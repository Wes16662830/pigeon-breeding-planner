// Spreadsheet import — bring a whole loft in from another program's export
// (PigeonDB "Export to CSV", Pigeon Planner, Excel saved as CSV…) instead
// of scanning sheets one at a time. No two programs name their columns the
// same, so the flow is: parse → guess which column is which (`guessMapping`)
// → the operator confirms/fixes the mapping → `rowsToImport` → server-side
// `planImport` turns rows into linked Bird records.
//
// Unlike a scanned pedigree, a spreadsheet export is the fancier's own
// structured data — nothing is read by a model — so imported birds are
// saved `verified` and skip the Phase 2 review screen.
//
// Pure (no I/O): parsing and mapping run in the browser, `planImport` runs
// on whichever backend (Express or Worker) receives the rows.

import type { Bird, BirdMarkers, BirdRole, DistanceCategory, Sex } from './types.js';
import { normaliseRing } from './ring.js';

// ---- CSV parsing ------------------------------------------------------------

/** RFC 4180-ish: quoted fields, doubled quotes, CRLF. Delimiter is sniffed from the header line (`,` `;` or tab). */
export function parseCsv(text: string): string[][] {
  const clean = text.replace(/^﻿/, '');
  const firstLine = clean.split(/\r?\n/, 1)[0] ?? '';
  const delimiter = [',', ';', '\t'].map((d) => ({ d, n: firstLine.split(d).length })).sort((a, b) => b.n - a.n)[0].d;

  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < clean.length; i++) {
    const ch = clean[i];
    if (inQuotes) {
      if (ch === '"' && clean[i + 1] === '"') {
        field += '"';
        i++;
      } else if (ch === '"') inQuotes = false;
      else field += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === delimiter) {
      row.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && clean[i + 1] === '\n') i++;
      row.push(field);
      field = '';
      if (row.some((f) => f.trim())) rows.push(row);
      row = [];
    } else field += ch;
  }
  row.push(field);
  if (row.some((f) => f.trim())) rows.push(row);
  return rows.map((r) => r.map((f) => f.trim()));
}

// ---- column mapping ---------------------------------------------------------

export type ImportField =
  | 'ring'
  | 'year'
  | 'name'
  | 'sex'
  | 'colour'
  | 'breeder'
  | 'sireRing'
  | 'damRing'
  | 'notes'
  | 'family'
  | 'strain'
  | 'foundationBird'
  | 'eyeSign'
  | 'category'
  | 'acePoints'
  | 'prizePercent'
  | 'bestPerformance'
  | 'role';

export const IMPORT_FIELDS: { field: ImportField; label: string; synonyms: string[] }[] = [
  { field: 'ring', label: 'Ring / band number', synonyms: ['ring', 'ring number', 'ringnumber', 'ring no', 'band', 'band number', 'band no', 'pigeon', 'pigeon id', 'id', 'ringnr'] },
  { field: 'year', label: 'Year (if separate from ring)', synonyms: ['year', 'yr', 'hatch year', 'birth year', 'jaar'] },
  { field: 'name', label: 'Name', synonyms: ['name', 'pigeon name', 'naam'] },
  { field: 'sex', label: 'Sex', synonyms: ['sex', 'gender', 'geslacht'] },
  { field: 'colour', label: 'Colour', synonyms: ['colour', 'color', 'kleur'] },
  { field: 'breeder', label: 'Breeder / loft', synonyms: ['breeder', 'loft', 'owner', 'fancier', 'kweker'] },
  { field: 'sireRing', label: 'Sire ring', synonyms: ['sire', 'father', 'sire ring', 'sire band', 'father ring', 'vader', 'cock parent'] },
  { field: 'damRing', label: 'Dam ring', synonyms: ['dam', 'mother', 'dam ring', 'dam band', 'mother ring', 'moeder', 'hen parent'] },
  { field: 'notes', label: 'Notes / remarks', synonyms: ['notes', 'note', 'remarks', 'comments', 'description', 'info', 'opmerking'] },
  { field: 'family', label: 'Family / line', synonyms: ['family', 'line', 'bloodline', 'blood line', 'lijn'] },
  { field: 'strain', label: 'Strain', synonyms: ['strain', 'strains', 'breed', 'origin', 'afstamming'] },
  { field: 'foundationBird', label: 'Foundation / champion ancestor', synonyms: ['foundation', 'foundation bird', 'champion', 'base bird', 'key ancestor'] },
  { field: 'eyeSign', label: 'Eye sign', synonyms: ['eye', 'eye sign', 'eyesign', 'eye colour', 'eye color'] },
  { field: 'category', label: 'Distance category', synonyms: ['category', 'distance', 'distance category', 'type', 'specialty', 'speciality'] },
  { field: 'acePoints', label: 'Ace points', synonyms: ['ace points', 'ace', 'acepoints', 'points'] },
  { field: 'prizePercent', label: 'Prize %', synonyms: ['prize %', 'prize percent', 'prize percentage', 'prizes %', '% prizes'] },
  { field: 'bestPerformance', label: 'Best performance', synonyms: ['best result', 'best performance', 'best', 'achievements', 'results'] },
  { field: 'role', label: 'Status / role', synonyms: ['status', 'role', 'loft status', 'use'] },
];

export type ColumnMapping = Partial<Record<ImportField, number>>; // field → column index

const squash = (s: string) => s.toLowerCase().replace(/[^a-z0-9%]+/g, ' ').trim();

export function guessMapping(header: string[]): ColumnMapping {
  const mapping: ColumnMapping = {};
  const used = new Set<number>();
  const cols = header.map(squash);
  // Exact synonym matches first, then "header contains synonym" — so a
  // column literally called "Sire" beats "Sire's sire" for sireRing.
  for (const pass of ['exact', 'contains'] as const) {
    for (const { field, synonyms } of IMPORT_FIELDS) {
      if (mapping[field] !== undefined) continue;
      const idx = cols.findIndex((c, i) => !used.has(i) && synonyms.some((syn) => (pass === 'exact' ? c === syn : c.includes(syn) && syn.length > 2)));
      if (idx >= 0) {
        mapping[field] = idx;
        used.add(idx);
      }
    }
  }
  return mapping;
}

// ---- row → ImportRow --------------------------------------------------------

export interface ImportRow {
  ring: string;
  name?: string;
  sex: Sex;
  colour?: string;
  breeder?: string;
  sireRing?: string;
  damRing?: string;
  notes?: string;
  markers: BirdMarkers;
}

export function parseSex(v: string | undefined): Sex {
  const s = (v ?? '').trim().toLowerCase();
  if (['cock', 'c', 'male', 'm', 'man', 'doffer', 'doffe', '1.0', 'v'].includes(s)) return 'cock';
  if (['hen', 'h', 'female', 'f', 'w', 'duivin', '0.1'].includes(s)) return 'hen';
  return 'unknown';
}

function parseCategory(v: string | undefined): DistanceCategory | undefined {
  const s = (v ?? '').toLowerCase();
  if (!s) return undefined;
  if (s.includes('marathon') || s.includes('extreme')) return 'marathon';
  if (s.includes('long')) return 'long';
  if (s.includes('mid')) return 'middle';
  if (s.includes('sprint') || s.includes('short') || s.includes('speed')) return 'sprint';
  return undefined;
}

function parseRole(v: string | undefined): BirdRole | undefined {
  const s = (v ?? '').toLowerCase();
  if (!s) return undefined;
  if (s.includes('proven')) return 'proven-breeder';
  if (s.includes('stock') || s.includes('breed')) return 'stock';
  if (s.includes('young') || s.includes('yb') || s.includes('squeaker')) return 'young';
  if (s.includes('retire') || s.includes('dead') || s.includes('sold') || s.includes('lost')) return 'retired';
  if (s.includes('rac') || s.includes('active')) return 'racer';
  return undefined;
}

function num(v: string | undefined): number | undefined {
  if (!v) return undefined;
  const n = Number(v.replace('%', '').replace(',', '.'));
  return Number.isFinite(n) ? n : undefined;
}

/** Appends the year column to the ring only when the ring doesn't already carry a 2- or 4-digit year. */
function withYear(ring: string, year: string | undefined): string {
  if (!year?.trim()) return ring;
  const y = year.trim();
  const short = y.length === 4 ? y.slice(2) : y;
  const tokens = ring.split(/[\s\-/.]+/);
  if (tokens.includes(y) || tokens.includes(short)) return ring;
  return `${ring} ${y}`;
}

export function rowsToImport(rows: string[][], mapping: ColumnMapping): { rows: ImportRow[]; skipped: number } {
  const get = (row: string[], f: ImportField) => {
    const i = mapping[f];
    const v = i === undefined ? undefined : row[i]?.trim();
    return v ? v : undefined;
  };
  const out: ImportRow[] = [];
  let skipped = 0;
  for (const row of rows) {
    const rawRing = get(row, 'ring');
    if (!rawRing) {
      skipped++;
      continue;
    }
    const markers: BirdMarkers = {
      family: get(row, 'family'),
      strain: get(row, 'strain'),
      foundationBird: get(row, 'foundationBird'),
      eyeSign: get(row, 'eyeSign'),
      category: parseCategory(get(row, 'category')),
      acePoints: num(get(row, 'acePoints')),
      prizePercent: num(get(row, 'prizePercent')),
      bestPerformance: get(row, 'bestPerformance'),
      role: parseRole(get(row, 'role')),
    };
    out.push({
      ring: withYear(rawRing, get(row, 'year')),
      name: get(row, 'name'),
      sex: parseSex(get(row, 'sex')),
      colour: get(row, 'colour'),
      breeder: get(row, 'breeder'),
      sireRing: get(row, 'sireRing'),
      damRing: get(row, 'damRing'),
      notes: get(row, 'notes'),
      markers: stripEmpty(markers),
    });
  }
  return { rows: out, skipped };
}

function stripEmpty<T extends object>(o: T): T {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== '')) as T;
}

// ---- server side: rows → linked Bird records --------------------------------

export interface ImportPlan {
  birds: Bird[];
  created: number;
  updated: number;
  placeholderParents: number;
  // Rings whose sire/dam in the file differ from a scanned pedigree already
  // on file. Both records are kept; the operator decides which is right.
  parentConflicts: string[];
}

export const IMPORT_SOURCE_PREFIX = 'import:';

/**
 * Turns import rows into Bird records ready for saveBirds (which handles
 * parent links in any order). Re-importing the same export updates the
 * rows a previous import created (matched by ring) instead of duplicating
 * them, and only overwrites fields the new row actually has a value for —
 * so markers typed in by hand since the last import survive. Rows from
 * scanned pedigrees are never touched; they're linked to imported birds by
 * ring through cross-referencing, same as any two uploads.
 *
 * A sire/dam ring that isn't a row in the file becomes a minimal
 * placeholder bird (ring + sex only) so the link isn't lost.
 */
export function planImport(rows: ImportRow[], existing: Bird[], sourceFile: string, newId: () => string): ImportPlan {
  const previousImports = new Map<string, Bird>();
  for (const b of existing) {
    if (b.sourceFile?.startsWith(IMPORT_SOURCE_PREFIX) && b.ringNormalised && !previousImports.has(b.ringNormalised)) previousImports.set(b.ringNormalised, b);
  }

  const byRing = new Map<string, Bird>();
  let created = 0;
  let updated = 0;
  let placeholderParents = 0;

  function upsert(ring: string, patch: Partial<Bird>, isPlaceholder: boolean): Bird {
    const key = normaliseRing(ring) ?? ring.trim().toUpperCase();
    const inBatch = byRing.get(key);
    if (inBatch) {
      // A placeholder created for an earlier row's parent, now reached as a
      // real row (or the file lists a bird twice) — fill in, don't replace.
      if (!isPlaceholder) Object.assign(inBatch, mergeDefined(inBatch, patch));
      return inBatch;
    }
    const prior = previousImports.get(key);
    const base: Bird = prior ?? {
      id: newId(),
      ring: ring.trim(),
      ringNormalised: normaliseRing(ring),
      sex: 'unknown',
      notes: [],
      results: [],
      confidence: 1,
      verified: true,
      sourceFile,
    };
    const bird: Bird = isPlaceholder ? { ...base } : { ...base, ...mergeDefined(base, patch) };
    if (prior) updated++;
    else if (isPlaceholder) placeholderParents++;
    else created++;
    byRing.set(key, bird);
    return bird;
  }

  // Real rows first so a bird that's both a row and someone's parent is
  // counted as a row, not a placeholder.
  const real = rows.map((r) =>
    upsert(r.ring, {
      name: r.name,
      sex: r.sex === 'unknown' ? undefined : r.sex,
      colour: r.colour,
      breeder: r.breeder,
      notes: r.notes ? [r.notes] : undefined,
      markers: Object.keys(r.markers).length ? r.markers : undefined,
    }, false),
  );
  rows.forEach((r, i) => {
    const bird = real[i];
    if (r.sireRing) {
      const sire = upsert(r.sireRing, {}, true);
      if (sire.sex === 'unknown') sire.sex = 'cock';
      bird.sireId = sire.id;
    }
    if (r.damRing) {
      const dam = upsert(r.damRing, {}, true);
      if (dam.sex === 'unknown') dam.sex = 'hen';
      bird.damId = dam.id;
    }
  });

  const existingById = new Map(existing.map((b) => [b.id, b]));
  const ringOf = (id?: string) => (id ? existingById.get(id)?.ringNormalised : undefined);
  const parentConflicts = new Set<string>();
  for (const r of rows) {
    const key = normaliseRing(r.ring);
    const fileSire = r.sireRing ? normaliseRing(r.sireRing) : undefined;
    const fileDam = r.damRing ? normaliseRing(r.damRing) : undefined;
    for (const other of existing) {
      if (other.ringNormalised !== key || other.sourceFile?.startsWith(IMPORT_SOURCE_PREFIX)) continue;
      const s = ringOf(other.sireId);
      const d = ringOf(other.damId);
      if ((fileSire && s && s !== fileSire) || (fileDam && d && d !== fileDam)) parentConflicts.add(r.ring);
    }
  }

  return { birds: [...byRing.values()], created, updated, placeholderParents, parentConflicts: [...parentConflicts] };
}

function mergeDefined(base: Bird, patch: Partial<Bird>): Partial<Bird> {
  const out: Partial<Bird> = {};
  for (const [k, v] of Object.entries(patch) as [keyof Bird, unknown][]) {
    if (v === undefined) continue;
    if (k === 'markers') out.markers = { ...base.markers, ...(v as BirdMarkers) };
    else (out as Record<string, unknown>)[k] = v;
  }
  return out;
}

import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Bird, Pairing, Result, Sex } from '../shared/types.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.resolve(__dirname, '..', 'data');
const DB_PATH = process.env.PEDIGREE_DB_PATH ?? path.join(DATA_DIR, 'birds.db');

fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(path.join(DATA_DIR, 'uploads'), { recursive: true });
fs.mkdirSync(path.join(DATA_DIR, 'exports'), { recursive: true });

export const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// schema.sql uses CREATE TABLE IF NOT EXISTS, so it's a no-op against a
// birds.db from before folders/reuse existed — child_pedigrees there still
// has the old (NOT NULL upload ids, no folder_id) shape. Detect that and
// apply the same rebuild as migrations/0003_folders_and_reuse.sql, BEFORE
// schema.sql runs (schema.sql's `CREATE INDEX ... (folder_id)` would fail
// against the old shape otherwise). Only relevant when child_pedigrees
// already exists — a brand new database file has nothing to migrate, and
// schema.sql below creates it fresh in the new shape directly.
const tableExists = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='child_pedigrees'").get();
if (tableExists) {
  const childPedigreeColumns = db.prepare('PRAGMA table_info(child_pedigrees)').all() as { name: string }[];
  const hasFolderId = childPedigreeColumns.some((c) => c.name === 'folder_id');
  if (!hasFolderId) {
    const migration = fs.readFileSync(path.resolve(__dirname, '..', 'migrations', '0003_folders_and_reuse.sql'), 'utf-8');
    db.exec(migration);
    console.log('[db] Migrated child_pedigrees to support folders and reused-bird pairings.');
  }

  // 0004: bird photos + sheet templates — plain ADD COLUMN, no rebuild.
  const birdColumns = db.prepare('PRAGMA table_info(birds)').all() as { name: string }[];
  const hasPhotoUrl = birdColumns.some((c) => c.name === 'photo_url');
  const childPedigreeColumns2 = db.prepare('PRAGMA table_info(child_pedigrees)').all() as { name: string }[];
  const hasTemplate = childPedigreeColumns2.some((c) => c.name === 'template');
  // Each statement is guarded independently rather than running
  // migrations/0004_photos_and_templates.sql verbatim, since re-running
  // `ALTER TABLE ADD COLUMN` on a column that already exists errors — one
  // of the two might already be present depending on when this was last run.
  if (!hasPhotoUrl) db.exec('ALTER TABLE birds ADD COLUMN photo_url TEXT');
  if (!hasTemplate) db.exec(`ALTER TABLE child_pedigrees ADD COLUMN template TEXT NOT NULL DEFAULT 'classic-gold'`);
  if (!hasPhotoUrl || !hasTemplate) {
    console.log('[db] Migrated birds/child_pedigrees to support photos and templates.');
  }

  // 0005: per-bird markers — plain ADD COLUMN, same pattern as 0004.
  if (!birdColumns.some((c) => c.name === 'markers_json')) {
    db.exec('ALTER TABLE birds ADD COLUMN markers_json TEXT');
    console.log('[db] Migrated birds to support breeding/performance markers.');
  }
}

const schema = fs.readFileSync(path.resolve(__dirname, '..', 'schema.sql'), 'utf-8');
db.exec(schema);

// ---- row <-> Bird mapping -------------------------------------------------

interface BirdRow {
  id: string;
  ring: string;
  ring_normalised: string | null;
  name: string | null;
  colour: string | null;
  sex: Sex;
  breeder: string | null;
  loft_address: string | null;
  notes_json: string;
  notes_en_json: string | null;
  results_json: string;
  sire_id: string | null;
  dam_id: string | null;
  source_file: string | null;
  photo_url: string | null;
  markers_json: string | null;
  confidence: number;
  verified: number;
  created_at: string;
  updated_at: string;
}

function rowToBird(row: BirdRow): Bird {
  return {
    id: row.id,
    ring: row.ring,
    ringNormalised: row.ring_normalised ?? undefined,
    name: row.name ?? undefined,
    colour: row.colour ?? undefined,
    sex: row.sex,
    breeder: row.breeder ?? undefined,
    loftAddress: row.loft_address ?? undefined,
    notes: JSON.parse(row.notes_json ?? '[]'),
    notesEn: row.notes_en_json ? JSON.parse(row.notes_en_json) : undefined,
    results: JSON.parse(row.results_json ?? '[]') as Result[],
    sireId: row.sire_id ?? undefined,
    damId: row.dam_id ?? undefined,
    sourceFile: row.source_file ?? undefined,
    photoUrl: row.photo_url ?? undefined,
    markers: row.markers_json ? JSON.parse(row.markers_json) : undefined,
    confidence: row.confidence,
    verified: !!row.verified,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

const upsertStmt = db.prepare(`
  INSERT INTO birds (id, ring, ring_normalised, name, colour, sex, breeder, loft_address,
                      notes_json, notes_en_json, results_json, sire_id, dam_id, source_file,
                      markers_json, confidence, verified, updated_at)
  VALUES (@id, @ring, @ringNormalised, @name, @colour, @sex, @breeder, @loftAddress,
          @notesJson, @notesEnJson, @resultsJson, @sireId, @damId, @sourceFile,
          @markersJson, @confidence, @verified, strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  ON CONFLICT(id) DO UPDATE SET
    ring = excluded.ring,
    ring_normalised = excluded.ring_normalised,
    name = excluded.name,
    colour = excluded.colour,
    sex = excluded.sex,
    breeder = excluded.breeder,
    loft_address = excluded.loft_address,
    notes_json = excluded.notes_json,
    notes_en_json = excluded.notes_en_json,
    results_json = excluded.results_json,
    sire_id = excluded.sire_id,
    dam_id = excluded.dam_id,
    source_file = excluded.source_file,
    markers_json = excluded.markers_json,
    confidence = excluded.confidence,
    verified = excluded.verified,
    updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
`);

export function saveBird(bird: Bird): void {
  upsertStmt.run({
    id: bird.id,
    ring: bird.ring,
    ringNormalised: bird.ringNormalised ?? null,
    name: bird.name ?? null,
    colour: bird.colour ?? null,
    sex: bird.sex,
    breeder: bird.breeder ?? null,
    loftAddress: bird.loftAddress ?? null,
    notesJson: JSON.stringify(bird.notes ?? []),
    notesEnJson: bird.notesEn ? JSON.stringify(bird.notesEn) : null,
    resultsJson: JSON.stringify(bird.results ?? []),
    sireId: bird.sireId ?? null,
    damId: bird.damId ?? null,
    sourceFile: bird.sourceFile ?? null,
    markersJson: bird.markers ? JSON.stringify(bird.markers) : null,
    confidence: bird.confidence,
    verified: bird.verified ? 1 : 0,
  });
}

const linkParentsStmt = db.prepare(`UPDATE birds SET sire_id = ?, dam_id = ? WHERE id = ?`);

// Extraction doesn't guarantee a bird's ancestors appear earlier in the
// array than the bird itself (the model has no reason to order its output
// that way) — but sire_id/dam_id are foreign keys into this same table, so
// inserting bird A before bird B (A's own sire, referenced by A.sireId)
// would fail the FK check the instant A is inserted. Two passes sidesteps
// the ordering requirement entirely: insert every bird with no parent
// links first (guaranteed FK-safe — nothing references anything yet), then
// wire up sire_id/dam_id once every bird in the batch is guaranteed to
// exist. Both passes run in one transaction, so this is invisible outside
// this function.
export function saveBirds(birds: Bird[]): void {
  const tx = db.transaction((list: Bird[]) => {
    for (const b of list) saveBird({ ...b, sireId: undefined, damId: undefined });
    for (const b of list) {
      if (b.sireId || b.damId) linkParentsStmt.run(b.sireId ?? null, b.damId ?? null, b.id);
    }
  });
  tx(birds);
}

export function getBird(id: string): Bird | undefined {
  const row = db.prepare('SELECT * FROM birds WHERE id = ?').get(id) as BirdRow | undefined;
  return row ? rowToBird(row) : undefined;
}

export function getAllBirds(): Bird[] {
  const rows = db.prepare('SELECT * FROM birds ORDER BY created_at').all() as BirdRow[];
  return rows.map(rowToBird);
}

export function getBirdsBySourceFile(sourceFile: string): Bird[] {
  const rows = db.prepare('SELECT * FROM birds WHERE source_file = ?').all(sourceFile) as BirdRow[];
  return rows.map(rowToBird);
}

export function findByRingNormalised(ringNormalised: string): Bird[] {
  const rows = db.prepare('SELECT * FROM birds WHERE ring_normalised = ?').all(ringNormalised) as BirdRow[];
  return rows.map(rowToBird);
}

export function deleteBird(id: string): void {
  db.prepare('DELETE FROM birds WHERE id = ?').run(id);
}

export function setBirdPhoto(id: string, photoUrl: string | null): void {
  db.prepare(`UPDATE birds SET photo_url = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?`).run(photoUrl, id);
}

// ---- uploads ---------------------------------------------------------------

export interface UploadRow {
  id: string;
  original_filename: string;
  stored_path: string;
  mime_type: string | null;
  root_bird_id: string | null;
  raw_extraction_json: string | null;
  verified: number;
  created_at: string;
  updated_at: string;
}

export function saveUpload(u: {
  id: string;
  originalFilename: string;
  storedPath: string;
  mimeType?: string;
  rootBirdId?: string;
  rawExtraction?: unknown;
  verified?: boolean;
}): void {
  db.prepare(`
    INSERT INTO uploads (id, original_filename, stored_path, mime_type, root_bird_id, raw_extraction_json, verified)
    VALUES (@id, @originalFilename, @storedPath, @mimeType, @rootBirdId, @rawExtraction, @verified)
    ON CONFLICT(id) DO UPDATE SET
      root_bird_id = excluded.root_bird_id,
      raw_extraction_json = excluded.raw_extraction_json,
      verified = excluded.verified,
      updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
  `).run({
    id: u.id,
    originalFilename: u.originalFilename,
    storedPath: u.storedPath,
    mimeType: u.mimeType ?? null,
    rootBirdId: u.rootBirdId ?? null,
    rawExtraction: u.rawExtraction ? JSON.stringify(u.rawExtraction) : null,
    verified: u.verified ? 1 : 0,
  });
}

export function getUpload(id: string): UploadRow | undefined {
  return db.prepare('SELECT * FROM uploads WHERE id = ?').get(id) as UploadRow | undefined;
}

export function getAllUploads(): UploadRow[] {
  return db.prepare('SELECT * FROM uploads ORDER BY created_at').all() as UploadRow[];
}

export function setUploadVerified(id: string, verified: boolean): void {
  db.prepare(`UPDATE uploads SET verified = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?`).run(verified ? 1 : 0, id);
}

// ---- child pedigrees ---------------------------------------------------------------

export interface ChildPedigreeRow {
  id: string;
  child_bird_id: string;
  sire_upload_id: string | null;
  dam_upload_id: string | null;
  prose_json: string;
  layout_json: string | null;
  ring_field_order: string;
  print_variant: string;
  template: string;
  folder_id: string | null;
  created_at: string;
  updated_at: string;
}

export function saveChildPedigree(row: {
  id: string;
  childBirdId: string;
  // Nullable — a side reusing an already-verified bird has no fresh upload
  // of its own (see server/lib/merge.ts).
  sireUploadId?: string;
  damUploadId?: string;
  prose: unknown;
  layout?: unknown;
  ringFieldOrder?: string;
  printVariant?: string;
  // src/lib/templates.ts is the source of truth for valid ids.
  template?: string;
}): void {
  db.prepare(`
    INSERT INTO child_pedigrees (id, child_bird_id, sire_upload_id, dam_upload_id, prose_json, layout_json, ring_field_order, print_variant, template)
    VALUES (@id, @childBirdId, @sireUploadId, @damUploadId, @proseJson, @layoutJson, @ringFieldOrder, @printVariant, @template)
    ON CONFLICT(id) DO UPDATE SET
      prose_json = excluded.prose_json,
      layout_json = excluded.layout_json,
      ring_field_order = excluded.ring_field_order,
      print_variant = excluded.print_variant,
      template = excluded.template,
      updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
  `).run({
    id: row.id,
    childBirdId: row.childBirdId,
    sireUploadId: row.sireUploadId ?? null,
    damUploadId: row.damUploadId ?? null,
    proseJson: JSON.stringify(row.prose ?? {}),
    layoutJson: row.layout ? JSON.stringify(row.layout) : null,
    ringFieldOrder: row.ringFieldOrder ?? 'ring-year',
    printVariant: row.printVariant ?? 'black-header',
    template: row.template ?? 'classic-gold',
  });
}

export function getChildPedigree(id: string): ChildPedigreeRow | undefined {
  return db.prepare('SELECT * FROM child_pedigrees WHERE id = ?').get(id) as ChildPedigreeRow | undefined;
}

export function getAllChildPedigrees(): ChildPedigreeRow[] {
  return db.prepare('SELECT * FROM child_pedigrees ORDER BY created_at DESC').all() as ChildPedigreeRow[];
}

// Removes the sheet/certificate row only — deliberately does NOT touch the
// underlying bird/ancestor data, which stays available for cross-referencing
// and for reuse as a parent in a future pairing (that's the whole point of
// storing every bird from every upload — see build brief §5 Phase 5).
export function deleteChildPedigree(id: string): void {
  db.prepare('DELETE FROM child_pedigrees WHERE id = ?').run(id);
}

export function setChildPedigreeFolder(id: string, folderId: string | null): void {
  db.prepare(`UPDATE child_pedigrees SET folder_id = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?`).run(folderId, id);
}

// ---- folders ---------------------------------------------------------------

export interface FolderRow {
  id: string;
  name: string;
  created_at: string;
  updated_at: string;
}

export function getAllFolders(): FolderRow[] {
  return db.prepare('SELECT * FROM folders ORDER BY name COLLATE NOCASE').all() as FolderRow[];
}

export function createFolder(id: string, name: string): FolderRow {
  db.prepare('INSERT INTO folders (id, name) VALUES (?, ?)').run(id, name);
  return db.prepare('SELECT * FROM folders WHERE id = ?').get(id) as FolderRow;
}

export function renameFolder(id: string, name: string): void {
  db.prepare(`UPDATE folders SET name = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?`).run(name, id);
}

// Upsert-by-id, unlike createFolder's plain INSERT — used by backup
// restore, where the folder may already exist (re-importing the same
// backup, or importing into a database that already has some overlap).
export function upsertFolder(id: string, name: string): void {
  db.prepare(
    `INSERT INTO folders (id, name) VALUES (?, ?)
     ON CONFLICT(id) DO UPDATE SET name = excluded.name, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')`,
  ).run(id, name);
}

// Deletes the folder only — pedigrees inside it fall back to "unfiled"
// (folder_id becomes NULL via ON DELETE behaviour we implement explicitly
// here, since SQLite's default FK action is NO ACTION).
export function deleteFolder(id: string): void {
  db.prepare('UPDATE child_pedigrees SET folder_id = NULL WHERE folder_id = ?').run(id);
  db.prepare('DELETE FROM folders WHERE id = ?').run(id);
}

// ---- settings ---------------------------------------------------------------
// Free-form key/value store. Currently used for the user-supplied Anthropic
// API key entered on the Settings page (see server/lib/anthropic.ts) — kept
// generic in case other per-install settings show up later.

export function getSetting(key: string): string | undefined {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined;
  return row?.value;
}

export function setSetting(key: string, value: string): void {
  db.prepare(
    `INSERT INTO settings (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
  ).run(key, value);
}

export function deleteSetting(key: string): void {
  db.prepare('DELETE FROM settings WHERE key = ?').run(key);
}

// ---- pairings ----------------------------------------------------------------

interface PairingRow {
  id: string;
  sire_id: string;
  dam_id: string;
  season: number;
  paired_on: string | null;
  status: Pairing['status'];
  notes: string | null;
  prediction_json: string | null;
  created_at: string;
  updated_at: string;
}

function rowToPairing(row: PairingRow): Pairing {
  return {
    id: row.id,
    sireId: row.sire_id,
    damId: row.dam_id,
    season: row.season,
    pairedOn: row.paired_on ?? undefined,
    status: row.status,
    notes: row.notes ?? undefined,
    prediction: row.prediction_json ? JSON.parse(row.prediction_json) : undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function getAllPairings(): Pairing[] {
  return (db.prepare('SELECT * FROM pairings ORDER BY season DESC, created_at DESC').all() as PairingRow[]).map(rowToPairing);
}

export function getPairing(id: string): Pairing | undefined {
  const row = db.prepare('SELECT * FROM pairings WHERE id = ?').get(id) as PairingRow | undefined;
  return row ? rowToPairing(row) : undefined;
}

// Upsert by id — also what backup restore uses.
export function savePairing(p: Pairing): void {
  db.prepare(
    `INSERT INTO pairings (id, sire_id, dam_id, season, paired_on, status, notes, prediction_json, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ','now'))
     ON CONFLICT(id) DO UPDATE SET
       sire_id = excluded.sire_id,
       dam_id = excluded.dam_id,
       season = excluded.season,
       paired_on = excluded.paired_on,
       status = excluded.status,
       notes = excluded.notes,
       prediction_json = excluded.prediction_json,
       updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')`,
  ).run(p.id, p.sireId, p.damId, p.season, p.pairedOn ?? null, p.status, p.notes ?? null, p.prediction ? JSON.stringify(p.prediction) : null);
}

export function deletePairing(id: string): void {
  db.prepare('DELETE FROM pairings WHERE id = ?').run(id);
}

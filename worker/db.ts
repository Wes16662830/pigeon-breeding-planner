// D1 access layer — the Cloudflare equivalent of server/db.ts. Same schema
// (schema.sql / migrations/0001_init.sql), same row<->Bird mapping, but
// async (D1 is a fetch-based binding, not a synchronous local file) and
// takes the D1Database binding as an explicit argument rather than holding
// a module-level singleton, since bindings only exist per-request in a
// Worker.

import type { Bird, Pairing, Result, Sex } from '../shared/types.js';

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

function saveBirdStatement(db: D1Database, bird: Bird): D1PreparedStatement {
  return db
    .prepare(
      `INSERT INTO birds (id, ring, ring_normalised, name, colour, sex, breeder, loft_address,
                          notes_json, notes_en_json, results_json, sire_id, dam_id, source_file,
                          markers_json, confidence, verified, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ','now'))
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
         updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')`,
    )
    .bind(
      bird.id,
      bird.ring,
      bird.ringNormalised ?? null,
      bird.name ?? null,
      bird.colour ?? null,
      bird.sex,
      bird.breeder ?? null,
      bird.loftAddress ?? null,
      JSON.stringify(bird.notes ?? []),
      bird.notesEn ? JSON.stringify(bird.notesEn) : null,
      JSON.stringify(bird.results ?? []),
      bird.sireId ?? null,
      bird.damId ?? null,
      bird.sourceFile ?? null,
      bird.markers ? JSON.stringify(bird.markers) : null,
      bird.confidence,
      bird.verified ? 1 : 0,
    );
}

export async function saveBird(db: D1Database, bird: Bird): Promise<void> {
  await saveBirdStatement(db, bird).run();
}

// Same two-pass shape as saveBirds, but as one D1 batch (a single round
// trip, applied atomically) — for spreadsheet imports, where a few hundred
// birds as sequential awaits would be slow and could run into the Worker's
// per-invocation query limit.
export async function saveBirdsBatch(db: D1Database, birds: Bird[]): Promise<void> {
  if (!birds.length) return;
  await db.batch([
    ...birds.map((b) => saveBirdStatement(db, { ...b, sireId: undefined, damId: undefined })),
    ...birds
      .filter((b) => b.sireId || b.damId)
      .map((b) => db.prepare('UPDATE birds SET sire_id = ?, dam_id = ? WHERE id = ?').bind(b.sireId ?? null, b.damId ?? null, b.id)),
  ]);
}

// Extraction doesn't guarantee a bird's ancestors appear earlier in the
// array than the bird itself (the model has no reason to order its output
// that way) — but sire_id/dam_id are foreign keys into this same table, so
// inserting bird A before bird B (A's own sire, referenced by A.sireId)
// would fail the FK check the instant A is inserted. Two passes sidesteps
// the ordering requirement entirely: insert every bird with no parent
// links first (guaranteed FK-safe — nothing references anything yet), then
// wire up sire_id/dam_id once every bird in the batch is guaranteed to
// exist.
export async function saveBirds(db: D1Database, birds: Bird[]): Promise<void> {
  // D1 doesn't support better-sqlite3-style sync transactions; sequential
  // awaits are fine here — batches are small (one pedigree tree at a time).
  for (const b of birds) await saveBird(db, { ...b, sireId: undefined, damId: undefined });
  for (const b of birds) {
    if (b.sireId || b.damId) {
      await db.prepare('UPDATE birds SET sire_id = ?, dam_id = ? WHERE id = ?').bind(b.sireId ?? null, b.damId ?? null, b.id).run();
    }
  }
}

export async function getBird(db: D1Database, id: string): Promise<Bird | undefined> {
  const row = await db.prepare('SELECT * FROM birds WHERE id = ?').bind(id).first<BirdRow>();
  return row ? rowToBird(row) : undefined;
}

export async function getAllBirds(db: D1Database): Promise<Bird[]> {
  const { results } = await db.prepare('SELECT * FROM birds ORDER BY created_at').all<BirdRow>();
  return results.map(rowToBird);
}

export async function getBirdsBySourceFile(db: D1Database, sourceFile: string): Promise<Bird[]> {
  const { results } = await db.prepare('SELECT * FROM birds WHERE source_file = ?').bind(sourceFile).all<BirdRow>();
  return results.map(rowToBird);
}

export async function deleteBird(db: D1Database, id: string): Promise<void> {
  await db.prepare('DELETE FROM birds WHERE id = ?').bind(id).run();
}

export async function setBirdPhoto(db: D1Database, id: string, photoUrl: string | null): Promise<void> {
  await db
    .prepare(`UPDATE birds SET photo_url = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?`)
    .bind(photoUrl, id)
    .run();
}

// ---- uploads ---------------------------------------------------------------

export interface UploadRow {
  id: string;
  original_filename: string;
  stored_path: string; // R2 object key, in the Worker
  mime_type: string | null;
  root_bird_id: string | null;
  raw_extraction_json: string | null;
  verified: number;
  created_at: string;
  updated_at: string;
}

export async function saveUpload(
  db: D1Database,
  u: {
    id: string;
    originalFilename: string;
    storedPath: string;
    mimeType?: string;
    rootBirdId?: string;
    rawExtraction?: unknown;
    verified?: boolean;
  },
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO uploads (id, original_filename, stored_path, mime_type, root_bird_id, raw_extraction_json, verified)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         root_bird_id = excluded.root_bird_id,
         raw_extraction_json = excluded.raw_extraction_json,
         verified = excluded.verified,
         updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')`,
    )
    .bind(
      u.id,
      u.originalFilename,
      u.storedPath,
      u.mimeType ?? null,
      u.rootBirdId ?? null,
      u.rawExtraction ? JSON.stringify(u.rawExtraction) : null,
      u.verified ? 1 : 0,
    )
    .run();
}

export async function getUpload(db: D1Database, id: string): Promise<UploadRow | undefined> {
  const row = await db.prepare('SELECT * FROM uploads WHERE id = ?').bind(id).first<UploadRow>();
  return row ?? undefined;
}

export async function getAllUploads(db: D1Database): Promise<UploadRow[]> {
  const { results } = await db.prepare('SELECT * FROM uploads ORDER BY created_at').all<UploadRow>();
  return results;
}

export async function setUploadVerified(db: D1Database, id: string, verified: boolean): Promise<void> {
  await db
    .prepare(`UPDATE uploads SET verified = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?`)
    .bind(verified ? 1 : 0, id)
    .run();
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

export async function saveChildPedigree(
  db: D1Database,
  row: {
    id: string;
    childBirdId: string;
    // Nullable — a side reusing an already-verified bird has no fresh
    // upload of its own (see worker/lib/merge.ts).
    sireUploadId?: string;
    damUploadId?: string;
    prose: unknown;
    layout?: unknown;
    ringFieldOrder?: string;
    printVariant?: string;
    // src/lib/templates.ts is the source of truth for valid ids.
    template?: string;
  },
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO child_pedigrees (id, child_bird_id, sire_upload_id, dam_upload_id, prose_json, layout_json, ring_field_order, print_variant, template)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         prose_json = excluded.prose_json,
         layout_json = excluded.layout_json,
         ring_field_order = excluded.ring_field_order,
         print_variant = excluded.print_variant,
         template = excluded.template,
         updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')`,
    )
    .bind(
      row.id,
      row.childBirdId,
      row.sireUploadId ?? null,
      row.damUploadId ?? null,
      JSON.stringify(row.prose ?? {}),
      row.layout ? JSON.stringify(row.layout) : null,
      row.ringFieldOrder ?? 'ring-year',
      row.printVariant ?? 'black-header',
      row.template ?? 'classic-gold',
    )
    .run();
}

export async function getChildPedigree(db: D1Database, id: string): Promise<ChildPedigreeRow | undefined> {
  const row = await db.prepare('SELECT * FROM child_pedigrees WHERE id = ?').bind(id).first<ChildPedigreeRow>();
  return row ?? undefined;
}

export async function getAllChildPedigrees(db: D1Database): Promise<ChildPedigreeRow[]> {
  const { results } = await db.prepare('SELECT * FROM child_pedigrees ORDER BY created_at DESC').all<ChildPedigreeRow>();
  return results;
}

// Removes the sheet/certificate row only — the underlying bird/ancestor
// data stays available for cross-referencing and reuse (see server/db.ts's
// deleteChildPedigree comment — same reasoning applies here).
export async function deleteChildPedigree(db: D1Database, id: string): Promise<void> {
  await db.prepare('DELETE FROM child_pedigrees WHERE id = ?').bind(id).run();
}

export async function setChildPedigreeFolder(db: D1Database, id: string, folderId: string | null): Promise<void> {
  await db
    .prepare(`UPDATE child_pedigrees SET folder_id = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?`)
    .bind(folderId, id)
    .run();
}

// ---- folders ---------------------------------------------------------------

export interface FolderRow {
  id: string;
  name: string;
  created_at: string;
  updated_at: string;
}

export async function getAllFolders(db: D1Database): Promise<FolderRow[]> {
  const { results } = await db.prepare('SELECT * FROM folders ORDER BY name COLLATE NOCASE').all<FolderRow>();
  return results;
}

export async function createFolder(db: D1Database, id: string, name: string): Promise<FolderRow> {
  await db.prepare('INSERT INTO folders (id, name) VALUES (?, ?)').bind(id, name).run();
  const row = await db.prepare('SELECT * FROM folders WHERE id = ?').bind(id).first<FolderRow>();
  return row!;
}

export async function renameFolder(db: D1Database, id: string, name: string): Promise<void> {
  await db.prepare(`UPDATE folders SET name = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?`).bind(name, id).run();
}

// Upsert-by-id — used by backup restore, where the folder may already
// exist (re-importing the same backup, or overlapping with existing data).
export async function upsertFolder(db: D1Database, id: string, name: string): Promise<void> {
  await db
    .prepare(
      `INSERT INTO folders (id, name) VALUES (?, ?)
       ON CONFLICT(id) DO UPDATE SET name = excluded.name, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')`,
    )
    .bind(id, name)
    .run();
}

// Deletes the folder only — pedigrees inside it fall back to "unfiled".
export async function deleteFolder(db: D1Database, id: string): Promise<void> {
  await db.prepare('UPDATE child_pedigrees SET folder_id = NULL WHERE folder_id = ?').bind(id).run();
  await db.prepare('DELETE FROM folders WHERE id = ?').bind(id).run();
}

// ---- settings ---------------------------------------------------------------
// Same free-form key/value store as server/db.ts — see that file's comment.
// This is what lets the Anthropic API key be pasted in on the Settings page
// instead of requiring a `wrangler secret put` at deploy time.

export async function getSetting(db: D1Database, key: string): Promise<string | undefined> {
  const row = await db.prepare('SELECT value FROM settings WHERE key = ?').bind(key).first<{ value: string }>();
  return row?.value;
}

export async function setSetting(db: D1Database, key: string, value: string): Promise<void> {
  await db
    .prepare(`INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`)
    .bind(key, value)
    .run();
}

export async function deleteSetting(db: D1Database, key: string): Promise<void> {
  await db.prepare('DELETE FROM settings WHERE key = ?').bind(key).run();
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

export async function getAllPairings(db: D1Database): Promise<Pairing[]> {
  const { results } = await db.prepare('SELECT * FROM pairings ORDER BY season DESC, created_at DESC').all<PairingRow>();
  return results.map(rowToPairing);
}

export async function getPairing(db: D1Database, id: string): Promise<Pairing | undefined> {
  const row = await db.prepare('SELECT * FROM pairings WHERE id = ?').bind(id).first<PairingRow>();
  return row ? rowToPairing(row) : undefined;
}

// Upsert by id — also what backup restore uses.
export async function savePairing(db: D1Database, p: Pairing): Promise<void> {
  await db
    .prepare(
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
    )
    .bind(p.id, p.sireId, p.damId, p.season, p.pairedOn ?? null, p.status, p.notes ?? null, p.prediction ? JSON.stringify(p.prediction) : null)
    .run();
}

export async function deletePairing(db: D1Database, id: string): Promise<void> {
  await db.prepare('DELETE FROM pairings WHERE id = ?').bind(id).run();
}

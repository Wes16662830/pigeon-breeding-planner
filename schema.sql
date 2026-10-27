-- OudeLuck Pedigree Builder — local SQLite schema.
-- One file, no ORM, no auth. Mirrors shared/types.ts exactly.

CREATE TABLE IF NOT EXISTS birds (
  id                TEXT PRIMARY KEY,
  ring              TEXT NOT NULL,           -- verbatim, never overwritten
  ring_normalised   TEXT,                     -- derived matching key
  name              TEXT,
  colour            TEXT,
  sex               TEXT NOT NULL DEFAULT 'unknown' CHECK (sex IN ('cock','hen','unknown')),
  breeder           TEXT,
  loft_address      TEXT,
  notes_json        TEXT NOT NULL DEFAULT '[]',  -- JSON string[] verbatim source wording
  notes_en_json     TEXT,                        -- JSON string[] English translation, same index alignment
  results_json      TEXT NOT NULL DEFAULT '[]',  -- JSON Result[]
  sire_id           TEXT REFERENCES birds(id),
  dam_id            TEXT REFERENCES birds(id),
  source_file       TEXT,
  photo_url         TEXT,                        -- /uploads/photos/... — optional, set via POST /api/birds/:id/photo
  markers_json      TEXT,                        -- JSON BirdMarkers — the fancier's own assessment, never extracted
  confidence        REAL NOT NULL DEFAULT 1,
  verified          INTEGER NOT NULL DEFAULT 0,  -- 0/1, set true only via Phase 2 verification
  created_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE INDEX IF NOT EXISTS idx_birds_ring_normalised ON birds(ring_normalised);
CREATE INDEX IF NOT EXISTS idx_birds_sire ON birds(sire_id);
CREATE INDEX IF NOT EXISTS idx_birds_dam ON birds(dam_id);
CREATE INDEX IF NOT EXISTS idx_birds_source_file ON birds(source_file);

-- One row per uploaded source pedigree (parent sheet). Tracks the raw
-- extraction (untouched model output) separately from what ends up in
-- `birds`, so Phase 2 verification always has the original to diff against.
CREATE TABLE IF NOT EXISTS uploads (
  id                TEXT PRIMARY KEY,
  original_filename TEXT NOT NULL,
  stored_path       TEXT NOT NULL,            -- path under data/uploads
  mime_type         TEXT,
  root_bird_id      TEXT REFERENCES birds(id),-- the parent whose sheet this is
  raw_extraction_json TEXT,                    -- verbatim model JSON output, pre-edit
  verified          INTEGER NOT NULL DEFAULT 0,
  created_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- Named groupings for the Pedigrees list — purely organisational, no
-- behaviour hangs off which folder a pedigree is in.
CREATE TABLE IF NOT EXISTS folders (
  id                TEXT PRIMARY KEY,
  name              TEXT NOT NULL,
  created_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- A finished child sheet: two verified parent trees merged, with generated
-- prose. `prose_json` holds a PedigreeProse object.
--
-- sire_upload_id/dam_upload_id are nullable: a side only has an `uploads`
-- row when it came from a fresh scan extraction this time. Reusing a bird
-- already on file (a previous upload's root, or an earlier merge's child)
-- as a parent has no upload of its own — the bird itself being `verified`
-- is what the merge gates on either way (see server/lib/merge.ts).
CREATE TABLE IF NOT EXISTS child_pedigrees (
  id                TEXT PRIMARY KEY,
  child_bird_id     TEXT NOT NULL REFERENCES birds(id),
  sire_upload_id    TEXT REFERENCES uploads(id),
  dam_upload_id     TEXT REFERENCES uploads(id),
  prose_json        TEXT NOT NULL DEFAULT '{}',
  layout_json        TEXT,                     -- Phase 4 layout-mode edits (position/scale per box)
  ring_field_order  TEXT NOT NULL DEFAULT 'ring-year' CHECK (ring_field_order IN ('ring-year','year-ring')),
  print_variant     TEXT NOT NULL DEFAULT 'black-header' CHECK (print_variant IN ('black-header','white-panel')),
  template          TEXT NOT NULL DEFAULT 'classic-gold',  -- src/lib/templates.ts is the source of truth for valid ids
  folder_id         TEXT REFERENCES folders(id),
  created_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE INDEX IF NOT EXISTS idx_child_pedigrees_folder ON child_pedigrees(folder_id);

CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

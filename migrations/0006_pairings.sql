-- Adds the pairings table (breeding record). New table only, nothing
-- existing changes.
--
-- Apply once against your live database after pulling this update:
--   npm run db:migrate:0006:remote

-- Pairings made in the loft (see Pairing in shared/types.ts). Youngsters
-- aren't linked here — they're birds whose sire/dam match this pair.
CREATE TABLE IF NOT EXISTS pairings (
  id                TEXT PRIMARY KEY,
  sire_id           TEXT NOT NULL REFERENCES birds(id),
  dam_id            TEXT NOT NULL REFERENCES birds(id),
  season            INTEGER NOT NULL,
  paired_on         TEXT,
  status            TEXT NOT NULL DEFAULT 'planned' CHECK (status IN ('planned','active','ended')),
  notes             TEXT,
  prediction_json   TEXT,
  created_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE INDEX IF NOT EXISTS idx_pairings_season ON pairings(season);

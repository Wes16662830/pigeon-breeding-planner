-- Adds per-bird breeding/performance markers (family, strain, type
-- scores, performance category, breeding record) as one JSON column.
-- Additive and nullable, so a plain ALTER TABLE is enough.
--
-- Apply once against your live database after pulling this update:
--   npm run db:migrate:0005:remote

ALTER TABLE birds ADD COLUMN markers_json TEXT;

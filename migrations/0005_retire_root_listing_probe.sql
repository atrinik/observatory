-- Retire the directory root as a current listing contract while preserving its
-- service_probes row and append-only observations for historical inspection.
ALTER TABLE service_probes
  ADD COLUMN active INTEGER NOT NULL DEFAULT 1
  CHECK (active IN (0, 1));

UPDATE service_probes
SET active = 0
WHERE id = 'metaserver:listings:root';

-- Keep the public metaserver contract explicit: four independent static
-- listings are probed, while rendezvous remains an intentional Unknown until
-- an operator-safe aggregate source exists.
ALTER TABLE service_probes
  ADD COLUMN surface TEXT NOT NULL DEFAULT 'service'
  CHECK (surface IN ('service', 'listings', 'rendezvous'));

ALTER TABLE service_probes
  ADD COLUMN format TEXT
  CHECK (format IN ('root', 'html', 'json', 'xml') OR format IS NULL);

ALTER TABLE service_observations ADD COLUMN format TEXT;
ALTER TABLE service_observations ADD COLUMN generation TEXT;
ALTER TABLE service_observations ADD COLUMN entry_count INTEGER;
ALTER TABLE service_observations ADD COLUMN parity_key TEXT;

UPDATE service_probes
SET name = 'Classic listings · HTML',
    surface = 'listings',
    format = 'html'
WHERE id = 'metaserver';

INSERT OR IGNORE INTO service_probes
  (id, name, url, stack, stale_after_seconds, surface, format)
VALUES
  ('metaserver:listings:root', 'Classic listings · root',
    'https://classic.meta.atrinik.org/', 'default', 1800, 'listings', 'root'),
  ('metaserver:listings:json', 'Classic listings · JSON',
    'https://classic.meta.atrinik.org/index.json', 'default', 1800, 'listings', 'json'),
  ('metaserver:listings:xml', 'Classic listings · XML',
    'https://classic.meta.atrinik.org/index.xml', 'default', 1800, 'listings', 'xml'),
  ('metaserver:rendezvous', 'Rendezvous rooms',
    'https://rendezvous.meta.atrinik.org/', 'default', 1800, 'rendezvous', NULL);

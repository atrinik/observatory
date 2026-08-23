-- Keep existing D1 databases aligned with the attached Classic directory artifact.
UPDATE service_probes
SET url = 'https://classic.meta.atrinik.org/index.html'
WHERE id = 'metaserver';

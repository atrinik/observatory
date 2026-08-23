PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS component_coordinates (
  id TEXT PRIMARY KEY NOT NULL,
  repository TEXT NOT NULL,
  component TEXT NOT NULL,
  stack TEXT NOT NULL CHECK (stack IN ('default', 'classic')),
  generation TEXT NOT NULL CHECK (generation IN ('replacement', 'classic', 'shared')),
  UNIQUE (repository, component, stack)
);

CREATE TABLE IF NOT EXISTS github_deliveries (
  delivery_id TEXT PRIMARY KEY NOT NULL,
  event_name TEXT NOT NULL,
  payload_digest TEXT NOT NULL,
  received_at TEXT NOT NULL,
  outcome TEXT NOT NULL CHECK (outcome IN ('pending', 'accepted', 'ignored'))
);

CREATE TABLE IF NOT EXISTS coordinate_observations (
  id TEXT PRIMARY KEY NOT NULL,
  delivery_id TEXT NOT NULL REFERENCES github_deliveries(delivery_id),
  coordinate_id TEXT NOT NULL REFERENCES component_coordinates(id),
  kind TEXT NOT NULL CHECK (kind IN ('build', 'release', 'package', 'deployment')),
  status TEXT NOT NULL CHECK (status IN ('passed', 'failed', 'cancelled', 'running', 'unknown')),
  observed_at TEXT NOT NULL,
  received_at TEXT NOT NULL,
  ref TEXT,
  commit_sha TEXT,
  title TEXT NOT NULL,
  source_url TEXT,
  workflow_name TEXT,
  release_tag TEXT,
  package_url TEXT,
  artifact_url TEXT
);

CREATE INDEX IF NOT EXISTS coordinate_observations_coordinate_kind_time
  ON coordinate_observations (coordinate_id, kind, observed_at DESC, received_at DESC);

CREATE TABLE IF NOT EXISTS service_probes (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  url TEXT NOT NULL,
  stack TEXT NOT NULL CHECK (stack IN ('default', 'classic')),
  stale_after_seconds INTEGER NOT NULL CHECK (stale_after_seconds > 0)
);

CREATE TABLE IF NOT EXISTS service_observations (
  id TEXT PRIMARY KEY NOT NULL,
  probe_id TEXT NOT NULL REFERENCES service_probes(id),
  status TEXT NOT NULL CHECK (status IN ('passed', 'failed', 'cancelled', 'running', 'unknown')),
  observed_at TEXT NOT NULL,
  status_code INTEGER,
  response_ms INTEGER,
  error TEXT
);

CREATE INDEX IF NOT EXISTS service_observations_probe_time
  ON service_observations (probe_id, observed_at DESC);

INSERT OR IGNORE INTO component_coordinates
  (id, repository, component, stack, generation)
VALUES
  ('default:client', 'atrinik/client', 'client', 'default', 'replacement'),
  ('default:server', 'atrinik/server', 'server', 'default', 'replacement'),
  ('default:protocol', 'atrinik/protocol', 'protocol', 'default', 'replacement'),
  ('default:editor', 'atrinik/editor', 'editor', 'default', 'replacement'),
  ('default:renderer', 'atrinik/renderer', 'renderer', 'default', 'replacement'),
  ('default:content-toolkit', 'atrinik/content-toolkit', 'content-toolkit', 'default', 'replacement'),
  ('default:website', 'atrinik/website', 'website', 'default', 'replacement'),
  ('default:content', 'atrinik/content', 'content', 'default', 'shared'),
  ('default:sound', 'atrinik/sound', 'sound', 'default', 'shared'),
  ('default:resources', 'atrinik/resources', 'resources', 'default', 'shared'),
  ('default:metaserver-worker', 'atrinik/metaserver-worker', 'metaserver-worker', 'default', 'shared'),
  ('default:devcontainer', 'atrinik/devcontainer', 'devcontainer', 'default', 'shared'),
  ('default:github-settings', 'atrinik/github-settings', 'github-settings', 'default', 'shared'),
  ('default:observatory', 'atrinik/observatory', 'observatory', 'default', 'replacement'),
  ('classic:classic', 'atrinik/classic', 'classic', 'classic', 'classic'),
  ('classic:playtester', 'atrinik/playtester', 'playtester', 'classic', 'classic'),
  ('classic:tools', 'atrinik/tools', 'tools', 'classic', 'classic'),
  ('classic:content', 'atrinik/content', 'content', 'classic', 'shared'),
  ('classic:sound', 'atrinik/sound', 'sound', 'classic', 'shared'),
  ('classic:resources', 'atrinik/resources', 'resources', 'classic', 'shared'),
  ('classic:metaserver-worker', 'atrinik/metaserver-worker', 'metaserver-worker', 'classic', 'shared');

INSERT OR IGNORE INTO service_probes
  (id, name, url, stack, stale_after_seconds)
VALUES
  ('website', 'Atrinik website', 'https://atrinik.org/', 'default', 1800),
  ('metaserver', 'Atrinik metaserver', 'https://meta.atrinik.org/', 'default', 1800);

-- Deployment evidence is only meaningful for coordinates with a configured
-- deployment surface. Keep that capability explicit instead of inferring it
-- from whichever webhook observations happen to exist.
ALTER TABLE component_coordinates
  ADD COLUMN deployment_applicable INTEGER NOT NULL DEFAULT 1
  CHECK (deployment_applicable IN (0, 1));

UPDATE component_coordinates
SET deployment_applicable = 0
WHERE id IN (
  'default:client',
  'default:server',
  'default:protocol',
  'default:editor',
  'default:renderer',
  'default:content-toolkit',
  'default:content',
  'default:sound',
  'default:resources',
  'default:devcontainer',
  'default:github-settings',
  'classic:playtester',
  'classic:tools',
  'classic:content',
  'classic:sound',
  'classic:resources'
);

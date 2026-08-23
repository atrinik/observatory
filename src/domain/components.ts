import type { ComponentCoordinate, ServiceProbe } from "./types";

const defaultDefinitions = [
  ["client", "client", "replacement"],
  ["server", "server", "replacement"],
  ["protocol", "protocol", "replacement"],
  ["editor", "editor", "replacement"],
  ["renderer", "renderer", "replacement"],
  ["content-toolkit", "content-toolkit", "replacement"],
  ["website", "website", "replacement"],
  ["content", "content", "shared"],
  ["sound", "sound", "shared"],
  ["resources", "resources", "shared"],
  ["metaserver-worker", "metaserver-worker", "shared"],
  ["devcontainer", "devcontainer", "shared"],
  ["github-settings", "github-settings", "shared"],
  ["observatory", "observatory", "replacement"],
] as const;

const defaultCoordinates: ComponentCoordinate[] = defaultDefinitions.map(
  ([component, repository, generation]) => ({
    id: `default:${component}`,
    repository: `atrinik/${repository}`,
    component,
    stack: "default",
    generation,
  }),
);

const classicDefinitions = [
  ["classic", "classic", "classic"],
  ["playtester", "playtester", "classic"],
  ["tools", "tools", "classic"],
  ["content", "content", "shared"],
  ["sound", "sound", "shared"],
  ["resources", "resources", "shared"],
  ["metaserver-worker", "metaserver-worker", "shared"],
] as const;

const classicCoordinates: ComponentCoordinate[] = classicDefinitions.map(
  ([component, repository, generation]) => ({
    id: `classic:${component}`,
    repository: `atrinik/${repository}`,
    component,
    stack: "classic",
    generation,
  }),
);

export const COMPONENT_COORDINATES: ComponentCoordinate[] = [
  ...defaultCoordinates,
  ...classicCoordinates,
];

export const SERVICE_PROBES: ServiceProbe[] = [
  {
    id: "website",
    name: "Atrinik website",
    url: "https://atrinik.org/",
    stack: "default",
    staleAfterSeconds: 1800,
  },
  {
    id: "metaserver",
    name: "Atrinik metaserver",
    url: "https://meta.atrinik.org/",
    stack: "default",
    staleAfterSeconds: 1800,
  },
];

export function githubRepositoryUrl(repository: string): string {
  return `https://github.com/${repository}`;
}

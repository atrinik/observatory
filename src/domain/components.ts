import type { ComponentCoordinate, ServiceProbe } from "./types";

export const METASERVER_LISTING_EVIDENCE_URL =
  "https://github.com/atrinik/metaserver-worker/blob/main/docs/routes.md";
export const METASERVER_RENDEZVOUS_EVIDENCE_URL =
  "https://github.com/atrinik/metaserver-worker/blob/main/docs/routes.md";

type CoordinateDefinition = Pick<
  ComponentCoordinate,
  "component" | "repository" | "generation" | "deploymentApplicable"
>;

const defaultDefinitions = [
  {
    component: "client",
    repository: "client",
    generation: "replacement",
    deploymentApplicable: false,
  },
  {
    component: "server",
    repository: "server",
    generation: "replacement",
    deploymentApplicable: false,
  },
  {
    component: "protocol",
    repository: "protocol",
    generation: "replacement",
    deploymentApplicable: false,
  },
  {
    component: "editor",
    repository: "editor",
    generation: "replacement",
    deploymentApplicable: false,
  },
  {
    component: "renderer",
    repository: "renderer",
    generation: "replacement",
    deploymentApplicable: false,
  },
  {
    component: "content-toolkit",
    repository: "content-toolkit",
    generation: "replacement",
    deploymentApplicable: false,
  },
  {
    component: "website",
    repository: "website",
    generation: "replacement",
    deploymentApplicable: true,
  },
  {
    component: "content",
    repository: "content",
    generation: "shared",
    deploymentApplicable: false,
  },
  {
    component: "sound",
    repository: "sound",
    generation: "shared",
    deploymentApplicable: false,
  },
  {
    component: "resources",
    repository: "resources",
    generation: "shared",
    deploymentApplicable: false,
  },
  {
    component: "metaserver-worker",
    repository: "metaserver-worker",
    generation: "shared",
    deploymentApplicable: true,
  },
  {
    component: "devcontainer",
    repository: "devcontainer",
    generation: "shared",
    deploymentApplicable: false,
  },
  {
    component: "github-settings",
    repository: "github-settings",
    generation: "shared",
    deploymentApplicable: false,
  },
  {
    component: "observatory",
    repository: "observatory",
    generation: "replacement",
    deploymentApplicable: true,
  },
] satisfies readonly CoordinateDefinition[];

const defaultCoordinates: ComponentCoordinate[] = defaultDefinitions.map(
  ({ component, repository, generation, deploymentApplicable }) => ({
    id: `default:${component}`,
    repository: `atrinik/${repository}`,
    component,
    stack: "default",
    generation,
    deploymentApplicable,
  }),
);

const classicDefinitions = [
  {
    component: "classic",
    repository: "classic",
    generation: "classic",
    deploymentApplicable: true,
  },
  {
    component: "playtester",
    repository: "playtester",
    generation: "classic",
    deploymentApplicable: false,
  },
  {
    component: "tools",
    repository: "tools",
    generation: "classic",
    deploymentApplicable: false,
  },
  {
    component: "content",
    repository: "content",
    generation: "shared",
    deploymentApplicable: false,
  },
  {
    component: "sound",
    repository: "sound",
    generation: "shared",
    deploymentApplicable: false,
  },
  {
    component: "resources",
    repository: "resources",
    generation: "shared",
    deploymentApplicable: false,
  },
  {
    component: "metaserver-worker",
    repository: "metaserver-worker",
    generation: "shared",
    deploymentApplicable: true,
  },
] satisfies readonly CoordinateDefinition[];

const classicCoordinates: ComponentCoordinate[] = classicDefinitions.map(
  ({ component, repository, generation, deploymentApplicable }) => ({
    id: `classic:${component}`,
    repository: `atrinik/${repository}`,
    component,
    stack: "classic",
    generation,
    deploymentApplicable,
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
    surface: "service",
    format: null,
    evidenceUrl: "https://atrinik.org/",
  },
  {
    id: "metaserver",
    name: "Classic listings · HTML",
    url: "https://classic.meta.atrinik.org/index.html",
    stack: "default",
    staleAfterSeconds: 1800,
    surface: "listings",
    format: "html",
    evidenceUrl: "https://classic.meta.atrinik.org/index.html",
  },
  {
    id: "metaserver:listings:json",
    name: "Classic listings · JSON",
    url: "https://classic.meta.atrinik.org/index.json",
    stack: "default",
    staleAfterSeconds: 1800,
    surface: "listings",
    format: "json",
    evidenceUrl: "https://classic.meta.atrinik.org/index.json",
  },
  {
    id: "metaserver:listings:xml",
    name: "Classic listings · XML",
    url: "https://classic.meta.atrinik.org/index.xml",
    stack: "default",
    staleAfterSeconds: 1800,
    surface: "listings",
    format: "xml",
    evidenceUrl: "https://classic.meta.atrinik.org/index.xml",
  },
  {
    id: "metaserver:rendezvous",
    name: "Rendezvous rooms",
    url: "https://rendezvous.meta.atrinik.org/",
    stack: "default",
    staleAfterSeconds: 1800,
    surface: "rendezvous",
    format: null,
    evidenceUrl: METASERVER_RENDEZVOUS_EVIDENCE_URL,
  },
];

export function githubRepositoryUrl(repository: string): string {
  return `https://github.com/${repository}`;
}

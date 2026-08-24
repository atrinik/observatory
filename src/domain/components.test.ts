import { describe, expect, it } from "vitest";
import { emptyDashboard } from "./aggregate";
import { COMPONENT_COORDINATES, SERVICE_PROBES } from "./components";

const CLASSIC_METASERVER_URL = "https://classic.meta.atrinik.org/index.html";

describe("service probes", () => {
  it("targets the attached Classic metaserver artifact", () => {
    const probe = SERVICE_PROBES.find((candidate) => candidate.id === "metaserver");
    const dashboardService = emptyDashboard().services.find(
      (service) => service.id === "metaserver",
    );

    expect(probe).toBeDefined();
    expect(probe?.url).toBe(CLASSIC_METASERVER_URL);
    expect(probe?.url).not.toBe("https://meta.atrinik.org/");
    expect(dashboardService?.url).toBe(CLASSIC_METASERVER_URL);
  });
});

describe("coordinate deployment applicability", () => {
  it("keeps both shared resources coordinates out of deployment tracking", () => {
    expect(
      COMPONENT_COORDINATES.filter((coordinate) =>
        coordinate.id.endsWith(":resources"),
      ).map((coordinate) => coordinate.deploymentApplicable),
    ).toEqual([false, false]);
  });

  it("tracks the configured deployment surfaces", () => {
    const tracked = COMPONENT_COORDINATES.filter(
      (coordinate) => coordinate.deploymentApplicable,
    ).map((coordinate) => coordinate.id);

    expect(tracked).toEqual([
      "default:website",
      "default:metaserver-worker",
      "default:observatory",
      "classic:classic",
      "classic:metaserver-worker",
    ]);
  });
});

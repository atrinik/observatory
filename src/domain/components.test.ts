import { describe, expect, it } from "vitest";
import { emptyDashboard } from "./aggregate";
import { SERVICE_PROBES } from "./components";

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

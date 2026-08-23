import { filterDashboardByStack } from "../../src/domain/aggregate";
import type { ObservatoryPagesFunction } from "../../src/pages";
import { readDashboard } from "../../src/storage/d1";

export const onRequestGet: ObservatoryPagesFunction = async ({ request, env }) => {
  try {
    const dashboard = await readDashboard(env.DB, new Date(), env.STALE_AFTER_SECONDS);
    const stack = new URL(request.url).searchParams.get("stack");
    return Response.json(filterDashboardByStack(dashboard, stack));
  } catch (error) {
    console.error(
      JSON.stringify({
        event: "status_read_failed",
        error: error instanceof Error ? error.message : "unknown error",
      }),
    );
    return Response.json(
      { error: "Observatory status is temporarily unavailable." },
      { status: 503 },
    );
  }
};

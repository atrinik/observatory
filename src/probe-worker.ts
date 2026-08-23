import { runServiceProbes } from "./storage/d1";

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method !== "GET") {
      return new Response("Method not allowed", {
        status: 405,
        headers: { allow: "GET" },
      });
    }
    return Response.json({
      service: "atrinik-observatory-probes",
      environment: env.OBSERVATORY_ENV,
      readOnly: true,
    });
  },

  async scheduled(controller: ScheduledController, env: Env): Promise<void> {
    const count = await runServiceProbes(env.DB, env.PROBE_TIMEOUT_MS);
    console.log(
      JSON.stringify({
        event: "service_probes_completed",
        environment: env.OBSERVATORY_ENV,
        scheduledTime: new Date(controller.scheduledTime).toISOString(),
        count,
      }),
    );
  },
} satisfies ExportedHandler<Env>;

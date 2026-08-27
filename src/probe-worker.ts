import { runRendezvousHealthProbe, runServiceProbes } from "./storage/d1";

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
    const [count, rendezvousHealth] = await Promise.all([
      runServiceProbes(env.DB, env.PROBE_TIMEOUT_MS),
      runRendezvousHealthProbe(
        env.DB,
        env.RENDEZVOUS_HEALTH,
        env.RENDEZVOUS_HEALTH_EXPORT_TOKEN,
        env.PROBE_TIMEOUT_MS,
      ),
    ]);
    console.log(
      JSON.stringify({
        event: "service_probes_completed",
        environment: env.OBSERVATORY_ENV,
        scheduledTime: new Date(controller.scheduledTime).toISOString(),
        count,
        rendezvousHealth:
          rendezvousHealth.error ?? rendezvousHealth.status ?? "unknown",
      }),
    );
  },
} satisfies ExportedHandler<Env>;

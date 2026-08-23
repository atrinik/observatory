import type { ObservatoryPagesFunction } from "../src/pages";

const API_HEADERS = {
  "access-control-allow-headers":
    "content-type,x-github-event,x-github-delivery,x-hub-signature-256",
  "access-control-allow-methods": "GET,POST,OPTIONS",
  "access-control-allow-origin": "*",
  "cache-control": "no-store",
  "referrer-policy": "no-referrer",
  "x-content-type-options": "nosniff",
};

export const onRequest: ObservatoryPagesFunction = async (context) => {
  if (context.request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: API_HEADERS });
  }
  const response = await context.next();
  const headers = new Headers(response.headers);
  for (const [name, value] of Object.entries(API_HEADERS)) {
    headers.set(name, value);
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
};

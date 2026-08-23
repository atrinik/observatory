import { normalizeGitHubEvent } from "../../../src/domain/events";
import type { ObservatoryPagesFunction } from "../../../src/pages";
import { sha256Hex, verifyGitHubSignature } from "../../../src/domain/signature";
import { recordGitHubDelivery } from "../../../src/storage/d1";

const MAX_GITHUB_PAYLOAD_BYTES = 1024 * 1024;

export const onRequestPost: ObservatoryPagesFunction = async ({ request, env }) => {
  const deliveryId = request.headers.get("x-github-delivery");
  const eventName = request.headers.get("x-github-event");
  if (!deliveryId || !eventName) {
    return Response.json(
      { error: "GitHub delivery and event headers are required." },
      { status: 400 },
    );
  }

  const contentLength = Number.parseInt(
    request.headers.get("content-length") ?? "",
    10,
  );
  if (Number.isFinite(contentLength) && contentLength > MAX_GITHUB_PAYLOAD_BYTES) {
    return Response.json({ error: "GitHub payload is too large." }, { status: 413 });
  }

  const body = await request.arrayBuffer();
  if (body.byteLength > MAX_GITHUB_PAYLOAD_BYTES) {
    return Response.json({ error: "GitHub payload is too large." }, { status: 413 });
  }
  const valid = await verifyGitHubSignature(
    body,
    request.headers.get("x-hub-signature-256"),
    env.GITHUB_WEBHOOK_SECRET,
  );
  if (!valid) {
    return Response.json({ error: "Invalid GitHub signature." }, { status: 401 });
  }

  let payload: unknown;
  try {
    payload = JSON.parse(new TextDecoder().decode(body)) as unknown;
  } catch {
    return Response.json(
      { error: "GitHub payload is not valid JSON." },
      { status: 400 },
    );
  }

  const receivedAt = new Date().toISOString();
  const normalized = normalizeGitHubEvent({
    eventName,
    deliveryId,
    payload,
    receivedAt,
  });
  const result = await recordGitHubDelivery(
    env.DB,
    deliveryId,
    eventName,
    await sha256Hex(body),
    receivedAt,
    normalized,
  );

  if (result.conflict) {
    return Response.json(
      { error: "GitHub delivery ID was previously used with a different body." },
      { status: 409 },
    );
  }

  return Response.json({
    accepted: !result.duplicate,
    conflict: result.conflict,
    duplicate: result.duplicate,
    event: eventName,
    inserted: result.inserted,
    mappedCoordinates: result.mapped,
  });
};

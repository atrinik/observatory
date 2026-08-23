import { describe, expect, it } from "vitest";
import { sha256Hex, verifyGitHubSignature } from "./signature";

describe("GitHub webhook signatures", () => {
  it("accepts an HMAC-SHA256 signature for the exact body", async () => {
    const body = new TextEncoder().encode('{"action":"completed"}');
    const secret = "test-secret";
    const key = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    );
    const digest = await crypto.subtle.sign("HMAC", key, body);
    const signature = Array.from(new Uint8Array(digest), (byte) =>
      byte.toString(16).padStart(2, "0"),
    ).join("");

    await expect(
      verifyGitHubSignature(body.buffer, `sha256=${signature}`, secret),
    ).resolves.toBe(true);
    await expect(sha256Hex(body.buffer)).resolves.toHaveLength(64);
  });

  it("rejects missing, malformed, and wrong signatures", async () => {
    const body = new TextEncoder().encode("body").buffer;
    await expect(verifyGitHubSignature(body, null, "secret")).resolves.toBe(false);
    await expect(verifyGitHubSignature(body, "sha256=nope", "secret")).resolves.toBe(
      false,
    );
    await expect(
      verifyGitHubSignature(body, "sha256=00000000000000000000000000000000", "secret"),
    ).resolves.toBe(false);
  });
});

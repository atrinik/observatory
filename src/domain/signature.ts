const HEX = /^[0-9a-f]{2}$/i;

function hexToBytes(value: string): Uint8Array | null {
  if (value.length === 0 || value.length % 2 !== 0) return null;
  const bytes = new Uint8Array(value.length / 2);
  for (let index = 0; index < bytes.length; index += 1) {
    const pair = value.slice(index * 2, index * 2 + 2);
    if (!HEX.test(pair)) return null;
    bytes[index] = Number.parseInt(pair, 16);
  }
  return bytes;
}

export async function verifyGitHubSignature(
  body: ArrayBuffer,
  signatureHeader: string | null,
  secret: string | undefined,
): Promise<boolean> {
  if (!secret || !signatureHeader?.startsWith("sha256=")) return false;
  const signature = hexToBytes(signatureHeader.slice("sha256=".length));
  if (!signature) return false;
  const signatureBuffer = new ArrayBuffer(signature.byteLength);
  new Uint8Array(signatureBuffer).set(signature);
  const bodyBuffer = body.slice(0);

  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["verify"],
  );
  return crypto.subtle.verify("HMAC", key, signatureBuffer, bodyBuffer);
}

export async function sha256Hex(body: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", body);
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

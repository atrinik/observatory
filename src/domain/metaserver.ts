import type { ListingFormat } from "./types";

export const MAX_LISTING_BODY_BYTES = 128 * 1024;

export interface ListingMetadata {
  generation: string | null;
  entryCount: number | null;
  parityKey: string | null;
}

function safeToken(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.replace(/[\u0000-\u001f\u007f]/g, " ").trim();
  if (normalized.length === 0 || normalized.length > 120) return null;
  return normalized;
}

function objectValue(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  return Object.fromEntries(Object.entries(value));
}

function arrayLength(value: unknown): number | null {
  return Array.isArray(value) ? value.length : null;
}

function jsonMetadata(
  body: string,
): Pick<ListingMetadata, "generation" | "entryCount"> {
  try {
    const parsed: unknown = JSON.parse(body);
    const root = objectValue(parsed);
    if (!root) return { generation: null, entryCount: null };

    const generation =
      [root.generation, root.version, root.revision]
        .map(safeToken)
        .find((value): value is string => value !== null) ?? null;
    const entryCount =
      [root.servers, root.entries, root.listings]
        .map(arrayLength)
        .find((value): value is number => value !== null) ?? null;
    return { generation, entryCount };
  } catch {
    return { generation: null, entryCount: null };
  }
}

function headerGeneration(headers: Headers): string | null {
  for (const name of [
    "x-directory-generation",
    "x-directory-version",
    "x-observatory-generation",
  ]) {
    const value = safeToken(headers.get(name));
    if (value) return value;
  }
  return null;
}

export function extractListingMetadata(
  format: ListingFormat,
  body: string,
  headers: Headers,
): ListingMetadata {
  if (new TextEncoder().encode(body).byteLength > MAX_LISTING_BODY_BYTES) {
    return { generation: null, entryCount: null, parityKey: null };
  }
  const json = format === "json" || format === "root" ? jsonMetadata(body) : null;
  const generation = headerGeneration(headers) ?? json?.generation ?? null;
  const entryCount =
    json?.entryCount ??
    (format === "html" || format === "xml"
      ? (body.match(/<(?:server|entry)\b/gi)?.length ?? null)
      : null);
  const parityKey = generation
    ? `generation:${generation}${entryCount !== null ? `;entries:${entryCount}` : ""}`
    : entryCount !== null
      ? `entries:${entryCount}`
      : null;

  return { generation, entryCount, parityKey };
}

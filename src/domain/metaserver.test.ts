import { describe, expect, it } from "vitest";
import { extractListingMetadata, MAX_LISTING_BODY_BYTES } from "./metaserver";

describe("bounded metaserver metadata", () => {
  it("extracts a safe generation and normalized entry count from JSON", () => {
    const metadata = extractListingMetadata(
      "json",
      JSON.stringify({ generation: "directory-42", servers: [{}, {}, {}] }),
      new Headers(),
    );

    expect(metadata).toEqual({
      generation: "directory-42",
      entryCount: 3,
      parityKey: "generation:directory-42;entries:3",
    });
  });

  it("prefers an operator-provided generation header and counts XML entries", () => {
    const metadata = extractListingMetadata(
      "xml",
      "<servers><server /><server /></servers>",
      new Headers({ "x-directory-generation": "directory-42" }),
    );

    expect(metadata).toEqual({
      generation: "directory-42",
      entryCount: 2,
      parityKey: "generation:directory-42;entries:2",
    });
  });

  it("does not retain an unbounded or unsafe body as metadata", () => {
    const metadata = extractListingMetadata(
      "html",
      `<html>${"x".repeat(MAX_LISTING_BODY_BYTES + 1)}</html>`,
      new Headers(),
    );

    expect(metadata).toEqual({
      generation: null,
      entryCount: null,
      parityKey: null,
    });
  });
});

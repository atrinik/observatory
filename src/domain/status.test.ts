import { describe, expect, it } from "vitest";
import { statusClass, statusLabel } from "./status";
describe("status presentation helpers", () => {
  it.each<[string, string]>([
    ["unknown", "Unknown"],
    ["passed", "Passed"],
    ["failed", "Failed"],
    ["cancelled", "Cancelled"],
    ["running", "Running"],
    ["stale", "Stale"],
    ["awaiting-review", "Awaiting Review"],
  ])("labels %s as %s", (status, label) => {
    expect(statusLabel(status)).toBe(label);
    expect(statusClass(status)).toBe(`status-${status}`);
  });
});

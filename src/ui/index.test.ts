import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(new URL("../pages/index.astro", import.meta.url), "utf8");

const tabMarkup = (stack: "default" | "classic") => {
  const match = source.match(
    new RegExp(`<button[\\s\\S]*?data-stack-tab="${stack}"[\\s\\S]*?</button>`),
  );
  if (!match) throw new Error(`missing ${stack} stack tab`);
  return match[0];
};

describe("initial stack view markup", () => {
  it("renders Classic as the selected, visible first-paint stack", () => {
    expect(source).toContain(
      'const initialStack = "classic" as "default" | "classic";',
    );

    expect(tabMarkup("default")).toMatch(
      /initialStack === "default"[\s\S]*?aria-selected=\{initialStack === "default" \? "true" : "false"\}/,
    );
    expect(tabMarkup("classic")).toMatch(
      /initialStack === "classic"[\s\S]*?aria-selected=\{initialStack === "classic" \? "true" : "false"\}/,
    );
    expect(source).toContain("hidden={stack !== initialStack}");
  });

  it("keeps tab ARIA state and panel visibility synchronized on interaction", () => {
    expect(source).toContain(
      'candidate.setAttribute("aria-selected", String(active));',
    );
    expect(source).toContain(
      'panel.hidden = panel.getAttribute("data-stack-panel") !== selected;',
    );
  });

  it("preserves the server-rendered stack state when the API request fails", () => {
    const apiFlow = source.slice(
      source.indexOf('fetch("/api/status"'),
      source.indexOf("for (const tab of document.querySelectorAll"),
    );

    expect(apiFlow).toContain(
      'setApiState("API unavailable · showing the safe unknown state", "error");',
    );
    expect(apiFlow).not.toContain("data-stack-tab");
  });
});

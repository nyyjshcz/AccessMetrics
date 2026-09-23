import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const stylesheet = fs.readFileSync(path.join(process.cwd(), "src", "app", "globals.css"), "utf8");

function rule(selector: string) {
  const match = stylesheet.match(
    new RegExp(`${selector.replace(/[.*+?^${}()|[\\]\\]/g, "\\$&")}\\s*\\{([^}]*)\\}`, "s"),
  );
  expect(match, `Expected a ${selector} style rule`).not.toBeNull();
  return match![1];
}

describe("review page header contrast", () => {
  it("keeps the hero title and eyebrow readable on its dark background", () => {
    expect(rule(".review-page-header h1")).toMatch(/color:\s*#ffffff/i);
    expect(rule(".review-page-header .eyebrow")).toMatch(/color:\s*#8[0-9a-f]{5}/i);
  });

  it("does not render the full-report link as white text on a white surface", () => {
    expect(rule(".review-page-header .secondary-link")).toMatch(
      /background:\s*rgba\(255,\s*255,\s*255,\s*(?:0)?\.1\d?\)/i,
    );
  });
});

describe("AI review controls", () => {
  it("gives review actions consistent spacing and a usable button hit area", () => {
    expect(rule(".ai-review-actions")).toMatch(/display:\s*flex/);
    expect(rule(".ai-review-actions button")).toMatch(/min-height:\s*42px/);
    expect(rule(".ai-review-actions button")).toMatch(/padding:\s*9px 15px/);
  });
});

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const css = readFileSync(join(__dirname, "style.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");

/** Body of the first top-level rule whose selector list contains exactly `selector`. */
function regula(selector: string): string {
  for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (m[1].split(",").map((x) => x.trim()).includes(selector)) return m[2];
  }
  return "";
}

describe("toggle switches must not scroll the whole document", () => {
  // Regression: the hidden checkbox is position:absolute. Without a positioned
  // ancestor it was laid out against the initial containing block, outside the
  // scrolling <main class="tresc">, so focusing it scrolled the document and the
  // 100vh #app slid up, leaving a black strip below (reported with the flip toggle).
  it("the absolutely positioned input has a positioned parent", () => {
    expect(regula(".przelacznik-input")).toMatch(/position:\s*absolute/);
    expect(regula(".przelacznik")).toMatch(/position:\s*relative/);
  });

  it("the scroll container is itself a containing block (defence in depth)", () => {
    const tresc = regula(".tresc");
    expect(tresc).toMatch(/overflow-y:\s*auto/);
    expect(tresc).toMatch(/position:\s*relative/);
  });
});

describe("P1: the 'bigger than the original' warning fits at 860 px", () => {
  // Regression: .szacunek had white-space: nowrap, so the warning ran past the right edge of the window.
  it("the estimate wraps and the warning text may break", () => {
    expect(regula(".szacunek")).toMatch(/flex-wrap:\s*wrap/);
    expect(regula(".szacunek")).toMatch(/min-width:\s*0/);
    expect(regula(".szacunek")).not.toMatch(/white-space:\s*nowrap/);
    expect(regula(".szacunek-ostrzezenie")).toMatch(/white-space:\s*normal/);
  });
});

describe("P10: action bar at the minimum window (860×600)", () => {
  // Regression: the bar wrapped into two or three rows (144 px = 24% of 600 px) and covered content.
  // The full check runs in Chromium: scripts/uklad.mjs (npm run uklad, part of npm run bramka).
  it("one row from 860 px, wrapping only below 760 px", () => {
    expect(regula(".pasek-akcji")).toMatch(/flex-wrap:\s*nowrap/);
    expect(css).toMatch(/@media \(max-width: 760px\) \{ \.pasek-akcji \{ flex-wrap: wrap; \} \}/);
    expect(regula(".pasek-akcji > .przycisk-glowny")).toMatch(/flex:\s*none/);
  });
  it("scroll padding equals the bar height, so focus never lands under it", () => {
    expect(regula(".tresc")).toMatch(/scroll-padding-bottom:\s*var\(--wys-paska/);
  });
});

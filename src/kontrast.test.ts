import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// E30: kontrast WCAG 2.1 AA (4,5:1 dla zwykłego tekstu) w obu motywach, liczony z tokeny.css.
const css = readFileSync(join(__dirname, "tokeny.css"), "utf8");

function blok(selektor: string): Record<string, string> {
  const i = css.indexOf(selektor);
  const tresc = css.slice(css.indexOf("{", i) + 1, css.indexOf("}", i));
  const wynik: Record<string, string> = {};
  for (const m of tresc.matchAll(/--([\w-]+):\s*(#[0-9a-fA-F]{6})/g)) wynik[m[1]] = m[2];
  return wynik;
}

function luminancja(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function kontrast(a: string, b: string): number {
  const [x, y] = [luminancja(a), luminancja(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}

const TLA = ["tlo", "powierzchnia", "powierzchnia-2", "powierzchnia-3"];
const TEKSTY = ["tekst", "tekst-2", "tekst-3", "akcent", "ok", "uwaga", "blad"];

describe("kontrast WCAG AA", () => {
  for (const [motyw, sel] of [["ciemny", '[data-theme="dark"]'], ["jasny", '[data-theme="light"]']] as const) {
    it(`motyw ${motyw}: tekst ≥ 4,5:1 na każdym tle`, () => {
      const t = blok(sel);
      const slabe: string[] = [];
      for (const tlo of TLA) {
        for (const tekst of TEKSTY) {
          if (!t[tlo] || !t[tekst]) throw new Error(`brak tokenu ${tlo}/${tekst} w ${sel}`);
          const k = kontrast(t[tekst], t[tlo]);
          if (k < 4.5) slabe.push(`${tekst} na ${tlo}: ${k.toFixed(2)}`);
        }
      }
      const przycisk = kontrast(t["akcent-tekst"], t["akcent"]);
      if (przycisk < 4.5) slabe.push(`akcent-tekst na akcent: ${przycisk.toFixed(2)}`);
      expect(slabe).toEqual([]);
    });
  }
  it("liczy kontrast jak WCAG", () => {
    expect(kontrast("#000000", "#ffffff")).toBeCloseTo(21, 1);
    expect(kontrast("#777777", "#ffffff")).toBeCloseTo(4.48, 1);
  });
});

// v1.2: każdy z 6 motywów (motywy.ts) w obu trybach. Te same progi co tokeny E30:
// tekst, tekst-2, tekst-3, akcent, ok, ostrzeżenie (pom1), błąd ≥ 4,5:1 na tle i kartach,
// tekst na akcencie ≥ 4,5:1. Kolory z color-mix() (pochodne) liczone są osobno w motywy.ts.
import { WBUDOWANE } from "./motywy";

describe("kontrast WCAG AA motywów", () => {
  for (const m of WBUDOWANE) {
    for (const tryb of ["jasny", "ciemny"] as const) {
      it(`${m.nazwa} (${tryb})`, () => {
        const k = m[tryb];
        const slabe: string[] = [];
        for (const [nt, tlo] of [["tlo", k.tlo], ["karta", k.karta], ["karta2", k.karta2]] as const) {
          for (const [nx, x] of [["tekst", k.tekst], ["tekst2", k.tekst2], ["tekst3", k.tekst3], ["akcent", k.akcent], ["ok", k.ok], ["pom1", k.pom1], ["zle", k.zle]] as const) {
            const w = kontrast(x, tlo);
            if (w < 4.5) slabe.push(`${nx} na ${nt}: ${w.toFixed(2)}`);
          }
        }
        const p = kontrast(k.naAkcencie, k.akcent);
        if (p < 4.5) slabe.push(`naAkcencie na akcent: ${p.toFixed(2)}`);
        expect(slabe).toEqual([]);
      });
    }
  }
});

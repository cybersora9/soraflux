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

// GUI 2.0 (DNA z makiety): każdy motyw × tryb, także „Własny” z kilkoma akcentami. Progi WCAG 2.1 AA:
// tekst, tekst2, tekst3, akcent jako tekst, ok/uwaga/błąd ≥ 4,5:1 na wgłębieniu, panelu i panelu 2;
// tekst i tekst2 także na panelu 3 (przycisk pod kursorem, wciśnięty segment) i na zaznaczonym kaflu;
// tekst na akcencie ≥ 4,5:1; cyfry LCD ≥ 4,5:1; akcent jako ikona na zaznaczonym kaflu ≥ 3:1 (WCAG 1.4.11).
import { BAZY, ID_MOTYWOW, SZYBKIE_AKCENTY, tokeny, type MotywWlasny } from "./motywy";

const WLASNE: MotywWlasny[] = [
  ...SZYBKIE_AKCENTY.map((akcent, i) => ({ akcent, baza: BAZY[i % BAZY.length] })),
  { akcent: "#ffff00", baza: "kissaten" },
  { akcent: "#101010", baza: "blackwall" },
  { akcent: "#808080", baza: "citypop" },
];

function sprawdz(k: ReturnType<typeof tokeny>): string[] {
  const slabe: string[] = [];
  const prog = (nazwa: string, x: string, tlo: string, nt: string, p = 4.5) => {
    const w = kontrast(x, tlo);
    if (w < p) slabe.push(`${nazwa} na ${nt}: ${w.toFixed(2)}`);
  };
  for (const [nt, tlo] of [["wglebienie", k.wglebienie], ["panel", k.panel], ["panel2", k.panel2]] as const) {
    for (const [nx, x] of [["tekst", k.tekst], ["tekst2", k.tekst2], ["tekst3", k.tekst3], ["akcentTekst", k.akcentTekst], ["ok", k.ok], ["uwaga", k.uwaga], ["zle", k.zle]] as const) prog(nx, x, tlo, nt);
  }
  for (const [nx, x] of [["tekst", k.tekst], ["tekst2", k.tekst2]] as const) {
    prog(nx, x, k.panel3, "panel3");
    prog(nx, x, k.akcentSlaby, "zaznaczonym kaflu");
  }
  prog("akcentTekst (ikona)", k.akcentTekst, k.akcentSlaby, "zaznaczonym kaflu", 3);
  prog("ok (gwiazdka)", k.ok, k.akcentSlaby, "zaznaczonym kaflu", 3);
  prog("naAkcencie", k.naAkcencie, k.akcent, "akcencie");
  prog("lcd", k.lcd, k.lcdTlo, "szkle LCD");
  return slabe;
}

describe("kontrast WCAG AA motywów 2.0", () => {
  for (const id of ID_MOTYWOW) {
    for (const ciemny of [true, false]) {
      const wlasne = id === "wlasny" ? WLASNE : [null];
      for (const w of wlasne) {
        it(`${id}${w ? ` ${w.akcent}/${w.baza}` : ""} (${ciemny ? "ciemny" : "jasny"})`, () => {
          expect(sprawdz(tokeny(id, ciemny, w))).toEqual([]);
        });
      }
    }
  }
});

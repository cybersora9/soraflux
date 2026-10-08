// Motywy wyglądu: trzy warianty japońskiego retro (A Kissaten Hi-Fi, B City Pop, C Heisei MiniDisc)
// w dwóch paletach (cybersora, japońska), każdy w wersji jasnej i ciemnej, plus własne motywy użytkownika.
// Motyw to zestaw kolorów; reszta tokenów (tła pomocnicze, obrysy, „słabe” odcienie) liczy się z nich.

import type { Konfig } from "./typy";

export type Wariant = "a" | "b" | "c";

export interface Kolory {
  tlo: string;
  karta: string;
  karta2: string;
  tekst: string;
  tekst2: string;
  tekst3: string;
  linia: string;
  akcent: string;
  akcentMocny: string;
  naAkcencie: string;
  pom1: string;
  pom2: string;
  braz: string;
  ok: string;
  zle: string;
  lcdTlo: string;
  lcd: string;
  wypelnienie?: string;
}

export interface Motyw {
  id: string;
  nazwa: string;
  wariant: Wariant;
  jasny: Kolory;
  ciemny: Kolory;
}

/** Własny motyw: baza z wbudowanych + nadpisane kolory osobno dla jasnego i ciemnego. */
export interface MotywWlasny {
  id: string;
  nazwa: string;
  baza: string;
  jasny: Partial<Kolory>;
  ciemny: Partial<Kolory>;
}

/** Kolory, które da się zmienić w edytorze (reszta liczy się sama). */
export const EDYTOWALNE = ["tlo", "karta", "tekst", "akcent", "pom1", "pom2"] as const;
export type Edytowalny = (typeof EDYTOWALNE)[number];

const SORA_A: Pick<Motyw, "jasny" | "ciemny"> = {
  jasny: {
    tlo: "#f7f3f4", karta: "#fffbfc", karta2: "#ede6e7", tekst: "#18161a", tekst2: "#48434a", tekst3: "#5f5960",
    linia: "rgba(24,22,26,.12)", akcent: "#c02b3f", akcentMocny: "#9c1f30", naAkcencie: "#fff7f8",
    pom1: "#865e0f", pom2: "#2e6f8e", braz: "#2a2730", ok: "#2d724e", zle: "#c02b3f", lcdTlo: "#121115", lcd: "#ff4a5e",
  },
  ciemny: {
    tlo: "#0e0e12", karta: "#15151a", karta2: "#1b1b21", tekst: "#f6f2f3", tekst2: "#cbc4c6", tekst3: "#9d9598",
    linia: "rgba(246,242,243,.1)", akcent: "#ff3a52", akcentMocny: "#8f1a2a", naAkcencie: "#09090c",
    pom1: "#d9a441", pom2: "#8fb8d4", braz: "#5a5560", ok: "#7ad6a4", zle: "#ff3a52", lcdTlo: "#050507", lcd: "#ff3a52",
  },
};

const SORA_B: Pick<Motyw, "jasny" | "ciemny"> = {
  jasny: {
    tlo: "#f5f2f3", karta: "#ffffff", karta2: "#eee9ea", tekst: "#141217", tekst2: "#3e3943", tekst3: "#57515b",
    linia: "rgba(20,18,23,.11)", akcent: "#c42c40", akcentMocny: "#9c1f30", naAkcencie: "#ffffff",
    pom1: "#c02a52", pom2: "#2e6f8e", braz: "#141217", ok: "#2d724e", zle: "#c42c40", lcdTlo: "transparent", lcd: "#141217",
    wypelnienie: "linear-gradient(90deg,#2a2730 0%,#8a1f2e 35%,#ff3a52 70%,#ffb36b 100%)",
  },
  ciemny: {
    tlo: "#111016", karta: "#1a1820", karta2: "#221f29", tekst: "#f6f2f3", tekst2: "#cbc4c6", tekst3: "#a39b9f",
    linia: "rgba(246,242,243,.1)", akcent: "#ff3a52", akcentMocny: "#8f1a2a", naAkcencie: "#0b0a0e",
    pom1: "#ffb36b", pom2: "#8fc4d8", braz: "#f6f2f3", ok: "#7ad6a4", zle: "#ff3a52", lcdTlo: "transparent", lcd: "#f6f2f3",
    wypelnienie: "linear-gradient(90deg,#3a3542 0%,#cc2e42 38%,#ff3a52 68%,#ffc27c 100%)",
  },
};

const SORA_C: Pick<Motyw, "jasny" | "ciemny"> = {
  jasny: {
    tlo: "#ebe8e9", karta: "#f8f6f7", karta2: "#e4e0e2", tekst: "#1a171c", tekst2: "#47424a", tekst3: "#5b555e",
    linia: "rgba(26,23,28,.13)", akcent: "#b3263a", akcentMocny: "#d63d52", naAkcencie: "#ffffff",
    pom1: "#815b0e", pom2: "#2e6f8e", braz: "#1a171c", ok: "#2c6e4b", zle: "#b3263a", lcdTlo: "#1a1418", lcd: "#ff4a5e",
  },
  ciemny: {
    tlo: "#141318", karta: "#1c1b21", karta2: "#222127", tekst: "#f6f2f3", tekst2: "#c3bcbf", tekst3: "#978f93",
    linia: "rgba(246,242,243,.1)", akcent: "#ff3f56", akcentMocny: "#ff6a7c", naAkcencie: "#0d0c10",
    pom1: "#d9a441", pom2: "#8fb8d4", braz: "#f6f2f3", ok: "#7ad6a4", zle: "#ff3f56", lcdTlo: "#170d10", lcd: "#ff3a52",
  },
};

const JP_A: Pick<Motyw, "jasny" | "ciemny"> = {
  jasny: {
    tlo: "#f6f0e6", karta: "#fffaf2", karta2: "#f1e9dc", tekst: "#33241b", tekst2: "#634e3f", tekst3: "#7a6455",
    linia: "rgba(51,36,27,.13)", akcent: "#b83d27", akcentMocny: "#a8341f", naAkcencie: "#fff8f0",
    pom1: "#816014", pom2: "#23807b", braz: "#6e4529", ok: "#317348", zle: "#b3361f", lcdTlo: "#2f2119", lcd: "#f2c25b",
  },
  ciemny: {
    tlo: "#211813", karta: "#2c211a", karta2: "#36291f", tekst: "#f3e7d6", tekst2: "#d2bfa9", tekst3: "#ae9882",
    linia: "rgba(243,231,214,.11)", akcent: "#eb7056", akcentMocny: "#8f3320", naAkcencie: "#1b120d",
    pom1: "#e6b450", pom2: "#5dbcb4", braz: "#b98058", ok: "#7fc893", zle: "#f2775a", lcdTlo: "#110b08", lcd: "#f5c35a",
  },
};

const JP_B: Pick<Motyw, "jasny" | "ciemny"> = {
  jasny: {
    tlo: "#eef4fc", karta: "#ffffff", karta2: "#e9f0fa", tekst: "#14204a", tekst2: "#36437a", tekst3: "#4f5c8c",
    linia: "rgba(20,32,74,.11)", akcent: "#2747c9", akcentMocny: "#1b36a8", naAkcencie: "#ffffff",
    pom1: "#ca2b51", pom2: "#0f8a83", braz: "#14204a", ok: "#137a52", zle: "#c23552", lcdTlo: "transparent", lcd: "#14204a",
    wypelnienie: "linear-gradient(90deg,#2747c9 0%,#7d5ccf 38%,#ff7d8e 70%,#ffb46a 100%)",
  },
  ciemny: {
    tlo: "#111a40", karta: "#1a2656", karta2: "#223064", tekst: "#f5f1e8", tekst2: "#c6cbe3", tekst3: "#a0a8cc",
    linia: "rgba(245,241,232,.1)", akcent: "#ff8c9b", akcentMocny: "#b3505e", naAkcencie: "#0b1230",
    pom1: "#ffc27c", pom2: "#4fd6cd", braz: "#f5f1e8", ok: "#6fdcaa", zle: "#ff8c9b", lcdTlo: "transparent", lcd: "#f5f1e8",
    wypelnienie: "linear-gradient(90deg,#4766e8 0%,#9a72e0 38%,#ff8c9b 70%,#ffc27c 100%)",
  },
};

const JP_C: Pick<Motyw, "jasny" | "ciemny"> = {
  jasny: {
    tlo: "#e9ecf0", karta: "#f6f7f9", karta2: "#e1e5ea", tekst: "#1c2330", tekst2: "#465061", tekst3: "#596374",
    linia: "rgba(28,35,48,.13)", akcent: "#2456a6", akcentMocny: "#3d6fc0", naAkcencie: "#ffffff",
    pom1: "#b13e26", pom2: "#16857f", braz: "#1c2330", ok: "#297144", zle: "#b43723", lcdTlo: "#b7c4a2", lcd: "#1d2913",
  },
  ciemny: {
    tlo: "#191c21", karta: "#202329", karta2: "#262a31", tekst: "#e8ebf0", tekst2: "#b6bdc9", tekst3: "#9098a5",
    linia: "rgba(232,235,240,.1)", akcent: "#80b2ff", akcentMocny: "#a2c6ff", naAkcencie: "#0c1320",
    pom1: "#ff7d5e", pom2: "#5cc9c1", braz: "#e8ebf0", ok: "#7bd49b", zle: "#ff7d5e", lcdTlo: "#1e190f", lcd: "#ffb547",
  },
};

export const WBUDOWANE: Motyw[] = [
  { id: "sora-a", nazwa: "Kissaten · cybersora", wariant: "a", ...SORA_A },
  { id: "sora-b", nazwa: "City Pop · cybersora", wariant: "b", ...SORA_B },
  { id: "sora-c", nazwa: "MiniDisc · cybersora", wariant: "c", ...SORA_C },
  { id: "jp-a", nazwa: "Kissaten · japoński", wariant: "a", ...JP_A },
  { id: "jp-b", nazwa: "City Pop · japoński", wariant: "b", ...JP_B },
  { id: "jp-c", nazwa: "MiniDisc · japoński", wariant: "c", ...JP_C },
];

export const DOMYSLNY = "sora-a";

// ---------- kolory: kontrast ----------

function rgb(hex: string): [number, number, number] | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function luminancja(hex: string): number | null {
  const c = rgb(hex);
  if (!c) return null;
  const [r, g, b] = c.map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Kontrast WCAG dwóch kolorów #rrggbb; null, gdy któregoś nie da się odczytać. */
export function kontrast(a: string, b: string): number | null {
  const la = luminancja(a);
  const lb = luminancja(b);
  if (la === null || lb === null) return null;
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** Tekst na akcencie: biały albo prawie czarny, co da lepszy kontrast. */
function tekstNa(akcent: string): string {
  const k1 = kontrast(akcent, "#ffffff") ?? 0;
  const k2 = kontrast(akcent, "#0c0b0f") ?? 0;
  return k1 >= k2 ? "#ffffff" : "#0c0b0f";
}

const mix = (a: string, b: string, procentB: number) => `color-mix(in oklab, ${a}, ${b} ${procentB}%)`;

/** Łączy kolory bazy z nadpisaniami i dolicza pochodne tego, co zmienił użytkownik. */
export function polacz(baza: Kolory, zmiany: Partial<Kolory>): Kolory {
  const k: Kolory = { ...baza, ...zmiany };
  if (zmiany.karta) k.karta2 = mix(zmiany.karta, k.tekst, 6);
  if (zmiany.tekst) {
    k.tekst2 = mix(zmiany.tekst, k.karta, 25);
    k.tekst3 = mix(zmiany.tekst, k.karta, 36);
    k.linia = `color-mix(in oklab, ${zmiany.tekst} 13%, transparent)`;
    k.braz = zmiany.tekst;
  }
  if (zmiany.akcent) {
    k.naAkcencie = tekstNa(zmiany.akcent);
    k.akcentMocny = mix(zmiany.akcent, "#000000", 28);
    k.zle = zmiany.akcent;
    if (baza.wypelnienie) k.wypelnienie = `linear-gradient(90deg, ${k.braz} 0%, ${zmiany.akcent} 55%, ${k.pom1} 100%)`;
  }
  return k;
}

// ---------- zapis: konfig w Rust (motyw_wyglad, wlasne_motywy) ----------
// Nie localStorage: ten psuje tryb przenośny (E30) i ginie przy zmianie identyfikatora apki.

export interface StanWygladu {
  motyw: string;
  wlasne: MotywWlasny[];
}

function poprawnyWlasny(x: unknown): x is MotywWlasny {
  if (!x || typeof x !== "object") return false;
  const m = x as Partial<MotywWlasny>;
  return typeof m.id === "string" && typeof m.nazwa === "string" && typeof m.baza === "string" && !!m.jasny && !!m.ciemny;
}

/** Stan wyglądu z konfigu (uszkodzone wpisy pomijane, nieznany motyw → domyślny). */
export function zKonfigu(k: Pick<Konfig, "motyw_wyglad" | "wlasne_motywy"> | null | undefined): StanWygladu {
  const wlasne = (k?.wlasne_motywy ?? []).filter(poprawnyWlasny);
  const id = k?.motyw_wyglad ?? DOMYSLNY;
  const znany = WBUDOWANE.some((m) => m.id === id) || wlasne.some((m) => m.id === id);
  return { motyw: znany ? id : DOMYSLNY, wlasne };
}

/** Pola konfigu do zapisania dla danego stanu wyglądu. */
export function doKonfigu(s: StanWygladu): Pick<Konfig, "motyw_wyglad" | "wlasne_motywy"> {
  return { motyw_wyglad: s.motyw, wlasne_motywy: s.wlasne };
}

let biezacy: StanWygladu = { motyw: DOMYSLNY, wlasne: [] };

/** Ustawia stan wyglądu (po wczytaniu albo zapisie konfigu). */
export function ustawStan(s: StanWygladu): void {
  biezacy = s;
}

export function wczytaj(): StanWygladu {
  return biezacy;
}

/** Pełny motyw o danym id (wbudowany albo własny); nieznany → domyślny. */
export function znajdz(id: string, s: StanWygladu = wczytaj()): Motyw {
  const wbud = WBUDOWANE.find((m) => m.id === id);
  if (wbud) return wbud;
  const w = s.wlasne.find((m) => m.id === id);
  if (w) {
    const baza = WBUDOWANE.find((m) => m.id === w.baza) ?? WBUDOWANE[0];
    return { id: w.id, nazwa: w.nazwa, wariant: baza.wariant, jasny: polacz(baza.jasny, w.jasny), ciemny: polacz(baza.ciemny, w.ciemny) };
  }
  return WBUDOWANE[0];
}

/** Sprawdza plik importu; zwraca motyw z nowym id albo null. */
export function zImportu(dane: unknown): MotywWlasny | null {
  if (!dane || typeof dane !== "object") return null;
  const d = dane as Partial<MotywWlasny>;
  if (typeof d.nazwa !== "string" || typeof d.baza !== "string" || !WBUDOWANE.some((m) => m.id === d.baza)) return null;
  const czysc = (o: unknown): Partial<Kolory> => {
    const wynik: Partial<Kolory> = {};
    if (o && typeof o === "object") {
      for (const k of EDYTOWALNE) {
        const v = (o as Record<string, unknown>)[k];
        if (typeof v === "string" && rgb(v)) wynik[k] = v;
      }
    }
    return wynik;
  };
  return { id: nowyId(), nazwa: d.nazwa.slice(0, 40), baza: d.baza, jasny: czysc(d.jasny), ciemny: czysc(d.ciemny) };
}

export function nowyId(): string {
  return `wlasny-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

// ---------- nakładanie na okno ----------

/** Tryb z ustawień (dark / light / system) → czy teraz ciemno. */
export function czyCiemny(tryb: string | undefined): boolean {
  const t = tryb ?? "system";
  return t === "dark" || (t === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
}

/** Nakłada motyw na dokument. `podglad` pozwala pokazać kolory z edytora bez zapisu. */
export function naloz(ciemny: boolean, podglad?: Motyw): void {
  const m = podglad ?? znajdz(wczytaj().motyw);
  const k = ciemny ? m.ciemny : m.jasny;
  const root = document.documentElement;
  root.dataset.theme = ciemny ? "dark" : "light";
  root.dataset.wariant = m.wariant;
  const slaby = (c: string, p: number) => `color-mix(in oklab, ${c} ${p}%, transparent)`;
  const zmienne: Record<string, string> = {
    "--tlo": k.tlo,
    "--powierzchnia": k.karta,
    "--powierzchnia-2": k.karta2,
    "--powierzchnia-3": mix(k.karta2, k.tekst, 7),
    "--obramowanie": k.linia,
    "--obramowanie-mocne": slaby(k.tekst, 24),
    "--tekst": k.tekst,
    "--tekst-2": k.tekst2,
    "--tekst-3": k.tekst3,
    "--akcent": k.akcent,
    "--akcent-tekst": k.naAkcencie,
    "--akcent-slaby": slaby(k.akcent, 15),
    "--akcent-ciemny": k.akcentMocny,
    "--akcent-2": k.pom2,
    "--ok": k.ok,
    "--ok-slaby": slaby(k.ok, 14),
    "--uwaga": k.pom1,
    "--uwaga-slaby": slaby(k.pom1, 14),
    "--blad": k.zle,
    "--blad-slaby": slaby(k.zle, 12),
    "--pas-1": k.akcent,
    "--pas-2": k.pom1,
    "--pas-3": k.braz,
    "--lcd-tlo": k.lcdTlo,
    "--lcd": k.lcd,
    "--wypelnienie": k.wypelnienie ?? `linear-gradient(90deg, ${k.akcent}, ${k.akcent})`,
  };
  for (const [n, v] of Object.entries(zmienne)) root.style.setProperty(n, v);
}

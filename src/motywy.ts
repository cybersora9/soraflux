// DNA 2.0 rodziny Sora (kopia z makiety docs/gui2/makieta.html, ADR: SoraFlux bez zależności od sora-ui).
// Motywy: Blackwall (domyślny), Kissaten, City Pop, MiniDisc, Neon noc i Własny (akcent z <input type=color>
// na bazie jednego z motywów). Każdy w trybie jasnym i ciemnym. Akcent SoraFluxa (#ff3a52 / #c8102e)
// nie należy do motywu; zmienia go tylko „Własny”. Logo zawsze karmazyn.
// Wszystkie kolory liczone tu do #rrggbb (mieszanie w OKLab jak color-mix w CSS), żeby test kontrastu
// sprawdzał dokładnie to, co trafia na ekran.

import type { Konfig } from "./typy";

export type IdMotywu = "blackwall" | "kissaten" | "citypop" | "minidisc" | "neon" | "wlasny";
export const ID_MOTYWOW: readonly IdMotywu[] = ["blackwall", "kissaten", "citypop", "minidisc", "neon", "wlasny"];
export type Baza = Exclude<IdMotywu, "wlasny">;
export const BAZY: readonly Baza[] = ["blackwall", "kissaten", "citypop", "minidisc", "neon"];
export const DOMYSLNY: Baza = "blackwall";

/** Paleta z makiety: wgłębienie, panel, panel2, tekst, tekst2, tekst3. */
type Szesc = readonly [string, string, string, string, string, string];

interface Zrodlo {
  ciemny: Szesc;
  jasny: Szesc;
}

const ZRODLA: Record<Baza, Zrodlo> = {
  blackwall: {
    ciemny: ["#0c0c0f", "#121216", "#18181d", "#f4eff1", "#bdb6b9", "#8f888c"],
    jasny: ["#ebe7e9", "#fbf9fa", "#f2eff0", "#151318", "#48434b", "#6a646c"],
  },
  kissaten: {
    ciemny: ["#211813", "#2c211a", "#36291f", "#f3e7d6", "#d2bfa9", "#ae9882"],
    jasny: ["#f6f0e6", "#fffaf2", "#f1e9dc", "#33241b", "#634e3f", "#7a6455"],
  },
  citypop: {
    ciemny: ["#111a40", "#1a2656", "#223064", "#f5f1e8", "#c6cbe3", "#a0a8cc"],
    jasny: ["#eef4fc", "#ffffff", "#e9f0fa", "#14204a", "#36437a", "#4f5c8c"],
  },
  minidisc: {
    ciemny: ["#191c21", "#202329", "#262a31", "#e8ebf0", "#b6bdc9", "#9098a5"],
    jasny: ["#e9ecf0", "#f6f7f9", "#e1e5ea", "#1c2330", "#465061", "#596374"],
  },
  neon: {
    ciemny: ["#0b0814", "#130f22", "#1b1630", "#f1ecff", "#c3b8e6", "#8f84b3"],
    jasny: ["#f3f0fb", "#ffffff", "#ebe6f8", "#1a1530", "#463d66", "#5f5680"],
  },
};

/** Akcent SoraFluxa: ciemny / jasny (makieta: --akd / --akl). */
export const AKCENT_FLUX = { ciemny: "#ff3a52", jasny: "#c8102e" } as const;
/** Szybkie akcenty „Własnego” (akcenty rodziny z makiety + róż). */
export const SZYBKIE_AKCENTY = ["#ff3a52", "#4cc2ff", "#5ee0c4", "#ffb547", "#b9a3ff", "#ff7ac6"] as const;

const STATUS = {
  ciemny: { ok: "#7ad6a4", uwaga: "#e6b450", zle: "#ff5468" },
  jasny: { ok: "#2d724e", uwaga: "#865e0f", zle: "#c02b3f" },
} as const;

/** Kolor LCD (wskaźnik „przed → po”): zawsze ciemne szkło, cyfry w akcencie trybu ciemnego. */
export const LCD_TLO = "#070709";

export interface MotywWlasny {
  akcent: string;
  baza: Baza;
}

/** Wszystkie tokeny jednego motywu w jednym trybie, każdy #rrggbb (poza liniami z przezroczystością). */
export interface Tokeny {
  wglebienie: string;
  panel: string;
  panel2: string;
  panel3: string;
  tekst: string;
  tekst2: string;
  tekst3: string;
  linia: string;
  linia2: string;
  linia3: string;
  ok: string;
  uwaga: string;
  zle: string;
  /** Akcent (przyciski, zaznaczenia). */
  akcent: string;
  /** Tekst na akcencie. */
  naAkcencie: string;
  /** Akcent użyty jako tekst/ikona na panelu: poprawiony do kontrastu 4,5:1, gdy akcent własny jest za słaby. */
  akcentTekst: string;
  /** Akcent 15% na panelu (zaznaczony kafel). */
  akcentSlaby: string;
  akcentLinia: string;
  /** „Półka” pod wciskanym przyciskiem. */
  akcentPolka: string;
  lcdTlo: string;
  lcd: string;
}

// ---------- kolory: hex, OKLab, kontrast ----------

function rgb(hex: string): [number, number, number] | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function poprawnyKolor(x: unknown): x is string {
  return typeof x === "string" && /^#[0-9a-f]{6}$/i.test(x.trim());
}

const doLin = (c: number) => {
  const s = c / 255;
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
};
const zLin = (l: number) => {
  const x = Math.min(1, Math.max(0, l));
  const s = x <= 0.0031308 ? 12.92 * x : 1.055 * x ** (1 / 2.4) - 0.055;
  return Math.round(Math.min(1, Math.max(0, s)) * 255);
};

function doOklab([r, g, b]: [number, number, number]): [number, number, number] {
  const [R, G, B] = [doLin(r), doLin(g), doLin(b)];
  const l = Math.cbrt(0.4122214708 * R + 0.5363325363 * G + 0.0514459929 * B);
  const m = Math.cbrt(0.2119034982 * R + 0.6806995451 * G + 0.1073969566 * B);
  const s = Math.cbrt(0.0883024619 * R + 0.2817188376 * G + 0.6299787005 * B);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

function zOklab([L, a, b]: [number, number, number]): string {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const R = 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s;
  const G = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s;
  const B = -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s;
  return "#" + [R, G, B].map((c) => zLin(c).toString(16).padStart(2, "0")).join("");
}

/** `color-mix(in oklab, a (100−p)%, b p%)` policzone do #rrggbb. */
export function mieszaj(a: string, b: string, procentB: number): string {
  const x = rgb(a);
  const y = rgb(b);
  if (!x || !y) return a;
  const p = Math.min(100, Math.max(0, procentB)) / 100;
  const [la, lb] = [doOklab(x), doOklab(y)];
  return zOklab([0, 1, 2].map((i) => la[i] * (1 - p) + lb[i] * p) as [number, number, number]);
}

function luminancja(hex: string): number | null {
  const c = rgb(hex);
  if (!c) return null;
  const [r, g, b] = c.map(doLin);
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
export function tekstNa(akcent: string): string {
  return (kontrast(akcent, "#ffffff") ?? 0) >= (kontrast(akcent, "#120a0d") ?? 0) ? "#ffffff" : "#120a0d";
}

/** Kolor przesuwany w stronę tekstu (jaśniej w ciemnym, ciemniej w jasnym), aż da `prog` na wszystkich tłach. */
export function doKontrastu(kolor: string, tla: string[], cel: string, prog = 4.5): string {
  let k = kolor;
  for (let p = 0; p <= 100; p += 4) {
    k = p === 0 ? kolor : mieszaj(kolor, cel, p);
    if (tla.every((t) => (kontrast(k, t) ?? 0) >= prog)) return k;
  }
  return cel;
}

// ---------- tokeny ----------

/** Tokeny motywu `id` w trybie (`ciemny`) z akcentem SoraFluxa albo własnym. */
export function tokeny(id: IdMotywu, ciemny: boolean, wlasny?: MotywWlasny | null): Tokeny {
  const baza: Baza = id === "wlasny" ? (wlasny?.baza && BAZY.includes(wlasny.baza) ? wlasny.baza : DOMYSLNY) : id;
  const [wglebienie, panel, panel2, tekst, tx2, tx3] = ZRODLA[baza][ciemny ? "ciemny" : "jasny"];
  const st = STATUS[ciemny ? "ciemny" : "jasny"];
  // Blackwall ma własny panel3 w makiecie; pozostałe: panel2 z 12% tekstu (jak color-mix w makiecie)
  const panel3 = baza === "blackwall" ? (ciemny ? "#1f1f25" : "#e8e4e6") : mieszaj(panel2, tekst, 12);
  // tła tekstu: wgłębienie, panel, panel2 (panel3 to tło przycisków pod kursorem i wciśniętych segmentów)
  const tla = [wglebienie, panel, panel2];
  // tekst pomocniczy z makiety, dociągnięty do 4,5:1 tam, gdzie paleta była na granicy
  const tekst2 = doKontrastu(tx2, [...tla, panel3], tekst);
  const tekst3 = doKontrastu(tx3, tla, tekst);
  let akcent: string = ciemny ? AKCENT_FLUX.ciemny : AKCENT_FLUX.jasny;
  let akcentCiemny: string = AKCENT_FLUX.ciemny;
  if (id === "wlasny" && wlasny && poprawnyKolor(wlasny.akcent)) {
    akcentCiemny = wlasny.akcent.toLowerCase();
    akcent = ciemny ? akcentCiemny : mieszaj(akcentCiemny, "#000000", 30);
  }
  // własny akcent w strefie „ani biały, ani czarny tekst nie daje 4,5:1”: lekko przesunięty od tekstu
  for (let p = 4; p <= 60 && (kontrast(tekstNa(akcent), akcent) ?? 0) < 4.5; p += 4) {
    const baz = id === "wlasny" && wlasny ? (ciemny ? akcentCiemny : mieszaj(akcentCiemny, "#000000", 30)) : akcent;
    akcent = mieszaj(baz, tekstNa(baz) === "#ffffff" ? "#000000" : "#ffffff", p);
  }
  const akcentSlaby = mieszaj(panel, akcent, 15);
  return {
    wglebienie,
    panel,
    panel2,
    panel3,
    tekst,
    tekst2,
    tekst3,
    linia: `color-mix(in oklab, ${tekst} 9%, transparent)`,
    linia2: `color-mix(in oklab, ${tekst} 15%, transparent)`,
    linia3: `color-mix(in oklab, ${tekst} 25%, transparent)`,
    // statusy dopasowane do najsłabszego tła motywu (City Pop ciemny ma jaśniejsze panele)
    ok: doKontrastu(st.ok, [...tla, akcentSlaby], tekst),
    uwaga: doKontrastu(st.uwaga, tla, tekst),
    zle: doKontrastu(st.zle, tla, tekst),
    akcent,
    naAkcencie: tekstNa(akcent),
    akcentTekst: doKontrastu(akcent, [...tla, akcentSlaby], tekst),
    akcentSlaby,
    akcentLinia: `color-mix(in oklab, ${akcent} 45%, transparent)`,
    akcentPolka: mieszaj(akcent, "#000000", 45),
    lcdTlo: LCD_TLO,
    lcd: doKontrastu(akcentCiemny, [LCD_TLO], "#ffffff"),
  };
}

// ---------- migracja motywów sprzed 2.0 ----------

/** Stare id (1.2–1.4) → najbliższy motyw 2.0. Palety „cybersora” (czerń + karmazyn) to Blackwall. */
const STARE: Record<string, Baza> = {
  "sora-a": "blackwall",
  "sora-b": "blackwall",
  "sora-c": "blackwall",
  "jp-a": "kissaten",
  "jp-b": "citypop",
  "jp-c": "minidisc",
};

export interface StanWygladu {
  motyw: IdMotywu;
  wlasny: MotywWlasny | null;
}

function poprawnyWlasny(x: unknown): MotywWlasny | null {
  if (!x || typeof x !== "object") return null;
  const m = x as Partial<MotywWlasny>;
  if (!poprawnyKolor(m.akcent)) return null;
  return { akcent: m.akcent.toLowerCase(), baza: BAZY.includes(m.baza as Baza) ? (m.baza as Baza) : DOMYSLNY };
}

/**
 * Stan wyglądu z konfigu, z migracją: stare id na najbliższy motyw, stary własny motyw (1.2–1.4:
 * baza + nadpisane kolory) na „Własny” z jego akcentem. `zmieniony` = trzeba zapisać konfig.
 */
export function zKonfigu(k: Pick<Konfig, "motyw_wyglad" | "wlasne_motywy" | "motyw_wlasny"> | null | undefined): StanWygladu & { zmieniony: boolean } {
  const id = k?.motyw_wyglad ?? DOMYSLNY;
  const wlasny = poprawnyWlasny(k?.motyw_wlasny);
  if ((ID_MOTYWOW as readonly string[]).includes(id)) {
    if (id === "wlasny" && !wlasny) return { motyw: DOMYSLNY, wlasny: null, zmieniony: true };
    return { motyw: id as IdMotywu, wlasny, zmieniony: false };
  }
  if (id in STARE) return { motyw: STARE[id], wlasny, zmieniony: true };
  const stary = (k?.wlasne_motywy ?? []).find((m) => (m as { id?: unknown })?.id === id) as
    | { baza?: string; jasny?: Record<string, unknown>; ciemny?: Record<string, unknown> }
    | undefined;
  if (stary) {
    const akcent = [stary.ciemny?.akcent, stary.jasny?.akcent].find(poprawnyKolor) ?? AKCENT_FLUX.ciemny;
    return { motyw: "wlasny", wlasny: { akcent: akcent.toLowerCase(), baza: STARE[stary.baza ?? ""] ?? DOMYSLNY }, zmieniony: true };
  }
  return { motyw: DOMYSLNY, wlasny, zmieniony: true };
}

/** Pola konfigu do zapisania. Stare `wlasne_motywy` zostają nietknięte (powrót do 1.4 nic nie gubi). */
export function doKonfigu(s: StanWygladu): Pick<Konfig, "motyw_wyglad" | "motyw_wlasny"> {
  return { motyw_wyglad: s.motyw, motyw_wlasny: s.wlasny };
}

// ---------- plik .json „Własnego” ----------

export function doPliku(w: MotywWlasny): string {
  return JSON.stringify({ rodzina: "sora", wersja: 2, nazwa: "Własny", akcent: w.akcent, baza: w.baza }, null, 2);
}

/** Import pliku .json (2.0 albo stary eksport 1.x z `baza` + kolorami); `null` = nie nasz plik. */
export function zPliku(tekst: string): MotywWlasny | null {
  let d: unknown;
  try {
    d = JSON.parse(tekst);
  } catch {
    return null;
  }
  const w = poprawnyWlasny(d);
  if (w) return w;
  const s = d as { baza?: string; jasny?: Record<string, unknown>; ciemny?: Record<string, unknown> } | null;
  const akcent = [s?.ciemny?.akcent, s?.jasny?.akcent].find(poprawnyKolor);
  return akcent ? { akcent: akcent.toLowerCase(), baza: STARE[s?.baza ?? ""] ?? DOMYSLNY } : null;
}

// ---------- nakładanie na okno ----------

let biezacy: StanWygladu = { motyw: DOMYSLNY, wlasny: null };

export function ustawStan(s: StanWygladu): void {
  biezacy = { motyw: s.motyw, wlasny: s.wlasny };
}

export function wczytaj(): StanWygladu {
  return biezacy;
}

/** Tryb z ustawień (dark / light / system) → czy teraz ciemno. */
export function czyCiemny(tryb: string | undefined): boolean {
  const t = tryb ?? "system";
  return t === "dark" || (t === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
}

/** Zmienne CSS motywu: nazwy DNA 2.0 (makieta) i aliasy widoków 1.x (Prosty, Ustawienia, panel). */
export function zmienneCss(k: Tokeny): Record<string, string> {
  const slaby = (c: string, p: number) => `color-mix(in oklab, ${c} ${p}%, transparent)`;
  return {
    "--wglebienie": k.wglebienie,
    "--panel": k.panel,
    "--panel2": k.panel2,
    "--panel3": k.panel3,
    "--tx": k.tekst,
    "--tx2": k.tekst2,
    "--tx3": k.tekst3,
    "--line": k.linia,
    "--line2": k.linia2,
    "--line3": k.linia3,
    "--ak": k.akcent,
    "--ak-na": k.naAkcencie,
    "--ak-tx": k.akcentTekst,
    "--ak-slaby": k.akcentSlaby,
    "--ak-linia": k.akcentLinia,
    "--ak-polka": k.akcentPolka,
    "--ok": k.ok,
    "--warn": k.uwaga,
    "--bad": k.zle,
    "--lcd-szklo": k.lcdTlo,
    "--lcd-cyfry": k.lcd,
    // widoki 1.x
    "--tlo": k.wglebienie,
    "--powierzchnia": k.panel,
    "--powierzchnia-2": k.panel2,
    "--powierzchnia-3": k.panel3,
    "--obramowanie": k.linia2,
    "--obramowanie-mocne": k.linia3,
    "--tekst": k.tekst,
    "--tekst-2": k.tekst2,
    "--tekst-3": k.tekst3,
    "--akcent": k.akcentTekst,
    "--akcent-tekst": k.naAkcencie,
    "--akcent-slaby": slaby(k.akcent, 15),
    "--akcent-ciemny": k.akcentPolka,
    "--akcent-2": k.uwaga,
    "--ok-slaby": slaby(k.ok, 14),
    "--uwaga": k.uwaga,
    "--uwaga-slaby": slaby(k.uwaga, 14),
    "--blad": k.zle,
    "--blad-slaby": slaby(k.zle, 12),
    "--pas-1": k.akcent,
    "--pas-2": k.uwaga,
    "--pas-3": k.tekst3,
    "--lcd-tlo": k.lcdTlo,
    "--lcd": k.lcd,
    "--wypelnienie": `linear-gradient(90deg, ${k.akcentPolka}, ${k.akcent})`,
  };
}

/** Nakłada motyw na dokument. `podglad` pokazuje kolory bez zapisu (edycja „Własnego”). */
export function naloz(ciemny: boolean, podglad?: StanWygladu): void {
  const s = podglad ?? wczytaj();
  const k = tokeny(s.motyw, ciemny, s.wlasny);
  const root = document.documentElement;
  root.dataset.theme = ciemny ? "dark" : "light";
  root.dataset.motyw = s.motyw;
  root.dataset.wariant = "a";
  for (const [n, v] of Object.entries(zmienneCss(k))) root.style.setProperty(n, v);
}

/** Podgląd motywu na kaflu w Ustawieniach: tło, panel boczny i pasek akcentu. */
export function probki(id: IdMotywu, ciemny: boolean, wlasny?: MotywWlasny | null): { tlo: string; bok: string; panel: string; akcent: string } {
  const k = tokeny(id, ciemny, wlasny);
  return { tlo: k.wglebienie, bok: k.panel, panel: k.panel2, akcent: k.akcent };
}

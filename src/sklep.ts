// Prosty store z subskrypcjami: stan globalny apki.
import type { InfoZadania, Konfig, Postep, Preset, StanNarzedzi } from "./typy";

export class Sklep<T extends object> {
  private s: T;
  private sluchacze = new Set<(s: T) => void>();

  constructor(poczatek: T) {
    this.s = poczatek;
  }

  get stan(): T {
    return this.s;
  }

  ustaw(zmiana: Partial<T> | ((s: T) => Partial<T>)): void {
    const z = typeof zmiana === "function" ? zmiana(this.s) : zmiana;
    this.s = { ...this.s, ...z };
    this.sluchacze.forEach((f) => f(this.s));
  }

  subskrybuj(f: (s: T) => void): () => void {
    this.sluchacze.add(f);
    return () => this.sluchacze.delete(f);
  }
}

export type Zakladka = "konwertuj" | "pobierz" | "obrazy" | "kolejka" | "ustawienia";

export interface StanApki {
  zakladka: Zakladka;
  konfig: Konfig | null;
  narzedzia: StanNarzedzi | null;
  presety: Preset[];
  zadania: Map<number, InfoZadania>;
  postepy: Map<number, Postep>;
  /** Komunikat w dymku na dole (np. „dodano 3 zadania”). */
  dymek: Dymek | null;
}

export interface Dymek {
  tekst: string;
  rodzaj: "info" | "blad";
  /** Przycisk w dymku, np. „Pokaż” → zakładka Kolejka. */
  akcja?: { etykieta: string; zrob: () => void };
}

export const sklep = new Sklep<StanApki>({
  zakladka: "konwertuj",
  konfig: null,
  narzedzia: null,
  presety: [],
  zadania: new Map(),
  postepy: new Map(),
  dymek: null,
});

let licznikDymku: ReturnType<typeof setTimeout> | undefined;
export function pokazDymek(tekst: string, rodzaj: "info" | "blad" = "info", akcja?: Dymek["akcja"]): void {
  sklep.ustaw({ dymek: { tekst, rodzaj, akcja } });
  if (licznikDymku) clearTimeout(licznikDymku);
  licznikDymku = setTimeout(() => sklep.ustaw({ dymek: null }), rodzaj === "blad" || akcja ? 6000 : 3000);
}

/** Forma liczby dla polskiej odmiany: 1 zadanie, 2–4 zadania, 5+ zadań (EN: 1 / więcej). */
export function forma(n: number): "1" | "kilka" | "wiele" {
  if (n === 1) return "1";
  const j = n % 10;
  const d = n % 100;
  return j >= 2 && j <= 4 && !(d >= 12 && d <= 14) ? "kilka" : "wiele";
}

/** Dymek po dodaniu zadań: „Dodano 2 zadania do kolejki · Pokaż” (usterka 6 z 07.10:
 *  lista plików czyści się po Konwertuj, więc trzeba jasno powiedzieć, gdzie trafiły). */
export function dymekDodano(n: number, t: (k: string, p?: Record<string, string | number>) => string): void {
  pokazDymek(t(`kolejka.dodano_${forma(n)}`, { n }), "info", { etykieta: t("kolejka.pokaz"), zrob: () => sklep.ustaw({ zakladka: "kolejka", dymek: null }) });
}

/** Ile zadań jest w toku (plakietka przy zakładce Kolejka). */
export function aktywneZadania(s: StanApki): number {
  let n = 0;
  for (const z of s.zadania.values()) if (z.stan.typ === "trwa" || z.stan.typ === "oczekuje") n++;
  return n;
}

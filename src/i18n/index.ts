import pl from "./pl.json";
import en from "./en.json";

export type Jezyk = "pl" | "en";
type Slownik = Record<string, string>;

const slowniki: Record<Jezyk, Slownik> = { pl, en };
let biezacy: Jezyk = "pl";
const sluchacze = new Set<() => void>();

export function ustawJezyk(j: Jezyk): void {
  if (j === biezacy) return;
  biezacy = j;
  document.documentElement.lang = j;
  sluchacze.forEach((f) => f());
}

export function jezyk(): Jezyk {
  return biezacy;
}

export function naZmianeJezyka(f: () => void): () => void {
  sluchacze.add(f);
  return () => sluchacze.delete(f);
}

/** Tłumaczenie z podstawieniem `{nazwa}`. Brak klucza: polski, potem sam klucz. */
export function t(klucz: string, parametry?: Record<string, string | number>): string {
  const tekst = slowniki[biezacy][klucz] ?? slowniki.pl[klucz] ?? klucz;
  if (!parametry) return tekst;
  return tekst.replace(/\{(\w+)\}/g, (_, n: string) => String(parametry[n] ?? `{${n}}`));
}

/** Znacznik komunikatu z Rusta (`src-tauri/src/blad.rs`): `@i18n {"k":…,"a":{…}}`, potem surowy ogon. */
const ZNACZNIK_BLEDU = "@i18n ";

/** Komunikat błędu z Rusta w języku interfejsu; zwykły tekst wraca bez zmian. */
export function tlumaczBlad(komunikat: string): string {
  if (!komunikat.startsWith(ZNACZNIK_BLEDU)) return komunikat;
  const koniec = komunikat.indexOf("\n");
  const linia = komunikat.slice(ZNACZNIK_BLEDU.length, koniec < 0 ? undefined : koniec);
  const ogon = koniec < 0 ? "" : komunikat.slice(koniec);
  try {
    const { k, a } = JSON.parse(linia) as { k: string; a?: Record<string, string> };
    return t(`rust.${k}`, a) + ogon;
  } catch {
    return komunikat;
  }
}

/** Błąd z `catch` (Tauri odrzuca stringiem z Rusta) do pokazania w GUI. */
export function tekstBledu(e: unknown): string {
  return tlumaczBlad(String(e));
}

export function maKlucz(klucz: string): boolean {
  return klucz in slowniki[biezacy] || klucz in slowniki.pl;
}

/** Wykrycie języka systemu przy pierwszym uruchomieniu. */
export function jezykSystemu(): Jezyk {
  const n = (navigator.language || "pl").toLowerCase();
  return n.startsWith("pl") ? "pl" : "en";
}

export const wszystkieSlowniki = slowniki;

// Upuszczone pliki → przyjęte i pominięte z powodem (P3 z testu na żywo 1.4.0: tekst.txt upuszczony na
// Konwertuj i film na Obrazy znikały bez słowa). Czysta logika, testowana vitestem; dymek składają widoki.
import { nazwaPliku, rozszerzenie, toObraz } from "./logika";

/** To samo co `ROZSZERZENIA_MEDIOW` w `src-tauri/src/komendy.rs` (test pilnuje zgodności). */
export const ROZSZERZENIA_MEDIOW = [
  "mp4", "mkv", "webm", "mov", "avi", "m4v", "wmv", "flv", "mpg", "mpeg", "ts", "m2ts", "mts", "3gp", "ogv", "gif",
  "mp3", "m4a", "aac", "opus", "ogg", "oga", "flac", "wav", "wma", "aiff", "aif", "amr", "ac3", "mka", "png", "jpg",
  "jpeg", "webp", "avif", "bmp", "ico", "tif", "tiff", "heic", "jxl",
];

export type PowodPominiecia =
  /** Rozszerzenie spoza listy mediów (tekst.txt, dokument.pdf). */
  | "format"
  /** Obrazy: wideo albo audio (konwertuje się je w zakładce Konwertuj). */
  | "nie_obraz"
  /** Folder (albo plik bez rozszerzenia), w którym nie było nic do przerobienia. */
  | "brak_mediow";

export interface Pominiety {
  sciezka: string;
  powod: PowodPominiecia;
}

export type Cel = "konwertuj" | "obrazy" | "prosty";

const obrazAlboGif = (s: string) => toObraz(s) || rozszerzenie(s) === "gif";

/** Czy `r` pochodzi z upuszczonego `w` (ten sam plik albo plik z folderu `w`). */
function zWejscia(r: string, w: string): boolean {
  if (r === w) return true;
  const baza = w.replace(/[\\/]+$/, "");
  return r.startsWith(baza + "/") || r.startsWith(baza + "\\");
}

/**
 * `wejscie` = to, co upuścił użytkownik; `rozwiniete` = pliki mediów po rozwinięciu folderów (Rust).
 * Wynik: pliki do listy i pominięte z powodem. Mieszana paczka: obsługiwane przyjęte, reszta wymieniona.
 */
export function klasyfikujUpuszczone(wejscie: string[], rozwiniete: string[], cel: Cel): { przyjete: string[]; pominiete: Pominiety[] } {
  const przyjete: string[] = [];
  const pominiete: Pominiety[] = [];
  for (const r of rozwiniete) {
    if (cel === "obrazy" && !obrazAlboGif(r)) pominiete.push({ sciezka: r, powod: "nie_obraz" });
    else przyjete.push(r);
  }
  for (const w of wejscie) {
    if (rozwiniete.some((r) => zWejscia(r, w))) continue;
    const ext = rozszerzenie(w);
    pominiete.push({ sciezka: w, powod: ext && !ROZSZERZENIA_MEDIOW.includes(ext) ? "format" : "brak_mediow" });
  }
  return { przyjete, pominiete };
}

export interface KomunikatPominietych {
  /** Klucz i18n i parametry dymku. */
  klucz: string;
  parametry: Record<string, string | number>;
  /** Obrazy: wideo/audio można jednym kliknięciem przenieść do Konwertuj. */
  doKonwertuj: string[];
}

/** Forma liczby (1 plik / 2–4 pliki / 5+ plików), jak `forma` w sklep.ts. */
function forma(n: number): "1" | "kilka" | "wiele" {
  if (n === 1) return "1";
  const j = n % 10;
  const d = n % 100;
  return j >= 2 && j <= 4 && !(d >= 12 && d <= 14) ? "kilka" : "wiele";
}

/** Dymek o pominiętych: „Pominięto 1 plik: nieobsługiwany format (tekst.txt)”. `null` = nic nie pominięto. */
export function komunikatPominietych(pominiete: Pominiety[]): KomunikatPominietych | null {
  if (pominiete.length === 0) return null;
  const nieObrazy = pominiete.filter((p) => p.powod === "nie_obraz").map((p) => p.sciezka);
  if (nieObrazy.length === pominiete.length) return { klucz: "upusc.nie_obrazy", parametry: {}, doKonwertuj: nieObrazy };
  const nazwy = pominiete.slice(0, 3).map((p) => nazwaPliku(p.sciezka.replace(/[\\/]+$/, ""))).join(", ") + (pominiete.length > 3 ? "…" : "");
  const powody = new Set(pominiete.map((p) => p.powod));
  const powod = powody.size === 1 ? [...powody][0] : "rozne";
  return {
    klucz: `upusc.pominieto_${forma(pominiete.length)}`,
    parametry: { n: pominiete.length, powod: `upusc.powod.${powod}`, nazwy },
    doKonwertuj: nieObrazy,
  };
}

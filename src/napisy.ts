// Tryb Napisy (S5): czysta logika bez DOM i bez i18n (zwraca klucze), testowana vitestem.
// Mowa → tekst robi whisper.cpp lokalnie (Rust: src-tauri/src/napisy/). Sieć tylko do pobrania modelu,
// i tylko po wyraźnej zgodzie (okno zgody w widoku Prostym).
import { formatujRozmiar } from "./logika";
import type { InfoModelu, ModelNapisow, OpcjeNapisow, Postep, StanNapisow, StylNapisow, JezykNapisow } from "./typy";

/** Akcja trybu Prostego, która nie jest konwersją (nie ma profilu ffmpeg). */
export const AKCJA_NAPISOW = "napisy";

export const JEZYKI: JezykNapisow[] = ["auto", "pl", "en"];
export const MODELE: ModelNapisow[] = ["base", "small", "medium", "large_v3_turbo"];
export const STYLE: (StylNapisow | null)[] = [null, "rolki", "srodek", "klasyczny"];

/** Domyślne: język wykrywany, najmniejszy model, sam SRT (najszerzej obsługiwany). */
export function opcjeDomyslne(): OpcjeNapisow {
  return { jezyk: "auto", model: "base", srt: true, vtt: false, wypal: null, uklad: null };
}

/**
 * Opcje do kolejki. Dźwięk bez obrazu: bez wypalania. Gdy nic nie zaznaczono, zostaje SRT
 * (przycisk nie może obiecać zadania, które nic nie zapisze).
 */
export function opcjeDoKolejki(o: OpcjeNapisow, maObraz: boolean): OpcjeNapisow {
  const wypal = maObraz ? o.wypal : null;
  const srt = o.srt || (!o.vtt && !wypal);
  return { ...o, wypal, srt };
}

export type GotowoscNapisow =
  /** czekamy na `napisy_stan` */
  | "sprawdzam"
  /** brak whisper-cli: Ustawienia → Narzędzia */
  | "brak_whisper"
  /** model trzeba pobrać (za zgodą) */
  | "pobierz"
  /** suma modelu nieprzypięta w tej wersji: tylko ręczne położenie pliku w katalogu modeli */
  | "brak_sumy"
  | "gotowe";

export function gotowosc(s: StanNapisow | null, model: ModelNapisow): GotowoscNapisow {
  if (!s) return "sprawdzam";
  if (!s.whisper) return "brak_whisper";
  const m = s.modele.find((x) => x.model === model);
  if (m?.pobrany) return "gotowe";
  return m?.do_pobrania ? "pobierz" : "brak_sumy";
}

export function infoModelu(s: StanNapisow | null, model: ModelNapisow): InfoModelu | null {
  return s?.modele.find((x) => x.model === model) ?? null;
}

/** „142 MB” / „1,5 GB” (rozmiar_mb to MiB, jak `formatujRozmiar`). */
export function rozmiarModelu(m: InfoModelu, jezyk: "pl" | "en"): string {
  return formatujRozmiar(m.rozmiar_mb * 1_048_576, jezyk).replace(/[.,]0 /, " ");
}

/** Klucz i18n etapu z postępu zadania + numer fragmentu, gdy plik jest dzielony. */
export function etapZadania(p: Postep | undefined): { klucz: string; fragment: { i: number; n: number } | null } | null {
  if (!p?.etap) return null;
  return { klucz: `napisy.etap.${p.etap}`, fragment: p.przebiegi > 1 && p.etap !== "wypalanie" ? { i: p.przebieg, n: p.przebiegi } : null };
}

/** Pozostały czas pobierania modelu z dotychczasowego tempa (`null` na początku). */
export function etaPobierania(pobrane: number, calosc: number | null, start: number, uplynelo_s: number): number | null {
  if (!calosc || uplynelo_s < 2) return null;
  const tempo = (pobrane - start) / uplynelo_s;
  if (tempo <= 0) return null;
  return Math.max(0, (calosc - pobrane) / tempo);
}

/** Klucz nazwy języka (PL/EN) albo sam kod wielkimi literami dla innych wykrytych języków. */
export function nazwaJezyka(kod: string | null): { klucz: string } | { tekst: string } | null {
  if (!kod) return null;
  if (kod === "pl" || kod === "en") return { klucz: `napisy.jezyk.${kod}` };
  return { tekst: kod.toUpperCase() };
}

/** Host pobierania modelu do okna zgody (bez ścieżki: krótko i czytelnie). */
export const HOST_MODELI = "huggingface.co";

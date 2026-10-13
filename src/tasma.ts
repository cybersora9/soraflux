// Taśma (GUI 2.0): czysta logika bez DOM. Każdy plik ma własny przepis (D2: ustawienia per plik),
// przepisy to akcje trybu Prostego (te same profile), „Dostosuj” = pełny panel ustawień = przepis „Własny”.
// Tu: lista przepisów dla rodzaju pliku, profil pozycji, zadanie do kolejki, blokady i sumy.
import { blokadaFormatu, sklonuj, type BlokadaFormatu } from "./logika";
import { AKCJE, CELE, dopisekAkcji, miesciSie, profilAkcji, rodzajMediow, type Cel, type Rodzaj } from "./prosty";
import { AKCJA_NAPISOW, opcjeDomyslne, opcjeDoKolejki } from "./napisy";
import type { InfoZadania, Media, NoweZadanie, Profil, Sprzet } from "./typy";

export type RodzajPliku = Exclude<Rodzaj, "link">;
/** Przepis to akcja trybu Prostego albo „wlasny” (profil z panelu „Dostosuj”). */
export type Przepis = string;
export const WLASNY = "wlasny";

export interface Pozycja {
  /** Lokalny numer pozycji na taśmie (nie id zadania). */
  nr: number;
  sciezka: string;
  /** Plik z upuszczonego folderu: podfolder względem niego (struktura w folderze wyniku). */
  podkatalog: string | null;
  media: Media | null;
  blad: string | null;
  przepis: Przepis;
  cel: Cel;
  /** Profil przepisu (albo z „Dostosuj”). Dla napisów nieużywany. */
  profil: Profil;
  /** Wyrównaj głośność −14 LUFS (EBU R128, dwa przebiegi). */
  glosnosc: boolean;
  /** Koduj kartą graficzną (wykryty enkoder sprzętowy), z powrotem do procesora przy awarii. */
  sprzet: Sprzet | null;
  /** GIF: początek fragmentu (s). */
  gifOd: number;
  /** Id zadania w kolejce po Start. */
  zadanie: number | null;
}

/** Przepisy dla rodzaju pliku: akcje trybu Prostego + „Własny”. */
export function przepisyDla(r: RodzajPliku): Przepis[] {
  return [...AKCJE[r], WLASNY];
}

/** Domyślny przepis rodzaju (pierwsza akcja: „Do wysłania”, „MP3”, „Do internetu”). */
export function domyslnyPrzepis(r: RodzajPliku): Przepis {
  return AKCJE[r][0];
}

export function rodzajPozycji(p: Pick<Pozycja, "media">): RodzajPliku | null {
  return p.media ? rodzajMediow(p.media) : null;
}

/** Enkoder sprzętowy z listy działających (`h264_nvenc` → `nvenc`); pierwszy wygrywa. */
export function sprzetZEnkoderow(dzialajace: string[]): Sprzet | null {
  for (const s of ["nvenc", "qsv", "amf"] as const) if (dzialajace.some((e) => e.endsWith(`_${s}`))) return s;
  return null;
}

/** Profil przepisu dla pozycji (bez opcji głośności i karty). `null` = napisy (nie konwersja). */
export function profilPrzepisu(p: Pick<Pozycja, "media" | "przepis" | "cel" | "gifOd" | "sciezka" | "profil">): Profil | null {
  const r = rodzajPozycji(p);
  if (!r || p.przepis === AKCJA_NAPISOW) return null;
  if (p.przepis === WLASNY) return sklonuj(p.profil);
  return profilAkcji(r, p.przepis, { cel: p.cel, zrodlo: p.sciezka, gifOd: p.gifOd, czas: p.media?.czas_s ?? null });
}

/** Profil, który naprawdę pójdzie do kolejki: przepis + wyrównanie głośności + karta graficzna. */
export function profilKoncowy(p: Pozycja): Profil | null {
  const prof = profilPrzepisu(p);
  if (!prof) return null;
  if (p.glosnosc && prof.audio && prof.audio.kodek !== "kopiuj") prof.audio = { ...prof.audio, normalizacja: true, lufs: -14 };
  if (p.sprzet && prof.wideo && (prof.wideo.kodek === "h264" || prof.wideo.kodek === "h265")) prof.wideo = { ...prof.wideo, sprzet: p.sprzet };
  return prof;
}

export type Blokada = { typ: "format"; powod: BlokadaFormatu } | { typ: "miesci" } | { typ: "blad" } | { typ: "sonda" };

/** Czy pozycja pójdzie do kolejki; jeśli nie, dlaczego (P4: brak dźwięku/obrazu, P1: już się mieści). */
export function blokada(p: Pozycja): Blokada | null {
  if (p.blad) return { typ: "blad" };
  if (!p.media) return { typ: "sonda" };
  const r = rodzajPozycji(p);
  if (r === "film" && p.przepis === "wyslij" && miesciSie(p.media.rozmiar_b, p.cel)) return { typ: "miesci" };
  const prof = profilKoncowy(p);
  if (prof) {
    const b = blokadaFormatu(p.media, prof);
    if (b) return { typ: "format", powod: b };
  }
  return null;
}

/** Katalog wyniku dla pliku z folderu: folder wyjścia + podfolder (bez folderu: obok źródła). */
export function katalogPozycji(p: Pick<Pozycja, "podkatalog">, katalogWyjscia: string | null): string | null {
  if (!katalogWyjscia || !p.podkatalog) return katalogWyjscia;
  const sep = katalogWyjscia.includes("\\") ? "\\" : "/";
  return [katalogWyjscia.replace(/[\\/]+$/, ""), ...p.podkatalog.split(/[\\/]/)].join(sep);
}

/**
 * Zadanie do kolejki albo `null` (zablokowana, już wysłana). `tlumacz` daje dopisek do nazwy
 * („wakacje (na Discorda).mp4”), jak w trybie Prostym.
 */
export function zadanieDla(p: Pozycja, katalogWyjscia: string | null, tlumacz: (k: string) => string): NoweZadanie | null {
  if (p.zadanie !== null || blokada(p)) return null;
  const r = rodzajPozycji(p)!;
  const katalog = katalogPozycji(p, katalogWyjscia);
  if (p.przepis === AKCJA_NAPISOW) {
    const maObraz = !!p.media?.wideo && !p.media.obraz;
    return { rodzaj: { typ: "napisy", wejscie: p.sciezka, opcje: opcjeDoKolejki(opcjeDomyslne(), maObraz) }, katalog };
  }
  const profil = profilKoncowy(p)!;
  const klucz = p.przepis === WLASNY ? null : dopisekAkcji(r, p.przepis, p.cel);
  return { rodzaj: { typ: "konwersja", wejscie: p.sciezka, profil }, katalog, dopisek: klucz ? tlumacz(klucz) : null };
}

/** Stan pozycji po Start (z kolejki). */
export type StanPozycji = "czeka" | "w_kolejce" | "trwa" | "gotowe" | "blad" | "anulowane";

export function stanPozycji(p: Pick<Pozycja, "zadanie">, zadania: Map<number, InfoZadania>): StanPozycji {
  if (p.zadanie === null) return "czeka";
  const z = zadania.get(p.zadanie);
  if (!z) return "w_kolejce";
  switch (z.stan.typ) {
    case "oczekuje":
      return "w_kolejce";
    case "trwa":
      return "trwa";
    case "gotowe":
    case "pominiete":
      return "gotowe";
    case "blad":
      return "blad";
    default:
      return "anulowane";
  }
}

export type Filtr = "wszystko" | "w_toku" | "bledy";

export function pasujeDoFiltra(s: StanPozycji, b: Blokada | null, f: Filtr): boolean {
  if (f === "w_toku") return s === "trwa" || s === "w_kolejce";
  if (f === "bledy") return s === "blad" || (b !== null && b.typ !== "sonda");
  return true;
}

/** Liczniki chipów filtra nad listą: „W toku” = tylko pozycje w kolejce (oczekuje / pauza) albo w trakcie. */
export function liczbyFiltrow(pozycje: Pozycja[], zadania: Map<number, InfoZadania>): Record<Filtr, number> {
  const n: Record<Filtr, number> = { wszystko: 0, w_toku: 0, bledy: 0 };
  for (const p of pozycje) {
    const s = stanPozycji(p, zadania);
    const b = blokada(p);
    for (const f of ["wszystko", "w_toku", "bledy"] as const) if (pasujeDoFiltra(s, b, f)) n[f]++;
  }
  return n;
}

/** Szacunek „po” dla pozycji: wynik zadania, gdy gotowe; inaczej szacunek przepisu. „Już się mieści” = bez zmian. */
export function rozmiarPo(p: Pozycja, szacunek: number | null, zadania: Map<number, InfoZadania>): number | null {
  const z = p.zadanie !== null ? zadania.get(p.zadanie) : undefined;
  if (z?.rozmiar_wyniku) return z.rozmiar_wyniku;
  if (blokada(p)?.typ === "miesci") return p.media?.rozmiar_b ?? null;
  return szacunek;
}

/** Suma przed / po na pasku transportu (tylko pozycje z danymi). */
export function sumy(lista: { przed: number | null; po: number | null }[]): { przed: number; po: number; znane: number } {
  let przed = 0;
  let po = 0;
  let znane = 0;
  for (const x of lista) {
    if (x.przed && x.po !== null) {
      przed += x.przed;
      po += x.po;
      znane++;
    }
  }
  return { przed, po, znane };
}

/** Limit celu „Do wysłania” w MB (chipy E-mail 25 / WhatsApp 16 / Discord 10). */
export const LIMITY: Record<Cel, number> = { mail: CELE.mail.limit, whatsapp: CELE.whatsapp.limit, discord: CELE.discord.limit };

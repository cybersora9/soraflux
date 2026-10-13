// Narzędzia P1 (GUI 2.0): czysta logika bez DOM. Zmiana kontenera, wyrównanie głośności i kadrowanie to
// zwykłe profile konwersji (kopia strumieni / loudnorm 2-przebiegowo / crop+transpose); wyodrębnianie
// ścieżek i łączenie to osobne zadania kolejki (Rust: budowniczy/obrobka.rs).
import { audioDomyslne, domyslnyKodekAudio, KODEKI_AUDIO, KODEKI_WIDEO, kontenerKopii, profilDla, rozszerzenie, tylkoAudio, wideoDomyslne } from "./logika";
import type { KodekAudio, KodekWideo, Kontener, Media, Obrot, Profil } from "./typy";

export type Narzedzie = "kontener" | "sciezki" | "polacz" | "glosnosc" | "kadr";
export const NARZEDZIA: Narzedzie[] = ["kontener", "sciezki", "polacz", "glosnosc", "kadr"];

/** Kodek z nazwy ffprobe → nasz (do zgodności kopii z kontenerem); jak `kodek_*_z_nazwy` w Rust. */
export function kodekWideoZNazwy(n: string): KodekWideo | null {
  return ({ h264: "h264", hevc: "h265", av1: "av1", vp9: "vp9", mpeg4: "mpeg4" } as Record<string, KodekWideo>)[n] ?? null;
}
export function kodekAudioZNazwy(n: string): KodekAudio | null {
  if (n.startsWith("pcm_")) return "pcm";
  return ({ aac: "aac", mp3: "mp3", opus: "opus", vorbis: "vorbis", flac: "flac" } as Record<string, KodekAudio>)[n] ?? null;
}

/** Czy plik da się przenieść do kontenera bez kodowania (lustro `kopia_mozliwa` w Rust). */
export function kopiaMozliwa(m: Media, k: Kontener): boolean {
  const wideo = m.wideo && !m.obraz ? m.wideo : null;
  const wideoOk = !wideo || tylkoAudio(k) || (() => {
    const kod = kodekWideoZNazwy(wideo.kodek);
    return !!kod && (KODEKI_WIDEO[k] ?? []).includes(kod);
  })();
  const audioOk = !m.audio || (() => {
    const kod = kodekAudioZNazwy(m.audio.kodek);
    return !!kod && (KODEKI_AUDIO[k] ?? []).includes(kod);
  })();
  const cokolwiek = !!m.audio || (!!wideo && !tylkoAudio(k));
  return wideoOk && audioOk && cokolwiek;
}

/** Kontenery do wyboru przy zmianie kontenera (wideo i audio). */
export const KONTENERY_ZMIANY: Kontener[] = ["mp4", "mkv", "mov", "webm", "m4a", "mp3", "flac", "opus", "wav"];

/** Zmiana kontenera = kopia obrazu i dźwięku (bez straty jakości), napisy zostają, gdy kontener je przyjmuje. */
export function profilKontenera(k: Kontener, m: Media): Profil {
  const p = profilDla(k);
  p.wideo = tylkoAudio(k) || !m.wideo || m.obraz ? null : { ...wideoDomyslne("kopiuj") };
  p.audio = m.audio ? { ...audioDomyslne("aac"), kodek: "kopiuj" } : null;
  p.sciezki_audio = { typ: "wszystkie" };
  p.napisy = true;
  return p;
}

/** Cele głośności (LUFS): social, podcast, TV (EBU R128). */
export const CELE_LUFS = [-14, -16, -23] as const;

/**
 * Wyrównanie głośności (2 przebiegi loudnorm): obraz bez kodowania, dźwięk kodowany w tym samym formacie
 * (MP3/FLAC/WAV zostają sobą; obce kontenery: MKV z AAC).
 */
export function profilGlosnosci(sciezka: string, m: Media, lufs: number): Profil {
  const ext = rozszerzenie(sciezka);
  const wideo = !!m.wideo && !m.obraz;
  const k: Kontener = wideo ? kontenerKopii(sciezka) : (["mp3", "m4a", "flac", "wav", "opus", "ogg"] as string[]).includes(ext) ? (ext as Kontener) : "m4a";
  const p = profilDla(k);
  if (wideo) p.wideo = { ...wideoDomyslne("kopiuj") };
  const kodek = domyslnyKodekAudio(k) ?? "aac";
  p.audio = { ...audioDomyslne(kodek), kbps: kodek === "mp3" ? 256 : 192, normalizacja: true, lufs };
  return p;
}

export type Proporcje = "bez" | "16:9" | "9:16" | "1:1" | "4:5";
export const PROPORCJE: Proporcje[] = ["bez", "16:9", "9:16", "1:1", "4:5"];

/** Przycięcie (px z każdej strony) do proporcji, kadr na środku, wymiary parzyste. */
export function przyciecieDo(w: number, h: number, p: Proporcje): Profil["przyciecie"] {
  const zero = { gora: 0, dol: 0, lewo: 0, prawo: 0 };
  if (p === "bez" || w <= 0 || h <= 0) return zero;
  const [a, b] = p.split(":").map(Number);
  const r = a / b;
  if (w / h > r) {
    const nw = Math.max(2, Math.floor((h * r) / 2) * 2);
    const lewo = Math.floor((w - nw) / 2);
    return { ...zero, lewo, prawo: w - nw - lewo };
  }
  const nh = Math.max(2, Math.floor(w / r / 2) * 2);
  const gora = Math.floor((h - nh) / 2);
  return { ...zero, gora, dol: h - nh - gora };
}

export interface Geometria {
  proporcje: Proporcje;
  obrot: Obrot;
  poziomo: boolean;
  pionowo: boolean;
}

/** Kadruj / obróć / odbij: obraz kodowany (H.264 CRF 18, prawie bez straty), dźwięk kopiowany. */
export function profilGeometrii(sciezka: string, m: Media, g: Geometria): Profil {
  const zrodlo = kontenerKopii(sciezka);
  const k: Kontener = zrodlo === "webm" || zrodlo === "avi" ? "mp4" : zrodlo;
  const p = profilDla(k);
  p.wideo = { ...wideoDomyslne("h264"), jakosc: { typ: "crf", crf: 18 } };
  p.audio = m.audio ? { ...audioDomyslne("aac"), kodek: kopiaMozliwa({ ...m, wideo: null }, k) ? "kopiuj" : "aac", kbps: 192 } : null;
  p.przyciecie = m.wideo ? przyciecieDo(m.wideo.w, m.wideo.h, g.proporcje) : p.przyciecie;
  p.obrot = g.obrot;
  p.odbicie = { poziomo: g.poziomo, pionowo: g.pionowo };
  return p;
}

export function geometriaPusta(g: Geometria): boolean {
  return g.proporcje === "bez" && g.obrot === "brak" && !g.poziomo && !g.pionowo;
}

// Czysta logika frontu (bez DOM): domyślne profile, zgodność kodeków,
// podpowiedź AAC, formatowanie czasu i rozmiaru. Testowane vitestem.
import type {
  Kontener, KodekAudio, KodekWideo, Profil, ProfilAudio, ProfilWideo, ProfilObrazu, ProfilGif, Wybor,
} from "./typy";

export const KONTENERY_WIDEO: Kontener[] = ["mp4", "mkv", "webm", "mov", "avi"];
export const KONTENERY_AUDIO: Kontener[] = ["mp3", "m4a", "aac", "opus", "ogg", "flac", "wav"];
export const KONTENERY_ANIMACJI: Kontener[] = ["gif", "webp"];
export const KONTENERY_OBRAZU: Kontener[] = ["png", "jpg", "webp", "avif", "gif", "bmp", "ico"];

export const WYSOKOSCI = [2160, 1440, 1080, 720, 480, 360, 240, 144];
export const FPS = [60, 50, 30, 25, 24, 15, 10];
export const BITRATY_AUDIO = [8, 12, 16, 24, 32, 48, 64, 96, 128, 160, 192, 256, 320];
export const CZESTOTLIWOSCI = [8000, 11025, 12000, 16000, 22050, 24000, 32000, 44100, 48000, 88200, 96000];

/** Zgodność kodeków z kontenerami: to samo co `Kontener::kodeki_*` w Rust. */
export const KODEKI_WIDEO: Partial<Record<Kontener, KodekWideo[]>> = {
  mp4: ["h264", "h265", "av1", "vp9", "mpeg4", "kopiuj"],
  mkv: ["h264", "h265", "av1", "vp9", "mpeg4", "kopiuj"],
  webm: ["vp9", "av1", "kopiuj"],
  mov: ["h264", "h265", "mpeg4", "kopiuj"],
  avi: ["h264", "mpeg4", "kopiuj"],
};

export const KODEKI_AUDIO: Partial<Record<Kontener, KodekAudio[]>> = {
  mp4: ["aac", "mp3", "opus", "flac", "kopiuj"],
  mkv: ["aac", "mp3", "opus", "vorbis", "flac", "pcm", "kopiuj"],
  webm: ["opus", "vorbis", "kopiuj"],
  mov: ["aac", "mp3", "pcm", "kopiuj"],
  avi: ["mp3", "pcm", "aac", "kopiuj"],
  mp3: ["mp3", "kopiuj"],
  m4a: ["aac", "flac", "kopiuj"],
  aac: ["aac", "kopiuj"],
  opus: ["opus", "kopiuj"],
  ogg: ["vorbis", "opus", "flac", "kopiuj"],
  flac: ["flac", "kopiuj"],
  wav: ["pcm", "kopiuj"],
};

export function tylkoAudio(k: Kontener): boolean {
  return KONTENERY_AUDIO.includes(k);
}

export function obrazowy(k: Kontener): boolean {
  return KONTENERY_OBRAZU.includes(k);
}

export function domyslnyKodekWideo(k: Kontener): KodekWideo | null {
  if (k === "webm") return "vp9";
  if (k === "avi") return "mpeg4";
  return KODEKI_WIDEO[k] ? "h264" : null;
}

export function domyslnyKodekAudio(k: Kontener): KodekAudio | null {
  const m: Partial<Record<Kontener, KodekAudio>> = {
    mp4: "aac", mkv: "aac", mov: "aac", m4a: "aac", aac: "aac",
    webm: "opus", opus: "opus", avi: "mp3", mp3: "mp3", ogg: "vorbis", flac: "flac", wav: "pcm",
  };
  return m[k] ?? null;
}

export function wideoDomyslne(kodek: KodekWideo = "h264"): ProfilWideo {
  return {
    kodek,
    rozdzielczosc: { typ: "zachowaj" },
    dopasowanie: { typ: "proporcje" },
    nie_powiekszaj: false,
    skaler: "lanczos",
    fps: { typ: "zachowaj" },
    jakosc: { typ: "crf", crf: 23 },
    sprzet: null,
    dziesiec_bit: false,
  };
}

export function audioDomyslne(kodek: KodekAudio = "aac"): ProfilAudio {
  return { kodek, kbps: kodek === "mp3" ? 192 : 160, hz: null, kanaly: null, normalizacja: false };
}

export function obrazDomyslny(): ProfilObrazu {
  return { rozmiar: { typ: "zachowaj" }, dopasowanie: { typ: "proporcje" }, jakosc: 85, nie_powiekszaj: true, skaler: "lanczos" };
}

export function gifDomyslny(): ProfilGif {
  return { fps: 15, szerokosc: 480, petla: { typ: "nieskonczona" }, dithering: { typ: "sierra2_4a" } };
}

/** To samo co `Profil::dla` w Rust. */
export function profilDla(k: Kontener): Profil {
  const kw = domyslnyKodekWideo(k);
  const ka = domyslnyKodekAudio(k);
  return {
    kontener: k,
    wideo: kw ? wideoDomyslne(kw) : null,
    audio: ka ? audioDomyslne(ka) : null,
    obraz: obrazowy(k) && k !== "gif" ? obrazDomyslny() : null,
    gif: k === "gif" ? gifDomyslny() : null,
    ciecie: null,
    obrot: "brak",
    odbicie: { poziomo: false, pionowo: false },
    przyciecie: { gora: 0, dol: 0, lewo: 0, prawo: 0 },
    deinterlace: false,
    predkosc: 1,
    sciezki_audio: { typ: "pierwsza" },
    napisy: true,
  };
}

/**
 * Zmiana kontenera z zachowaniem tego, co się da (rozdzielczość, fps, cięcie...).
 * Kodeki niezgodne z nowym kontenerem wracają do domyślnych.
 */
export function zmienKontener(p: Profil, k: Kontener, trybObrazu = false): Profil {
  const n = profilDla(k);
  const wspolne = {
    ciecie: p.ciecie, obrot: p.obrot, odbicie: p.odbicie, przyciecie: p.przyciecie,
    deinterlace: p.deinterlace, predkosc: p.predkosc, sciezki_audio: p.sciezki_audio, napisy: p.napisy,
  };
  if (trybObrazu) {
    return { ...n, ...wspolne, gif: null, obraz: p.obraz ?? obrazDomyslny() };
  }
  if (n.wideo && p.wideo) {
    const kodek = KODEKI_WIDEO[k]!.includes(p.wideo.kodek) ? p.wideo.kodek : n.wideo.kodek;
    n.wideo = { ...p.wideo, kodek, sprzet: kodek === p.wideo.kodek ? p.wideo.sprzet : null };
  }
  if (n.audio && p.audio !== undefined) {
    // GIF/WebP nie mają dźwięku, więc „brak dźwięku” po nich nie jest wyborem użytkownika.
    if (p.audio === null && !tylkoAudio(k) && !KONTENERY_ANIMACJI.includes(p.kontener)) {
      n.audio = null; // użytkownik wybrał „bez dźwięku”
    } else if (p.audio) {
      const kodek = KODEKI_AUDIO[k]!.includes(p.audio.kodek) ? p.audio.kodek : n.audio.kodek;
      n.audio = kodek === p.audio.kodek ? { ...p.audio } : { ...p.audio, kodek, kbps: n.audio.kbps };
    }
  }
  if (k === "webp") n.gif = p.gif ?? gifDomyslny(); // z filmu: animowany WebP
  if (k === "gif") n.gif = p.gif ?? gifDomyslny();
  return { ...n, ...wspolne };
}

/**
 * AAC poniżej 32 kb/s: przy przekroczeniu progu w dół automatycznie
 * proponujemy mono + 16 kHz (użytkownik może to potem zmienić).
 */
export function podpowiedzAac(poprzedni: ProfilAudio | null, nowy: ProfilAudio): ProfilAudio {
  if (nowy.kodek !== "aac" || nowy.kbps >= 32) return nowy;
  const bylNisko = poprzedni !== null && poprzedni.kodek === "aac" && poprzedni.kbps < 32;
  if (bylNisko) return nowy;
  return { ...nowy, kanaly: 1, hz: 16000 };
}

export function niskiAac(a: ProfilAudio | null): boolean {
  return !!a && a.kodek === "aac" && a.kbps < 32;
}

/** "1:02:03.5", "02:03", "75" → sekundy; pusty/zły → null */
export function parsujCzas(t: string): number | null {
  const s = t.trim().replace(",", ".");
  if (!s) return null;
  const cz = s.split(":");
  if (cz.length > 3) return null;
  let suma = 0;
  for (const c of cz) {
    if (!/^\d+(\.\d+)?$/.test(c)) return null;
    suma = suma * 60 + Number(c);
  }
  return suma;
}

export function formatujCzas(s: number | null | undefined): string {
  if (s === null || s === undefined || !isFinite(s)) return "";
  const calk = Math.max(0, s);
  const h = Math.floor(calk / 3600);
  const m = Math.floor((calk % 3600) / 60);
  const sek = calk % 60;
  const ss = Number.isInteger(sek) ? String(sek).padStart(2, "0") : sek.toFixed(1).padStart(4, "0");
  const mm = String(m).padStart(2, "0");
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

export function formatujRozmiar(b: number | null | undefined, jezyk: "pl" | "en" = "pl"): string {
  if (b === null || b === undefined) return "—";
  const j = ["B", "KB", "MB", "GB", "TB"];
  let x = b;
  let i = 0;
  while (x >= 1024 && i < j.length - 1) {
    x /= 1024;
    i++;
  }
  const liczba = x >= 100 || i === 0 ? Math.round(x).toString() : x.toFixed(1);
  return `${jezyk === "pl" ? liczba.replace(".", ",") : liczba} ${j[i]}`;
}

/** Zmiana rozmiaru po konwersji: „−82%”, „+12%”. */
export function zmianaRozmiaru(przed: number, po: number): string {
  if (przed <= 0) return "";
  const r = Math.round((po / przed - 1) * 100);
  return r === 0 ? "±0%" : r < 0 ? `−${-r}%` : `+${r}%`;
}

export function formatujEta(s: number | null | undefined): string {
  if (s === null || s === undefined || !isFinite(s)) return "";
  if (s < 60) return `${Math.max(1, Math.round(s))} s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min ${Math.round(s % 60)} s`;
  return `${Math.floor(m / 60)} h ${m % 60} min`;
}

/** Wysokość źródła wybrana w presetach rozdzielczości (do opisu „1080p”). */
export function etykietaWysokosci(h: number): string {
  return h === 2160 ? "2160p (4K)" : h === 1440 ? "1440p (2K)" : `${h}p`;
}

export function rozszerzenie(sciezka: string): string {
  const m = /\.([^./\\]+)$/.exec(sciezka);
  return m ? m[1].toLowerCase() : "";
}

export function nazwaPliku(sciezka: string): string {
  return sciezka.split(/[\\/]/).pop() ?? sciezka;
}

export function katalogPliku(sciezka: string): string {
  const i = Math.max(sciezka.lastIndexOf("/"), sciezka.lastIndexOf("\\"));
  return i > 0 ? sciezka.slice(0, i) : sciezka;
}

const ROZSZ_OBRAZOW = ["png", "jpg", "jpeg", "webp", "avif", "bmp", "ico", "tif", "tiff", "heic", "jxl"];
export function toObraz(sciezka: string): boolean {
  return ROZSZ_OBRAZOW.includes(rozszerzenie(sciezka));
}

/** Ścieżka do pokazania z jednym rodzajem separatora (usterka 3 z 07.10: `C:/Users/…/test\plik.mp4`).
 *  Ścieżka Windows (litera dysku, UNC albo jakikolwiek `\`) → same `\`; inne bez zmian. */
export function sciezkaDoPokazania(s: string): string {
  const windows = /^[A-Za-z]:[\\/]/.test(s) || s.includes("\\");
  return windows ? s.replace(/\//g, "\\") : s;
}

/** Linki w tekście (jeden na linię albo rozdzielone spacjami). */
export function wyciagnijUrl(tekst: string): string[] {
  const m = tekst.match(/https?:\/\/[^\s"'<>]+/g) ?? [];
  return [...new Set(m)];
}

/** Obsługiwane źródła pokazywane jako chipy na ekranie Pobierz (yt-dlp umie więcej). */
export const ZRODLA_POBIERANIA = ["SoundCloud", "Bandcamp", "Vimeo", "Mixcloud", "Internet Archive"] as const;

/** Szybkie akcje pobierania → wybór dla yt-dlp. */
export function wyborSzybki(akcja: "mp3" | "najlepsza"): Wybor {
  return akcja === "mp3" ? { typ: "tylko_audio", format: "mp3" } : { typ: "najlepsza" };
}

/** Komenda do pokazania (cudzysłowy tylko tam, gdzie trzeba). */
export function komendaDoPokazania(args: string[]): string {
  return ["ffmpeg", ...args]
    .map((a) => (/^[\w@%+=:,./\\-]+$/.test(a) ? a : `"${a.replace(/"/g, '\\"')}"`))
    .join(" ");
}

export function sklonuj<T>(x: T): T {
  return JSON.parse(JSON.stringify(x)) as T;
}

// ---------- szybkie akcje (punkt 4.2) ----------

export type SzybkaAkcja = "rozmiar" | "mp3" | "gif" | "telefon" | "wytnij";
export const SZYBKIE_AKCJE: SzybkaAkcja[] = ["rozmiar", "mp3", "gif", "telefon", "wytnij"];

/** Kontener dla cięcia bez ponownego kodowania: ten sam co źródło (kopia strumieni musi pasować). */
export function kontenerKopii(sciezkaZrodla: string | null): Kontener {
  const ext = sciezkaZrodla ? rozszerzenie(sciezkaZrodla) : "";
  const m: Record<string, Kontener> = { mp4: "mp4", m4v: "mp4", mkv: "mkv", webm: "webm", mov: "mov", avi: "avi" };
  return m[ext] ?? "mkv";
}

/**
 * Profil po jednym kliknięciu szybkiej akcji. Cięcie od–do z bieżącego profilu zostaje
 * (np. „Zrób GIF” z wybranego fragmentu), resztę można potem dopracować w panelu.
 */
export function profilSzybkiejAkcji(a: SzybkaAkcja, obecny: Profil, opcje: { mb?: number; zrodlo?: string | null } = {}): Profil {
  const zostaw = { ciecie: obecny.ciecie };
  switch (a) {
    case "rozmiar": {
      const p = profilDla("mp4");
      p.wideo!.rozdzielczosc = { typ: "wysokosc", h: 720 };
      p.wideo!.nie_powiekszaj = true;
      p.wideo!.jakosc = { typ: "rozmiar_mb", mb: opcje.mb ?? 10 };
      p.audio!.kbps = 96;
      return { ...p, ...zostaw };
    }
    case "mp3": {
      const p = profilDla("mp3");
      p.audio = { ...audioDomyslne("mp3"), kbps: 192 };
      return { ...p, ...zostaw };
    }
    case "gif":
      return { ...profilDla("gif"), ...zostaw };
    case "telefon": {
      const p = profilDla("mp4");
      p.wideo!.rozdzielczosc = { typ: "wysokosc", h: 480 };
      p.wideo!.nie_powiekszaj = true;
      p.wideo!.fps = { typ: "wartosc", fps: 25 };
      p.wideo!.jakosc = { typ: "bitrate", kbps: 800 };
      p.audio!.kbps = 96;
      return { ...p, ...zostaw };
    }
    case "wytnij": {
      const p = profilDla(kontenerKopii(opcje.zrodlo ?? null));
      p.wideo = { ...wideoDomyslne("kopiuj") };
      p.audio = { ...audioDomyslne("aac"), kodek: "kopiuj" };
      return { ...p, ciecie: obecny.ciecie ?? { od: 0, koniec: null } };
    }
  }
}

/** Opis pliku na karcie informacji (punkt 4.5). Wartości gotowe do pokazania. */
export function wierszeInformacji(m: import("./typy").Media): [string, string][] {
  const w: [string, string][] = [];
  const v = m.wideo;
  if (v) {
    w.push(["info.rozdzielczosc", `${v.w}×${v.h}${v.obrot ? ` (↻ ${v.obrot}°)` : ""}`]);
    if (!m.obraz && v.fps) w.push(["info.fps", `${Math.round(v.fps * 100) / 100}${v.vfr ? " VFR" : ""}`]);
    w.push(["info.kodek_wideo", `${v.kodek.toUpperCase()}${v.bity && v.bity > 8 ? ` ${v.bity}-bit` : ""}${v.piksele ? ` · ${v.piksele}` : ""}`]);
    if (!m.obraz) w.push(["info.hdr", v.hdr ? (v.hdr === "pq" ? "HDR10 (PQ)" : "HLG") : "—"]);
  }
  if (m.czas_s) w.push(["info.czas", formatujCzas(m.czas_s)]);
  if (m.kbps) w.push(["info.bitrate", `${m.kbps.toLocaleString("pl-PL")} kb/s`]);
  const sciezki = m.sciezki_audio.length ? m.sciezki_audio : m.audio ? [m.audio] : [];
  sciezki.forEach((a, i) =>
    w.push([
      sciezki.length > 1 ? `info.audio_n:${i + 1}` : "info.audio",
      `${a.kodek.toUpperCase()}${a.kbps ? ` ${a.kbps} kb/s` : ""}${a.hz ? ` · ${a.hz / 1000} kHz` : ""}${a.kanaly ? ` · ${a.kanaly === 1 ? "mono" : a.kanaly === 2 ? "stereo" : `${a.kanaly} kan.`}` : ""}${a.jezyk ? ` · ${a.jezyk}` : ""}`,
    ]),
  );
  if (m.napisy.length) w.push(["info.napisy", m.napisy.map((n) => `${n.jezyk ?? "?"} (${n.kodek})`).join(", ")]);
  if (m.okladka) w.push(["info.okladka", "✓"]);
  if (m.rozmiar_b) w.push(["info.rozmiar", formatujRozmiar(m.rozmiar_b)]);
  return w;
}

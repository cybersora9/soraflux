// Z linku (GUI 2.0): czysta logika „klipu z linku” i łańcucha pobierz → cel. Bez DOM.
// yt-dlp pobiera tylko zaznaczony fragment (`--download-sections`, cięcie co do klatki), potem kolejka
// robi z niego cel (ten sam profil co w Taśmie). Playlisty: cała, zakres (`--playlist-items`) albo
// tylko nowe (`--download-archive` w danych apki).
import { audioDomyslne, profilDla, profilSzybkiejAkcji } from "./logika";
import { CELE, fragmentGif } from "./prosty";
import type { InfoFilmu, OpcjePobrania, Profil, Wybor } from "./typy";

export type CelLinku = "discord" | "gif" | "mp3" | "rolka" | "oryg";
export const CELE_LINKU: CelLinku[] = ["discord", "gif", "mp3", "rolka", "oryg"];
export type TrybPlaylisty = "wszystko" | "zakres" | "nowe";

export interface StanLinku {
  cel: CelLinku;
  /** Wysokość z listy albo `null` = najlepsza; „tylko dźwięk” wynika z celu MP3. */
  wysokosc: number | null;
  /** Fragment w sekundach; `null` = cały film. */
  od: number;
  do_: number | null;
  napisy: boolean;
  rozdzialy: boolean;
  okladka: boolean;
  glosnosc: boolean;
  playlista: boolean;
  trybPlaylisty: TrybPlaylisty;
  zakresOd: number;
  zakresDo: number;
}

export function stanPoczatkowy(): StanLinku {
  return {
    cel: "discord", wysokosc: null, od: 0, do_: null, napisy: false, rozdzialy: true, okladka: true, glosnosc: false,
    playlista: false, trybPlaylisty: "wszystko", zakresOd: 1, zakresDo: 10,
  };
}

/** Fragment do `--download-sections` albo `null` (cały film, albo zakres obejmuje całość). */
export function fragment(s: Pick<StanLinku, "od" | "do_" | "playlista">, czas: number | null): { od: number; do_: number } | null {
  if (s.playlista || s.do_ === null) return null;
  const od = Math.max(0, s.od);
  const koniec = czas ? Math.min(s.do_, czas) : s.do_;
  if (koniec <= od) return null;
  if (od < 0.05 && czas && koniec >= czas - 0.05) return null;
  return { od: Math.round(od * 100) / 100, do_: Math.round(koniec * 100) / 100 };
}

/** Profil konwersji po pobraniu (`potem`) albo `null`, gdy plik zostaje taki, jak przyszedł z serwisu. */
export function profilCelu(cel: CelLinku, glosnosc: boolean): Profil | null {
  let p: Profil | null = null;
  if (cel === "discord") p = profilSzybkiejAkcji("rozmiar", profilDla("mp4"), { mb: CELE.discord.cel });
  if (cel === "gif") {
    // klip pobrany już jako fragment: GIF z jego początku, najwyżej 5 s (jak w Taśmie)
    p = { ...profilDla("gif"), ciecie: fragmentGif(0, null) };
  }
  if (cel === "mp3" && glosnosc) p = { ...profilDla("mp3"), audio: { ...audioDomyslne("mp3"), kbps: 320 } };
  if (cel === "rolka") {
    const r = profilDla("mp4");
    r.wideo = { ...r.wideo!, rozdzielczosc: { typ: "wlasna", w: 1080, h: 1920 }, dopasowanie: { typ: "przytnij" }, jakosc: { typ: "crf", crf: 23 } };
    p = r;
  }
  if (cel === "oryg" && glosnosc) {
    // tylko dźwięk przez loudnorm, obraz bez kodowania
    const o = profilDla("mkv");
    o.wideo = { ...o.wideo!, kodek: "kopiuj" };
    p = o;
  }
  if (p && glosnosc && p.audio && p.kontener !== "gif") p.audio = { ...p.audio, normalizacja: true, lufs: -14 };
  return p;
}

/** Wybór formatu dla yt-dlp. MP3: bez potem = yt-dlp robi MP3 sam; z głośnością = najlepszy dźwięk i konwersja w kolejce. */
export function wyborLinku(s: Pick<StanLinku, "cel" | "wysokosc" | "glosnosc">): Wybor {
  if (s.cel === "mp3") return { typ: "tylko_audio", format: s.glosnosc ? "best" : "mp3" };
  // cel z limitem rozmiaru albo GIF: nie ma sensu ciągnąć 4K
  const sufit = s.cel === "discord" || s.cel === "gif" ? 1080 : s.cel === "rolka" ? 1920 : null;
  const h = s.wysokosc !== null && sufit !== null ? Math.min(s.wysokosc, sufit) : s.wysokosc ?? sufit;
  return h !== null ? { typ: "wysokosc", h } : { typ: "najlepsza" };
}

export function opcjePobrania(s: StanLinku, info: { tytul: string; czas_s: number | null } | null): OpcjePobrania {
  const audio = s.cel === "mp3";
  return {
    wybor: wyborLinku(s),
    kontener: "mp4",
    napisy: s.napisy && !audio,
    jezyki_napisow: "pl,en",
    miniatura: s.okladka,
    metadane: true,
    rozdzialy: s.rozdzialy && !audio,
    playlista: s.playlista,
    tytul: info?.tytul ?? null,
    fragment: fragment(s, info?.czas_s ?? null),
    zakres_playlisty: s.playlista && s.trybPlaylisty === "zakres" ? `${Math.max(1, Math.min(s.zakresOd, s.zakresDo))}-${Math.max(s.zakresOd, s.zakresDo)}` : null,
    tylko_nowe: s.playlista && s.trybPlaylisty === "nowe",
  };
}

/** Ogniwa łańcucha w panelu: [klucz i18n, parametry]. */
export function lancuch(s: StanLinku, czas: number | null): [string, Record<string, string | number>][] {
  const f = fragment(s, czas);
  const kroki: [string, Record<string, string | number>][] = [];
  if (s.playlista) kroki.push([`link.krok.playlista.${s.trybPlaylisty}`, { od: s.zakresOd, do: s.zakresDo }]);
  else kroki.push(f ? ["link.krok.fragment", { od: f.od, do: f.do_ }] : ["link.krok.calosc", {}]);
  if (f) kroki.push(["link.krok.ciecie", {}]);
  if (s.cel !== "oryg" && (s.cel !== "mp3" || s.glosnosc)) kroki.push([`link.krok.cel.${s.cel}`, {}]);
  else if (s.cel === "mp3") kroki.push(["link.krok.cel.mp3", {}]);
  if (s.glosnosc) kroki.push(["link.krok.glosnosc", {}]);
  if (s.napisy && s.cel !== "mp3") kroki.push(["link.krok.napisy", {}]);
  kroki.push(["link.krok.zapisz", {}]);
  return kroki;
}

/** Szacunek rozmiaru: cel z limitem = limit; inaczej bitrate z najlepszego formatu × długość fragmentu. */
export function szacunekLinku(s: StanLinku, info: InfoFilmu | null): number | null {
  if (!info) return null;
  const czas = info.czas_s;
  const f = fragment(s, czas);
  const dl = f ? f.do_ - f.od : czas;
  if (!dl) return null;
  if (s.cel === "discord") return Math.min(CELE.discord.cel * 1024 * 1024, szacunekStrumienia(info, s, dl) ?? Infinity);
  if (s.cel === "mp3") return ((s.glosnosc ? 320 : 256) * 1000 * dl) / 8;
  if (s.cel === "gif") return Math.min(5, dl) * 480 * 270 * 15 * 0.045;
  return szacunekStrumienia(info, s, dl);
}

function szacunekStrumienia(info: InfoFilmu, s: Pick<StanLinku, "wysokosc">, dl: number): number | null {
  const wideo = info.formaty.filter((f) => f.vkodek && f.kbps && (s.wysokosc === null || (f.h ?? 0) <= s.wysokosc));
  const najlepsze = wideo.sort((a, b) => (b.h ?? 0) - (a.h ?? 0) || (b.kbps ?? 0) - (a.kbps ?? 0))[0];
  if (!najlepsze?.kbps) return null;
  const audio = najlepsze.akodek ? 0 : info.formaty.filter((f) => !f.vkodek && f.akodek && f.kbps).sort((a, b) => (b.kbps ?? 0) - (a.kbps ?? 0))[0]?.kbps ?? 128;
  return ((najlepsze.kbps + audio) * 1000 * dl) / 8;
}

/** Czy link wygląda na playlistę albo kanał (wtedy info pobieramy jako listę). */
export function linkPlaylisty(url: string): boolean {
  return /[?&]list=|\/playlist|\/@[^/]+\/?$|\/channel\/|\/c\/|\/sets\//i.test(url);
}

/** Pierwszy link http(s) z tekstu (wklejone z opisem). */
export function wyciagnijLink(tekst: string): string | null {
  return /https?:\/\/[^\s"'<>]+/i.exec(tekst)?.[0] ?? null;
}

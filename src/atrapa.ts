// Atrapa backendu: przeglądarka bez Tauri (podgląd Vite, vitest, zrzuty Playwright).
// Udaje ffprobe, kolejkę z postępem, yt-dlp i narzędzia. Bez sieci, bez plików.
// Dane pobierania są zmyślone (example.com), żadnych linków do cudzych utworów.
import type { Api } from "./api";
import type {
  Info, StrumienAudio, StrumienWideo, InfoZadania, Konfig, PlikZFolderu, Media, NoweZadanie, PodgladPlanu, Postep, PostepNarzedzia, Preset, Profil, Szacunek,
} from "./typy";
import { profilDla, rozszerzenie, nazwaPliku, toObraz, komendaDoPokazania, obrazDomyslny, gifDomyslny } from "./logika";

type Sluchacz<T> = (x: T) => void;
const sluchacze = {
  postep: new Set<Sluchacz<Postep>>(),
  stan: new Set<Sluchacz<InfoZadania>>(),
  narzedzia: new Set<Sluchacz<PostepNarzedzia>>(),
};

let konfig: Konfig = {
  jezyk: null,
  motyw: "dark",
  rownolegle: 2,
  rownolegle_wideo: 1,
  niski_priorytet: false,
  katalog_wyjscia: null,
  katalog_pobierania: null,
  schowek: true,
  motyw_wyglad: "sora-a",
  wlasne_motywy: [],
  ostatnie_foldery: [],
  sciezki: { ffmpeg: null, ffprobe: null, ytdlp: null, deno: null },
  kreator_zakonczony: true,
};

// Parametry adresu: ?kreator=1 pokazuje pierwsze uruchomienie, ?demo=1 wypełnia widoki.
const parametry = typeof location !== "undefined" ? new URLSearchParams(location.search) : new URLSearchParams();
if (parametry.get("kreator") === "1") konfig.kreator_zakonczony = false;
const motyw = parametry.get("motyw");
if (motyw === "light" || motyw === "dark") konfig.motyw = motyw;
// ?wyglad=jp-b: motyw wyglądu (zrzuty v1.2, każdy z 6 motywów)
const wygladParam = parametry.get("wyglad");
if (wygladParam) konfig.motyw_wyglad = wygladParam;
const jezykParam = parametry.get("jezyk");
if (jezykParam === "pl" || jezykParam === "en") konfig.jezyk = jezykParam;
// Zmyślone nazwy w języku zrzutu (EN zrzuty bez polskich tytułów i ścieżek).
const tx = (pl: string, en: string) => (konfig.jezyk === "en" ? en : pl);
// Miniatura z ffmpeg lavfi (gradient), zero cudzych obrazów.
const MINIATURA = new URL("./atrapa-miniatura.jpg", import.meta.url).href;

const narzedziaZnalezione = parametry.get("kreator") !== "1";

function wbudowane(): Preset[] {
  const p = (id: string, zakladka: "konwertuj" | "obrazy", profil: Profil): Preset => ({
    id, nazwa: `preset.${id}`, zakladka, wbudowany: true, profil,
  });
  const telefon = profilDla("mp4");
  telefon.wideo!.rozdzielczosc = { typ: "wysokosc", h: 480 };
  telefon.wideo!.nie_powiekszaj = true;
  telefon.wideo!.fps = { typ: "wartosc", fps: 25 };
  telefon.wideo!.jakosc = { typ: "bitrate", kbps: 800 };
  telefon.audio!.kbps = 96;
  const rozmiar = (mb: number) => {
    const x = profilDla("mp4");
    x.wideo!.rozdzielczosc = { typ: "wysokosc", h: 720 };
    x.wideo!.nie_powiekszaj = true;
    x.wideo!.jakosc = { typ: "rozmiar_mb", mb };
    x.audio!.kbps = 96;
    return x;
  };
  const podcast = profilDla("m4a");
  podcast.audio = { kodek: "aac", kbps: 8, hz: 16000, kanaly: 1, normalizacja: true };
  const mp3 = profilDla("mp3");
  mp3.audio = { kodek: "mp3", kbps: 320, hz: 44100, kanaly: 2, normalizacja: false };
  const webp = profilDla("webp");
  webp.obraz = { ...obrazDomyslny(), rozmiar: { typ: "wymiary", w: 1600, h: null }, jakosc: 80 };
  const gif = profilDla("gif");
  gif.gif = gifDomyslny();
  return [
    p("telefon", "konwertuj", telefon),
    p("discord", "konwertuj", rozmiar(9.5)),
    p("whatsapp", "konwertuj", rozmiar(15.5)),
    p("podcast", "konwertuj", podcast),
    p("mp3_320", "konwertuj", mp3),
    p("gif", "konwertuj", gif),
    p("webp_1600", "obrazy", webp),
  ];
}

let presetyUzytkownika: Preset[] = [];

const wideoPrzyklad = (x: Partial<StrumienWideo>): StrumienWideo => ({
  indeks: 0, kodek: "h264", w: 1920, h: 1080, fps: 59.94, kbps: 17_400, piksele: "yuv420p", bity: 8, hdr: null, obrot: 0, vfr: false, ...x,
});
const audioPrzyklad = (x: Partial<StrumienAudio>): StrumienAudio => ({
  indeks: 1, kodek: "aac", hz: 48000, kanaly: 2, kbps: 192, jezyk: null, ...x,
});

function mediaDla(sciezka: string): Media {
  const ext = rozszerzenie(sciezka);
  const baza = { sciezki_audio: [] as StrumienAudio[], napisy: [], okladka: false };
  if (toObraz(sciezka)) {
    return {
      ...baza, czas_s: null, rozmiar_b: 2_400_000, kbps: null, format: `${ext}_pipe`, obraz: true,
      wideo: wideoPrzyklad({ kodek: ext, w: 4032, h: 3024, fps: null, kbps: null }), audio: null,
    };
  }
  if (["mp3", "m4a", "flac", "wav", "ogg", "opus", "aac"].includes(ext)) {
    const a = audioPrzyklad({ indeks: 0, kodek: ext === "m4a" ? "aac" : ext, hz: 44100, kbps: 320 });
    return { ...baza, czas_s: 214.6, rozmiar_b: 8_600_000, kbps: 320, format: ext, obraz: false, wideo: null, audio: a, sciezki_audio: [a], okladka: ext === "mp3" };
  }
  // „telefon”: pionowy HDR HLG 10 bit, VFR, dwie ścieżki dźwięku, napisy
  if (ext === "mov") {
    const a = [audioPrzyklad({ jezyk: "pol" }), audioPrzyklad({ indeks: 2, kodek: "ac3", kanaly: 6, kbps: 384, jezyk: "eng" })];
    return {
      czas_s: 42.7, rozmiar_b: 96_000_000, kbps: 18_000, format: "mov,mp4,m4a,3gp,3g2,mj2", obraz: false, okladka: false,
      wideo: wideoPrzyklad({ kodek: "hevc", w: 2160, h: 3840, fps: 29.87, kbps: 17_500, piksele: "yuv420p10le", bity: 10, hdr: "hlg", obrot: 90, vfr: true }),
      audio: a[0], sciezki_audio: a,
      napisy: [{ indeks: 3, kodek: "mov_text", jezyk: "pol", tekstowe: true }],
    };
  }
  const a = audioPrzyklad({});
  return {
    ...baza, czas_s: 187.4, rozmiar_b: 432_013_312, kbps: 17_600, format: "mov,mp4,m4a,3gp,3g2,mj2", obraz: false,
    wideo: wideoPrzyklad({}), audio: a, sciezki_audio: [a],
  };
}

function wymiaryWyniku(m: Media, p: Profil): [number, number] {
  const w = m.wideo?.w ?? 1920;
  const h = m.wideo?.h ?? 1080;
  const r = p.wideo?.rozdzielczosc;
  if (r?.typ === "wysokosc") return [Math.round((w * r.h) / h / 2) * 2, r.h];
  if (r?.typ === "wlasna") return [r.w, r.h];
  return [w, h];
}

function szacuj(m: Media, p: Profil): Szacunek {
  const czas = m.czas_s ?? 0;
  if (p.kontener === "gif" && p.gif) {
    const [w0, h0] = [Math.min(p.gif.szerokosc, m.wideo?.w ?? 480), 0];
    const h = h0 || (w0 * (m.wideo?.h ?? 270)) / (m.wideo?.w ?? 480);
    const dl = p.ciecie ? (p.ciecie.koniec ?? czas) - p.ciecie.od : czas;
    const b = w0 * h * p.gif.fps * dl * (p.gif.dithering.typ === "brak" ? 0.04 : 0.045);
    return { bajty: b, dokladny: false, ostrzezenie: b > 20 * 1024 * 1024 ? "ogromny" : null, zrodlo_kbps: null };
  }
  if (m.obraz) {
    const px = (m.wideo?.w ?? 1000) * (m.wideo?.h ?? 1000);
    const q = (p.obraz?.jakosc ?? 85) / 100;
    const skala = p.obraz?.rozmiar.typ === "procent" ? (p.obraz.rozmiar.p / 100) ** 2 : p.obraz?.rozmiar.typ === "wymiary" && p.obraz.rozmiar.w ? (p.obraz.rozmiar.w / (m.wideo?.w ?? 1)) ** 2 : 1;
    return { bajty: px * skala * (0.04 + q ** 3 * 0.3), dokladny: false, ostrzezenie: null, zrodlo_kbps: null };
  }
  const a = p.audio && m.audio ? (p.audio.kodek === "flac" ? 700 : p.audio.kodek === "pcm" ? 1411 : p.audio.kbps) : 0;
  let v = 0;
  let dokladny = true;
  let zrodloKbps: number | null = null;
  if (p.wideo && m.wideo && !["mp3", "m4a", "aac", "opus", "ogg", "flac", "wav"].includes(p.kontener)) {
    const j = p.wideo.jakosc;
    if (j.typ === "rozmiar_mb") return { bajty: j.mb * 1024 * 1024 * 0.98, dokladny: true, ostrzezenie: null, zrodlo_kbps: null };
    if (j.typ === "bitrate") {
      // jak szacunek.rs: min(docelowy, źródłowy)
      const sufit = m.wideo.kbps ?? Infinity;
      v = Math.min(j.kbps, sufit);
      if (j.kbps > sufit) {
        zrodloKbps = m.wideo.kbps;
        dokladny = false;
      }
    }
    else {
      const [w, h] = wymiaryWyniku(m, p);
      const fps = p.wideo.fps.typ === "wartosc" ? p.wideo.fps.fps : m.wideo.fps ?? 30;
      v = (w * h * fps * 0.075 * 2 ** ((23 - j.crf) / 6)) / 1000;
      dokladny = false;
    }
  }
  const dl = (p.ciecie ? (p.ciecie.koniec ?? czas) - p.ciecie.od : czas) / (p.predkosc || 1);
  return { bajty: ((v + a) * 1000 * dl) / 8, dokladny, ostrzezenie: null, zrodlo_kbps: zrodloKbps };
}

function plan(wejscie: string, m: Media, p: Profil): PodgladPlanu {
  // jak plan_komendy w Rust: folder z konfigu, inaczej obok źródła
  const nazwa = nazwaPliku(wejscie).replace(/\.[^.]+$/, "");
  const katalog = konfig.katalog_wyjscia ?? wejscie.slice(0, Math.max(wejscie.lastIndexOf("/"), wejscie.lastIndexOf("\\")));
  const wyj = `${katalog}/${nazwa}.${p.kontener}`;
  const a: string[] = ["-hide_banner", "-nostdin", "-y", "-loglevel", "warning", "-progress", "pipe:1", "-nostats"];
  if (p.ciecie) a.push("-ss", String(p.ciecie.od));
  a.push("-i", wejscie);
  const vf: string[] = [];
  if (p.wideo?.rozdzielczosc.typ === "wysokosc") vf.push(`scale=w=-2:h=${p.wideo.rozdzielczosc.h}:flags=${p.wideo.skaler}`);
  if (p.wideo?.fps.typ === "wartosc") vf.push(`fps=${p.wideo.fps.fps}`);
  if (vf.length) a.push("-vf", vf.join(","));
  if (p.wideo && !["mp3", "m4a", "aac", "opus", "ogg", "flac", "wav"].includes(p.kontener) && m.wideo) {
    a.push("-c:v", { h264: "libx264", h265: "libx265", av1: "libsvtav1", vp9: "libvpx-vp9", mpeg4: "mpeg4", kopiuj: "copy" }[p.wideo.kodek]);
    const j = p.wideo.jakosc;
    if (j.typ === "crf") a.push("-crf", String(j.crf));
    else if (j.typ === "bitrate") a.push("-b:v", `${j.kbps}k`);
  } else a.push("-vn");
  if (p.audio) {
    a.push("-c:a", { aac: "aac", mp3: "libmp3lame", opus: "libopus", vorbis: "libvorbis", flac: "flac", pcm: "pcm_s16le", kopiuj: "copy" }[p.audio.kodek]);
    if (!["flac", "pcm", "kopiuj"].includes(p.audio.kodek)) a.push("-b:a", `${p.audio.kbps}k`);
    if (p.audio.hz) a.push("-ar", String(p.audio.hz));
    if (p.audio.kanaly) a.push("-ac", String(p.audio.kanaly));
  } else a.push("-an");
  a.push(wyj);
  const podpowiedzi: PodgladPlanu["podpowiedzi"] = [];
  if (p.audio?.kodek === "aac" && p.audio.kbps < 32) podpowiedzi.push({ typ: "mono_niski_hz", kanaly: 1, hz: 16000 });
  void komendaDoPokazania;
  return { przebiegi: [a], podpowiedzi, blad: null };
}

/** Atrapa klatki: kolorowy kadr SVG; „po” z wymiarami i wyblakłym/podbitym kolorem jak po konwersji. */
function klatkaSvg(m: Media, p: Profil | null): string {
  const [w, h] = p ? wymiaryWyniku(m, p) : [m.wideo?.w ?? 1920, m.wideo?.h ?? 1080];
  const skala = Math.min(1, 960 / w);
  const [sw, sh] = [Math.round(w * skala), Math.round(h * skala)];
  const nasycenie = p ? 1 : m.wideo?.hdr ? 0.45 : 1;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${sw}" height="${sh}" viewBox="0 0 160 90" preserveAspectRatio="xMidYMid slice">
<defs><linearGradient id="n" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#3b6fd8"/><stop offset=".55" stop-color="#f0a35e"/><stop offset="1" stop-color="#2a3a52"/></linearGradient></defs>
<g style="filter:saturate(${nasycenie})"><rect width="160" height="90" fill="url(#n)"/><circle cx="118" cy="44" r="13" fill="#ffd27a"/>
<path d="M0 70 Q40 56 80 66 T160 62 V90 H0Z" fill="#1d2b3f"/><path d="M0 78 Q50 70 100 78 T160 76 V90 H0Z" fill="#0f1a2a"/></g>
<text x="6" y="12" font-family="sans-serif" font-size="7" fill="#fff" opacity=".85">${p ? `${w}×${h}` : "oryginał"}</text></svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

let nastepneId = 1;
const zadania = new Map<number, InfoZadania>();

function emituj(z: InfoZadania) {
  zadania.set(z.id, { ...z });
  sluchacze.stan.forEach((f) => f({ ...z }));
}

function symuluj(z: InfoZadania, szybkosc: number, koniec?: Partial<InfoZadania>) {
  z.stan = { typ: "trwa" };
  emituj(z);
  const t = setInterval(() => {
    const biezace = zadania.get(z.id);
    if (!biezace || biezace.stan.typ !== "trwa") return clearInterval(t);
    z.procent = Math.min(100, z.procent + szybkosc);
    sluchacze.postep.forEach((f) =>
      f({ id: z.id, procent: z.procent, eta_s: (100 - z.procent) / szybkosc, predkosc_x: z.rodzaj === "pobranie" ? null : 3.4, bajty_s: z.rodzaj === "pobranie" ? 6_400_000 : null, przebieg: 1, przebiegi: 1, nieokreslony: false }),
    );
    zadania.set(z.id, { ...z });
    if (z.procent >= 100) {
      clearInterval(t);
      Object.assign(z, { stan: { typ: "gotowe", wyjscie: z.wyjscie ?? tx("C:/Wideo/wynik.mp4", "C:/Videos/result.mp4") }, rozmiar_wyniku: 77_594_624 }, koniec);
      emituj(z);
    }
  }, 400);
}

if (parametry.get("demo") === "1") {
  const przyklady: [string, InfoZadania["stan"], number, InfoZadania["rodzaj"]][] = [
    [tx("wakacje-2026.mp4 → mp4 480p", "holiday-2026.mp4 → mp4 480p"), { typ: "trwa" }, 62, "konwersja"],
    [tx("Przykładowy film", "Sample video"), { typ: "trwa" }, 28, "pobranie"],
    [tx("podcast-odc-14.wav → m4a", "podcast-ep-14.wav → m4a"), { typ: "oczekuje" }, 0, "konwersja"],
    [tx("zrzut-ekranu.png → webp", "screenshot.png → webp"), { typ: "gotowe", wyjscie: tx("C:/Obrazy/zrzut-ekranu.webp", "C:/Pictures/screenshot.webp") }, 100, "konwersja"],
    [tx("stary-film.avi → mkv", "old-movie.avi → mkv"), { typ: "blad", komunikat: '@i18n {"k":"ffmpeg_kod","a":{"kod":"1"}}\n\nInvalid data found when processing input' }, 13, "konwersja"],
    [tx("piosenka-uszkodzona.mp3", "song-damaged.mp3"), { typ: "gotowe", wyjscie: tx("C:/Muzyka/Gotowe/piosenka-uszkodzona.m4a", "C:/Music/Done/song-damaged.m4a") }, 100, "konwersja"],
  ];
  for (const [nazwa, stan, procent, rodzaj] of przyklady) {
    const id = nastepneId++;
    const gotowe = stan.typ === "gotowe";
    zadania.set(id, {
      id, nazwa, rodzaj, stan, procent, wyjscie: gotowe ? stan.wyjscie : null,
      rozmiar_wejscia: gotowe ? 3_400_000 : 432_013_312, rozmiar_wyniku: gotowe ? 612_000 : null, awaria_sprzetu: false,
      ostrzezenie: /uszkodzona|damaged/.test(nazwa) ? { typ: "uciete", zrodlo_konczy_s: 32, wynik_s: 32, oczekiwane_s: 179 } : null,
    });
  }
}

const INFO_PRZYKLAD: Info = {
  typ: "film",
  id: "test01",
  tytul: tx("Przykładowy film", "Sample video"),
  url: "https://example.com/watch?v=test01",
  miniatura: MINIATURA,
  czas_s: 201,
  autor: tx("Kanał przykładowy", "Sample channel"),
  formaty: [],
  wysokosci: [2160, 1440, 1080, 720, 480, 360, 240, 144],
  napisy: ["en", "pl"],
  rozdzialy: 6,
  na_zywo: false,
};

// ?ytdlp=stary udaje stary yt-dlp z pipa (ostrzeżenie o wieku na ekranie Pobierz).
let ytdlpStary = parametry.get("ytdlp") === "stary";

const opoznij = <T>(x: T, ms = 120): Promise<T> => new Promise((r) => setTimeout(() => r(x), ms));

export const atrapa: Api = {
  wTauri: false,
  wersjaApki: () => opoznij("1.3.0"),
  raport: () => opoznij("SoraFlux 1.3.0\nSystem: windows x86_64\nffmpeg: 7.1-essentials_build-www.gyan.dev\n\nOstatnie wpisy dziennika:\n(brak)\n"),
  sprawdzAktualizacje: () => opoznij(null, 300),
  async zainstalujAktualizacje() {},
  sonda: (s) => opoznij(mediaDla(s)),
  planKomendy: (w, m, p) => opoznij(plan(w, m, p), 30),
  szacuj: (m, p) => opoznij(szacuj(m, p), 30),
  szacujZProbki: () => opoznij(null, 30),
  async dodajZadania(nowe: NoweZadanie[]) {
    const ids: number[] = [];
    for (const n of nowe) {
      const id = nastepneId++;
      const r = n.rodzaj;
      const nazwa = r.typ === "konwersja" ? nazwaPliku(r.wejscie) : r.opcje.tytul ?? r.url;
      const z: InfoZadania = {
        id, nazwa, rodzaj: r.typ, stan: { typ: "oczekuje" }, procent: 0, wyjscie: null,
        rozmiar_wejscia: 432_013_312, rozmiar_wyniku: null, awaria_sprzetu: false, ostrzezenie: null,
      };
      emituj(z);
      setTimeout(() => symuluj(z, 7), 300);
      ids.push(id);
    }
    return ids;
  },
  listaZadan: () => opoznij([...zadania.values()], 10),
  async anulujZadanie(id) {
    const z = zadania.get(id);
    if (z && (z.stan.typ === "trwa" || z.stan.typ === "oczekuje")) emituj({ ...z, stan: { typ: "anulowane" } });
  },
  async wyczyscZakonczone() {
    for (const [id, z] of zadania) if (["gotowe", "blad", "anulowane"].includes(z.stan.typ)) zadania.delete(id);
  },
  rozwinSciezki: (s) => opoznij(s),
  rozwinFoldery: (s, r) =>
    opoznij(
      s.flatMap((p): PlikZFolderu[] =>
        /\.[a-z0-9]+$/i.test(p)
          ? [{ sciezka: p, podkatalog: null }]
          : (konfig.jezyk === "en"
              ? ["day-1/beach.mp4", "day-1/sunset.mov", "day-2/boat-trip.mp4", "drone-footage.mkv"]
              : ["dzien-1/plaza.mp4", "dzien-1/zachod-slonca.mov", "dzien-2/rejs.mp4", "film-z-drona.mkv"])
              .filter((n) => r.length === 0 || r.includes(rozszerzenie(n)))
              .map((n) => ({ sciezka: `${p}/${n}`, podkatalog: n.includes("/") ? n.split("/")[0] : "" })),
      ),
    ),
  podgladKlatki: (_w, m, p) => opoznij({ przed: klatkaSvg(m, null), po: klatkaSvg(m, p), czas_s: (m.czas_s ?? 0) / 3 }, 250),
  odsluch: () => opoznij("data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA=", 300),
  plikiStartowe: () => opoznij([]),
  naOtworzPliki: () => () => undefined,
  async powiadom() {},
  konfigWczytaj: () => opoznij({ ...konfig }, 10),
  async konfigZapisz(k) {
    konfig = { ...k };
  },
  presetyLista: () => opoznij([...wbudowane(), ...presetyUzytkownika], 10),
  async presetZapisz(p) {
    const zapisany = { ...p, id: p.id || `u${Date.now()}`, wbudowany: false };
    presetyUzytkownika = [...presetyUzytkownika.filter((x) => x.id !== zapisany.id), zapisany];
    return zapisany;
  },
  async presetUsun(id) {
    presetyUzytkownika = presetyUzytkownika.filter((p) => p.id !== id);
  },
  narzedziaStan: () =>
    opoznij({
      sciezki: narzedziaZnalezione
        ? {
            ffmpeg: "C:/Users/sora/AppData/Roaming/SoraConverter/narzedzia/ffmpeg.exe",
            ffprobe: "C:/Users/sora/AppData/Roaming/SoraConverter/narzedzia/ffprobe.exe",
            ytdlp: ytdlpStary ? "C:/Users/sora/AppData/Local/Programs/Python/Python312/Scripts/yt-dlp.exe" : "C:/Users/sora/AppData/Roaming/SoraConverter/narzedzia/yt-dlp.exe",
            deno: "C:/Users/sora/AppData/Roaming/SoraConverter/narzedzia/deno.exe",
          }
        : { ffmpeg: null, ffprobe: null, ytdlp: null, deno: null },
      wersje: narzedziaZnalezione
        ? { ffmpeg: "7.1-full_build-www.gyan.dev", ffprobe: "7.1-full_build-www.gyan.dev", ytdlp: ytdlpStary ? "2026.07.04" : "2026.10.01", deno: "2.5.1" }
        : {},
      enkodery: ["libx264", "libx265", "libsvtav1", "libvpx-vp9", "mpeg4", "h264_nvenc", "hevc_nvenc", "aac", "libmp3lame", "libopus", "libvorbis", "flac", "pcm_s16le", "libwebp", "libaom-av1", "png", "mjpeg", "gif", "bmp"],
      sprzet: narzedziaZnalezione ? ["h264_nvenc", "hevc_nvenc", "av1_nvenc"] : [],
      filtry: ["scale", "zscale", "tonemap", "fps", "palettegen", "paletteuse"],
      do_pobrania: ["ffmpeg", "ffmpeg_full", "ytdlp", "deno"],
      przenosny: false,
      ytdlp: narzedziaZnalezione
        ? ytdlpStary
          ? { wersja: "2026.07.04", wiek_dni: 95, pochodzenie: "path", stary: true }
          : { wersja: "2026.10.01", wiek_dni: 6, pochodzenie: "apka", stary: false }
        : null,
      katalog: "C:/Users/sora/AppData/Roaming/SoraConverter/narzedzia",
    }),
  narzedziaWykryj: () => opoznij(konfig.sciezki),
  async narzedziaPobierz(pakiet) {
    const calosc = 80_000_000;
    for (let i = 1; i <= 10; i++) {
      await opoznij(null, 150);
      sluchacze.narzedzia.forEach((f) => f({ pakiet, pobrane: (calosc * i) / 10, calosc }));
    }
    return konfig.sciezki;
  },
  ytdlpInfo: (url) => opoznij({ ...INFO_PRZYKLAD, url } as Info, 500),
  async ytdlpAktualizuj() {
    await opoznij(null, 600);
    ytdlpStary = false;
    return atrapa.narzedziaStan();
  },
  ytdlpZapewnij: () => opoznij(false),
  czytajSchowek: () => opoznij(""),
  naPowrotOkna(f) {
    const g = () => f();
    window.addEventListener("focus", g);
    return () => window.removeEventListener("focus", g);
  },
  wybierzPliki: (obrazy) =>
    opoznij(
      obrazy
        ? tx("C:/Obrazy/zdjecie-gory.jpg|C:/Obrazy/zrzut-ekranu.png|C:/Obrazy/logo.png", "C:/Pictures/mountains.jpg|C:/Pictures/screenshot.png|C:/Pictures/logo.png").split("|")
        : tx("C:/Wideo/wakacje-2026.mp4|C:/Wideo/telefon-pionowo-hdr.mov", "C:/Videos/holiday-2026.mp4|C:/Videos/phone-vertical-hdr.mov").split("|"),
    ),
  wybierzFolder: () => opoznij(tx("C:/Wideo/Gotowe", "C:/Videos/Done")),
  wybierzPlik: () => opoznij("C:/narzedzia/ffmpeg.exe"),
  async pokazWFolderze() {},
  async otworzLink() {},
  async piszSchowek(t) {
    await navigator.clipboard?.writeText(t).catch(() => undefined);
  },
  naPostep(f) {
    sluchacze.postep.add(f);
    return () => sluchacze.postep.delete(f);
  },
  naStan(f) {
    sluchacze.stan.add(f);
    return () => sluchacze.stan.delete(f);
  },
  naPostepNarzedzi(f) {
    sluchacze.narzedzia.add(f);
    return () => sluchacze.narzedzia.delete(f);
  },
  naUpuszczenie() {
    return () => undefined;
  },
};

// Lustro typów Rust (serde). Zmiana tu = zmiana w src-tauri/src/ustawienia.

export type Kontener =
  | "mp4" | "mkv" | "webm" | "mov" | "avi" | "gif"
  | "mp3" | "m4a" | "aac" | "opus" | "ogg" | "flac" | "wav"
  | "webp" | "png" | "jpg" | "avif" | "bmp" | "ico";

export type KodekWideo = "h264" | "h265" | "av1" | "vp9" | "mpeg4" | "kopiuj";
export type KodekAudio = "aac" | "mp3" | "opus" | "vorbis" | "flac" | "pcm" | "kopiuj";
export type Sprzet = "nvenc" | "qsv" | "amf";
export type Skaler = "lanczos" | "bicubic" | "bilinear" | "neighbor";

export type Rozdzielczosc =
  | { typ: "zachowaj" }
  | { typ: "wysokosc"; h: number }
  | { typ: "wlasna"; w: number; h: number };

export type Dopasowanie =
  | { typ: "proporcje" }
  | { typ: "rozciagnij" }
  | { typ: "pasy"; kolor: string }
  | { typ: "rozmycie" }
  | { typ: "przytnij" };

export type Fps = { typ: "zachowaj" } | { typ: "wartosc"; fps: number };

export type JakoscWideo =
  | { typ: "crf"; crf: number }
  | { typ: "bitrate"; kbps: number }
  | { typ: "rozmiar_mb"; mb: number };

export interface ProfilWideo {
  kodek: KodekWideo;
  rozdzielczosc: Rozdzielczosc;
  dopasowanie: Dopasowanie;
  nie_powiekszaj: boolean;
  skaler: Skaler;
  fps: Fps;
  jakosc: JakoscWideo;
  sprzet: Sprzet | null;
  /** 10 bitów tylko świadomie (H.265/AV1/VP9). */
  dziesiec_bit: boolean;
}

export interface ProfilAudio {
  kodek: KodekAudio;
  kbps: number;
  hz: number | null;
  kanaly: number | null;
  normalizacja: boolean;
}

export type Petla = { typ: "nieskonczona" } | { typ: "razy"; n: number } | { typ: "brak" };
export type Dithering =
  | { typ: "bayer"; skala: number }
  | { typ: "floyd_steinberg" }
  | { typ: "sierra2_4a" }
  | { typ: "brak" };

export interface ProfilGif {
  fps: number;
  szerokosc: number;
  petla: Petla;
  dithering: Dithering;
}

export type RozmiarObrazu =
  | { typ: "zachowaj" }
  | { typ: "wymiary"; w: number | null; h: number | null }
  | { typ: "procent"; p: number };

export interface ProfilObrazu {
  rozmiar: RozmiarObrazu;
  dopasowanie: Dopasowanie;
  jakosc: number;
  nie_powiekszaj: boolean;
  skaler: Skaler;
}

export interface Ciecie {
  od: number;
  koniec: number | null;
}

export type Obrot = "brak" | "o90" | "o180" | "o270";

export type WyborAudio = { typ: "pierwsza" } | { typ: "wszystkie" } | { typ: "numer"; n: number };

export interface Profil {
  kontener: Kontener;
  wideo: ProfilWideo | null;
  audio: ProfilAudio | null;
  obraz: ProfilObrazu | null;
  gif: ProfilGif | null;
  ciecie: Ciecie | null;
  obrot: Obrot;
  odbicie: { poziomo: boolean; pionowo: boolean };
  przyciecie: { gora: number; dol: number; lewo: number; prawo: number };
  deinterlace: boolean;
  predkosc: number;
  sciezki_audio: WyborAudio;
  napisy: boolean;
}

export type Hdr = "pq" | "hlg";

export interface StrumienWideo {
  indeks: number;
  kodek: string;
  w: number;
  h: number;
  fps: number | null;
  kbps: number | null;
  piksele: string | null;
  bity: number | null;
  hdr: Hdr | null;
  /** Obrót z metadanych, stopnie w prawo. */
  obrot: number;
  vfr: boolean;
}

export interface StrumienAudio {
  indeks: number;
  kodek: string;
  hz: number | null;
  kanaly: number | null;
  kbps: number | null;
  jezyk: string | null;
}

export interface StrumienNapisow {
  indeks: number;
  kodek: string;
  jezyk: string | null;
  tekstowe: boolean;
}

export interface Media {
  czas_s: number | null;
  rozmiar_b: number | null;
  kbps: number | null;
  format: string | null;
  wideo: StrumienWideo | null;
  audio: StrumienAudio | null;
  sciezki_audio: StrumienAudio[];
  napisy: StrumienNapisow[];
  okladka: boolean;
  obraz: boolean;
}

export type Podpowiedz =
  | { typ: "mono_niski_hz"; kanaly: number; hz: number }
  | { typ: "jeden_przebieg" }
  | { typ: "wymiary_parzyste"; w: number; h: number }
  | { typ: "opus_hz"; hz: number }
  | { typ: "mp3_niski_hz"; hz: number }
  | { typ: "ico_maks256" }
  | { typ: "hdr_na_sdr" }
  | { typ: "hdr_bez_tonemapowania" }
  | { typ: "dziesiec_bit"; hdr: boolean }
  | { typ: "dziesiec_bit_niedostepne" }
  | { typ: "mp4_opus" }
  | { typ: "napisy_pominiete"; n: number }
  | { typ: "napisy_nieobslugiwane" }
  | { typ: "ciecie_klatka_kluczowa" };

export type BladProfilu =
  | { typ: "niezgodny_kodek_wideo"; kodek: KodekWideo; kontener: Kontener }
  | { typ: "niezgodny_kodek_audio"; kodek: KodekAudio; kontener: Kontener }
  | { typ: "za_maly_rozmiar"; kbps: number }
  | { typ: "brak_czasu" }
  | { typ: "kopia_z_filtrami" }
  | { typ: "brak_wideo" }
  | { typ: "pusty_wynik" }
  | { typ: "zla_predkosc" }
  | { typ: "zle_ciecie" }
  | { typ: "zly_bitrate_audio" }
  | { typ: "zle_wymiary" };

export interface PodgladPlanu {
  przebiegi: string[][];
  podpowiedzi: Podpowiedz[];
  blad: BladProfilu | null;
}

export interface Szacunek {
  bajty: number | null;
  dokladny: boolean;
  ostrzezenie: "ogromny" | "wiekszy_niz_zrodlo" | null;
  /** Docelowy bitrate wyższy niż źródło: tyle kb/s ma źródło. */
  zrodlo_kbps: number | null;
}

export type Wybor =
  | { typ: "najlepsza" }
  | { typ: "wysokosc"; h: number }
  | { typ: "format"; id: string; z_audio: boolean }
  | { typ: "tylko_audio"; format: string };

export interface OpcjePobrania {
  wybor: Wybor;
  kontener: string;
  napisy: boolean;
  jezyki_napisow: string;
  miniatura: boolean;
  metadane: boolean;
  rozdzialy: boolean;
  playlista: boolean;
  tytul: string | null;
}

export type RodzajZadania =
  | { typ: "konwersja"; wejscie: string; profil: Profil }
  | { typ: "pobranie"; url: string; opcje: OpcjePobrania; potem: Profil | null };

export interface NoweZadanie {
  rodzaj: RodzajZadania;
  katalog: string | null;
  /** Foldery wsadowo: pomiń, jeśli wynik już istnieje. */
  pomin_istniejace?: boolean;
}

export interface PlikZFolderu {
  sciezka: string;
  /** null = plik upuszczony bezpośrednio; "" = korzeń folderu; "a/b" = podfolder. */
  podkatalog: string | null;
}

export interface PodgladKlatki {
  przed: string;
  po: string;
  czas_s: number | null;
}

export type Stan =
  | { typ: "oczekuje" }
  | { typ: "trwa" }
  | { typ: "gotowe"; wyjscie: string }
  | { typ: "blad"; komunikat: string }
  | { typ: "anulowane" }
  | { typ: "pominiete"; wyjscie: string };

export interface InfoZadania {
  id: number;
  nazwa: string;
  rodzaj: "konwersja" | "pobranie";
  stan: Stan;
  procent: number;
  wyjscie: string | null;
  rozmiar_wejscia: number | null;
  rozmiar_wyniku: number | null;
  /** Enkoder sprzętowy padł, dokończone programowo. */
  awaria_sprzetu: boolean;
  /** „Gotowe z ostrzeżeniem” (np. ucięte źródło). */
  ostrzezenie: OstrzezenieWyniku | null;
}

export type OstrzezenieWyniku = { typ: "uciete"; zrodlo_konczy_s: number; wynik_s: number; oczekiwane_s: number };

export interface Postep {
  id: number;
  procent: number;
  eta_s: number | null;
  predkosc_x: number | null;
  /** Bajty na sekundę (pobieranie). */
  bajty_s: number | null;
  przebieg: number;
  przebiegi: number;
  /** Nieznany czas trwania: pasek nieokreślony. */
  nieokreslony: boolean;
}

export interface Sciezki {
  ffmpeg: string | null;
  ffprobe: string | null;
  ytdlp: string | null;
  deno: string | null;
}

export type Narzedzie = "ffmpeg" | "ffprobe" | "ytdlp" | "deno";
export type Pakiet = "ffmpeg" | "ffmpeg_full" | "ytdlp" | "deno";

/** Skąd jest yt-dlp: ręcznie wskazany, własna kopia apki (tylko tę aktualizujemy), PATH (pip). */
export type Pochodzenie = "reczne" | "apka" | "path";

export interface InfoYtdlp {
  wersja: string | null;
  wiek_dni: number | null;
  pochodzenie: Pochodzenie;
  /** Starszy niż 30 dni: YouTube może odmawiać. */
  stary: boolean;
}

export interface StanNarzedzi {
  sciezki: Sciezki;
  wersje: Partial<Record<Narzedzie, string>>;
  enkodery: string[];
  sprzet: string[];
  filtry: string[];
  do_pobrania: Pakiet[];
  katalog: string;
  przenosny: boolean;
  ytdlp: InfoYtdlp | null;
}

export interface PostepNarzedzia {
  pakiet: Pakiet;
  pobrane: number;
  calosc: number | null;
}

export interface Konfig {
  jezyk: "pl" | "en" | null;
  motyw: "dark" | "light" | "system";
  rownolegle: number;
  /** Zadań wideo naraz (słaby procesor: 1). */
  rownolegle_wideo: number;
  /** „Nie zamulaj komputera”. */
  niski_priorytet: boolean;
  katalog_wyjscia: string | null;
  katalog_pobierania: string | null;
  /** Wykrywanie linku w schowku. */
  schowek: boolean;
  sciezki: Sciezki;
  kreator_zakonczony: boolean;
  /** Motyw wyglądu (id z motywy.ts albo własnego). */
  motyw_wyglad: string;
  /** Własne motywy (MotywWlasny z motywy.ts). */
  wlasne_motywy: unknown[];
  /** Ostatnio wybrane foldery zapisu, najnowszy pierwszy. */
  ostatnie_foldery: string[];
}

export interface Preset {
  id: string;
  nazwa: string;
  zakladka: "konwertuj" | "obrazy";
  wbudowany: boolean;
  profil: Profil;
}

export interface FormatFilmu {
  id: string;
  ext: string;
  w: number | null;
  h: number | null;
  fps: number | null;
  vkodek: string | null;
  akodek: string | null;
  rozmiar_b: number | null;
  kbps: number | null;
  opis: string;
}

export interface InfoFilmu {
  id: string;
  tytul: string;
  url: string;
  miniatura: string | null;
  czas_s: number | null;
  autor: string | null;
  formaty: FormatFilmu[];
  wysokosci: number[];
  napisy: string[];
  rozdzialy: number;
  na_zywo: boolean;
}

export interface WpisPlaylisty {
  id: string;
  tytul: string;
  url: string;
  czas_s: number | null;
}

export type Info =
  | ({ typ: "film" } & InfoFilmu)
  | { typ: "playlista"; tytul: string; url: string; wpisy: WpisPlaylisty[] };

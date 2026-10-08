// Jedyne miejsce z invoke/listen. Poza Tauri (przeglądarka, testy, zrzuty)
// działa atrapa z danymi przykładowymi.
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { open } from "@tauri-apps/plugin-dialog";
import { revealItemInDir, openUrl } from "@tauri-apps/plugin-opener";
import { readText, writeText } from "@tauri-apps/plugin-clipboard-manager";
import { check } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { isPermissionGranted, requestPermission, sendNotification } from "@tauri-apps/plugin-notification";
import type {
  Info, InfoZadania, Konfig, Media, NoweZadanie, Pakiet, PodgladPlanu, Postep, PostepNarzedzia,
  Preset, Profil, Sciezki, StanNarzedzi, Szacunek, PlikZFolderu, PodgladKlatki,
} from "./typy";
import { atrapa } from "./atrapa";

export type Odsubskrybuj = () => void;

export interface Api {
  wTauri: boolean;
  wersjaApki(): Promise<string>;
  raport(): Promise<string>;
  /** `null` = brak nowszej wersji. Rzuca, gdy sprawdzenie się nie uda. */
  sprawdzAktualizacje(): Promise<{ wersja: string; opis: string | null } | null>;
  zainstalujAktualizacje(): Promise<void>;
  sonda(sciezka: string): Promise<Media>;
  planKomendy(wejscie: string, media: Media, profil: Profil): Promise<PodgladPlanu>;
  szacuj(media: Media, profil: Profil): Promise<Szacunek>;
  dodajZadania(zadania: NoweZadanie[]): Promise<number[]>;
  listaZadan(): Promise<InfoZadania[]>;
  anulujZadanie(id: number): Promise<void>;
  wyczyscZakonczone(): Promise<void>;
  rozwinSciezki(sciezki: string[]): Promise<string[]>;
  rozwinFoldery(sciezki: string[], rozszerzenia: string[]): Promise<PlikZFolderu[]>;
  podgladKlatki(wejscie: string, media: Media, profil: Profil, czas_s: number | null): Promise<PodgladKlatki>;
  /** data URL z 5 s dźwięku z bieżącymi ustawieniami. */
  odsluch(wejscie: string, media: Media, profil: Profil, od_s: number): Promise<string>;
  /** Pliki z linii poleceń (menu kontekstowe Eksploratora) przy starcie. */
  plikiStartowe(): Promise<string[]>;
  /** Kolejne pliki z Eksploratora, gdy okno już jest otwarte (single-instance). */
  naOtworzPliki(f: (sciezki: string[]) => void): Odsubskrybuj;
  powiadom(tytul: string, tresc: string): Promise<void>;
  konfigWczytaj(): Promise<Konfig>;
  konfigZapisz(k: Konfig): Promise<void>;
  presetyLista(): Promise<Preset[]>;
  presetZapisz(p: Preset): Promise<Preset>;
  presetUsun(id: string): Promise<void>;
  narzedziaStan(): Promise<StanNarzedzi>;
  narzedziaWykryj(): Promise<Sciezki>;
  narzedziaPobierz(p: Pakiet): Promise<Sciezki>;
  ytdlpInfo(url: string, playlista: boolean): Promise<Info>;
  /** Pobiera świeżą WŁASNĄ kopię yt-dlp (pipa użytkownika nie ruszamy). */
  ytdlpAktualizuj(): Promise<StanNarzedzi>;
  /** Brak yt-dlp albo stary z PATH bez własnej kopii → pobiera własną; `true` = pobrano. */
  ytdlpZapewnij(): Promise<boolean>;
  czytajSchowek(): Promise<string>;
  naPowrotOkna(f: () => void): Odsubskrybuj;
  wybierzPliki(obrazy: boolean): Promise<string[]>;
  wybierzFolder(start?: string): Promise<string | null>;
  wybierzPlik(): Promise<string | null>;
  pokazWFolderze(sciezka: string): Promise<void>;
  otworzLink(url: string): Promise<void>;
  piszSchowek(t: string): Promise<void>;
  naPostep(f: (p: Postep) => void): Odsubskrybuj;
  naStan(f: (z: InfoZadania) => void): Odsubskrybuj;
  naPostepNarzedzi(f: (p: PostepNarzedzia) => void): Odsubskrybuj;
  /** `null` = opuszczenie strefy, [] = najechanie, ścieżki = upuszczenie */
  naUpuszczenie(f: (sciezki: string[] | null, najechanie: boolean) => void): Odsubskrybuj;
}

function nasluch<T>(nazwa: string, f: (x: T) => void): Odsubskrybuj {
  const p = listen<T>(nazwa, (e) => f(e.payload));
  return () => void p.then((u) => u());
}

const ROZSZ_MEDIOW = ["mp4", "mkv", "webm", "mov", "avi", "m4v", "wmv", "flv", "mpg", "mpeg", "ts", "m2ts", "mts", "3gp", "ogv", "gif", "mp3", "m4a", "aac", "opus", "ogg", "oga", "flac", "wav", "wma", "aiff", "amr", "ac3", "mka"];
const ROZSZ_OBRAZOW = ["png", "jpg", "jpeg", "webp", "avif", "bmp", "ico", "tif", "tiff", "gif", "heic", "jxl"];

const tauri: Api = {
  wTauri: true,
  wersjaApki: () => invoke("wersja_apki"),
  raport: () => invoke("raport"),
  async sprawdzAktualizacje() {
    const u = await check();
    return u ? { wersja: u.version, opis: u.body ?? null } : null;
  },
  async zainstalujAktualizacje() {
    const u = await check();
    if (!u) return;
    await u.downloadAndInstall();
    await relaunch();
  },
  sonda: (sciezka) => invoke("sonda", { sciezka }),
  planKomendy: (wejscie, media, profil) => invoke("plan_komendy", { wejscie, media, profil }),
  szacuj: (media, profil) => invoke("szacuj", { media, profil }),
  dodajZadania: (zadania) => invoke("dodaj_zadania", { zadania }),
  listaZadan: () => invoke("lista_zadan"),
  anulujZadanie: (id) => invoke("anuluj_zadanie", { id }),
  wyczyscZakonczone: () => invoke("wyczysc_zakonczone"),
  rozwinSciezki: (sciezki) => invoke("rozwin_sciezki", { sciezki }),
  rozwinFoldery: (sciezki, rozszerzenia) => invoke("rozwin_foldery", { sciezki, rozszerzenia }),
  podgladKlatki: (wejscie, media, profil, czasS) => invoke("podglad_klatki", { wejscie, media, profil, czasS }),
  odsluch: (wejscie, media, profil, odS) => invoke("odsluch", { wejscie, media, profil, odS }),
  plikiStartowe: () => invoke("pliki_startowe"),
  naOtworzPliki: (f) => nasluch("pliki://otworz", f),
  async powiadom(title, body) {
    let zgoda = await isPermissionGranted();
    if (!zgoda) zgoda = (await requestPermission()) === "granted";
    if (zgoda) sendNotification({ title, body });
  },
  konfigWczytaj: () => invoke("konfig_wczytaj"),
  konfigZapisz: (konfig) => invoke("konfig_zapisz", { konfig }),
  presetyLista: () => invoke("presety_lista"),
  presetZapisz: (preset) => invoke("preset_zapisz", { preset }),
  presetUsun: (id) => invoke("preset_usun", { id }),
  narzedziaStan: () => invoke("narzedzia_stan"),
  narzedziaWykryj: () => invoke("narzedzia_wykryj"),
  narzedziaPobierz: (pakiet) => invoke("narzedzia_pobierz", { pakiet }),
  ytdlpInfo: (url, playlista) => invoke("ytdlp_info", { url, playlista }),
  ytdlpAktualizuj: () => invoke("ytdlp_aktualizuj"),
  ytdlpZapewnij: () => invoke("ytdlp_zapewnij"),
  czytajSchowek: () => readText().catch(() => ""),
  naPowrotOkna(f) {
    const p = getCurrentWindow().onFocusChanged(({ payload }) => {
      if (payload) f();
    });
    return () => void p.then((u) => u());
  },
  async wybierzPliki(obrazy) {
    const w = await open({
      multiple: true,
      filters: [{ name: obrazy ? "Obrazy" : "Media", extensions: obrazy ? ROZSZ_OBRAZOW : [...ROZSZ_MEDIOW, ...ROZSZ_OBRAZOW] }],
    });
    return w ? (Array.isArray(w) ? w : [w]) : [];
  },
  async wybierzFolder(start) {
    const w = await open({ directory: true, defaultPath: start, title: "Wybierz folder zapisu" });
    return typeof w === "string" ? w : null;
  },
  async wybierzPlik() {
    const w = await open({ multiple: false });
    return typeof w === "string" ? w : null;
  },
  pokazWFolderze: (sciezka) => revealItemInDir(sciezka),
  otworzLink: (url) => openUrl(url),
  piszSchowek: (t) => writeText(t),
  naPostep: (f) => nasluch("zadanie://postep", f),
  naStan: (f) => nasluch("zadanie://stan", f),
  naPostepNarzedzi: (f) => nasluch("narzedzia://postep", f),
  naUpuszczenie(f) {
    const p = getCurrentWebview().onDragDropEvent((e) => {
      const d = e.payload;
      if (d.type === "drop") f(d.paths, false);
      else if (d.type === "enter" || d.type === "over") f([], true);
      else f(null, false);
    });
    return () => void p.then((u) => u());
  },
};

const wTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

export const api: Api = wTauri ? tauri : atrapa;

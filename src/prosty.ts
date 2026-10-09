// Tryb Prosty (S4, 1.4.0): czysta logika bez DOM i bez i18n (zwraca klucze), testowana vitestem.
// Rozpoznanie wejścia → 3–4 akcje → profil z istniejących funkcji (`profilSzybkiejAkcji`, `profilDla`).
// Celowo bez zależności od widoków trybu Pełnego: ma się dać przenieść do wspólnego `sora-ui`.
import { audioDomyslne, formatujCzas, formatujRozmiar, profilDla, profilSzybkiejAkcji, rozszerzenie } from "./logika";
import type { Kontener, Media, OpcjePobrania, Profil, Wybor } from "./typy";

export type Tryb = "prosty" | "pelny";

/**
 * Tryb przy starcie. Zapisany w konfigu wygrywa. Bez zapisu (pierwsze uruchomienie albo konfig sprzed 1.4.0):
 * kreator niezakończony = nowa instalacja → Prosty; zakończony = aktualizacja z 1.x → Pełny.
 * `zapisz` = wynik trzeba utrwalić od razu (inaczej po zamknięciu kreatora nowa instalacja wyglądałaby jak aktualizacja).
 * `podpowiedz` = „Wypróbuj tryb Prosty”, dopóki nie została pokazana (nowej instalacji nie dotyczy: zapis ustawia
 * `podpowiedz_prosty_pokazana`, patrz `main.ts`). Gdy przy pierwszym starcie po aktualizacji wisi kreator, pokaże się później.
 */
export function rozstrzygnijTryb(k: { tryb?: string | null; kreator_zakonczony: boolean; podpowiedz_prosty_pokazana?: boolean } | null): {
  tryb: Tryb;
  zapisz: boolean;
  podpowiedz: boolean;
} {
  const pokazana = !!k?.podpowiedz_prosty_pokazana;
  if (k?.tryb === "prosty" || k?.tryb === "pelny") return { tryb: k.tryb, zapisz: false, podpowiedz: k.tryb === "pelny" && !pokazana };
  if (!k || !k.kreator_zakonczony) return { tryb: "prosty", zapisz: true, podpowiedz: false };
  return { tryb: "pelny", zapisz: true, podpowiedz: !pokazana };
}

export type Rodzaj = "film" | "dzwiek" | "zdjecia" | "link";

/** Rodzaj jednego pliku po sondzie (okładka MP3 nie robi z dźwięku filmu: sonda nie daje jej jako wideo). */
export function rodzajMediow(m: Media): Exclude<Rodzaj, "link"> | null {
  if (m.obraz) return "zdjecia";
  if (m.wideo) return "film";
  if (m.audio || m.sciezki_audio.length) return "dzwiek";
  return null;
}

/**
 * Paczka plików → jeden rodzaj (większość; remis: film > dźwięk > zdjęcia). `pozostale` = pliki innego rodzaju,
 * które pomijamy z jednym zdaniem „przerobisz je osobno”.
 */
export function rozpoznaj(media: Media[]): { rodzaj: Exclude<Rodzaj, "link">; pozostale: number } | null {
  const liczby = { film: 0, dzwiek: 0, zdjecia: 0 };
  for (const m of media) {
    const r = rodzajMediow(m);
    if (r) liczby[r]++;
  }
  const kolejnosc = ["film", "dzwiek", "zdjecia"] as const;
  const rodzaj = kolejnosc.reduce((a, b) => (liczby[b] > liczby[a] ? b : a));
  if (liczby[rodzaj] === 0) return null;
  return { rodzaj, pozostale: media.length - liczby[rodzaj] };
}

export const AKCJE: Record<Rodzaj, string[]> = {
  film: ["wyslij", "telefon", "mp3", "gif"],
  dzwiek: ["mp3", "mowa", "glosnosc"],
  zdjecia: ["www", "jpg", "pol"],
  link: ["film", "mp3", "telefon"],
};

export function akcjeDla(r: Rodzaj): string[] {
  return AKCJE[r];
}

/** Gdzie wysyłasz film: limit załącznika i cel z zapasem (jak presety rozmiaru: kontener + dźwięk + korekta). */
export type Cel = "mail" | "whatsapp" | "discord";
export const CELE: Record<Cel, { limit: number; cel: number }> = {
  mail: { limit: 25, cel: 24 },
  whatsapp: { limit: 16, cel: 15.5 },
  discord: { limit: 10, cel: 9.5 },
};

/** Długość GIF-a z fragmentu (sekundy). */
export const DLUGOSC_GIF = 5;

export interface OpcjeAkcji {
  cel?: Cel;
  /** Ścieżka źródła (kontener „o połowę mniejszych” zdjęć). */
  zrodlo?: string | null;
  /** GIF: początek fragmentu w sekundach. */
  gifOd?: number;
  /** Czas trwania źródła (GIF: fragment nie wychodzi poza koniec). */
  czas?: number | null;
}

/** Fragment GIF-a: `DLUGOSC_GIF` sekund od `od`, przycięty do długości filmu. */
export function fragmentGif(od: number, czas: number | null | undefined): { od: number; koniec: number } {
  const dl = czas && czas > 0 ? czas : null;
  const start = Math.max(0, dl ? Math.min(od, Math.max(0, dl - DLUGOSC_GIF)) : od);
  const koniec = dl ? Math.min(dl, start + DLUGOSC_GIF) : start + DLUGOSC_GIF;
  return { od: Math.round(start * 10) / 10, koniec: Math.round(koniec * 10) / 10 };
}

/** Kontener „o połowę mniejszych” zdjęć: ten sam format, gdy umiemy go zapisać; inaczej JPG. */
export function kontenerZdjecia(sciezka: string | null | undefined): Kontener {
  const ext = sciezka ? rozszerzenie(sciezka) : "";
  const m: Record<string, Kontener> = { jpg: "jpg", jpeg: "jpg", png: "png", webp: "webp", avif: "avif", bmp: "bmp" };
  return m[ext] ?? "jpg";
}

/**
 * Profil konwersji dla akcji na pliku. Mapowanie na istniejący kod (PROMPT_TRYB_PROSTY.md):
 * film = szybkie akcje Konwertuj, dźwięk = MP3 192 / AAC mono 32 kb/s / MP3 + normalizacja,
 * zdjęcia = preset webp_1600 / JPG domyślny / 50% w tym samym formacie.
 */
export function profilAkcji(r: Exclude<Rodzaj, "link">, akcja: string, o: OpcjeAkcji = {}): Profil {
  const pusty = profilDla("mp4");
  if (r === "film") {
    if (akcja === "wyslij") return profilSzybkiejAkcji("rozmiar", pusty, { mb: CELE[o.cel ?? "mail"].cel });
    if (akcja === "telefon") return profilSzybkiejAkcji("telefon", pusty);
    if (akcja === "mp3") return profilSzybkiejAkcji("mp3", pusty);
    if (akcja === "gif") return profilSzybkiejAkcji("gif", { ...pusty, ciecie: fragmentGif(o.gifOd ?? 0, o.czas) });
  }
  if (r === "dzwiek") {
    if (akcja === "mp3") return profilSzybkiejAkcji("mp3", pusty);
    if (akcja === "mowa") {
      // NIE preset podcast 8 kb/s (za słaby dla laika): AAC mono ~32 kb/s, mowa zostaje wyraźna.
      const p = profilDla("m4a");
      p.audio = { ...audioDomyslne("aac"), kbps: 32, kanaly: 1 };
      return p;
    }
    if (akcja === "glosnosc") {
      const p = profilSzybkiejAkcji("mp3", pusty);
      p.audio = { ...p.audio!, normalizacja: true };
      return p;
    }
  }
  if (r === "zdjecia") {
    if (akcja === "www") {
      // to samo co wbudowany preset `webp_1600` (presety.rs)
      const p = profilDla("webp");
      p.obraz = { ...p.obraz!, rozmiar: { typ: "wymiary", w: 1600, h: null }, jakosc: 80, nie_powiekszaj: true };
      return p;
    }
    if (akcja === "jpg") return profilDla("jpg");
    if (akcja === "pol") {
      const p = profilDla(kontenerZdjecia(o.zrodlo));
      p.obraz = { ...p.obraz!, rozmiar: { typ: "procent", p: 50 } };
      return p;
    }
  }
  throw new Error(`nieznana akcja ${r}/${akcja}`);
}

/** Pobranie z linku: wybór dla yt-dlp (MP4 = H.264 od 1.3.0). */
export function wyborLinku(akcja: string): Wybor {
  if (akcja === "mp3") return { typ: "tylko_audio", format: "mp3" };
  if (akcja === "telefon") return { typ: "wysokosc", h: 480 };
  return { typ: "najlepsza" };
}

/** Opcje pobrania w Prostym: MP4, bez napisów, z miniaturą i metadanymi (jak domyślne w Pobierz). */
export function opcjeLinku(akcja: string, tytul: string | null): OpcjePobrania {
  return {
    wybor: wyborLinku(akcja),
    kontener: "mp4",
    napisy: false,
    jezyki_napisow: "pl,en",
    miniatura: true,
    metadane: true,
    rozdzialy: true,
    playlista: false,
    tytul,
  };
}

/** Forma liczby (jak `forma` w sklep.ts, bez importu stanu apki). */
export function formaLiczby(n: number): "1" | "kilka" | "wiele" {
  if (n === 1) return "1";
  const j = n % 10;
  const d = n % 100;
  return j >= 2 && j <= 4 && !(d >= 12 && d <= 14) ? "kilka" : "wiele";
}

/** Napis przycisku głównego: mówi, co się stanie. Klucz i18n + parametry. */
export function napisPrzycisku(r: Rodzaj, akcja: string, o: { cel?: Cel; n?: number } = {}): [string, Record<string, string | number>] {
  if (r === "film" && akcja === "wyslij") return ["prosty.przycisk.film.wyslij", { mb: CELE[o.cel ?? "mail"].limit }];
  if (r === "zdjecia") {
    const n = o.n ?? 1;
    return [`prosty.przycisk.zdjecia.${akcja}_${formaLiczby(n)}`, { n }];
  }
  return [`prosty.przycisk.${r}.${akcja}`, {}];
}

/** Dopisek do nazwy wyniku (klucz i18n), np. „wakacje-2026 (do maila).mp4”. `null` = sama nazwa
 *  (zmienia się rozszerzenie, a kolizje i tak dostają „ (1)” w Rust). */
export function dopisekAkcji(r: Rodzaj, akcja: string, cel?: Cel): string | null {
  if (r === "film" && akcja === "wyslij") return `prosty.dopisek.${cel ?? "mail"}`;
  if (r === "film" && akcja === "telefon") return "prosty.dopisek.telefon";
  if (r === "dzwiek" && akcja === "glosnosc") return "prosty.dopisek.glosnosc";
  if (r === "dzwiek" && akcja === "mowa") return "prosty.dopisek.mowa";
  if (r === "zdjecia" && akcja === "www") return "prosty.dopisek.www";
  if (r === "zdjecia" && akcja === "pol") return "prosty.dopisek.pol";
  return null;
}

/** Nagłówek stanu „gotowe” (klucz): przy wysyłce mówi wprost, że zmieści się w limicie. */
export function tytulGotowe(r: Rodzaj, akcja: string, cel?: Cel): string {
  if (r === "film" && akcja === "wyslij") return `prosty.gotowe.${cel ?? "mail"}`;
  return "prosty.gotowe";
}

/** Pionowy. `sonda.rs` podaje wymiary już po obrocie z metadanych (tak, jak widać film), więc bez ponownego obracania. */
export function pionowy(m: Media): boolean {
  const v = m.wideo;
  return !!v && !m.obraz && v.h > v.w;
}

/** „Z telefonu”: tylko gdy pewne (zmienny klatkaż + HDR albo HEVC albo obrót z metadanych). Niepewne = pomijamy. */
export function zTelefonu(m: Media): boolean {
  const v = m.wideo;
  if (!v || m.obraz || !v.vfr) return false;
  return !!v.hdr || v.kodek === "hevc" || v.obrot !== 0;
}

/** Opis pliku po ludzku: [klucz rodzaju, czas, rozmiar, cechy]. Cechy to klucze i18n. */
export function opisPliku(m: Media, jezyk: "pl" | "en"): { rodzaj: string; czesci: string[]; cechy: string[] } {
  const r = rodzajMediow(m);
  const czesci: string[] = [];
  if (m.czas_s && r !== "zdjecia") czesci.push(formatujCzas(Math.round(m.czas_s)));
  if (r === "zdjecia" && m.wideo) czesci.push(`${m.wideo.w}×${m.wideo.h}`);
  if (m.rozmiar_b) czesci.push(formatujRozmiar(m.rozmiar_b, jezyk));
  const cechy: string[] = [];
  if (zTelefonu(m)) cechy.push("prosty.cecha.telefon");
  if (pionowy(m)) cechy.push("prosty.cecha.pionowy");
  return { rodzaj: `prosty.rodzaj.${r ?? "film"}`, czesci, cechy };
}

/** Przewidywany wynik na kaflu: „412 MB → ok. 24 MB” albo samo „≈ 4,4 MB”, gdy wynik to inny rodzaj pliku. */
export function opisWyniku(przed: number | null, po: number | null, o: { jezyk: "pl" | "en"; ok: string; porownaj: boolean }): string {
  if (po === null) return "";
  // szacunek: „24 MB”, nie „24,0 MB” (dokładność, której nie ma)
  const r = (b: number) => formatujRozmiar(b, o.jezyk).replace(/[.,]0 /, " ");
  return o.porownaj && przed ? `${r(przed)} → ${o.ok} ${r(po)}` : `≈ ${r(po)}`;
}

/** Klucz błędu z Rusta (`@i18n {"k":…}`) albo `null` dla zwykłego tekstu. */
export function kluczBledu(komunikat: string): string | null {
  const m = /^@i18n (\{.*?\})(\n|$)/.exec(komunikat);
  if (!m) return null;
  try {
    return (JSON.parse(m[1]) as { k?: string }).k ?? null;
  } catch {
    return null;
  }
}

export type Naprawa = "aktualizuj" | "folder" | "inny";

/** Jedna akcja naprawcza dla błędu: blokada serwisu → zaktualizuj yt-dlp i ponów; folder → zmień folder; reszta → inny plik. */
export function naprawaBledu(komunikat: string): Naprawa {
  const k = kluczBledu(komunikat);
  if (k === "yt.blokada" || k === "yt.brak_formatu") return "aktualizuj";
  if (k === "folder_zapisu" || k === "zapis_wyniku") return "folder";
  return "inny";
}

/** Postęp paczki zadań: średni procent i najdłuższe „zostało”. */
export function postepPaczki(
  zadania: { procent: number; stan: { typ: string } }[],
  eta: (number | null)[],
): { procent: number; eta: number | null; koniec: boolean } {
  if (zadania.length === 0) return { procent: 0, eta: null, koniec: true };
  const konce = ["gotowe", "blad", "anulowane", "pominiete"];
  const procent = zadania.reduce((s, z) => s + (konce.includes(z.stan.typ) ? 100 : z.procent), 0) / zadania.length;
  const znane = eta.filter((x): x is number => x !== null && isFinite(x));
  return { procent, eta: znane.length ? Math.max(...znane) : null, koniec: zadania.every((z) => konce.includes(z.stan.typ)) };
}

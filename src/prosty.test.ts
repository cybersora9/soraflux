import { describe, expect, it } from "vitest";
import pl from "./i18n/pl.json";
import en from "./i18n/en.json";
import {
  AKCJE, CELE, dopisekAkcji, fragmentGif, kluczBledu, kontenerZdjecia, napisPrzycisku, naprawaBledu, opisPliku, opisWyniku,
  pionowy, postepPaczki, profilAkcji, rozpoznaj, rozstrzygnijTryb, tytulGotowe, wyborLinku, zTelefonu, type Rodzaj,
} from "./prosty";
import type { Media, StrumienWideo } from "./typy";

const wideo = (w: Partial<StrumienWideo> = {}): StrumienWideo => ({
  indeks: 0, kodek: "h264", w: 1920, h: 1080, fps: 30, kbps: 8000, piksele: "yuv420p", bity: 8, hdr: null, obrot: 0, vfr: false, ...w,
});
const audio = { indeks: 1, kodek: "aac", hz: 48000, kanaly: 2, kbps: 160, jezyk: null };
const baza = { kbps: null, format: null, sciezki_audio: [], napisy: [], okladka: false };
const film = (w: Partial<StrumienWideo> = {}): Media => ({ ...baza, czas_s: 187.4, rozmiar_b: 432_013_312, obraz: false, wideo: wideo(w), audio });
const dzwiek: Media = { ...baza, czas_s: 2892, rozmiar_b: 486_000_000, obraz: false, wideo: null, audio, sciezki_audio: [audio] };
const mp3ZOkladka: Media = { ...dzwiek, okladka: true };
const zdjecie: Media = { ...baza, czas_s: null, rozmiar_b: 2_400_000, obraz: true, wideo: wideo({ kodek: "mjpeg", w: 4032, h: 3024, fps: null }), audio: null };

describe("rozstrzygnijTryb (decyzja 2)", () => {
  it("brak konfigu i świeża instalacja → Prosty, zapis od razu", () => {
    expect(rozstrzygnijTryb(null)).toEqual({ tryb: "prosty", zapisz: true, podpowiedz: false });
    expect(rozstrzygnijTryb({ kreator_zakonczony: false })).toEqual({ tryb: "prosty", zapisz: true, podpowiedz: false });
  });
  it("aktualizacja z 1.x (kreator zakończony, brak pola) → Pełny + podpowiedź raz", () => {
    expect(rozstrzygnijTryb({ kreator_zakonczony: true, tryb: null })).toEqual({ tryb: "pelny", zapisz: true, podpowiedz: true });
    expect(rozstrzygnijTryb({ kreator_zakonczony: true, podpowiedz_prosty_pokazana: true }).podpowiedz).toBe(false);
  });
  it("zapisany tryb wygrywa; podpowiedź raz (także odłożona, gdy przy pierwszym starcie wisiał kreator)", () => {
    expect(rozstrzygnijTryb({ kreator_zakonczony: true, tryb: "prosty" })).toEqual({ tryb: "prosty", zapisz: false, podpowiedz: false });
    expect(rozstrzygnijTryb({ kreator_zakonczony: true, tryb: "pelny", podpowiedz_prosty_pokazana: true })).toEqual({ tryb: "pelny", zapisz: false, podpowiedz: false });
    expect(rozstrzygnijTryb({ kreator_zakonczony: true, tryb: "pelny", podpowiedz_prosty_pokazana: false }).podpowiedz).toBe(true);
  });
  it("śmieci w polu trybu = jak brak pola", () => {
    expect(rozstrzygnijTryb({ kreator_zakonczony: true, tryb: "xyz" }).tryb).toBe("pelny");
  });
});

describe("rozpoznanie wejścia", () => {
  it("film, dźwięk (też MP3 z okładką), zdjęcia", () => {
    expect(rozpoznaj([film()])).toEqual({ rodzaj: "film", pozostale: 0 });
    expect(rozpoznaj([mp3ZOkladka])).toEqual({ rodzaj: "dzwiek", pozostale: 0 });
    expect(rozpoznaj([zdjecie, zdjecie, zdjecie])).toEqual({ rodzaj: "zdjecia", pozostale: 0 });
  });
  it("mieszane: większość wygrywa, reszta osobno; remis → film", () => {
    expect(rozpoznaj([film(), zdjecie])).toEqual({ rodzaj: "film", pozostale: 1 });
    expect(rozpoznaj([film(), zdjecie, zdjecie])).toEqual({ rodzaj: "zdjecia", pozostale: 1 });
  });
  it("nic rozpoznawalnego → null", () => {
    expect(rozpoznaj([])).toBeNull();
    expect(rozpoznaj([{ ...dzwiek, audio: null, sciezki_audio: [] }])).toBeNull();
  });
});

describe("akcje → profile (mapowanie z PROMPT_TRYB_PROSTY)", () => {
  it("film: do wysłania z celem z zapasem (24 / 15,5 / 9,5 MB)", () => {
    expect(CELE.mail.cel).toBe(24);
    for (const [cel, mb] of [["mail", 24], ["whatsapp", 15.5], ["discord", 9.5]] as const) {
      const p = profilAkcji("film", "wyslij", { cel });
      expect(p.kontener).toBe("mp4");
      expect(p.wideo!.jakosc).toEqual({ typ: "rozmiar_mb", mb });
    }
  });
  it("film: telefon 480p, MP3 192, GIF 5 s z wybranego momentu", () => {
    expect(profilAkcji("film", "telefon").wideo!.rozdzielczosc).toEqual({ typ: "wysokosc", h: 480 });
    const mp3 = profilAkcji("film", "mp3");
    expect([mp3.kontener, mp3.audio!.kbps, mp3.wideo]).toEqual(["mp3", 192, null]);
    const gif = profilAkcji("film", "gif", { gifOd: 30, czas: 187.4 });
    expect(gif.kontener).toBe("gif");
    expect(gif.ciecie).toEqual({ od: 30, koniec: 35 });
  });
  it("fragment GIF-a nie wychodzi poza koniec filmu", () => {
    expect(fragmentGif(185, 187.4)).toEqual({ od: 182.4, koniec: 187.4 });
    expect(fragmentGif(0, 3)).toEqual({ od: 0, koniec: 3 });
    expect(fragmentGif(-2, null)).toEqual({ od: 0, koniec: 5 });
  });
  it("dźwięk: MP3 192, mowa = AAC mono 32 kb/s (nie 8 kb/s), głośność = MP3 z normalizacją", () => {
    expect(profilAkcji("dzwiek", "mp3").audio!.kbps).toBe(192);
    const mowa = profilAkcji("dzwiek", "mowa");
    expect([mowa.kontener, mowa.audio!.kodek, mowa.audio!.kbps, mowa.audio!.kanaly]).toEqual(["m4a", "aac", 32, 1]);
    const g = profilAkcji("dzwiek", "glosnosc");
    expect([g.kontener, g.audio!.normalizacja]).toEqual(["mp3", true]);
  });
  it("zdjęcia: WebP 1600 jak preset, JPG, połowa w tym samym formacie", () => {
    const www = profilAkcji("zdjecia", "www");
    expect([www.kontener, www.obraz!.rozmiar, www.obraz!.jakosc]).toEqual(["webp", { typ: "wymiary", w: 1600, h: null }, 80]);
    expect(profilAkcji("zdjecia", "jpg").kontener).toBe("jpg");
    const pol = profilAkcji("zdjecia", "pol", { zrodlo: "C:/a/logo.PNG" });
    expect([pol.kontener, pol.obraz!.rozmiar]).toEqual(["png", { typ: "procent", p: 50 }]);
    expect(kontenerZdjecia("x.heic")).toBe("jpg");
    expect(kontenerZdjecia("x.jpeg")).toBe("jpg");
  });
  it("link: najlepsza (MP4) / MP3 / 480p", () => {
    expect(wyborLinku("film")).toEqual({ typ: "najlepsza" });
    expect(wyborLinku("mp3")).toEqual({ typ: "tylko_audio", format: "mp3" });
    expect(wyborLinku("telefon")).toEqual({ typ: "wysokosc", h: 480 });
  });
  it("każda akcja plikowa daje profil", () => {
    // „napisy” to zadanie whisper.cpp, nie konwersja (src/napisy.ts)
    for (const r of ["film", "dzwiek", "zdjecia"] as const) for (const a of AKCJE[r].filter((x) => x !== "napisy")) expect(profilAkcji(r, a).kontener).toBeTruthy();
    expect(() => profilAkcji("film", "napisy")).toThrow();
    expect(() => profilAkcji("film", "nie-ma")).toThrow();
  });
});

describe("napisy i nazwy", () => {
  it("przycisk mówi, co się stanie (limit celu, liczba mnoga zdjęć)", () => {
    expect(napisPrzycisku("film", "wyslij", { cel: "whatsapp" })).toEqual(["prosty.przycisk.film.wyslij", { mb: 16 }]);
    expect(napisPrzycisku("zdjecia", "www", { n: 1 })[0]).toBe("prosty.przycisk.zdjecia.www_1");
    expect(napisPrzycisku("zdjecia", "www", { n: 3 })[0]).toBe("prosty.przycisk.zdjecia.www_kilka");
    expect(napisPrzycisku("zdjecia", "jpg", { n: 12 })[0]).toBe("prosty.przycisk.zdjecia.jpg_wiele");
    expect(napisPrzycisku("link", "mp3")[0]).toBe("prosty.przycisk.link.mp3");
  });
  it("wszystkie klucze trybu Prostego są w PL i EN", () => {
    const klucze = new Set<string>();
    for (const r of Object.keys(AKCJE) as Rodzaj[]) {
      klucze.add(`prosty.rodzaj.${r}`);
      for (const a of AKCJE[r]) {
        klucze.add(`prosty.akcja.${r}.${a}`);
        klucze.add(`prosty.akcja.${r}.${a}.opis`);
        for (const n of [1, 3, 5]) klucze.add(napisPrzycisku(r, a, { n })[0]);
        const d = dopisekAkcji(r, a);
        if (d) klucze.add(d);
        klucze.add(tytulGotowe(r, a));
      }
    }
    for (const c of Object.keys(CELE)) ["prosty.dopisek.", "prosty.gotowe.", "prosty.cel."].forEach((p) => klucze.add(p + c));
    for (const k of klucze) {
      expect(pl, k).toHaveProperty([k]);
      expect(en, k).toHaveProperty([k]);
    }
  });
  it("dopisek do nazwy: do maila / na telefon; MP3 i GIF bez dopisku", () => {
    expect(dopisekAkcji("film", "wyslij")).toBe("prosty.dopisek.mail");
    expect((pl as Record<string, string>)["prosty.dopisek.mail"]).toBe("do maila");
    expect(dopisekAkcji("film", "mp3")).toBeNull();
    expect(dopisekAkcji("film", "gif")).toBeNull();
    expect(dopisekAkcji("link", "film")).toBeNull();
  });
});

describe("opis pliku po ludzku", () => {
  it("film z telefonu, pionowy (wymiary z sondy są już po obrocie 90°)", () => {
    const m = film({ kodek: "hevc", vfr: true, obrot: 90, hdr: "hlg", w: 1080, h: 1920 });
    expect(pionowy(m) && zTelefonu(m)).toBe(true);
    expect(opisPliku(m, "pl")).toEqual({ rodzaj: "prosty.rodzaj.film", czesci: ["03:07", "412 MB"], cechy: ["prosty.cecha.telefon", "prosty.cecha.pionowy"] });
  });
  it("niepewne „z telefonu” pomijamy; poziomy bez cech", () => {
    expect(zTelefonu(film({ kodek: "hevc" }))).toBe(false);
    expect(opisPliku(film(), "en").cechy).toEqual([]);
    expect(pionowy(film({ w: 1080, h: 1920 }))).toBe(true);
    expect(pionowy(film({ obrot: 90 }))).toBe(false); // 1920×1080 po obrocie = poziomy
  });
  it("zdjęcie: wymiary zamiast czasu", () => {
    expect(opisPliku(zdjecie, "pl").czesci).toEqual(["4032×3024", "2,3 MB"]);
  });
  it("przewidywany wynik", () => {
    expect(opisWyniku(432_013_312, 24 * 1048576, { jezyk: "pl", ok: "ok.", porownaj: true })).toBe("412 MB → ok. 24 MB");
    expect(opisWyniku(432_013_312, 4_600_000, { jezyk: "pl", ok: "ok.", porownaj: false })).toBe("≈ 4,4 MB");
    expect(opisWyniku(null, null, { jezyk: "pl", ok: "ok.", porownaj: true })).toBe("");
    // na żywo 09.10: 2 PNG 376 KB, szacunek 726 KB, wynik 101 KB → bez strzałki „rośnie”
    expect(opisWyniku(385_000, 743_000, { jezyk: "pl", ok: "ok.", porownaj: true })).toBe("≈ 726 KB");
  });
});

describe("błędy i postęp", () => {
  it("klucz błędu z Rusta i jedna akcja naprawcza", () => {
    const blokada = '@i18n {"k":"yt.blokada"}\n\nERROR: HTTP Error 403: Forbidden';
    expect(kluczBledu(blokada)).toBe("yt.blokada");
    expect(naprawaBledu(blokada)).toBe("aktualizuj");
    expect(naprawaBledu('@i18n {"k":"folder_zapisu","a":{"folder":"X"}}')).toBe("folder");
    expect(naprawaBledu('@i18n {"k":"ffmpeg_kod","a":{"kod":"1"}}\n\nInvalid data')).toBe("inny");
    expect(naprawaBledu("zwykły tekst")).toBe("inny");
    expect(kluczBledu("@i18n {zepsute")).toBeNull();
  });
  it("postęp paczki: średnia, najdłuższe „zostało”, koniec gdy wszystkie zakończone", () => {
    const p = postepPaczki([{ procent: 40, stan: { typ: "trwa" } }, { procent: 0, stan: { typ: "gotowe" } }], [30, null]);
    expect(p).toEqual({ procent: 70, eta: 30, koniec: false });
    expect(postepPaczki([{ procent: 13, stan: { typ: "blad" } }], [null]).koniec).toBe(true);
  });
});

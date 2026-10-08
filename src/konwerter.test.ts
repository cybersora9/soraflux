import { describe, expect, it } from "vitest";
import { kontenerKopii, profilDla, profilSzybkiejAkcji, wierszeInformacji, zmianaRozmiaru } from "./logika";
import { katalogDlaPliku, rozszerzeniaZTekstu } from "./widoki/plikowy";
import type { Media } from "./typy";

describe("szybkie akcje (4.2)", () => {
  it("jeden klik ustawia gotowy profil, cięcie zostaje", () => {
    const z = { ...profilDla("mkv"), ciecie: { od: 5, koniec: 9 } };
    const r = profilSzybkiejAkcji("rozmiar", z, { mb: 8 });
    expect(r.kontener).toBe("mp4");
    expect(r.wideo?.jakosc).toEqual({ typ: "rozmiar_mb", mb: 8 });
    expect(r.ciecie).toEqual({ od: 5, koniec: 9 });
    expect(profilSzybkiejAkcji("mp3", z).audio).toMatchObject({ kodek: "mp3", kbps: 192 });
    const tel = profilSzybkiejAkcji("telefon", z);
    expect(tel.wideo?.rozdzielczosc).toEqual({ typ: "wysokosc", h: 480 });
    expect(tel.wideo?.fps).toEqual({ typ: "wartosc", fps: 25 });
    expect(profilSzybkiejAkcji("gif", z).gif).toMatchObject({ fps: 15, szerokosc: 480 });
  });
  it("wytnij: kopia strumieni w kontenerze źródła", () => {
    const r = profilSzybkiejAkcji("wytnij", profilDla("mp4"), { zrodlo: "C:/Filmy/a.MOV" });
    expect(r.kontener).toBe("mov");
    expect(r.wideo?.kodek).toBe("kopiuj");
    expect(r.audio?.kodek).toBe("kopiuj");
    expect(r.ciecie).toEqual({ od: 0, koniec: null });
    expect(kontenerKopii("x.ts")).toBe("mkv");
    expect(kontenerKopii("x.m4v")).toBe("mp4");
  });
});

describe("foldery wsadowo (4.3)", () => {
  it("zachowanie struktury podfolderów", () => {
    const o = { struktura: true, rozszerzenia: "", pomin: true };
    const p = { sciezka: "D:/Wakacje/dzien 1/a.mp4", media: null, podkatalog: "dzien 1" };
    expect(katalogDlaPliku(p, "E:\\Gotowe\\", o)).toBe("E:\\Gotowe\\dzien 1");
    expect(katalogDlaPliku({ ...p, podkatalog: "a/b" }, "/home/x/out", o)).toBe("/home/x/out/a/b");
    expect(katalogDlaPliku(p, null, o)).toBeNull();
    expect(katalogDlaPliku({ ...p, podkatalog: "" }, "E:/Gotowe", o)).toBeNull();
    expect(katalogDlaPliku(p, "E:/Gotowe", { ...o, struktura: false })).toBeNull();
  });
  it("filtr rozszerzeń z tekstu", () => {
    expect(rozszerzeniaZTekstu("MP4, .mov; *.mkv  mp4")).toEqual(["mp4", "mov", "mkv"]);
    expect(rozszerzeniaZTekstu("  ")).toEqual([]);
  });
});

describe("informacje i rozmiar (4.5, 4.6)", () => {
  it("karta informacji z ffprobe", () => {
    const m: Media = {
      czas_s: 42.7, rozmiar_b: 96_000_000, kbps: 18000, format: "mov", obraz: false, okladka: false,
      wideo: { indeks: 0, kodek: "hevc", w: 2160, h: 3840, fps: 29.87, kbps: 17500, piksele: "yuv420p10le", bity: 10, hdr: "hlg", obrot: 90, vfr: true },
      audio: null,
      sciezki_audio: [
        { indeks: 1, kodek: "aac", hz: 48000, kanaly: 2, kbps: 128, jezyk: "pol" },
        { indeks: 2, kodek: "ac3", hz: 48000, kanaly: 6, kbps: 384, jezyk: "eng" },
      ],
      napisy: [{ indeks: 3, kodek: "mov_text", jezyk: "pol", tekstowe: true }],
    };
    const w = Object.fromEntries(wierszeInformacji(m));
    expect(w["info.rozdzielczosc"]).toBe("2160×3840 (↻ 90°)");
    expect(w["info.fps"]).toBe("29.87 VFR");
    expect(w["info.kodek_wideo"]).toBe("HEVC 10-bit · yuv420p10le");
    expect(w["info.hdr"]).toBe("HLG");
    expect(w["info.audio_n:2"]).toContain("AC3 384 kb/s");
    expect(w["info.napisy"]).toBe("pol (mov_text)");
  });
  it("porównanie rozmiaru przed/po", () => {
    expect(zmianaRozmiaru(412_000_000, 74_000_000)).toBe("−82%");
    expect(zmianaRozmiaru(100, 112)).toBe("+12%");
    expect(zmianaRozmiaru(100, 100)).toBe("±0%");
  });
});

import { describe, expect, it } from "vitest";
import {
  KODEKI_AUDIO, KODEKI_WIDEO, formatujCzas, formatujRozmiar, komendaDoPokazania, parsujCzas, podpowiedzAac,
  profilDla, zmienKontener, audioDomyslne, wyciagnijUrl, wyborSzybki, ZRODLA_POBIERANIA, sciezkaDoPokazania,
} from "./logika";

describe("podpowiedź AAC < 32 kb/s", () => {
  it("przy zejściu poniżej progu ustawia mono i 16 kHz", () => {
    const przed = audioDomyslne("aac");
    const po = podpowiedzAac(przed, { ...przed, kbps: 8 });
    expect(po).toMatchObject({ kbps: 8, kanaly: 1, hz: 16000 });
  });
  it("nie nadpisuje zmian użytkownika, gdy już jest nisko", () => {
    const nisko = { kodek: "aac" as const, kbps: 16, hz: 16000, kanaly: 1, normalizacja: false };
    const zmiana = { ...nisko, kanaly: 2, hz: 22050 };
    expect(podpowiedzAac(nisko, zmiana)).toEqual(zmiana);
  });
  it("nie dotyczy Opus ani wysokich bitrate", () => {
    const opus = { ...audioDomyslne("opus"), kbps: 8 };
    expect(podpowiedzAac(null, opus)).toEqual(opus);
    const aac = { ...audioDomyslne("aac"), kbps: 64 };
    expect(podpowiedzAac(null, aac)).toEqual(aac);
  });
});

describe("profile", () => {
  it("profilDla odpowiada Profil::dla w Rust", () => {
    const p = profilDla("mp4");
    expect(p.wideo?.kodek).toBe("h264");
    expect(p.audio?.kodek).toBe("aac");
    expect(profilDla("mp3").wideo).toBeNull();
    expect(profilDla("webm").audio?.kodek).toBe("opus");
    expect(profilDla("gif").gif?.fps).toBe(15);
    expect(profilDla("webp").obraz?.jakosc).toBe(85);
  });
  it("zmiana kontenera zachowuje rozdzielczość, a niezgodny kodek wraca do domyślnego", () => {
    const p = profilDla("mp4");
    p.wideo!.rozdzielczosc = { typ: "wysokosc", h: 480 };
    p.wideo!.fps = { typ: "wartosc", fps: 25 };
    const w = zmienKontener(p, "webm");
    expect(w.wideo?.kodek).toBe("vp9");
    expect(w.wideo?.rozdzielczosc).toEqual({ typ: "wysokosc", h: 480 });
    expect(w.audio?.kodek).toBe("opus");
  });
  it("„bez dźwięku” przeżywa zmianę kontenera wideo", () => {
    const p = profilDla("mp4");
    p.audio = null;
    expect(zmienKontener(p, "mkv").audio).toBeNull();
    expect(zmienKontener(p, "mp3").audio?.kodek).toBe("mp3");
  });
  it("po GIF-ie wideo wraca z dźwiękiem (GIF nie ma dźwięku, to nie był wybór)", () => {
    const gif = zmienKontener(profilDla("mp4"), "gif");
    expect(gif.audio ?? null).toBeNull();
    expect(zmienKontener(gif, "webm").audio?.kodek).toBe("opus");
    expect(zmienKontener(gif, "mp4").audio?.kodek).toBe("aac");
  });
  it("mapy zgodności pokrywają domyślne kodeki", () => {
    for (const k of Object.keys(KODEKI_AUDIO) as (keyof typeof KODEKI_AUDIO)[]) {
      const p = profilDla(k);
      if (p.audio) expect(KODEKI_AUDIO[k]).toContain(p.audio.kodek);
      if (p.wideo) expect(KODEKI_WIDEO[k]).toContain(p.wideo.kodek);
    }
  });
});

describe("czas i rozmiar", () => {
  it("parsuje różne zapisy czasu", () => {
    expect(parsujCzas("1:02:03.5")).toBe(3723.5);
    expect(parsujCzas("02:03")).toBe(123);
    expect(parsujCzas("75")).toBe(75);
    expect(parsujCzas("1,5")).toBe(1.5);
    expect(parsujCzas("")).toBeNull();
    expect(parsujCzas("ab:cd")).toBeNull();
  });
  it("formatuje czas i rozmiar", () => {
    expect(formatujCzas(3723)).toBe("1:02:03");
    expect(formatujCzas(65)).toBe("01:05");
    expect(formatujRozmiar(1536, "pl")).toBe("1,5 KB");
    expect(formatujRozmiar(10 * 1024 * 1024, "en")).toBe("10.0 MB");
    expect(formatujRozmiar(null)).toBe("—");
  });
});

describe("pomocnicze", () => {
  it("cytuje argumenty komendy ze spacjami", () => {
    expect(komendaDoPokazania(["-i", "C:/Moje filmy/a.mp4", "-vf", "scale=w=-2:h=480"])).toBe('ffmpeg -i "C:/Moje filmy/a.mp4" -vf scale=w=-2:h=480');
  });
});

describe("pobieranie", () => {
  it("wyciąga linki z tekstu", () => {
    expect(wyciagnijUrl("zobacz https://example.com/a i https://x.y/b?c=1\nhttps://example.com/a")).toEqual(["https://example.com/a", "https://x.y/b?c=1"]);
  });
  it("szybkie akcje i chipy źródeł", () => {
    expect(wyborSzybki("mp3")).toEqual({ typ: "tylko_audio", format: "mp3" });
    expect(wyborSzybki("najlepsza")).toEqual({ typ: "najlepsza" });
    expect(ZRODLA_POBIERANIA).toEqual(["SoundCloud", "Bandcamp", "Vimeo", "Mixcloud", "Internet Archive"]);
  });
});

describe("v1.2 usterki", () => {
  it("ścieżki do pokazania z jednym separatorem (usterka 3)", () => {
    expect(sciezkaDoPokazania("C:/Users/sora/SoraConverter-test\\plik.mp4")).toBe("C:\\Users\\sora\\SoraConverter-test\\plik.mp4");
    expect(sciezkaDoPokazania("D:\\Wideo/Gotowe/a.mp4")).toBe("D:\\Wideo\\Gotowe\\a.mp4");
    expect(sciezkaDoPokazania("/home/sora/Wideo/a.mp4")).toBe("/home/sora/Wideo/a.mp4");
  });
});

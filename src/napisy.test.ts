import { describe, expect, it } from "vitest";
import pl from "./i18n/pl.json";
import en from "./i18n/en.json";
import { etapZadania, etaPobierania, gotowosc, JEZYKI, MODELE, nazwaJezyka, opcjeDoKolejki, opcjeDomyslne, rozmiarModelu, STYLE } from "./napisy";
import { AKCJE, napisPrzycisku } from "./prosty";
import type { InfoModelu, StanNapisow } from "./typy";

const model = (m: Partial<InfoModelu> = {}): InfoModelu => ({
  model: "base", plik: "ggml-base.bin", rozmiar_mb: 142, ram_mb: 500, pobrany: false, czesciowy_b: null, do_pobrania: true, ostrzezenie_ram: null, ...m,
});
const stan = (s: Partial<StanNapisow> = {}): StanNapisow => ({
  whisper: "C:/narzedzia/whisper-cli.exe", katalog_modeli: "C:/dane/modele", modele: [model()], ram_mb: 16000, wolne_ram_mb: 8000, pobieranie_trwa: false, ...s,
});

describe("napisy: gotowość", () => {
  it("brak whispera, model do pobrania, suma nieprzypięta, gotowe", () => {
    expect(gotowosc(null, "base")).toBe("sprawdzam");
    expect(gotowosc(stan({ whisper: null }), "base")).toBe("brak_whisper");
    expect(gotowosc(stan(), "base")).toBe("pobierz");
    expect(gotowosc(stan({ modele: [model({ do_pobrania: false })] }), "base")).toBe("brak_sumy");
    expect(gotowosc(stan({ modele: [model({ do_pobrania: false, pobrany: true })] }), "base")).toBe("gotowe");
    expect(gotowosc(stan(), "small")).toBe("brak_sumy");
  });
  it("rozmiar modelu po ludzku", () => {
    expect(rozmiarModelu(model(), "pl")).toBe("142 MB");
    expect(rozmiarModelu(model({ rozmiar_mb: 1549 }), "en")).toBe("1.5 GB");
  });
});

describe("napisy: opcje do kolejki", () => {
  it("dźwięk bez obrazu nie wypala, pusty wybór daje SRT", () => {
    const o = { ...opcjeDomyslne(), srt: false, wypal: "rolki" as const };
    expect(opcjeDoKolejki(o, true)).toEqual({ ...o, srt: false });
    expect(opcjeDoKolejki(o, false)).toEqual({ ...o, wypal: null, srt: true });
    expect(opcjeDoKolejki({ ...opcjeDomyslne(), srt: false, vtt: true }, true).srt).toBe(false);
  });
});

describe("napisy: postęp", () => {
  const p = { id: 1, procent: 40, eta_s: 10, predkosc_x: null, bajty_s: null, przebieg: 2, przebiegi: 3, nieokreslony: false };
  it("etap i fragment długiego pliku", () => {
    expect(etapZadania({ ...p, etap: "rozpoznawanie" })).toEqual({ klucz: "napisy.etap.rozpoznawanie", fragment: { i: 2, n: 3 } });
    expect(etapZadania({ ...p, etap: "wypalanie" })?.fragment).toBeNull();
    expect(etapZadania({ ...p, przebiegi: 1, etap: "dzwiek" })?.fragment).toBeNull();
    expect(etapZadania(p)).toBeNull();
    expect(etapZadania(undefined)).toBeNull();
  });
  it("ETA pobierania modelu z tempa (także po wznowieniu)", () => {
    expect(etaPobierania(60, 100, 0, 6)).toBe(4);
    expect(etaPobierania(80, 100, 50, 3)).toBe(2, "liczy tylko bajty z tej sesji");
    expect(etaPobierania(10, null, 0, 6)).toBeNull();
    expect(etaPobierania(10, 100, 0, 1)).toBeNull();
    expect(etaPobierania(10, 100, 10, 5)).toBeNull();
  });
  it("nazwa wykrytego języka", () => {
    expect(nazwaJezyka("pl")).toEqual({ klucz: "napisy.jezyk.pl" });
    expect(nazwaJezyka("de")).toEqual({ tekst: "DE" });
    expect(nazwaJezyka(null)).toBeNull();
  });
});

describe("napisy: i18n", () => {
  it("wszystkie klucze napisów są w PL i EN", () => {
    const klucze = [
      ...JEZYKI.map((j) => `napisy.jezyk.${j}`),
      ...MODELE.map((m) => `napisy.model.${m}`),
      ...STYLE.map((s) => `napisy.wypal.${s ?? "brak"}`),
      ...["dzwiek", "rozpoznawanie", "wypalanie"].map((e) => `napisy.etap.${e}`),
      "napisy.ram.za_malo", "napisy.ram.ciasno",
      ...(["film", "dzwiek"] as const).map((r) => napisPrzycisku(r, "napisy")[0]),
    ];
    for (const k of klucze) {
      expect(pl, k).toHaveProperty([k]);
      expect(en, k).toHaveProperty([k]);
    }
    expect(AKCJE.film).toContain("napisy");
    expect(AKCJE.dzwiek).toContain("napisy");
  });
  it("teksty napisów bez obietnic jakości i szybkości (do zmierzenia na żywo)", () => {
    for (const s of [pl, en] as Record<string, string>[]) {
      for (const [k, v] of Object.entries(s)) {
        if (!k.startsWith("napisy.") && !k.includes(".napisy")) continue;
        expect(v, k).not.toMatch(/\d+\s*%|\d+\s*[x×]\s|dokładn|accura|szybk|fast|best|najlepsz/i);
      }
    }
  });
  it("zgoda na pobranie mówi skąd, ile i że to jedyne połączenie", () => {
    expect((pl as Record<string, string>)["napisy.zgoda.opis"]).toMatch(/\{host\}.*\{mb\}|\{mb\}.*\{host\}/s);
    expect((en as Record<string, string>)["napisy.zgoda.opis"]).toMatch(/\{host\}.*\{mb\}|\{mb\}.*\{host\}/s);
  });
});

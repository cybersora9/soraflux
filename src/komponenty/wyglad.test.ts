import { beforeEach, describe, expect, it, vi } from "vitest";
import { sklep } from "../sklep";
import { api } from "../api";
import { DOMYSLNY, ID_MOTYWOW, doKonfigu, doPliku, ustawStan, wczytaj, zKonfigu, zPliku } from "../motywy";
import { sekcjaMotywow } from "./wyglad";
import type { Konfig } from "../typy";

const konfig = (): Konfig => ({
  jezyk: "pl", motyw: "dark", rownolegle: 2, rownolegle_wideo: 1, niski_priorytet: false,
  katalog_wyjscia: null, katalog_pobierania: null, schowek: true,
  sciezki: { ffmpeg: null, ffprobe: null, ytdlp: null, deno: null }, kreator_zakonczony: true,
  motyw_wyglad: "blackwall", wlasne_motywy: [], ostatnie_foldery: [], tryb: "pelny", podpowiedz_prosty_pokazana: true,
  skala: 1, motyw_wlasny: null,
});

describe("DNA 2.0: motywy w konfigu i migracja starych", () => {
  it("domyślnie Blackwall; nieznany id → Blackwall z zapisem", () => {
    expect(DOMYSLNY).toBe("blackwall");
    expect(zKonfigu(null)).toEqual({ motyw: "blackwall", wlasny: null, zmieniony: false });
    expect(zKonfigu({ motyw_wyglad: "nie-ma", wlasne_motywy: [] })).toMatchObject({ motyw: "blackwall", zmieniony: true });
    expect(zKonfigu({ motyw_wyglad: "citypop", wlasne_motywy: [] })).toEqual({ motyw: "citypop", wlasny: null, zmieniony: false });
  });

  it("stare motywy 1.2–1.4 przechodzą na najbliższy nowy", () => {
    const m = (id: string) => zKonfigu({ motyw_wyglad: id, wlasne_motywy: [] });
    expect(["sora-a", "sora-b", "sora-c", "jp-a", "jp-b", "jp-c"].map((id) => m(id).motyw)).toEqual(["blackwall", "blackwall", "blackwall", "kissaten", "citypop", "minidisc"]);
    expect(m("jp-b").zmieniony).toBe(true);
  });

  it("stary własny motyw (baza + kolory) → „Własny” z jego akcentem; stare dane zostają w konfigu", () => {
    const stary = { id: "wlasny-1", nazwa: "Mój", baza: "jp-a", jasny: { akcent: "#123456" }, ciemny: { akcent: "#FF7AC6", tlo: "#000000" } };
    const s = zKonfigu({ motyw_wyglad: "wlasny-1", wlasne_motywy: [stary, 5] });
    expect(s).toEqual({ motyw: "wlasny", wlasny: { akcent: "#ff7ac6", baza: "kissaten" }, zmieniony: true });
    // doKonfigu nie rusza `wlasne_motywy` (powrót do 1.4 nic nie gubi)
    expect(doKonfigu(s)).toEqual({ motyw_wyglad: "wlasny", motyw_wlasny: { akcent: "#ff7ac6", baza: "kissaten" } });
    // „wlasny” bez danych → Blackwall
    expect(zKonfigu({ motyw_wyglad: "wlasny", wlasne_motywy: [], motyw_wlasny: { akcent: "zly" } as never }).motyw).toBe("blackwall");
  });

  it("eksport i import .json (2.0 i stary eksport 1.x)", () => {
    const w = { akcent: "#5ee0c4", baza: "minidisc" as const };
    expect(zPliku(doPliku(w))).toEqual(w);
    expect(zPliku('{"soraconverter_motyw":1,"nazwa":"x","baza":"jp-b","jasny":{},"ciemny":{"akcent":"#4CC2FF"}}')).toEqual({ akcent: "#4cc2ff", baza: "citypop" });
    expect(zPliku("nie json")).toBeNull();
    expect(zPliku('{"akcent":"czerwony"}')).toBeNull();
  });
});

describe("usterka 5: motyw nie zmienia się od przypadkowych klawiszy", () => {
  let zapisane: Konfig[] = [];
  beforeEach(() => {
    zapisane = [];
    vi.spyOn(api, "konfigZapisz").mockImplementation(async (k) => void zapisane.push(k));
    sklep.ustaw({ konfig: konfig() });
    ustawStan(zKonfigu(sklep.stan.konfig));
    document.body.replaceChildren(sekcjaMotywow());
  });

  it("klik kafla zapisuje motyw w konfigu", () => {
    document.querySelector<HTMLButtonElement>('[data-motyw="citypop"]')!.click();
    expect(wczytaj().motyw).toBe("citypop");
    expect(zapisane.at(-1)?.motyw_wyglad).toBe("citypop");
    expect(sklep.stan.konfig?.motyw_wyglad).toBe("citypop");
    expect(document.documentElement.dataset.motyw).toBe("citypop");
  });

  it("strzałki w siatce kafli przesuwają tylko fokus, nic nie zapisują", () => {
    const grupa = document.querySelector<HTMLElement>(".motywy")!;
    expect(grupa.getAttribute("role")).toBe("group");
    document.querySelector<HTMLButtonElement>('[data-motyw="blackwall"]')!.focus();
    for (const key of ["ArrowRight", "ArrowRight", "ArrowDown", "End", "ArrowLeft"]) {
      document.activeElement!.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
    }
    expect((document.activeElement as HTMLElement).dataset.motyw).toBe("neon");
    expect(wczytaj().motyw).toBe("blackwall");
    expect(zapisane).toEqual([]);
    expect(document.querySelectorAll('.kafel-motywu[tabindex="0"]').length).toBe(1);
  });

  it("„Własny”: kolor, baza i szybkie akcenty zapisują motyw_wlasny", () => {
    document.querySelector<HTMLButtonElement>('[data-motyw="wlasny"]')!.click();
    expect(wczytaj()).toEqual({ motyw: "wlasny", wlasny: { akcent: "#ff7ac6", baza: "neon" } });
    const kolor = document.querySelector<HTMLInputElement>('input[type="color"]')!;
    kolor.value = "#4cc2ff";
    kolor.dispatchEvent(new Event("change"));
    expect(zapisane.at(-1)?.motyw_wlasny).toEqual({ akcent: "#4cc2ff", baza: "neon" });
    const baza = document.querySelector<HTMLSelectElement>(".grupa-d select")!;
    baza.value = "kissaten";
    baza.dispatchEvent(new Event("change"));
    expect(zapisane.at(-1)?.motyw_wlasny).toEqual({ akcent: "#4cc2ff", baza: "kissaten" });
    document.querySelector<HTMLButtonElement>('.kropka-akcentu[aria-label="Akcent #5ee0c4"]')!.click();
    expect(zapisane.at(-1)?.motyw_wlasny).toEqual({ akcent: "#5ee0c4", baza: "kissaten" });
  });

  it("tryb jasny/ciemny/system i skala w jednym miejscu", async () => {
    const skala = vi.spyOn(api, "ustawSkale").mockImplementation(async (s) => s);
    document.querySelector<HTMLButtonElement>('.tryb-jasnosci [data-wartosc="light"]')!.click();
    expect(zapisane.at(-1)?.motyw).toBe("light");
    document.querySelector<HTMLButtonElement>('.skala-seg [data-wartosc="1.25"]')!.click();
    await new Promise((r) => setTimeout(r, 0));
    expect(skala).toHaveBeenCalledWith(1.25);
    expect(sklep.stan.konfig?.skala).toBe(1.25);
  });
});

describe("P8: kafle motywów dla czytników ekranu", () => {
  beforeEach(() => {
    vi.spyOn(api, "konfigZapisz").mockImplementation(async () => undefined);
  });

  for (const tryb of ["dark", "light"] as const) {
    it(`6 motywów, tryb ${tryb}: przycisk z aria-pressed, wybrany oznaczony nie tylko kolorem`, () => {
      sklep.ustaw({ konfig: { ...konfig(), motyw: tryb } });
      ustawStan(zKonfigu(sklep.stan.konfig));
      document.body.replaceChildren(sekcjaMotywow());
      expect(ID_MOTYWOW).toHaveLength(6);
      for (const id of ID_MOTYWOW) {
        document.querySelector<HTMLButtonElement>(`[data-motyw="${id}"]`)!.click();
        const kafle = [...document.querySelectorAll<HTMLButtonElement>(".kafel-motywu")];
        expect(kafle).toHaveLength(6);
        for (const k of kafle) {
          const wybrany = k.dataset.motyw === id;
          expect(k.tagName).toBe("BUTTON");
          expect(k.getAttribute("role")).toBeNull();
          expect(k.getAttribute("aria-pressed"), `${tryb} ${id} → ${k.dataset.motyw}`).toBe(String(wybrany));
          expect(k.querySelector(".wybrany-znak")?.textContent ?? null).toBe(wybrany ? "Wybrany" : null);
          expect(k.getAttribute("tabindex")).toBe(wybrany ? "0" : "-1");
        }
      }
    });
  }
});

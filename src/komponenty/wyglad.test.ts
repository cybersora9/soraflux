import { beforeEach, describe, expect, it, vi } from "vitest";
import { sklep } from "../sklep";
import { api } from "../api";
import { DOMYSLNY, ustawStan, wczytaj, zKonfigu, doKonfigu, WBUDOWANE } from "../motywy";
import { sekcjaMotywow } from "./wyglad";
import type { Konfig } from "../typy";

const konfig = (): Konfig => ({
  jezyk: "pl", motyw: "dark", rownolegle: 2, rownolegle_wideo: 1, niski_priorytet: false,
  katalog_wyjscia: null, katalog_pobierania: null, schowek: true,
  sciezki: { ffmpeg: null, ffprobe: null, ytdlp: null, deno: null }, kreator_zakonczony: true,
  motyw_wyglad: "sora-a", wlasne_motywy: [], ostatnie_foldery: [],
});

describe("motywy w konfigu (nie localStorage)", () => {
  it("domyślnie Kissaten · cybersora; nieznany id → domyślny; uszkodzone własne pomijane", () => {
    expect(DOMYSLNY).toBe("sora-a");
    expect(WBUDOWANE.find((m) => m.id === DOMYSLNY)?.nazwa).toBe("Kissaten · cybersora");
    expect(zKonfigu(null)).toEqual({ motyw: "sora-a", wlasne: [] });
    expect(zKonfigu({ motyw_wyglad: "nie-ma", wlasne_motywy: [] }).motyw).toBe("sora-a");
    const w = { id: "wlasny-1", nazwa: "Mój", baza: "jp-b", jasny: {}, ciemny: {} };
    const s = zKonfigu({ motyw_wyglad: "wlasny-1", wlasne_motywy: [w, 5, { id: 1 }] });
    expect(s).toEqual({ motyw: "wlasny-1", wlasne: [w] });
    expect(doKonfigu(s)).toEqual({ motyw_wyglad: "wlasny-1", wlasne_motywy: [w] });
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
    document.querySelector<HTMLButtonElement>('[data-motyw="jp-b"]')!.click();
    expect(wczytaj().motyw).toBe("jp-b");
    expect(zapisane.at(-1)?.motyw_wyglad).toBe("jp-b");
    expect(sklep.stan.konfig?.motyw_wyglad).toBe("jp-b");
  });

  it("strzałki w siatce kafli przesuwają tylko fokus, nic nie zapisują", () => {
    const grupa = document.querySelector<HTMLElement>(".motywy")!;
    expect(grupa.getAttribute("role")).toBe("radiogroup");
    const pierwszy = document.querySelector<HTMLButtonElement>('[data-motyw="sora-a"]')!;
    pierwszy.focus();
    for (const key of ["ArrowRight", "ArrowRight", "ArrowDown", "End", "ArrowLeft"]) {
      document.activeElement!.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
    }
    expect((document.activeElement as HTMLElement).dataset.motyw).toBe("jp-b");
    expect(wczytaj().motyw).toBe("sora-a");
    expect(zapisane).toEqual([]);
    // tylko jeden kafel w kolejności Tab
    expect(document.querySelectorAll('.motyw-kafel[tabindex="0"]').length).toBe(1);
  });
});

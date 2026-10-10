// S5 tryb Napisy w widoku Prostym (jsdom + atrapa api): zgoda przed pobraniem modelu, zadanie „napisy”
// w kolejce, obsługa klawiaturą (kafle, chipy, pola wyboru to natywne przyciski i pola).
import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "../api";
import { ustawJezyk } from "../i18n";
import { stworzWidokProsty } from "./prosty";
import type { NoweZadanie, StanNapisow } from "../typy";

const czekaj = async (warunek: () => boolean, ms = 3000) => {
  const start = Date.now();
  while (!warunek()) {
    if (Date.now() - start > ms) throw new Error("warunek nie spełniony");
    await new Promise((r) => setTimeout(r, 20));
  }
};

const stan = (pobrany: boolean, whisper: string | null = "C:/narzedzia/whisper-cli.exe"): StanNapisow => ({
  whisper, katalog_modeli: "C:/dane/modele", ram_mb: 16_000, wolne_ram_mb: 8_000, pobieranie_trwa: false,
  modele: [{ model: "base", plik: "ggml-base.bin", rozmiar_mb: 142, ram_mb: 500, pobrany, czesciowy_b: null, do_pobrania: true, ostrzezenie_ram: null }],
});

async function widokZNapisami(s: StanNapisow) {
  vi.spyOn(api, "napisyStan").mockResolvedValue(s);
  const w = stworzWidokProsty({ doPelnego: () => undefined });
  document.body.replaceChildren(w.el);
  await w.dodaj(["C:/Wideo/rolka.mp4"]);
  await czekaj(() => !!w.el.querySelector('[data-akcja-prosta="napisy"]'));
  w.el.querySelector<HTMLButtonElement>('[data-akcja-prosta="napisy"]')!.click();
  await czekaj(() => !!w.el.querySelector(".prosty-napisy"));
  await czekaj(() => !w.el.querySelector<HTMLButtonElement>('[data-fokus="start"]')!.disabled);
  return w;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("widok Prosty: napisy", () => {
  it("model do pobrania: nic nie idzie do sieci przed kliknięciem zgody", async () => {
    ustawJezyk("pl");
    const pobierz = vi.spyOn(api, "napisyPobierzModel").mockResolvedValue(stan(true));
    const dodaj = vi.spyOn(api, "dodajZadania").mockResolvedValue([901]);
    const w = await widokZNapisami(stan(false));
    const start = w.el.querySelector<HTMLButtonElement>('[data-fokus="start"]')!;
    expect(start.textContent).toBe("Pobierz model (142 MB) i zrób napisy");
    start.click();
    expect(pobierz).not.toHaveBeenCalled();
    const zgoda = w.el.querySelector(".prosty-zgoda")!;
    expect(zgoda.textContent).toContain("huggingface.co");
    expect(zgoda.textContent).toContain("142 MB");
    // fokus na decyzji, „Nie teraz” chowa okno bez pobierania
    expect(document.activeElement?.getAttribute("data-fokus")).toBe("zgoda-tak");
    w.el.querySelector<HTMLButtonElement>('[data-fokus="zgoda-nie"]')!.click();
    expect(w.el.querySelector(".prosty-zgoda")).toBeNull();
    expect(pobierz).not.toHaveBeenCalled();
    // zgoda → pobranie z `zgoda: true`, potem od razu zadanie napisów
    w.el.querySelector<HTMLButtonElement>('[data-fokus="start"]')!.click();
    w.el.querySelector<HTMLButtonElement>('[data-fokus="zgoda-tak"]')!.click();
    await czekaj(() => dodaj.mock.calls.length > 0);
    expect(pobierz).toHaveBeenCalledWith("base", true);
    const z = dodaj.mock.calls[0][0][0] as NoweZadanie;
    expect(z.rodzaj).toMatchObject({ typ: "napisy", wejscie: "C:/Wideo/rolka.mp4", opcje: { jezyk: "auto", model: "base", srt: true } });
    expect(z.dopisek).toBe("z napisami");
  });

  it("opcje klawiaturą: język, VTT, wypalanie trafiają do zadania", async () => {
    ustawJezyk("en");
    const dodaj = vi.spyOn(api, "dodajZadania").mockResolvedValue([902]);
    const w = await widokZNapisami(stan(true));
    // wszystkie kontrolki to natywne przyciski / pola wyboru (Tab + Enter/Spacja)
    const kontrolki = [...w.el.querySelectorAll<HTMLElement>(".prosty-napisy button, .prosty-napisy input")];
    expect(kontrolki.length).toBeGreaterThan(8);
    expect(kontrolki.every((k) => k.tabIndex >= 0)).toBe(true);
    const pl = w.el.querySelector<HTMLButtonElement>('[data-fokus="jezyk-1"]')!;
    expect(pl.textContent).toBe("Polish");
    pl.click();
    expect(w.el.querySelector('[data-fokus="jezyk-1"]')!.getAttribute("aria-pressed")).toBe("true");
    const vtt = w.el.querySelector<HTMLInputElement>('[data-fokus="vtt"]')!;
    vtt.checked = true;
    vtt.dispatchEvent(new Event("change"));
    w.el.querySelector<HTMLButtonElement>('[data-fokus="wypal-1"]')!.click();
    expect(w.el.querySelector('[data-akcja-prosta="napisy"] .prosty-akcja-wynik')!.textContent).toBe("SRT · VTT · MP4");
    const start = w.el.querySelector<HTMLButtonElement>('[data-fokus="start"]')!;
    expect(start.textContent).toBe("Make subtitles");
    expect(w.el.querySelector(".prosty-wiecej")).toBeNull();
    start.click();
    await czekaj(() => dodaj.mock.calls.length > 0);
    expect((dodaj.mock.calls[0][0][0] as NoweZadanie).rodzaj).toMatchObject({ typ: "napisy", opcje: { jezyk: "pl", vtt: true, srt: true, wypal: "rolki" } });
    expect((dodaj.mock.calls[0][0][0] as NoweZadanie).dopisek).toBe("subtitled");
  });

  it("brak whisper-cli: przycisk wyłączony, droga do Ustawień", async () => {
    ustawJezyk("pl");
    vi.spyOn(api, "napisyStan").mockResolvedValue(stan(true, null));
    const w = stworzWidokProsty({ doPelnego: () => undefined });
    document.body.replaceChildren(w.el);
    await w.dodaj(["C:/Wideo/rolka.mp4"]);
    await czekaj(() => !!w.el.querySelector('[data-akcja-prosta="napisy"]'));
    w.el.querySelector<HTMLButtonElement>('[data-akcja-prosta="napisy"]')!.click();
    await czekaj(() => !!w.el.querySelector('[data-fokus="do-ustawien"]'));
    expect(w.el.querySelector<HTMLButtonElement>('[data-fokus="start"]')!.disabled).toBe(true);
    expect(w.el.querySelector(".prosty-napisy")!.textContent).toContain("whisper.cpp");
  });
});

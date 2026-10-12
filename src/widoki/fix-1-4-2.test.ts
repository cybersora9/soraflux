// Poprawki z testu na żywo 1.4.1 (N1, N2, N4): przejścia stanu w widoku Konwertuj na atrapie backendu.
import { describe, expect, it } from "vitest";
import { profilDla, profilSzybkiejAkcji, zdejmijLimitAkcji } from "../logika";
import { stworzWidokPlikowy } from "./plikowy";

const czekaj = (ms: number) => new Promise((r) => setTimeout(r, ms));
const chip = (el: HTMLElement, nazwa: string) => [...el.querySelectorAll<HTMLButtonElement>(".formaty .chip")].find((b) => b.textContent === nazwa)!;

describe("N4: format po „Zmniejsz do X MB” zdejmuje limit", () => {
  const limit = profilSzybkiejAkcji("rozmiar", profilDla("mp4"), { mb: 10 });
  it("zmiana kontenera przy jakości rozmiar_mb wraca do CRF", () => {
    const mkv = { ...limit, kontener: "mkv" as const };
    expect(zdejmijLimitAkcji(limit, mkv).wideo?.jakosc).toEqual({ typ: "crf", crf: 23 });
  });
  it("ten sam kontener (własny limit w panelu) zostaje bez zmian", () => {
    const inny = { ...limit, wideo: { ...limit.wideo!, jakosc: { typ: "rozmiar_mb" as const, mb: 5 } } };
    expect(zdejmijLimitAkcji(limit, inny)).toBe(inny);
  });
  it("na żywo: mały plik + „Zmniejsz do 10 MB” + MKV nie jest pomijany jako „już się mieści”", async () => {
    const w = stworzWidokPlikowy("konwertuj");
    document.body.replaceChildren(w.el);
    await w.dodaj(["C:/Wideo/nowy-maly.mp4"]);
    w.el.querySelector<HTMLButtonElement>('[data-akcja="rozmiar"]')!.click();
    await czekaj(400);
    expect(w.el.textContent).toMatch(/już się mieści/i);
    chip(w.el, "MKV").click();
    await czekaj(400);
    expect(w.el.textContent).not.toMatch(/już się mieści/i);
    expect(w.el.querySelector('[data-akcja="rozmiar"]')!.getAttribute("aria-pressed")).toBe("false");
  });
});

describe("N1: „Dokładnie” rozwija Zaawansowane z polami od–do", () => {
  it("po włączeniu przełącznika sekcja jest otwarta i widać pola czasu", async () => {
    const w = stworzWidokPlikowy("konwertuj");
    document.body.replaceChildren(w.el);
    await w.dodaj(["C:/Wideo/jedna-klatka.mp4"]);
    w.el.querySelector<HTMLButtonElement>('[data-akcja="wytnij"]')!.click();
    expect(w.el.querySelector<HTMLDetailsElement>(".zaawansowane")!.open).toBe(false);
    const input = [...w.el.querySelectorAll<HTMLElement>(".wytnij-opcje .przelacznik")].find((x) => x.textContent?.includes("Dokładnie (ponowne kodowanie)"))!.querySelector<HTMLInputElement>("input")!;
    input.checked = true;
    input.dispatchEvent(new Event("change"));
    expect(w.el.querySelector<HTMLDetailsElement>(".zaawansowane")!.open).toBe(true);
    expect(w.el.querySelectorAll(".zaawansowane input.czas").length).toBe(2);
  });
});

describe("N2: pole „Zmniejsz do X MB” mieści 4 cyfry", () => {
  it("szerokość pola co najmniej 5.5em (4000 + sufiks nie jest obcinane)", async () => {
    const w = stworzWidokPlikowy("konwertuj");
    document.body.replaceChildren(w.el);
    await w.dodaj(["C:/Wideo/a.mp4"]);
    const pole = w.el.querySelector<HTMLInputElement>('.akcja:has([data-akcja="rozmiar"]) input')!;
    expect(parseFloat(pole.style.width || pole.parentElement!.style.width || "0")).toBeGreaterThanOrEqual(5.5);
  });
});

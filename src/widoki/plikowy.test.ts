// Widok Konwertuj na atrapie backendu (bez Tauri): przejścia stanu, które psuły wyniki w teście na żywo 1.4.0.
import { describe, expect, it } from "vitest";
import { stworzWidokPlikowy } from "./plikowy";

const czekaj = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("P2: fragment od–do nie przechodzi na kolejne pliki", () => {
  it("nowe pliki i szybka akcja kasują fragment ustawiony wcześniej", async () => {
    const w = stworzWidokPlikowy("konwertuj");
    document.body.replaceChildren(w.el);
    await w.dodaj(["C:/Wideo/stary.mp4"]);
    // użytkownik ustawia 00:06–00:20 w Zaawansowanych
    const pola = () => [...w.el.querySelectorAll<HTMLInputElement>(".zaawansowane input.czas")];
    pola()[0].value = "00:06";
    pola()[0].dispatchEvent(new Event("change"));
    pola()[1].value = "00:20";
    pola()[1].dispatchEvent(new Event("change"));
    expect(w.el.querySelector(".plakietka-ciecie")?.textContent).toBe("Fragment 00:06–00:20");
    // nowy plik: pola puste, plakietki nie ma
    await w.dodaj(["C:/Wideo/nowy-maly.mp4"]);
    await czekaj(50);
    expect(pola().map((p) => p.value)).toEqual(["", ""]);
    expect(w.el.querySelector(".plakietka-ciecie")).toBeNull();
    // fragment ustawiony znowu, potem „Zmniejsz do 10 MB” → bez fragmentu
    pola()[0].value = "00:02";
    pola()[0].dispatchEvent(new Event("change"));
    w.el.querySelector<HTMLButtonElement>('[data-akcja="rozmiar"]')!.click();
    await czekaj(50);
    expect(pola().map((p) => p.value)).toEqual(["", ""]);
    expect(w.el.querySelector(".plakietka-ciecie")).toBeNull();
    // „Wytnij fragment” zostawia to, co wpisane
    pola()[0].value = "00:02";
    pola()[0].dispatchEvent(new Event("change"));
    w.el.querySelector<HTMLButtonElement>('[data-akcja="wytnij"]')!.click();
    await czekaj(50);
    expect(w.el.querySelector<HTMLInputElement>("input.czas")!.value).toBe("00:02");
  });

  it("„Wyczyść” kasuje fragment", async () => {
    const w = stworzWidokPlikowy("konwertuj");
    document.body.replaceChildren(w.el);
    await w.dodaj(["C:/Wideo/a.mp4"]);
    const pole = w.el.querySelector<HTMLInputElement>(".zaawansowane input.czas")!;
    pole.value = "00:06";
    pole.dispatchEvent(new Event("change"));
    expect(w.el.querySelector(".plakietka-ciecie")).not.toBeNull();
    [...w.el.querySelectorAll<HTMLButtonElement>(".pliki-naglowek button")].find((b) => b.textContent === "Wyczyść")!.click();
    expect(w.el.querySelector(".plakietka-ciecie")).toBeNull();
  });
});

// P9 z testu na żywo 1.4.0: „Wytnij fragment bez ponownego kodowania” na pliku z jedną klatką kluczową
// dało 5,09 s zamiast 3 s (02–05) i cały plik 8,02 s (06–20) ze stanem „Gotowe”, a pomoc obiecywała
// przesunięcie o „ułamek sekundy”.
import { describe, expect, it } from "vitest";
import pl from "./i18n/pl.json";
import en from "./i18n/en.json";
import { formatujSekundy, profilDla, profilSzybkiejAkcji } from "./logika";
import { opisOstrzezenia } from "./widoki/kolejka";
import { stworzWidokPlikowy } from "./widoki/plikowy";
import type { InfoZadania } from "./typy";

describe("P9: dwa tryby cięcia", () => {
  const obecny = { ...profilDla("mp4"), ciecie: { od: 2, koniec: 5 } };
  it("bez ponownego kodowania (domyślnie): kopia strumieni w kontenerze źródła", () => {
    const p = profilSzybkiejAkcji("wytnij", obecny, { zrodlo: "C:/a/film.mp4" });
    expect(p.kontener).toBe("mp4");
    expect(p.wideo?.kodek).toBe("kopiuj");
    expect(p.audio?.kodek).toBe("kopiuj");
    expect(p.ciecie).toEqual({ od: 2, koniec: 5 });
  });
  it("„Dokładnie”: ponowne kodowanie zgodne z kontenerem, CRF 18", () => {
    const p = profilSzybkiejAkcji("wytnij", obecny, { zrodlo: "C:/a/film.mp4", dokladnie: true });
    expect(p.wideo?.kodek).toBe("h264");
    expect(p.wideo?.jakosc).toEqual({ typ: "crf", crf: 18 });
    expect(p.audio?.kodek).toBe("aac");
    expect(p.ciecie).toEqual({ od: 2, koniec: 5 });
    const w = profilSzybkiejAkcji("wytnij", obecny, { zrodlo: "C:/a/film.webm", dokladnie: true });
    expect([w.kontener, w.wideo?.kodek, w.audio?.kodek]).toEqual(["webm", "vp9", "opus"]);
  });
});

describe("P9: ostrzeżenie i pomoc mówią prawdę", () => {
  it("„Wynik trwa 5,1 s zamiast 3 s: …klatce kluczowej”", () => {
    expect(formatujSekundy(5.09)).toBe("5,1 s");
    expect(formatujSekundy(3)).toBe("3 s");
    expect(formatujSekundy(8.02, "en")).toBe("8 s");
    const z = { ostrzezenie: { typ: "niedokladne_ciecie", wynik_s: 5.09, oczekiwane_s: 3 } } as InfoZadania;
    expect(opisOstrzezenia(z)).toMatch(/^Wynik trwa 5,1 s zamiast 3 s: cięcie bez ponownego kodowania zaczyna się na klatce kluczowej/);
  });
  it("żaden tekst nie obiecuje „ułamka sekundy” (PL i EN)", () => {
    for (const s of [pl, en] as Record<string, string>[]) {
      for (const [k, v] of Object.entries(s)) expect(v, k).not.toMatch(/ułamek sekundy|fraction of a second/i);
    }
  });
  it("przełącznik „Dokładnie (ponowne kodowanie)” obok akcji, domyślnie wyłączony, zmienia profil", async () => {
    const w = stworzWidokPlikowy("konwertuj");
    document.body.replaceChildren(w.el);
    await w.dodaj(["C:/Wideo/jedna-klatka.mp4"]);
    w.el.querySelector<HTMLButtonElement>('[data-akcja="wytnij"]')!.click();
    const przel = () => [...w.el.querySelectorAll<HTMLElement>(".wytnij-opcje .przelacznik")].find((x) => x.textContent?.includes("Dokładnie (ponowne kodowanie)"))!;
    const input = przel().querySelector<HTMLInputElement>("input")!;
    expect(input.checked).toBe(false);
    const kodek = () => [...w.el.querySelectorAll<HTMLSelectElement>(".panel-ustawien select")].map((s) => s.selectedOptions[0]?.textContent ?? "").join(" | ");
    expect(w.el.textContent).toContain(pl["akcje.wytnij.pomoc"]);
    expect(kodek()).toMatch(/Kopiuj/);
    input.checked = true;
    input.dispatchEvent(new Event("change"));
    expect(przel().querySelector<HTMLInputElement>("input")!.checked).toBe(true);
    expect(w.el.textContent).toContain(pl["akcje.wytnij.pomoc_dokladnie"]);
    expect(kodek()).not.toMatch(/Kopiuj/);
  });
});

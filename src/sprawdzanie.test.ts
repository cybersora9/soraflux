// P6 z testu na żywo 1.4.0: karta 404 dla poprzedniego linku zostawała po wpisaniu „abc to nie jest link”
// i kliknięciu „Sprawdź” (dymek „Nie widzę żadnego linku”, ale stary wynik dalej na ekranie).
import { describe, expect, it } from "vitest";
import { doPobrania, POCZATEK, sprawdzanie, type StanSprawdzania } from "./sprawdzanie";
import { stworzWidokPobierania } from "./widoki/pobierz";
import { sklep } from "./sklep";
import type { Info } from "./typy";

const najlepsza = { typ: "najlepsza" } as const;
const info = { typ: "film", tytul: "x" } as Info;

describe("P6: reduktor wyników „Sprawdź”", () => {
  it("„Sprawdź” bez linku czyści poprzednie wyniki", () => {
    let s = sprawdzanie(POCZATEK, { typ: "sprawdz", tekst: "https://example.com/nie-ma", wybor: najlepsza });
    s = sprawdzanie(s, { typ: "wynik", pokolenie: s.pokolenie, url: "https://example.com/nie-ma", blad: "404" });
    expect(s.wyniki).toHaveLength(1);
    s = sprawdzanie(s, { typ: "sprawdz", tekst: "abc to nie jest link", wybor: najlepsza });
    expect(s.wyniki).toEqual([]);
  });

  it("edycja pola oznacza jako nieaktualne wyniki, których linku już nie ma", () => {
    let s = sprawdzanie(POCZATEK, { typ: "sprawdz", tekst: "https://example.com/a https://example.com/b", wybor: najlepsza });
    s = sprawdzanie(s, { typ: "wynik", pokolenie: s.pokolenie, url: "https://example.com/a", info });
    s = sprawdzanie(s, { typ: "wynik", pokolenie: s.pokolenie, url: "https://example.com/b", info });
    expect(doPobrania(s).map((w) => w.url)).toEqual(["https://example.com/a", "https://example.com/b"]);
    s = sprawdzanie(s, { typ: "edycja", tekst: "https://example.com/a abc" });
    expect(s.wyniki.map((w) => w.nieaktualny)).toEqual([false, true]);
    expect(doPobrania(s).map((w) => w.url)).toEqual(["https://example.com/a"]);
    // powrót linku do pola: znów aktualny; edycja bez zmian nie tworzy nowego stanu
    s = sprawdzanie(s, { typ: "edycja", tekst: "https://example.com/a https://example.com/b" });
    expect(s.wyniki.every((w) => !w.nieaktualny)).toBe(true);
    expect(sprawdzanie(s, { typ: "edycja", tekst: "https://example.com/a https://example.com/b" })).toBe(s);
  });

  it("spóźniona odpowiedź z poprzedniego sprawdzenia nie wraca na ekran", () => {
    let s: StanSprawdzania = sprawdzanie(POCZATEK, { typ: "sprawdz", tekst: "https://example.com/stary", wybor: najlepsza });
    const stare = s.pokolenie;
    s = sprawdzanie(s, { typ: "sprawdz", tekst: "https://example.com/nowy", wybor: najlepsza });
    s = sprawdzanie(s, { typ: "wynik", pokolenie: stare, url: "https://example.com/stary", blad: "404" });
    expect(s.wyniki.map((w) => [w.url, w.blad])).toEqual([["https://example.com/nowy", null]]);
  });
});

describe("P6: zakładka Pobierz", () => {
  const czekaj = (ms: number) => new Promise((r) => setTimeout(r, ms));
  it("404, potem „abc to nie jest link” + Sprawdź: stara karta znika", async () => {
    const w = stworzWidokPobierania();
    document.body.replaceChildren(w.el);
    const pole = () => w.el.querySelector<HTMLTextAreaElement>(".pole-url")!;
    pole().value = "https://example.com/nie-ma";
    pole().dispatchEvent(new Event("input"));
    w.el.querySelector<HTMLButtonElement>(".przycisk-sprawdz")!.click();
    await czekaj(500);
    expect(w.el.querySelectorAll(".film")).toHaveLength(1);
    expect(w.el.querySelector(".film .blad-tekst")?.textContent).toContain("404");
    // edycja: karta od razu oznaczona jako nieaktualna
    pole().value = "abc to nie jest link";
    pole().dispatchEvent(new Event("input"));
    expect(w.el.querySelector(".film")?.classList.contains("film-nieaktualny")).toBe(true);
    expect(document.activeElement).toBe(pole());
    w.el.querySelector<HTMLButtonElement>(".przycisk-sprawdz")!.click();
    await czekaj(10);
    expect(w.el.querySelectorAll(".film")).toHaveLength(0);
    expect(sklep.stan.dymek?.tekst).toBe("Nie widzę żadnego linku http(s).");
  });
});

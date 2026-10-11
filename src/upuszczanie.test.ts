// P3 z testu na żywo 1.4.0: tekst.txt upuszczony na Konwertuj i film na Obrazy znikały bez śladu
// (bez listy i bez dymku, sprawdzane po 0,1/0,6/1,5/3 s).
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import pl from "./i18n/pl.json";
import en from "./i18n/en.json";
import { klasyfikujUpuszczone, komunikatPominietych, ROZSZERZENIA_MEDIOW } from "./upuszczanie";
import { stworzWidokPlikowy } from "./widoki/plikowy";
import { sklep } from "./sklep";
import { t } from "./i18n";

describe("P3: klasyfikator upuszczonych plików", () => {
  it("tekst.txt na Konwertuj: pominięty z powodem „format”", () => {
    expect(klasyfikujUpuszczone(["C:/a/tekst.txt"], [], "konwertuj")).toEqual({ przyjete: [], pominiete: [{ sciezka: "C:/a/tekst.txt", powod: "format" }] });
  });
  it("film na Obrazy: pominięty z powodem „nie_obraz”; GIF i zdjęcia przyjęte", () => {
    const w = ["C:/a/film.mp4", "C:/a/piosenka.mp3", "C:/a/zdj.jpg", "C:/a/anim.gif"];
    const r = klasyfikujUpuszczone(w, w, "obrazy");
    expect(r.przyjete).toEqual(["C:/a/zdj.jpg", "C:/a/anim.gif"]);
    expect(r.pominiete).toEqual([
      { sciezka: "C:/a/film.mp4", powod: "nie_obraz" },
      { sciezka: "C:/a/piosenka.mp3", powod: "nie_obraz" },
    ]);
  });
  it("mieszana paczka: obsługiwane przyjęte, reszta wymieniona", () => {
    const r = klasyfikujUpuszczone(["C:\\a\\film.mkv", "C:\\a\\notatki.docx", "C:\\a\\Wakacje", "C:\\a\\Pusty"], ["C:\\a\\film.mkv", "C:\\a\\Wakacje\\plaza.mp4"], "konwertuj");
    expect(r.przyjete).toEqual(["C:\\a\\film.mkv", "C:\\a\\Wakacje\\plaza.mp4"]);
    expect(r.pominiete).toEqual([
      { sciezka: "C:\\a\\notatki.docx", powod: "format" },
      { sciezka: "C:\\a\\Pusty", powod: "brak_mediow" },
    ]);
    // folder „Wakacje” nie łapie się na plik z folderu „Wakacje 2”
    expect(klasyfikujUpuszczone(["/x/Wakacje"], ["/x/Wakacje 2/a.mp4"], "prosty").pominiete).toEqual([{ sciezka: "/x/Wakacje", powod: "brak_mediow" }]);
  });
  it("lista rozszerzeń zgodna z ROZSZERZENIA_MEDIOW w komendy.rs", () => {
    const rs = readFileSync(join(__dirname, "../src-tauri/src/komendy.rs"), "utf8");
    const blok = /ROZSZERZENIA_MEDIOW: &\[&str\] = &\[([\s\S]*?)\];/.exec(rs)![1];
    expect([...blok.matchAll(/"(\w+)"/g)].map((m) => m[1])).toEqual(ROZSZERZENIA_MEDIOW);
  });
});

describe("P3: treść dymku", () => {
  it("„Pominięto 1 plik: nieobsługiwany format (tekst.txt)”", () => {
    const k = komunikatPominietych([{ sciezka: "C:/a/tekst.txt", powod: "format" }])!;
    expect(t(k.klucz, { ...k.parametry, powod: t(String(k.parametry.powod)) })).toBe("Pominięto 1 plik: nieobsługiwany format (tekst.txt)");
    expect(k.doKonwertuj).toEqual([]);
  });
  it("same wideo/audio na Obrazach: osobny komunikat z przejściem do Konwertuj", () => {
    const k = komunikatPominietych([{ sciezka: "C:/a/film.mp4", powod: "nie_obraz" }])!;
    expect(t(k.klucz)).toBe("To nie obrazy. Wideo i audio konwertuj w zakładce Konwertuj");
    expect(k.doKonwertuj).toEqual(["C:/a/film.mp4"]);
  });
  it("liczba mnoga i skrót listy nazw", () => {
    const p = ["a.txt", "b.txt", "c.txt", "d.txt", "e.txt"].map((s) => ({ sciezka: `/x/${s}`, powod: "format" as const }));
    const k = komunikatPominietych(p)!;
    expect(k.klucz).toBe("upusc.pominieto_wiele");
    expect(k.parametry.nazwy).toBe("a.txt, b.txt, c.txt…");
    expect(komunikatPominietych(p.slice(0, 2))!.klucz).toBe("upusc.pominieto_kilka");
    expect(komunikatPominietych([])).toBeNull();
  });
  it("klucze są w PL i EN", () => {
    for (const k of ["upusc.pominieto_1", "upusc.pominieto_kilka", "upusc.pominieto_wiele", "upusc.nie_obrazy", "upusc.do_konwertuj", "upusc.powod.format", "upusc.powod.nie_obraz", "upusc.powod.brak_mediow", "upusc.powod.rozne"]) {
      expect(pl, k).toHaveProperty([k]);
      expect(en, k).toHaveProperty([k]);
    }
  });
});

describe("P3: widoki pokazują dymek", () => {
  it("Konwertuj: tekst.txt → dymek, lista pusta", async () => {
    sklep.ustaw({ dymek: null });
    const w = stworzWidokPlikowy("konwertuj");
    await w.dodaj(["C:/Dokumenty/tekst.txt"]);
    expect(sklep.stan.dymek?.tekst).toBe("Pominięto 1 plik: nieobsługiwany format (tekst.txt)");
    expect(w.el.querySelector(".plik")).toBeNull();
  });
  it("Obrazy: film → dymek z przyciskiem, który przenosi go do Konwertuj", async () => {
    sklep.ustaw({ dymek: null });
    const przeniesione: string[][] = [];
    const w = stworzWidokPlikowy("obrazy", { doKonwertuj: (s) => przeniesione.push(s) });
    await w.dodaj(["C:/Wideo/film.mp4", "C:/Obrazy/zdj.png"]);
    expect(sklep.stan.dymek?.tekst).toBe("To nie obrazy. Wideo i audio konwertuj w zakładce Konwertuj");
    expect(sklep.stan.dymek?.akcja?.etykieta).toBe("Przejdź do Konwertuj");
    expect(w.el.querySelectorAll(".plik").length).toBe(1);
    sklep.stan.dymek!.akcja!.zrob();
    expect(przeniesione).toEqual([["C:/Wideo/film.mp4"]]);
  });
});

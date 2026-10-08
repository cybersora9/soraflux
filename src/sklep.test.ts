import { describe, expect, it } from "vitest";
import { dymekDodano, forma, sklep } from "./sklep";
import { t, ustawJezyk } from "./i18n";

describe("dymek po dodaniu zadań (usterka 6)", () => {
  it("odmiana: 1 zadanie, 2–4 zadania, 5+ zadań", () => {
    expect([1, 2, 4, 5, 12, 14, 22, 25, 102].map(forma)).toEqual(["1", "kilka", "kilka", "wiele", "wiele", "wiele", "kilka", "wiele", "kilka"]);
  });
  it("„Dodano 2 zadania do kolejki · Pokaż” przenosi do Kolejki", () => {
    ustawJezyk("pl");
    sklep.ustaw({ zakladka: "konwertuj" });
    dymekDodano(2, t);
    expect(sklep.stan.dymek?.tekst).toBe("Dodano 2 zadania do kolejki");
    expect(sklep.stan.dymek?.akcja?.etykieta).toBe("Pokaż");
    sklep.stan.dymek!.akcja!.zrob();
    expect(sklep.stan.zakladka).toBe("kolejka");
    dymekDodano(5, t);
    expect(sklep.stan.dymek?.tekst).toBe("Dodano 5 zadań do kolejki");
  });
});

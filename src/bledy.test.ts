// P5 z testu na żywo 1.4.0: błędy pobierania pokazywały surowy tekst yt-dlp (z krzakami zamiast
// polskich liter), a 404 miało surowe „ERROR: …” doklejone do przyjaznego zdania.
import { describe, expect, it } from "vitest";
import { rozdzielBlad, t } from "./i18n";
import { stworzWidokPobierania } from "./widoki/pobierz";
import { stworzWidokKolejki } from "./widoki/kolejka";
import { sklep } from "./sklep";
import type { InfoZadania } from "./typy";

const POLACZENIE =
  '@i18n {"k":"yt.polaczenie","a":{}}\n\nERROR: [generic] x: Unable to download webpage: [WinError 10061] Nie można nawiązać połączenia';
const czekaj = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("P5: błąd = zwięzłe zdanie + szczegóły techniczne", () => {
  it("rozdzielBlad: klucz → zdanie, surowy ogon osobno", () => {
    expect(rozdzielBlad(POLACZENIE)).toEqual({
      tekst: "Nie mogę połączyć się z serwerem. Sprawdź adres i internet.",
      szczegoly: "ERROR: [generic] x: Unable to download webpage: [WinError 10061] Nie można nawiązać połączenia",
    });
    expect(rozdzielBlad('@i18n {"k":"yt.nie_znaleziono","a":{}}')).toEqual({ tekst: "Pod tym adresem nic nie ma (błąd 404). Sprawdź link.", szczegoly: null });
    // zwykły tekst bez klucza zostaje zdaniem
    expect(rozdzielBlad("coś")).toEqual({ tekst: "coś", szczegoly: null });
    expect(t("blad.szczegoly_techniczne")).toBe("Szczegóły techniczne");
  });

  it("Pobierz: karta z błędem połączenia nie pokazuje surowego ERROR na wierzchu", async () => {
    const w = stworzWidokPobierania();
    document.body.replaceChildren(w.el);
    w.wstaw("http://127.0.0.1:59999/x.mp4", { typ: "najlepsza" });
    await czekaj(500);
    const blad = w.el.querySelector(".film .blad-blok")!;
    expect(blad.querySelector(".blad-tekst")?.textContent).toBe("Nie mogę połączyć się z serwerem. Sprawdź adres i internet.");
    const szczegoly = blad.querySelector<HTMLDetailsElement>("details.blad-szczegoly")!;
    expect(szczegoly.open).toBe(false);
    expect(szczegoly.querySelector("summary")?.textContent).toBe("Szczegóły techniczne");
    expect(szczegoly.querySelector("pre")?.textContent).toContain("Nie można nawiązać połączenia");
    expect(blad.querySelector(".blad-tekst")?.textContent).not.toContain("ERROR");
  });

  it("Kolejka: zadanie z błędem pokazuje zdanie, surowy tekst w szczegółach", () => {
    const z: InfoZadania = {
      id: 9001, nazwa: "x.mp4", rodzaj: "pobranie", stan: { typ: "blad", komunikat: POLACZENIE }, procent: 0, wyjscie: null,
      rozmiar_wejscia: null, rozmiar_wyniku: null, awaria_sprzetu: false, ostrzezenie: null,
    };
    sklep.ustaw({ zadania: new Map([[z.id, z]]) });
    const k = stworzWidokKolejki();
    k.odswiez();
    const blad = k.el.querySelector(".zadanie .blad-blok")!;
    expect(blad.querySelector(".blad-tekst")?.textContent).toBe("Nie mogę połączyć się z serwerem. Sprawdź adres i internet.");
    expect(blad.querySelector("details pre")?.textContent).toContain("WinError 10061");
  });
});

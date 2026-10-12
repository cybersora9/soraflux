// P2 z testu na żywo 1.4.0: ukryte „Fragment od–do” przycinało kolejne konwersje.
// Cięcie 00:06–00:20, potem „Zmniejsz do 10 MB” na nowym 8-sekundowym pliku → wynik 2,00 s,
// a pola wciąż trzymały 00:06/00:20 pod zwiniętym „Zaawansowane”.
import { describe, expect, it } from "vitest";
import { opisCiecia, profilDla, profilSzybkiejAkcji, stanCiecia, SZYBKIE_AKCJE, type StanCiecia } from "./logika";
import { panelUstawien } from "./komponenty/PanelUstawien";
import type { Media, Profil } from "./typy";

const fragment: StanCiecia = { ciecie: { od: 6, koniec: 20 }, przyciete: false };

describe("P2: stan pól od–do", () => {
  it("nowe pliki, usunięcie i „Wyczyść” kasują fragment", () => {
    expect(stanCiecia(fragment, { typ: "pliki" })).toEqual({ ciecie: null, przyciete: false });
  });

  it("szybka akcja inna niż „Wytnij fragment” kasuje fragment, „Wytnij” go zostawia", () => {
    for (const a of SZYBKIE_AKCJE) {
      const s = stanCiecia(fragment, { typ: "akcja", akcja: a });
      expect(s.ciecie, a).toEqual(a === "wytnij" ? { od: 6, koniec: 20 } : null);
    }
  });

  it("koniec za długością pliku jest przycinany i oznaczany", () => {
    expect(stanCiecia({ ciecie: null, przyciete: false }, { typ: "pola", od: 6, koniec: 20, czas: 8 })).toEqual({ ciecie: { od: 6, koniec: 8 }, przyciete: true });
    expect(stanCiecia({ ciecie: null, przyciete: false }, { typ: "pola", od: 2, koniec: 5, czas: 8 })).toEqual({ ciecie: { od: 2, koniec: 5 }, przyciete: false });
    // 0–20 na 8 s = cały plik: bez cięcia, ale z uwagą
    expect(stanCiecia(fragment, { typ: "pola", od: null, koniec: 20, czas: 8 })).toEqual({ ciecie: null, przyciete: true });
    // nieznana długość: nie zgadujemy
    expect(stanCiecia(fragment, { typ: "pola", od: 6, koniec: 20, czas: null })).toEqual({ ciecie: { od: 6, koniec: 20 }, przyciete: false });
    expect(stanCiecia(fragment, { typ: "pola", od: null, koniec: null, czas: 8 })).toEqual({ ciecie: null, przyciete: false });
  });

  it("scenariusz z testu na żywo: cięcie 06–20, nowy plik, „Zmniejsz do 10 MB” → pełna długość", () => {
    let s = stanCiecia({ ciecie: null, przyciete: false }, { typ: "pola", od: 6, koniec: 20, czas: 25 });
    expect(s.ciecie).toEqual({ od: 6, koniec: 20 });
    s = stanCiecia(s, { typ: "pliki" }); // upuszczony nowy 8-sekundowy plik
    s = stanCiecia(s, { typ: "akcja", akcja: "rozmiar" });
    const p = profilSzybkiejAkcji("rozmiar", { ...profilDla("mp4"), ciecie: s.ciecie }, { mb: 10 });
    expect(p.ciecie).toBeNull();
    // nawet bez zmiany listy sama akcja nie przenosi starego fragmentu
    const zostalo = stanCiecia(fragment, { typ: "akcja", akcja: "rozmiar" });
    expect(profilSzybkiejAkcji("rozmiar", { ...profilDla("mp4"), ciecie: zostalo.ciecie }).ciecie).toBeNull();
  });
});

describe("P2: plakietka na zwiniętym „Zaawansowane”", () => {
  const media = { czas_s: 8 } as Media;
  function panel(p: Profil) {
    let ostatni = p;
    const pan = panelUstawien({ tryb: "wideo", profil: p, media: () => media, onZmiana: (x) => (ostatni = x) });
    document.body.replaceChildren(pan.el);
    return { pan, ostatni: () => ostatni };
  }
  const plakietka = () => document.querySelector(".zaawansowane > summary .plakietka-ciecie");

  it("aktywny fragment widać na nagłówku, bez fragmentu plakietki nie ma", () => {
    expect(opisCiecia({ od: 6, koniec: 20 })).toBe("00:06–00:20");
    panel({ ...profilDla("mp4"), ciecie: { od: 6, koniec: 20 } });
    expect(document.querySelector<HTMLDetailsElement>(".zaawansowane")!.open).toBe(false);
    expect(plakietka()?.textContent).toBe("Fragment 00:06–00:20");
    panel(profilDla("mp4"));
    expect(plakietka()).toBeNull();
  });

  it("koniec za długością pliku: pole pokazuje przyciętą wartość i uwagę", () => {
    const { ostatni } = panel(profilDla("mp4"));
    const [od, koniec] = document.querySelectorAll<HTMLInputElement>(".zaawansowane input.czas");
    od.value = "00:06";
    od.dispatchEvent(new Event("change"));
    const k = document.querySelectorAll<HTMLInputElement>(".zaawansowane input.czas")[1] ?? koniec;
    k.value = "00:20";
    k.dispatchEvent(new Event("change"));
    expect(ostatni().ciecie).toEqual({ od: 6, koniec: 8 });
    const pole = document.querySelectorAll<HTMLInputElement>(".zaawansowane input.czas")[1];
    expect(pole.value).toBe("00:08");
    expect(pole.getAttribute("aria-describedby")).toBe("ciecie-uciete");
    expect(document.getElementById("ciecie-uciete")?.textContent).toContain("00:08");
    expect(plakietka()?.textContent).toBe("Fragment 00:06–00:08");
  });
});

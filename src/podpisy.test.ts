// P7 z testu na żywo 1.4.0: pod strefą upuszczania na Obrazach dwa sprzeczne podpisy:
// „Wideo, audio, obrazy, także całe foldery.” (skopiowany z Konwertuj) i „PNG, JPG, WebP, AVIF, GIF, BMP, ICO…”.
import { describe, expect, it } from "vitest";
import pl from "./i18n/pl.json";
import en from "./i18n/en.json";
import { podpisyStrefy } from "./komponenty/wspolne";
import { stworzWidokPlikowy } from "./widoki/plikowy";

const slowniki = { pl: pl as Record<string, string>, en: en as Record<string, string> };

describe("P7: podpisy pod strefą upuszczania", () => {
  it("Obrazy: tylko lista formatów obrazów, bez wideo i audio (PL i EN)", () => {
    const p = podpisyStrefy(true);
    expect(p.pomoc).toBeNull();
    for (const [j, s] of Object.entries(slowniki)) {
      const teksty = [s[p.tytul], s[p.pusto]];
      for (const x of teksty) expect(x, j).toBeTruthy();
      expect(teksty.join(" "), j).not.toMatch(/wideo|audio|video/i);
      expect(s[p.pusto], j).toMatch(/PNG, JPG, WebP, AVIF, GIF, BMP, ICO/);
    }
  });

  it("Konwertuj: swój podpis, różny od Obrazów (PL i EN)", () => {
    const k = podpisyStrefy(false);
    const o = podpisyStrefy(true);
    for (const [j, s] of Object.entries(slowniki)) {
      for (const klucz of [k.tytul, k.pomoc!, k.pusto]) expect(s[klucz], `${j} ${klucz}`).toBeTruthy();
      expect(s[k.pomoc!], j).toMatch(/wideo|video/i);
      expect(s[k.pusto], j).not.toBe(s[o.pusto]);
    }
  });

  it("widok Obrazy na ekranie: jeden podpis o formatach, bez skopiowanego z Konwertuj", () => {
    const w = stworzWidokPlikowy("obrazy");
    const tekst = w.el.querySelector(".kolumna-lewa")!.textContent!;
    expect(tekst).toContain(pl["obrazy.pusto"]);
    expect(tekst).not.toContain(pl["strefa.pomoc"]);
    const k = stworzWidokPlikowy("konwertuj").el.querySelector(".kolumna-lewa")!.textContent!;
    expect(k).toContain(pl["strefa.pomoc"]);
    expect(k).not.toContain(pl["obrazy.pusto"]);
  });

  it("żaden dłuższy tekst interfejsu nie jest skopiowany pod dwoma kluczami (poza parą front/Rust i formami liczby)", () => {
    const rdzen = (k: string) => k.replace(/^(blad|rust)\./, "").replace(/_(1|kilka|wiele)$/, "");
    for (const [j, s] of Object.entries(slowniki)) {
      const widziane = new Map<string, string>();
      for (const [k, v] of Object.entries(s)) {
        if (v.length < 25) continue;
        const inny = widziane.get(v);
        const para = inny && rdzen(inny) === rdzen(k);
        expect(inny && !para ? `${inny} = ${k}` : null, j).toBeNull();
        widziane.set(v, k);
      }
    }
  });
});

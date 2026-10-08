import { describe, expect, it } from "vitest";
import { panelUstawien } from "./PanelUstawien";
import { profilDla } from "../logika";
import type { Media, Profil } from "../typy";

function panel(p: Profil, tryb: "wideo" | "obraz" = "wideo") {
  let ostatni = p;
  const pan = panelUstawien({ tryb, profil: p, onZmiana: (x) => (ostatni = x) });
  document.body.replaceChildren(pan.el);
  return { pan, ostatni: () => ostatni };
}

function wybierz(sel: HTMLSelectElement, etykieta: string) {
  const i = [...sel.options].findIndex((o) => o.textContent === etykieta);
  expect(i, `brak opcji ${etykieta}`).toBeGreaterThanOrEqual(0);
  sel.value = sel.options[i].value;
  sel.dispatchEvent(new Event("change"));
}

const selectPola = (etykieta: string) =>
  [...document.querySelectorAll<HTMLElement>(".pole")].find((p) => p.querySelector(".pole-etykieta")?.textContent === etykieta)!
    .querySelector("select") as HTMLSelectElement;

describe("PanelUstawien", () => {
  it("ustawia 480p i 25 fps", () => {
    const { ostatni } = panel(profilDla("mp4"));
    wybierz(selectPola("Rozdzielczość"), "480p");
    wybierz(selectPola("Klatki na sekundę"), "25 fps");
    expect(ostatni().wideo?.rozdzielczosc).toEqual({ typ: "wysokosc", h: 480 });
    expect(ostatni().wideo?.fps).toEqual({ typ: "wartosc", fps: 25 });
  });

  it("AAC 8 kb/s przestawia na mono 16 kHz i pokazuje spokojną uwagę", () => {
    const { ostatni } = panel(profilDla("mp4"));
    wybierz(selectPola("Bitrate dźwięku"), "8 kb/s");
    expect(ostatni().audio).toMatchObject({ kodek: "aac", kbps: 8, kanaly: 1, hz: 16000 });
    expect(document.querySelector(".uwaga-info")?.textContent).toContain("Opus");
  });

  it("MP3 z filmu nie ma ustawień obrazu", () => {
    const { ostatni } = panel(profilDla("mp4"));
    const mp3 = [...document.querySelectorAll<HTMLButtonElement>(".chip")].find((b) => b.textContent === "MP3")!;
    mp3.click();
    expect(ostatni().kontener).toBe("mp3");
    expect(ostatni().audio?.kodek).toBe("mp3");
    expect(document.body.textContent).not.toContain("Rozdzielczość");
  });

  it("tryb rozmiaru pliku w MB", () => {
    const { ostatni } = panel(profilDla("mp4"));
    const seg = [...document.querySelectorAll<HTMLButtonElement>(".segment")].find((b) => b.textContent === "Rozmiar pliku")!;
    seg.click();
    expect(ostatni().wideo?.jakosc.typ).toBe("rozmiar_mb");
  });

  it("GIF ma fps, szerokość i pętlę", () => {
    const { ostatni } = panel(profilDla("mp4"));
    [...document.querySelectorAll<HTMLButtonElement>(".chip")].find((b) => b.textContent === "GIF")!.click();
    expect(ostatni().gif).toMatchObject({ fps: 15, szerokosc: 480 });
    wybierz(selectPola("Pętla"), "Odtwórz raz");
    expect(ostatni().gif?.petla).toEqual({ typ: "brak" });
  });

  it("obrazy: procent i jakość", () => {
    const { ostatni } = panel(profilDla("webp"), "obraz");
    [...document.querySelectorAll<HTMLButtonElement>(".segment")].find((b) => b.textContent === "Procent")!.click();
    expect(ostatni().obraz?.rozmiar).toEqual({ typ: "procent", p: 50 });
    [...document.querySelectorAll<HTMLButtonElement>(".chip")].find((b) => b.textContent === "JPG")!.click();
    expect(ostatni().kontener).toBe("jpg");
    expect(ostatni().obraz?.rozmiar).toEqual({ typ: "procent", p: 50 });
  });

  it("E31: kodeki bez enkodera w tym ffmpeg są wyszarzone", () => {
    const pan = panelUstawien({ tryb: "wideo", profil: profilDla("mkv"), enkodery: () => ["libx264", "aac"], onZmiana: () => undefined });
    document.body.replaceChildren(pan.el);
    const kodek = selectPola("Kodek wideo");
    const av1 = [...kodek.options].find((o) => o.textContent?.startsWith("AV1"))!;
    expect(av1.disabled).toBe(true);
    expect(av1.textContent).toContain("brak w tym ffmpeg");
    expect([...kodek.options].find((o) => o.textContent?.startsWith("H.264"))!.disabled).toBe(false);
  });

  it("C13/C19/C17: 10 bitów tylko dla H.265/AV1/VP9, wybór ścieżki i napisy przy wielościeżkowym pliku", () => {
    const media = {
      czas_s: 10, rozmiar_b: 1, kbps: 1, format: "matroska", obraz: false, okladka: false,
      wideo: { indeks: 0, kodek: "hevc", w: 1920, h: 1080, fps: 25, kbps: 1, piksele: "yuv420p10le", bity: 10, hdr: "hlg", obrot: 0, vfr: false },
      audio: null,
      sciezki_audio: [
        { indeks: 1, kodek: "aac", hz: 48000, kanaly: 2, kbps: 128, jezyk: "pol" },
        { indeks: 2, kodek: "ac3", hz: 48000, kanaly: 6, kbps: 384, jezyk: "eng" },
      ],
      napisy: [{ indeks: 3, kodek: "subrip", jezyk: "pol", tekstowe: true }],
    } satisfies Media;
    let ostatni = profilDla("mkv");
    const pan = panelUstawien({ tryb: "wideo", profil: ostatni, media: () => media, onZmiana: (x) => (ostatni = x) });
    document.body.replaceChildren(pan.el);
    const etykiety = () => [...document.querySelectorAll(".pole-etykieta")].map((e) => e.textContent);
    expect(etykiety()).not.toContain("10 bitów");
    wybierz(selectPola("Kodek wideo"), "H.265 / HEVC");
    expect(etykiety()).toContain("10 bitów");
    expect(document.body.textContent).toContain("Zachowaj HDR");
    wybierz(selectPola("Ścieżka dźwięku"), "2: AC3 6 kan. (eng)");
    expect(ostatni.sciezki_audio).toEqual({ typ: "numer", n: 1 });
    wybierz(selectPola("Ścieżka dźwięku"), "Wszystkie ścieżki");
    expect(ostatni.sciezki_audio).toEqual({ typ: "wszystkie" });
    expect(etykiety()).toContain("Napisy");
  });
});

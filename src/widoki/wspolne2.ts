// Kontrolki DNA 2.0 wspólne dla ekranów SoraFlux 2.0 (przełącznik, segmenty, pigułka).
import { h, ikona } from "../dom";

/** Przełącznik (role=switch, aria-checked) jak w makiecie. */
export function przelacznik2(wartosc: boolean, zmiana: (v: boolean) => void, etykieta: string, fokus?: string, wylaczony = false): HTMLButtonElement {
  const b = h("button", {
    type: "button", class: "przel", role: "switch", "aria-checked": String(wartosc), "aria-label": etykieta, title: etykieta,
    "data-fokus": fokus, disabled: wylaczony,
  }) as HTMLButtonElement;
  b.addEventListener("click", () => {
    const nowa = b.getAttribute("aria-checked") !== "true";
    b.setAttribute("aria-checked", String(nowa));
    zmiana(nowa);
  });
  return b;
}

/** Segmenty z aria-pressed (wybór jednej wartości). */
export function segment2<T extends string | number>(
  opcje: { v: T; e: string; ikona?: string; wylaczona?: boolean }[],
  wartosc: T,
  zmiana: (v: T) => void,
  etykieta: string,
  klasa = "",
): HTMLElement {
  return h(
    "div",
    { class: `seg ${klasa}`.trim(), role: "group", "aria-label": etykieta },
    opcje.map((o) =>
      h(
        "button",
        { type: "button", "aria-pressed": String(o.v === wartosc), "data-wartosc": String(o.v), disabled: o.wylaczona, onclick: () => o.v !== wartosc && zmiana(o.v) },
        o.ikona ? ikona(o.ikona, "ikona ic m") : null,
        o.e,
      ),
    ),
  );
}

/** Pigułka-przycisk (chip z makiety). */
export function pil(tekst: string, wcisniety: boolean, akcja: () => void, atr: Record<string, unknown> = {}, ikonaSvg?: string): HTMLButtonElement {
  return h("button", { type: "button", class: "pil", "aria-pressed": String(wcisniety), onclick: akcja, ...atr }, ikonaSvg ? ikona(ikonaSvg, "ikona ic m") : null, tekst) as HTMLButtonElement;
}

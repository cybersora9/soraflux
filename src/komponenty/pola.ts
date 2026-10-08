// Kontrolki formularza w jednym stylu.
import { h } from "../dom";

export interface Opcja<T> {
  wartosc: T;
  etykieta: string;
  grupa?: string;
  wylaczona?: boolean;
}

let licznik = 0;
const noweId = () => `pole-${++licznik}`;

export function pole(etykieta: string, kontrolka: HTMLElement, pomoc?: string | null, klasa = ""): HTMLElement {
  const id = kontrolka.id || noweId();
  if (!kontrolka.id && (kontrolka instanceof HTMLInputElement || kontrolka instanceof HTMLSelectElement)) kontrolka.id = id;
  return h(
    "div",
    { class: `pole ${klasa}`.trim() },
    h("label", { class: "pole-etykieta", for: id }, etykieta),
    kontrolka,
    pomoc ? h("div", { class: "pole-pomoc" }, pomoc) : null,
  );
}

/** Select; wartości porównywane przez JSON, więc działają też obiekty. */
export function wybor<T>(opcje: Opcja<T>[], wartosc: T, zmiana: (v: T) => void, atr: Record<string, unknown> = {}): HTMLSelectElement {
  const klucz = (v: T) => JSON.stringify(v);
  const grupy = new Map<string, HTMLElement>();
  const sel = h("select", { class: "wybor", ...atr });
  for (const [i, o] of opcje.entries()) {
    const el = h("option", { value: String(i), selected: klucz(o.wartosc) === klucz(wartosc), disabled: o.wylaczona }, o.etykieta);
    if (o.grupa) {
      if (!grupy.has(o.grupa)) {
        const g = h("optgroup", { label: o.grupa });
        grupy.set(o.grupa, g);
        sel.append(g);
      }
      grupy.get(o.grupa)!.append(el);
    } else sel.append(el);
  }
  sel.addEventListener("change", () => zmiana(opcje[Number(sel.value)].wartosc));
  return sel;
}

/** Przełącznik segmentowy (np. CRF / Bitrate / Rozmiar). */
export function segmenty<T extends string>(opcje: Opcja<T>[], wartosc: T, zmiana: (v: T) => void, etykieta?: string): HTMLElement {
  return h(
    "div",
    { class: "segmenty", role: "radiogroup", "aria-label": etykieta },
    opcje.map((o) =>
      h(
        "button",
        {
          type: "button",
          class: "segment" + (o.wartosc === wartosc ? " aktywny" : ""),
          role: "radio",
          "aria-checked": String(o.wartosc === wartosc),
          onclick: () => o.wartosc !== wartosc && zmiana(o.wartosc),
        },
        o.etykieta,
      ),
    ),
  );
}

export function przelacznik(etykieta: string, wartosc: boolean, zmiana: (v: boolean) => void, pomoc?: string): HTMLElement {
  const input = h("input", { type: "checkbox", class: "przelacznik-input", checked: wartosc });
  input.addEventListener("change", () => zmiana(input.checked));
  return h(
    "label",
    { class: "przelacznik" },
    input,
    h("span", { class: "przelacznik-tor", "aria-hidden": "true" }, h("span", { class: "przelacznik-galka" })),
    h("span", { class: "przelacznik-tekst" }, etykieta, pomoc ? h("small", null, pomoc) : null),
  );
}

export interface OpcjeLiczby {
  min?: number;
  max?: number;
  krok?: number;
  sufiks?: string;
  pusta?: boolean;
  placeholder?: string;
  szerokosc?: string;
}

/** Pole liczby; `zmiana` po zatwierdzeniu (change), `naZywo` przy każdym znaku. */
export function liczba(
  wartosc: number | null,
  o: OpcjeLiczby,
  zmiana: (v: number | null) => void,
  naZywo?: (v: number | null) => void,
): HTMLElement {
  const input = h("input", {
    type: "number",
    class: "liczba",
    value: wartosc === null ? "" : String(wartosc),
    min: o.min,
    max: o.max,
    step: o.krok ?? 1,
    placeholder: o.placeholder,
    inputmode: "decimal",
    style: o.szerokosc ? { width: o.szerokosc } : undefined,
  });
  const odczyt = (): number | null => {
    if (input.value.trim() === "") return o.pusta ? null : (o.min ?? 0);
    let v = Number(input.value);
    if (!isFinite(v)) return null;
    if (o.min !== undefined) v = Math.max(o.min, v);
    if (o.max !== undefined) v = Math.min(o.max, v);
    return v;
  };
  input.addEventListener("input", () => naZywo?.(odczyt()));
  input.addEventListener("change", () => {
    const v = odczyt();
    if (v !== null) input.value = String(v);
    zmiana(v);
  });
  if (!o.sufiks) return input;
  return h("span", { class: "liczba-z-sufiksem" }, input, h("span", { class: "sufiks" }, o.sufiks));
}

export function tekst(wartosc: string, zmiana: (v: string) => void, atr: Record<string, unknown> = {}): HTMLInputElement {
  const input = h("input", { type: "text", class: "tekst", value: wartosc, ...atr });
  input.addEventListener("change", () => zmiana(input.value));
  return input;
}

export function suwak(wartosc: number, min: number, max: number, zmiana: (v: number) => void, atr: Record<string, unknown> = {}): HTMLInputElement {
  const s = h("input", { type: "range", class: "suwak", min, max, step: 1, value: String(wartosc), ...atr });
  const tlo = () => s.style.setProperty("--wypelnienie", `${((Number(s.value) - min) / (max - min)) * 100}%`);
  tlo();
  s.addEventListener("input", () => {
    tlo();
    zmiana(Number(s.value));
  });
  return s;
}

export function przycisk(tresc: (Node | string)[] | string, akcja: () => void, klasa = "", atr: Record<string, unknown> = {}): HTMLButtonElement {
  return h("button", { type: "button", class: `przycisk ${klasa}`.trim(), onclick: akcja, ...atr }, ...(Array.isArray(tresc) ? tresc : [tresc]));
}

export function uwaga(rodzaj: "info" | "uwaga" | "blad", ...tresc: (Node | string)[]): HTMLElement {
  return h("div", { class: `uwaga uwaga-${rodzaj}`, role: rodzaj === "blad" ? "alert" : "note" }, ...tresc);
}

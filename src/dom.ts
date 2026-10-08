// Mały pomocnik do budowania DOM bez frameworka.

type Dziecko = Node | string | number | null | undefined | false;
type Atrybuty = Record<string, unknown>;

const WLASCIWOSCI = new Set(["value", "checked", "disabled", "selected", "open", "indeterminate"]);

export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  atr?: Atrybuty | null,
  ...dzieci: (Dziecko | Dziecko[])[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (atr) {
    for (const [k, v] of Object.entries(atr)) {
      if (v === undefined || v === null || v === false) continue;
      if (k.startsWith("on") && typeof v === "function") {
        el.addEventListener(k.slice(2).toLowerCase(), v as EventListener);
      } else if (k === "class") {
        el.className = String(v);
      } else if (k === "style" && typeof v === "object") {
        Object.assign(el.style, v);
      } else if (k === "html") {
        el.innerHTML = String(v);
      } else if (WLASCIWOSCI.has(k)) {
        (el as unknown as Record<string, unknown>)[k] = v;
      } else {
        el.setAttribute(k, v === true ? "" : String(v));
      }
    }
  }
  dolacz(el, dzieci);
  return el;
}

function dolacz(el: Node, dzieci: (Dziecko | Dziecko[])[]): void {
  for (const d of dzieci.flat()) {
    if (d === null || d === undefined || d === false) continue;
    el.appendChild(typeof d === "string" || typeof d === "number" ? document.createTextNode(String(d)) : d);
  }
}

export function zamien(el: Element, ...dzieci: (Dziecko | Dziecko[])[]): void {
  el.replaceChildren();
  dolacz(el, dzieci);
}

/** Opóźnia wywołanie, aż ustaną zmiany (szacunek rozmiaru: 150 ms). */
export function debounce<A extends unknown[]>(f: (...a: A) => void, ms: number): (...a: A) => void {
  let t: ReturnType<typeof setTimeout> | undefined;
  return (...a: A) => {
    if (t) clearTimeout(t);
    t = setTimeout(() => f(...a), ms);
  };
}

export function ikona(svg: string, klasa = "ikona"): HTMLSpanElement {
  return h("span", { class: klasa, "aria-hidden": "true", html: svg });
}

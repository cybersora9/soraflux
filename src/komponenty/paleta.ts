// Paleta poleceń (Ctrl K, DNA 2.0): pole wyszukiwania, lista poleceń z sekcjami i skrótami.
// ↑ ↓ wybierają, Enter wykonuje, Esc zamyka i oddaje fokus tam, skąd przyszedł.
import { h, ikona } from "../dom";
import { IKONY } from "../ikony";
import { t } from "../i18n";

export interface Polecenie {
  id: string;
  sekcja: string;
  tekst: string;
  ikona: string;
  skrot?: string;
  wykonaj(): void;
}

/** Tekst do porównania: małe litery, bez polskich znaków (dopasowanie „glosnosc” → „Głośność”). */
export function bezOgonkow(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/ł/g, "l");
}

/** Polecenia pasujące do zapytania: każde słowo zapytania musi wystąpić w tekście albo sekcji. */
export function filtruj<T extends Pick<Polecenie, "tekst" | "sekcja">>(lista: T[], zapytanie: string): T[] {
  const slowa = bezOgonkow(zapytanie).split(/\s+/).filter(Boolean);
  if (!slowa.length) return lista;
  return lista.filter((p) => {
    const tekst = bezOgonkow(`${p.tekst} ${p.sekcja}`);
    return slowa.every((s) => tekst.includes(s));
  });
}

let otwarta: HTMLElement | null = null;

export function paletaOtwarta(): boolean {
  return !!otwarta;
}

export function zamknijPalete(): void {
  otwarta?.dispatchEvent(new CustomEvent("zamknij"));
}

/** Otwiera paletę; `polecenia` liczone przy otwarciu (stan apki może się zmienić). */
export function otworzPalete(polecenia: () => Polecenie[]): void {
  if (otwarta) return;
  const poprzedni = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const wszystkie = polecenia();
  let lista = wszystkie;
  let i = 0;
  const idListy = "paleta-lista";
  const pole = h("input", {
    type: "text",
    role: "combobox",
    "aria-expanded": "true",
    "aria-controls": idListy,
    "aria-autocomplete": "list",
    "aria-label": t("paleta.szukaj"),
    placeholder: t("paleta.szukaj"),
    spellcheck: "false",
  }) as HTMLInputElement;
  const ul = h("ul", { class: "paleta-l", id: idListy, role: "listbox", "aria-label": t("paleta.polecenia") });

  function rysuj() {
    const elementy: HTMLElement[] = [];
    let sekcja = "";
    lista.forEach((p, n) => {
      if (p.sekcja !== sekcja) {
        sekcja = p.sekcja;
        elementy.push(h("li", { class: "sek", role: "presentation" }, sekcja));
      }
      elementy.push(
        h(
          "li",
          {
            id: `pal-${n}`,
            class: "pal-p",
            role: "option",
            "aria-selected": String(n === i),
            "data-polecenie": p.id,
            onmousedown: (e: MouseEvent) => e.preventDefault(),
            onclick: () => wykonaj(n),
            onmousemove: () => {
              if (i !== n) {
                i = n;
                zaznacz();
              }
            },
          },
          ikona(p.ikona, "ikona ic m"),
          h("span", null, p.tekst),
          p.skrot ? h("span", { class: "kbd" }, p.skrot) : null,
        ),
      );
    });
    if (!lista.length) elementy.push(h("li", { class: "paleta-pusto", role: "presentation" }, t("paleta.brak")));
    ul.replaceChildren(...elementy);
    zaznacz();
  }

  function zaznacz() {
    ul.querySelectorAll<HTMLElement>(".pal-p").forEach((el, n) => el.setAttribute("aria-selected", String(n === i)));
    const el = ul.querySelector<HTMLElement>(`#pal-${i}`);
    if (el) {
      pole.setAttribute("aria-activedescendant", el.id);
      el.scrollIntoView?.({ block: "nearest" });
    } else pole.removeAttribute("aria-activedescendant");
  }

  function zamknij() {
    tlo.remove();
    otwarta = null;
    poprzedni?.focus?.();
  }

  function wykonaj(n: number) {
    const p = lista[n];
    if (!p) return;
    zamknij();
    p.wykonaj();
  }

  pole.addEventListener("input", () => {
    lista = filtruj(wszystkie, pole.value);
    i = 0;
    rysuj();
  });
  pole.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (!lista.length) return;
      i = (i + (e.key === "ArrowDown" ? 1 : -1) + lista.length) % lista.length;
      zaznacz();
    } else if (e.key === "Enter") {
      e.preventDefault();
      wykonaj(i);
    } else if (e.key === "Escape") {
      e.preventDefault();
      zamknij();
    } else if (e.key === "Tab") {
      e.preventDefault(); // fokus zostaje w oknie palety
    }
  });

  const tlo = h(
    "div",
    { class: "paleta-tlo", onmousedown: (e: MouseEvent) => e.target === tlo && zamknij() },
    h(
      "div",
      { class: "paleta", role: "dialog", "aria-modal": "true", "aria-label": t("paleta.tytul") },
      h("div", { class: "paleta-w" }, ikona(IKONY.szukaj, "ikona ic"), pole, h("span", { class: "kbd" }, "Esc")),
      ul,
      h("div", { class: "paleta-d" }, h("span", null, h("span", { class: "kbd" }, "↑ ↓"), " ", t("paleta.wybierz")), h("span", null, h("span", { class: "kbd" }, "↵"), " ", t("paleta.wykonaj")), h("span", null, h("span", { class: "kbd" }, "Esc"), " ", t("paleta.zamknij"))),
    ),
  );
  tlo.addEventListener("zamknij", zamknij);
  otwarta = tlo;
  document.body.append(tlo);
  rysuj();
  pole.focus();
}

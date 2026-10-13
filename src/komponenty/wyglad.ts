// Ustawienia → Wygląd (DNA 2.0): kafle motywów rodziny (Blackwall, Kissaten, City Pop, MiniDisc, Neon noc,
// Własny), „Własny” z <input type=color> na wybranej bazie, eksport/import .json, tryb jasny/ciemny/system
// i skala 90–150%. Zapis w konfigu (Rust), nie w localStorage.
// Motyw zmienia się TYLKO kliknięciem kafla albo Enterem/spacją na kaflu; strzałki tylko przesuwają fokus
// (usterka 5 z testów 07.10, P8: przyciski z aria-pressed, nie radio).
import { api } from "../api";
import { h, ikona, zamien } from "../dom";
import { IKONY } from "../ikony";
import { t, tekstBledu } from "../i18n";
import {
  BAZY, ID_MOTYWOW, SZYBKIE_AKCENTY, czyCiemny, doKonfigu, doPliku, naloz, probki, ustawStan, wczytaj, zPliku,
  type Baza, type IdMotywu, type MotywWlasny, type StanWygladu,
} from "../motywy";
import { biezacaSkala, SKALE, ustawSkale } from "../skala";
import { pokazDymek, sklep } from "../sklep";
import type { Konfig } from "../typy";
import { przycisk } from "./pola";

const DOMYSLNY_WLASNY: MotywWlasny = { akcent: "#ff7ac6", baza: "neon" };

/** Przełącznik w stylu makiety: segmenty z aria-pressed. */
function seg<T extends string | number>(opcje: { v: T; e: string; ikona?: string }[], wartosc: T, zmiana: (v: T) => void, etykieta: string, klasa = ""): HTMLElement {
  return h(
    "div",
    { class: `seg ${klasa}`.trim(), role: "group", "aria-label": etykieta },
    opcje.map((o) =>
      h("button", { type: "button", "aria-pressed": String(o.v === wartosc), "data-wartosc": String(o.v), onclick: () => o.v !== wartosc && zmiana(o.v) }, o.ikona ? ikona(o.ikona, "ikona ic m") : null, o.e),
    ),
  );
}

export function sekcjaMotywow(): HTMLElement {
  const el = h("div", { class: "wyglad2" });
  let stan: StanWygladu = wczytaj();
  const ciemno = () => czyCiemny(sklep.stan.konfig?.motyw);

  async function zapiszKonfig(zmiana: Partial<Konfig>) {
    const k = sklep.stan.konfig;
    if (!k) return;
    const konfig = { ...k, ...zmiana };
    sklep.ustaw({ konfig });
    await api.konfigZapisz(konfig).catch((e) => pokazDymek(tekstBledu(e), "blad"));
  }

  function utrwal(nowy: StanWygladu) {
    stan = nowy;
    ustawStan(stan);
    naloz(ciemno());
    rysuj();
    void zapiszKonfig(doKonfigu(stan));
  }

  function wybierz(id: IdMotywu) {
    utrwal({ motyw: id, wlasny: id === "wlasny" ? stan.wlasny ?? { ...DOMYSLNY_WLASNY } : stan.wlasny });
  }

  function kafel(id: IdMotywu) {
    const aktywny = stan.motyw === id;
    const p = probki(id, ciemno(), id === "wlasny" ? stan.wlasny ?? DOMYSLNY_WLASNY : null);
    return h(
      "button",
      {
        type: "button",
        class: `kafel-n kafel-motywu${aktywny ? " aktywny" : ""}`,
        "aria-pressed": String(aktywny),
        tabindex: aktywny ? "0" : "-1",
        "data-motyw": id,
        onclick: () => wybierz(id),
      },
      h(
        "span",
        { class: "motyw-podglad", "aria-hidden": "true", style: { background: p.tlo } },
        h("i", { style: { background: p.bok } }),
        h("i", { style: { background: p.panel } }, h("i", { class: "motyw-pasek", style: { background: p.akcent } })),
      ),
      h("b", { class: "tnij", title: t(`motyw2.${id}`) }, t(`motyw2.${id}`)),
      h("small", null, t(`motyw2.${id}.opis`)),
      aktywny ? h("span", { class: "wybrany-znak" }, ikona(IKONY.ok, "ikona ic m"), t("motyw.wybrany")) : null,
    );
  }

  /** Strzałki w siatce kafli TYLKO przesuwają fokus; motyw zmienia klik albo Enter/spacja. */
  function klawiszeKafli(e: KeyboardEvent) {
    const kafle = [...(e.currentTarget as HTMLElement).querySelectorAll<HTMLButtonElement>(".kafel-motywu")];
    const i = kafle.indexOf(document.activeElement as HTMLButtonElement);
    if (i < 0) return;
    const n = kafle.length;
    const j =
      e.key === "ArrowRight" || e.key === "ArrowDown" ? (i + 1) % n
      : e.key === "ArrowLeft" || e.key === "ArrowUp" ? (i - 1 + n) % n
      : e.key === "Home" ? 0
      : e.key === "End" ? n - 1
      : -1;
    if (j < 0) return;
    e.preventDefault();
    kafle.forEach((x, idx) => (x.tabIndex = idx === j ? 0 : -1));
    kafle[j].focus();
  }

  function wlasny(w: MotywWlasny): HTMLElement {
    const ustaw = (z: Partial<MotywWlasny>) => utrwal({ motyw: "wlasny", wlasny: { ...w, ...z } });
    const kolor = h("input", { type: "color", class: "kolor-akcentu", value: w.akcent, "aria-label": t("motyw2.akcent") }) as HTMLInputElement;
    // podgląd na żywo przy przeciąganiu, zapis po puszczeniu
    kolor.addEventListener("input", () => naloz(ciemno(), { motyw: "wlasny", wlasny: { ...w, akcent: kolor.value } }));
    kolor.addEventListener("change", () => ustaw({ akcent: kolor.value }));
    const baza = h(
      "select",
      { class: "wybor", "aria-label": t("motyw2.baza"), onchange: (e: Event) => ustaw({ baza: (e.target as HTMLSelectElement).value as Baza }) },
      BAZY.map((b) => h("option", { value: b, selected: b === w.baza }, t(`motyw2.${b}`))),
    );
    return h(
      "div",
      { class: "grupa-d" },
      h("div", { class: "sekcja-g" }, h("h3", null, t("motyw2.wlasny")), h("span", null, t("motyw2.wlasny.pomoc"))),
      h(
        "div",
        { class: "wiersz-zawijany" },
        h("label", { class: "pole-w" }, t("motyw2.akcent"), kolor),
        h("label", { class: "pole-w" }, t("motyw2.baza"), baza),
        h(
          "div",
          { class: "szybkie-akcenty", role: "group", "aria-label": t("motyw2.szybkie") },
          SZYBKIE_AKCENTY.map((c) =>
            h("button", { type: "button", class: "kropka-akcentu", style: { background: c }, "aria-label": t("motyw2.akcent_x", { kolor: c }), "aria-pressed": String(c === w.akcent), onclick: () => ustaw({ akcent: c }) }),
          ),
        ),
        przycisk([ikona(IKONY.pobierzPlik, "ikona ic m"), t("motyw2.eksportuj")], async () => {
          try {
            if (await api.motywEksportuj(doPliku(w), "soraflux-motyw.json")) pokazDymek(t("motyw2.wyeksportowano"));
          } catch (e) {
            pokazDymek(tekstBledu(e), "blad");
          }
        }, "btn"),
        przycisk([ikona(IKONY.upusc, "ikona ic m"), t("motyw2.importuj")], async () => {
          try {
            const tekst = await api.motywImportuj();
            if (tekst === null) return;
            const m = zPliku(tekst);
            if (!m) throw new Error(t("motyw.import_blad"));
            utrwal({ motyw: "wlasny", wlasny: m });
            pokazDymek(t("motyw2.zaimportowano"));
          } catch (e) {
            pokazDymek(e instanceof Error ? e.message : tekstBledu(e), "blad");
          }
        }, "btn cichy"),
      ),
    );
  }

  function rysuj() {
    stan = wczytaj();
    const k = sklep.stan.konfig;
    const skala = biezacaSkala();
    zamien(
      el,
      h("div", { class: "pole-w kolumna" }, h("span", { class: "etyk-s" }, t("motyw.tytul")),
        h("div", { class: "motywy siatka-n trzy", role: "group", "aria-label": t("motyw.tytul"), onkeydown: klawiszeKafli }, ID_MOTYWOW.map(kafel)),
      ),
      stan.motyw === "wlasny" ? wlasny(stan.wlasny ?? DOMYSLNY_WLASNY) : null,
      h("div", { class: "pole-w kolumna" }, h("span", { class: "etyk-s" }, t("ustawienia.motyw")),
        seg<Konfig["motyw"]>(
          [
            { v: "system", e: t("ustawienia.motyw.system"), ikona: IKONY.monitor },
            { v: "dark", e: t("ustawienia.motyw.ciemny"), ikona: IKONY.ksiezyc },
            { v: "light", e: t("ustawienia.motyw.jasny"), ikona: IKONY.slonce },
          ],
          k?.motyw ?? "system",
          (v) => void zapiszKonfig({ motyw: v }),
          t("ustawienia.motyw"),
          "tryb-jasnosci",
        ),
      ),
      h("div", { class: "pole-w kolumna" }, h("span", { class: "etyk-s" }, t("skala.tytul"), " ", h("span", { class: "tx3" }, t("skala.skroty"))),
        seg<number>(SKALE.map((s) => ({ v: s, e: `${Math.round(s * 100)}%` })), skala, (v) => void ustawSkale(v), t("skala.tytul"), "skala-seg"),
      ),
    );
  }

  rysuj();
  return el;
}

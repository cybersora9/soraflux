// Ustawienia → Wygląd: kafle motywów (wbudowane + własne), edytor własnego motywu z podglądem na żywo,
// eksport do schowka i import z pliku .json. Zapis w konfigu (Rust), nie w localStorage.
// Motyw zmienia się TYLKO kliknięciem kafla (pointer) albo Enterem/spacją na kaflu, który
// użytkownik sam wybrał klawiaturą; patrz `aktywujKafel` (usterka 5 z testów 07.10).
import { api } from "../api";
import { h } from "../dom";
import { t, tekstBledu } from "../i18n";
import {
  EDYTOWALNE,
  WBUDOWANE,
  czyCiemny,
  kontrast,
  naloz,
  doKonfigu,
  nowyId,
  ustawStan,
  wczytaj,
  zImportu,
  znajdz,
  type Edytowalny,
  type Kolory,
  type Motyw,
  type MotywWlasny,
  type StanWygladu,
} from "../motywy";
import { pokazDymek, sklep } from "../sklep";
import { pole, przycisk, uwaga, wybor } from "./pola";

const OPISY_WARIANTOW: Record<Motyw["wariant"], string> = {
  a: "motyw.wariant_a",
  b: "motyw.wariant_b",
  c: "motyw.wariant_c",
};

const ETYKIETY: Record<Edytowalny, string> = {
  tlo: "motyw.kolor.tlo",
  karta: "motyw.kolor.karta",
  tekst: "motyw.kolor.tekst",
  akcent: "motyw.kolor.akcent",
  pom1: "motyw.kolor.pom1",
  pom2: "motyw.kolor.pom2",
};

/** Kolor do pola <input type=color>: tylko #rrggbb, inaczej przybliżenie z bazy. */
function doPola(v: string, zapas: string): string {
  return /^#[0-9a-f]{6}$/i.test(v) ? v : /^#[0-9a-f]{6}$/i.test(zapas) ? zapas : "#808080";
}

export function sekcjaMotywow(): HTMLElement {
  const el = h("div", { class: "kolumna" });
  let stan: StanWygladu = wczytaj();
  let edycja: MotywWlasny | null = null;
  const ciemno = () => czyCiemny(sklep.stan.konfig?.motyw);
  const plik = h("input", { type: "file", accept: ".json,application/json", class: "ukryty-plik" }) as HTMLInputElement;

  function utrwal(nowy: StanWygladu) {
    stan = nowy;
    ustawStan(stan);
    naloz(ciemno());
    rysuj();
    const k = sklep.stan.konfig;
    if (!k) return;
    const konfig = { ...k, ...doKonfigu(stan) };
    sklep.ustaw({ konfig });
    void api.konfigZapisz(konfig).catch((e) => pokazDymek(tekstBledu(e), "blad"));
  }

  function wybierz(id: string) {
    edycja = null;
    utrwal({ ...stan, motyw: id });
  }

  function podglad() {
    if (!edycja) return;
    const baza = WBUDOWANE.find((m) => m.id === edycja!.baza) ?? WBUDOWANE[0];
    const tymczasowy = znajdz(edycja.id, { motyw: edycja.id, wlasne: [edycja] });
    naloz(ciemno(), { ...tymczasowy, wariant: baza.wariant });
  }

  function kafel(m: Motyw, wlasny: boolean) {
    const k = ciemno() ? m.ciemny : m.jasny;
    const aktywny = stan.motyw === m.id;
    return h(
      "button",
      {
        type: "button",
        role: "radio",
        class: `motyw-kafel${aktywny ? " aktywny" : ""}`,
        "aria-checked": String(aktywny),
        // jeden kafel w kolejności Tab (roving tabindex), reszta strzałkami
        tabindex: aktywny ? "0" : "-1",
        "data-motyw": m.id,
        onclick: () => wybierz(m.id),
      },
      h(
        "span",
        { class: "motyw-probki", "aria-hidden": "true" },
        [k.tlo, k.karta, k.akcent, k.pom1, k.tekst].map((c) => h("span", { style: { background: c } })),
      ),
      h("span", { class: "motyw-nazwa" }, m.nazwa),
      h("span", { class: "motyw-opis" }, wlasny ? t("motyw.wlasny") : t(OPISY_WARIANTOW[m.wariant])),
    );
  }

  /** Strzałki w siatce kafli TYLKO przesuwają fokus; motyw zmienia klik albo Enter/spacja.
   *  (W zwykłym radiogroup strzałka od razu wybiera: tu przypadkowe klawisze nie mogą zmienić wyglądu.) */
  function klawiszeKafli(e: KeyboardEvent) {
    const kafle = [...(e.currentTarget as HTMLElement).querySelectorAll<HTMLButtonElement>(".motyw-kafel")];
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

  function edytor(e: MotywWlasny) {
    const tryb: "jasny" | "ciemny" = ciemno() ? "ciemny" : "jasny";
    const baza = WBUDOWANE.find((m) => m.id === e.baza) ?? WBUDOWANE[0];
    const bazowe: Kolory = baza[tryb];
    const biezace = { ...bazowe, ...e[tryb] };
    const ostrzezenia: string[] = [];
    const kt = kontrast(doPola(biezace.tekst, bazowe.tekst), doPola(biezace.tlo, bazowe.tlo));
    if (kt !== null && kt < 4.5) ostrzezenia.push(t("motyw.kontrast_tekst", { k: kt.toFixed(1) }));
    const ktk = kontrast(doPola(biezace.tekst, bazowe.tekst), doPola(biezace.karta, bazowe.karta));
    if (ktk !== null && ktk < 4.5) ostrzezenia.push(t("motyw.kontrast_karta", { k: ktk.toFixed(1) }));

    const nazwa = h("input", { class: "tekst", value: e.nazwa, maxlength: "40", oninput: (ev: Event) => (e.nazwa = (ev.target as HTMLInputElement).value) }) as HTMLInputElement;
    return h(
      "div",
      { class: "edytor-motywu" },
      h(
        "div",
        { class: "siatka-pol" },
        pole(t("motyw.nazwa"), nazwa),
        pole(
          t("motyw.baza"),
          wybor(
            WBUDOWANE.map((m) => ({ wartosc: m.id, etykieta: m.nazwa })),
            e.baza,
            (v) => {
              e.baza = v;
              podglad();
              rysuj();
            },
          ),
          t("motyw.baza_pomoc"),
        ),
      ),
      h("p", { class: "pole-pomoc" }, t(tryb === "ciemny" ? "motyw.edytujesz_ciemny" : "motyw.edytujesz_jasny")),
      h(
        "div",
        { class: "edytor-kolory" },
        EDYTOWALNE.map((klucz) =>
          h(
            "label",
            { class: "kolor-pole" },
            h("input", {
              type: "color",
              value: doPola(biezace[klucz] ?? "", bazowe[klucz] ?? ""),
              oninput: (ev: Event) => {
                e[tryb] = { ...e[tryb], [klucz]: (ev.target as HTMLInputElement).value };
                podglad();
              },
              onchange: () => rysuj(),
            }),
            t(ETYKIETY[klucz]),
          ),
        ),
      ),
      ostrzezenia.length ? uwaga("uwaga", ostrzezenia.join(" ")) : null,
      h(
        "div",
        { class: "motyw-akcje" },
        przycisk(t("motyw.zapisz"), () => {
          e.nazwa = e.nazwa.trim() || t("motyw.bez_nazwy");
          const wlasne = stan.wlasne.some((m) => m.id === e.id) ? stan.wlasne.map((m) => (m.id === e.id ? e : m)) : [...stan.wlasne, e];
          edycja = null;
          utrwal({ motyw: e.id, wlasne });
          pokazDymek(t("motyw.zapisano", { nazwa: e.nazwa }));
        }, "przycisk-maly"),
        przycisk(t("motyw.przywroc_kolory"), () => {
          e[tryb] = {};
          podglad();
          rysuj();
        }, "przycisk-maly przycisk-drugorzedny"),
        przycisk(t("motyw.anuluj"), () => {
          edycja = null;
          naloz(ciemno());
          rysuj();
        }, "przycisk-maly przycisk-drugorzedny"),
      ),
    );
  }

  function rysuj() {
    if (!edycja) stan = wczytaj();
    const aktywnyWlasny = stan.wlasne.find((m) => m.id === stan.motyw) ?? null;
    el.replaceChildren(
      h("span", { class: "pole-etykieta" }, t("motyw.tytul")),
      h(
        "div",
        { class: "motywy", role: "radiogroup", "aria-label": t("motyw.tytul"), onkeydown: klawiszeKafli },
        WBUDOWANE.map((m) => kafel(m, false)),
        stan.wlasne.map((w) => kafel(znajdz(w.id, stan), true)),
      ),
      h(
        "div",
        { class: "motyw-akcje" },
        przycisk(t("motyw.nowy"), () => {
          const baza = WBUDOWANE.find((m) => m.id === stan.motyw)?.id ?? aktywnyWlasny?.baza ?? WBUDOWANE[0].id;
          edycja = { id: nowyId(), nazwa: t("motyw.moj"), baza, jasny: {}, ciemny: {} };
          podglad();
          rysuj();
        }, "przycisk-maly"),
        aktywnyWlasny
          ? przycisk(t("motyw.edytuj"), () => {
              edycja = JSON.parse(JSON.stringify(aktywnyWlasny)) as MotywWlasny;
              rysuj();
            }, "przycisk-maly przycisk-drugorzedny")
          : null,
        aktywnyWlasny
          ? przycisk(t("motyw.usun"), () => {
              utrwal({ motyw: aktywnyWlasny.baza, wlasne: stan.wlasne.filter((m) => m.id !== aktywnyWlasny.id) });
              pokazDymek(t("motyw.usunieto", { nazwa: aktywnyWlasny.nazwa }));
            }, "przycisk-maly przycisk-drugorzedny")
          : null,
        aktywnyWlasny
          ? przycisk(t("motyw.eksport"), async () => {
              const { id: _id, ...dane } = aktywnyWlasny;
              await api.piszSchowek(JSON.stringify({ soraconverter_motyw: 1, ...dane }, null, 2));
              pokazDymek(t("motyw.eksport_gotowy"));
            }, "przycisk-maly przycisk-drugorzedny")
          : null,
        przycisk(t("motyw.import"), () => plik.click(), "przycisk-maly przycisk-drugorzedny"),
        plik,
      ),
      ...(edycja ? [edytor(edycja)] : []),
    );
  }

  plik.addEventListener("change", async () => {
    const f = plik.files?.[0];
    plik.value = "";
    if (!f) return;
    try {
      const m = zImportu(JSON.parse(await f.text()));
      if (!m) throw new Error("zly");
      utrwal({ motyw: m.id, wlasne: [...stan.wlasne, m] });
      pokazDymek(t("motyw.zaimportowano", { nazwa: m.nazwa }));
    } catch {
      pokazDymek(t("motyw.import_blad"), "blad");
    }
  });

  rysuj();
  return el;
}

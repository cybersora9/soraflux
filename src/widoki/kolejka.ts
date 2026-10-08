// Zakładka Kolejka: zadania z postępem, ETA, prędkością, anulowanie, „otwórz folder”.
import { api } from "../api";
import { h, ikona } from "../dom";
import { IKONY } from "../ikony";
import { jezyk, t, tlumaczBlad } from "../i18n";
import { formatujCzas, formatujEta, formatujRozmiar, sciezkaDoPokazania, zmianaRozmiaru } from "../logika";
import { liczba, przycisk } from "../komponenty/pola";
import { sklep } from "../sklep";
import type { InfoZadania, Postep } from "../typy";

function etykietaStanu(z: InfoZadania): string {
  if (z.stan.typ === "gotowe" && z.ostrzezenie) return t("stan.gotowe_ostrzezenie");
  return t(`stan.${z.stan.typ}`);
}

/** Opis ostrzeżenia „gotowe z ostrzeżeniem”. */
export function opisOstrzezenia(z: InfoZadania): string | null {
  const o = z.ostrzezenie;
  if (!o) return null;
  return t("kolejka.uciete", { czas: formatujCzas(o.zrodlo_konczy_s), oczekiwane: formatujCzas(o.oczekiwane_s) });
}

function wiersz(z: InfoZadania, p: Postep | undefined): HTMLElement {
  const procent = z.stan.typ === "gotowe" ? 100 : (p?.procent ?? z.procent);
  const szczegoly: string[] = [];
  if (z.stan.typ === "trwa") {
    szczegoly.push(`${Math.floor(procent)}%`);
    if (p?.przebiegi && p.przebiegi > 1) szczegoly.push(t("kolejka.przebieg", { i: p.przebieg, n: p.przebiegi }));
    if (p?.predkosc_x) szczegoly.push(`${p.predkosc_x.toFixed(1)}×`);
    if (p?.bajty_s) szczegoly.push(`${formatujRozmiar(p.bajty_s, jezyk())}/s`);
    if (p?.eta_s) szczegoly.push(t("kolejka.eta", { czas: formatujEta(p.eta_s) }));
  }
  const akcje: HTMLElement[] = [];
  if (z.stan.typ === "trwa" || z.stan.typ === "oczekuje") {
    akcje.push(przycisk(t("kolejka.anuluj"), () => void api.anulujZadanie(z.id), "przycisk-maly"));
  }
  const wynik = z.stan.typ === "gotowe" || z.stan.typ === "pominiete" ? sciezkaDoPokazania(z.stan.wyjscie) : null;
  const ostrz = z.stan.typ === "gotowe" ? opisOstrzezenia(z) : null;
  const nieokreslony = z.stan.typ === "trwa" && !!p?.nieokreslony;
  if (nieokreslony) szczegoly.splice(0, 1, t("kolejka.nieokreslony"));
  const porownanie = wynik && z.rozmiar_wejscia && z.rozmiar_wyniku
    ? `${formatujRozmiar(z.rozmiar_wejscia, jezyk())} → ${formatujRozmiar(z.rozmiar_wyniku, jezyk())} (${zmianaRozmiaru(z.rozmiar_wejscia, z.rozmiar_wyniku)})`
    : null;
  if (wynik) {
    akcje.push(przycisk([ikona(IKONY.folder), t("kolejka.otworz_folder")], () => void api.pokazWFolderze(wynik), "przycisk-maly"));
  }
  return h(
    "li",
    { class: `zadanie zadanie-${z.stan.typ}${ostrz ? " zadanie-ostrzezenie" : ""}` },
    ikona(z.rodzaj === "pobranie" ? IKONY.pobierz : IKONY.konwertuj, "ikona zadanie-ikona"),
    h(
      "div",
      { class: "zadanie-srodek" },
      h(
        "div",
        { class: "zadanie-gora" },
        h("span", { class: "zadanie-nazwa", title: z.nazwa }, z.nazwa),
        h("span", { class: `stan stan-${z.stan.typ}${ostrz ? " stan-ostrzezenie" : ""}` }, etykietaStanu(z)),
      ),
      h(
        "div",
        {
          class: "pasek" + (nieokreslony ? " pasek-nieokreslony" : ""),
          role: "progressbar",
          "aria-valuemin": "0",
          "aria-valuemax": "100",
          "aria-valuenow": nieokreslony ? undefined : String(Math.floor(procent)),
          "aria-label": z.nazwa,
        },
        h("div", { class: "pasek-wypelnienie", style: { width: `${procent}%` } }),
      ),
      h(
        "div",
        { class: "zadanie-dol" },
        z.stan.typ === "blad"
          ? h("details", { class: "zadanie-blad-szczegoly" }, h("summary", null, t("kolejka.blad_szczegoly")), h("pre", null, tlumaczBlad(z.stan.komunikat)))
          : h(
              "span",
              { class: "zadanie-szczegoly", title: wynik ?? undefined },
              z.stan.typ === "pominiete" ? t("kolejka.pominiete_opis") : wynik ? (porownanie ?? wynik) : szczegoly.join(" · "),
            ),
      ),
      z.awaria_sprzetu ? h("div", { class: "zadanie-uwaga" }, ikona(IKONY.info), t("kolejka.awaria_sprzetu")) : null,
      ostrz ? h("div", { class: "zadanie-uwaga zadanie-uwaga-mocna" }, ikona(IKONY.uwaga), ostrz) : null,
    ),
    h("div", { class: "zadanie-akcje" }, akcje),
  );
}

export function stworzWidokKolejki(): { el: HTMLElement; odswiez(): void } {
  const el = h("div", { class: "widok widok-kolejka" });
  const lista = h("ul", { class: "zadania", "aria-live": "polite" });
  const gora = h("div", { class: "kolejka-pasek" });

  function rysujGore() {
    const k = sklep.stan.konfig;
    gora.replaceChildren(
      h(
        "label",
        { class: "rownolegle" },
        h("span", null, t("kolejka.rownolegle")),
        liczba(k?.rownolegle ?? 2, { min: 1, max: 8, szerokosc: "4em" }, async (v) => {
          if (!sklep.stan.konfig || !v) return;
          const nowy = { ...sklep.stan.konfig, rownolegle: v };
          await api.konfigZapisz(nowy);
          sklep.ustaw({ konfig: nowy });
        }),
      ),
      przycisk(t("kolejka.wyczysc"), async () => {
        await api.wyczyscZakonczone();
        const zadania = new Map((await api.listaZadan()).map((z) => [z.id, z]));
        sklep.ustaw({ zadania });
      }, "przycisk-drugorzedny"),
    );
  }

  function rysujListe() {
    const zadania = [...sklep.stan.zadania.values()].sort((a, b) => a.id - b.id);
    if (zadania.length === 0) {
      lista.replaceChildren(h("li", { class: "pusto" }, ikona(IKONY.kolejka, "ikona pusto-ikona"), h("p", null, t("kolejka.pusto"))));
      return;
    }
    lista.replaceChildren(...zadania.map((z) => wiersz(z, sklep.stan.postepy.get(z.id))));
  }

  const naglowek = h("header", { class: "naglowek" });
  el.append(naglowek, gora, h("div", { class: "karta karta-lista" }, lista));

  let ostatnieZadania = sklep.stan.zadania;
  let ostatniePostepy = sklep.stan.postepy;
  sklep.subskrybuj((s) => {
    if (s.zadania !== ostatnieZadania || s.postepy !== ostatniePostepy) {
      ostatnieZadania = s.zadania;
      ostatniePostepy = s.postepy;
      rysujListe();
    }
  });

  function odswiez() {
    naglowek.replaceChildren(h("div", null, h("h1", null, t("zakladka.kolejka")), h("p", { class: "podtytul" }, t("kolejka.podtytul"))));
    rysujGore();
    rysujListe();
  }
  odswiez();
  return { el, odswiez };
}

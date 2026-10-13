// Narzędzia (GUI 2.0, makieta: „Narzędzia”): tylko te z działającym backendem (P1): zmiana kontenera,
// wyodrębnij ścieżki, połącz klipy, wyrównaj głośność (loudnorm 2 przebiegi), kadruj/obróć/odbij,
// plus napisy z mowy (przepis na Taśmie). Działają na plikach z Taśmy albo wybranych tutaj.
import { api } from "../api";
import { h, ikona } from "../dom";
import { IKONY } from "../ikony";
import { t, tekstBledu } from "../i18n";
import { nazwaPliku, toObraz } from "../logika";
import {
  CELE_LUFS, geometriaPusta, KONTENERY_ZMIANY, kopiaMozliwa, NARZEDZIA, PROPORCJE, profilGeometrii, profilGlosnosci, profilKontenera,
  type Geometria, type Narzedzie,
} from "../obrobka";
import { dymekDodano, pokazDymek, sklep } from "../sklep";
import type { Kontener, Media, NoweZadanie, Obrot } from "../typy";
import { pil, przelacznik2, segment2 } from "./wspolne2";

export interface WidokNarzedzi {
  el: HTMLElement;
  odswiez(): void;
  wybierz(n: Narzedzie): void;
}

const IKONA: Record<Narzedzie, string> = { kontener: IKONY.warstwy, sciezki: IKONY.kolejka, polacz: IKONY.polacz, glosnosc: IKONY.glosnosc, kadr: IKONY.kadr };
const GRUPA: Record<Narzedzie, string> = { kontener: "bez_straty", sciezki: "bez_straty", polacz: "bez_straty", glosnosc: "dzwiek", kadr: "obraz" };

export function stworzWidokNarzedzi(o: { plikiTasmy: () => string[]; doTasmyNapisy: () => void }): WidokNarzedzi {
  let wybrane: Narzedzie = "kontener";
  let wlasne: string[] | null = null;
  const media = new Map<string, Media | null>();
  let kontener: Kontener = "mp4";
  let kontenerPolaczenia: Kontener = "mp4";
  let lufs: number = CELE_LUFS[0];
  let geom: Geometria = { proporcje: "bez", obrot: "brak", poziomo: false, pionowo: false };
  let podglad: { przed: string; po: string } | null = null;
  let pokolenie = 0;

  const el = h("div", { class: "v2 ekran-2", "data-ekran": "narzedzia" });
  const lewa = h("div", { class: "l" });
  const prawa = h("aside", { class: "panel2c", "aria-label": t("narzedzia2.narzedzie") });
  el.append(lewa, prawa);

  const pliki = () => (wlasne ?? o.plikiTasmy()).filter((p) => !toObraz(p));

  async function sonduj() {
    const brak = pliki().filter((p) => !media.has(p));
    if (!brak.length) return;
    await Promise.all(brak.map(async (p) => media.set(p, await api.sonda(p).catch(() => null))));
    rysujPanel();
  }

  async function podgladKadru() {
    const p = pliki()[0];
    const m = p ? media.get(p) : null;
    if (wybrane !== "kadr" || !p || !m?.wideo) return (podglad = null);
    const moje = ++pokolenie;
    try {
      const k = await api.podgladKlatki(p, m, profilGeometrii(p, m, geom), null);
      if (moje === pokolenie) podglad = { przed: k.przed, po: k.po };
    } catch {
      podglad = null;
    }
    rysujPanel();
  }

  function rysuj() {
    const fokus = document.activeElement instanceof HTMLElement && el.contains(document.activeElement) ? document.activeElement.dataset.fokus : undefined;
    const grupy = ["bez_straty", "dzwiek", "obraz", "napisy"];
    lewa.replaceChildren(
      h("div", { class: "naglowek2" }, h("h2", { class: "tytul-ekr" }, t("zakladka.narzedzia")), h("span", { class: "opis" }, t("narzedzia2.podtytul"))),
      ...grupy.flatMap((g) => [
        h("div", { class: "sekcja-g" }, h("h2", null, t(`narzedzia2.grupa.${g}`))),
        h(
          "div",
          { class: "siatka-n", role: "group", "aria-label": t(`narzedzia2.grupa.${g}`) },
          g === "napisy"
            ? h(
                "button",
                { type: "button", class: "kafel-n", "aria-pressed": "false", "data-fokus": "n-napisy", onclick: () => o.doTasmyNapisy() },
                h("span", { class: "ik" }, ikona(IKONY.napisy, "ikona ic m")),
                h("b", null, t("prosty.akcja.film.napisy")),
                h("small", null, t("narzedzia2.napisy.opis")),
                h("span", { class: "pigi" }, h("span", { class: "pigu jest" }, t("narzedzia2.na_tasmie"))),
              )
            : NARZEDZIA.filter((n) => GRUPA[n] === g).map((n) =>
                h(
                  "button",
                  { type: "button", class: "kafel-n", "aria-pressed": String(n === wybrane), "data-narzedzie": n, "data-fokus": `n-${n}`, onclick: () => wybierz(n) },
                  h("span", { class: "ik" }, ikona(IKONA[n], "ikona ic m")),
                  h("b", { title: t(`narzedzia2.${n}`) }, t(`narzedzia2.${n}`)),
                  h("small", null, t(`narzedzia2.${n}.opis`)),
                  h("span", { class: "pigi" }, h("span", { class: "pigu ak" }, t(n === "glosnosc" || n === "kadr" ? "narzedzia2.koduje" : "narzedzia2.bez_kodowania"))),
                ),
              ),
        ),
      ]),
    );
    rysujPanel();
    if (fokus) el.querySelector<HTMLElement>(`[data-fokus="${fokus}"]`)?.focus();
  }

  function wybierz(n: Narzedzie) {
    wybrane = n;
    podglad = null;
    rysuj();
    void sonduj().then(() => podgladKadru());
  }

  /** Pliki, na których narzędzie nie zadziała, z powodem (klucz i18n). */
  function problemy(): Map<string, string> {
    const wynik = new Map<string, string>();
    for (const p of pliki()) {
      const m = media.get(p);
      if (m === undefined) continue;
      if (m === null) wynik.set(p, "narzedzia2.problem.odczyt");
      else if (wybrane === "kontener" && !kopiaMozliwa(m, kontener)) wynik.set(p, "narzedzia2.problem.kontener");
      else if (wybrane === "glosnosc" && !m.audio) wynik.set(p, "narzedzia2.problem.bez_dzwieku");
      else if (wybrane === "kadr" && (!m.wideo || m.obraz)) wynik.set(p, "narzedzia2.problem.bez_obrazu");
    }
    return wynik;
  }

  function zadania(): NoweZadanie[] {
    const pr = problemy();
    const ok = pliki().filter((p) => !pr.has(p) && media.get(p));
    const katalog = sklep.stan.konfig?.katalog_wyjscia ?? null;
    switch (wybrane) {
      case "sciezki":
        return ok.map((p) => ({ rodzaj: { typ: "sciezki", wejscie: p }, katalog }));
      case "polacz":
        return ok.length >= 2 ? [{ rodzaj: { typ: "polacz", wejscia: ok, kontener: kontenerPolaczenia }, katalog, dopisek: t("narzedzia2.polacz.dopisek") }] : [];
      case "kontener":
        return ok.map((p) => ({ rodzaj: { typ: "konwersja", wejscie: p, profil: profilKontenera(kontener, media.get(p)!) }, katalog }));
      case "glosnosc":
        return ok.map((p) => ({ rodzaj: { typ: "konwersja", wejscie: p, profil: profilGlosnosci(p, media.get(p)!, lufs) }, katalog, dopisek: t("prosty.dopisek.glosnosc") }));
      case "kadr":
        return geometriaPusta(geom) ? [] : ok.map((p) => ({ rodzaj: { typ: "konwersja", wejscie: p, profil: profilGeometrii(p, media.get(p)!, geom) }, katalog, dopisek: t("narzedzia2.kadr.dopisek") }));
    }
  }

  async function uruchom() {
    const z = zadania();
    if (!z.length) return;
    try {
      const ids = await api.dodajZadania(z);
      dymekDodano(ids.length, t);
    } catch (e) {
      pokazDymek(tekstBledu(e), "blad");
    }
  }

  function opcje(): (HTMLElement | null)[] {
    switch (wybrane) {
      case "kontener":
        return [
          h("div", { class: "pole-w kolumna" }, h("span", { class: "etyk-s" }, t("narzedzia2.kontener.na")),
            segment2(KONTENERY_ZMIANY.map((k) => ({ v: k, e: k.toUpperCase() })), kontener, (v) => ((kontener = v), rysujPanel()), t("narzedzia2.kontener.na"))),
          h("small", { class: "tx3" }, t("narzedzia2.kontener.pomoc")),
        ];
      case "polacz":
        return [
          h("div", { class: "pole-w kolumna" }, h("span", { class: "etyk-s" }, t("narzedzia2.polacz.wynik")),
            segment2((["mp4", "mkv", "mov", "webm", "mp3", "m4a", "wav"] as Kontener[]).map((k) => ({ v: k, e: k.toUpperCase() })), kontenerPolaczenia, (v) => ((kontenerPolaczenia = v), rysujPanel()), t("narzedzia2.polacz.wynik"))),
          h("small", { class: "tx3" }, t("narzedzia2.polacz.pomoc")),
          pliki().length > 1 ? h("ol", { class: "lista-kolejnosci mono", style: { margin: "0", paddingLeft: "18px", fontSize: "12px" } }, pliki().map((p) => h("li", { class: "tnij", title: p }, nazwaPliku(p)))) : null,
        ];
      case "glosnosc":
        return [
          h("div", { class: "pole-w kolumna" }, h("span", { class: "etyk-s" }, t("narzedzia2.glosnosc.cel")),
            segment2(CELE_LUFS.map((l) => ({ v: l, e: t(`narzedzia2.glosnosc.${-l}`) })), lufs, (v) => ((lufs = v), rysujPanel()), t("narzedzia2.glosnosc.cel"))),
          h("small", { class: "tx3" }, t("narzedzia2.glosnosc.pomoc")),
        ];
      case "kadr":
        return [
          h("div", { class: "pole-w kolumna" }, h("span", { class: "etyk-s" }, t("narzedzia2.kadr.proporcje")),
            segment2(PROPORCJE.map((p) => ({ v: p, e: p === "bez" ? t("narzedzia2.kadr.bez") : p })), geom.proporcje, (v) => zmienGeom({ proporcje: v }), t("narzedzia2.kadr.proporcje"))),
          h("div", { class: "pole-w kolumna" }, h("span", { class: "etyk-s" }, t("narzedzia2.kadr.obrot")),
            segment2((["brak", "o90", "o180", "o270"] as Obrot[]).map((v) => ({ v, e: v === "brak" ? "0°" : `${v.slice(1)}°` })), geom.obrot, (v) => zmienGeom({ obrot: v }), t("narzedzia2.kadr.obrot"))),
          h("div", { class: "wiersz-op" }, h("span", null, t("narzedzia2.kadr.poziomo")), przelacznik2(geom.poziomo, (v) => zmienGeom({ poziomo: v }), t("narzedzia2.kadr.poziomo"), "poziomo")),
          h("div", { class: "wiersz-op" }, h("span", null, t("narzedzia2.kadr.pionowo")), przelacznik2(geom.pionowo, (v) => zmienGeom({ pionowo: v }), t("narzedzia2.kadr.pionowo"), "pionowo")),
          podglad ? h("div", { class: "kadr-podglad", style: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: "6px" } },
            h("img", { src: podglad.przed, alt: t("porownaj.oryginal"), style: { width: "100%", borderRadius: "10px" } }),
            h("img", { src: podglad.po, alt: t("porownaj.wynik"), style: { width: "100%", borderRadius: "10px" } })) : null,
        ];
      case "sciezki":
        return [h("small", { class: "tx3" }, t("narzedzia2.sciezki.pomoc"))];
    }
  }

  function zmienGeom(z: Partial<Geometria>) {
    geom = { ...geom, ...z };
    rysujPanel();
    void podgladKadru();
  }

  function rysujPanel() {
    const lista = pliki();
    const pr = problemy();
    const z = zadania();
    const fokus = document.activeElement instanceof HTMLElement && prawa.contains(document.activeElement) ? document.activeElement.dataset.fokus : undefined;
    prawa.replaceChildren(
      h("div", { class: "panel-g" }, h("span", { class: "etyk-s" }, t("narzedzia2.narzedzie")), h("h3", null, t(`narzedzia2.${wybrane}`))),
      h(
        "div",
        { class: "panel-s" },
        h("p", { class: "tx3", style: { margin: "0", fontSize: "13px" } }, t(`narzedzia2.${wybrane}.opis`)),
        ...opcje(),
        h("div", { class: "wiersz-op" }, h("span", null, wlasne ? t("narzedzia2.pliki.wybrane") : t("narzedzia2.pliki.tasma")), h("span", { class: "pigu" }, String(lista.length))),
        h("div", { class: "wiersz-zawijany" },
          pil(t("narzedzia2.pliki.wybierz"), false, async () => {
            const s = await api.wybierzPliki(false);
            if (s.length) {
              wlasne = s;
              await sonduj();
              void podgladKadru();
              rysujPanel();
            }
          }, { "data-fokus": "wybierz-pliki" }, IKONY.upusc),
          wlasne ? pil(t("narzedzia2.pliki.z_tasmy"), false, () => ((wlasne = null), void sonduj(), rysujPanel()), { "data-fokus": "z-tasmy" }) : null,
        ),
        pr.size ? h("div", { class: "baner" }, ikona(IKONY.uwaga, "ikona ic m"), h("span", null, [...pr].slice(0, 4).map(([p, k]) => h("span", { style: { display: "block" } }, `${nazwaPliku(p)}: ${t(k)}`)))) : null,
        wybrane === "polacz" && lista.length < 2 ? h("div", { class: "baner" }, ikona(IKONY.info, "ikona ic m"), h("span", null, t("narzedzia2.polacz.min"))) : null,
      ),
      h(
        "div",
        { class: "panel-d" },
        h("button", { type: "button", class: "btn-wcisk", style: { width: "100%" }, disabled: !z.length, "data-fokus": "uruchom", title: t("narzedzia2.uruchom"), onclick: () => void uruchom() },
          ikona(IKONY.start, "ikona ic m"), z.length > 1 ? t("narzedzia2.uruchom_n", { n: z.length }) : t("narzedzia2.uruchom")),
      ),
    );
    if (fokus) prawa.querySelector<HTMLElement>(`[data-fokus="${fokus}"]`)?.focus();
  }

  rysuj();
  return {
    el,
    odswiez() {
      void sonduj();
      rysuj();
    },
    wybierz,
  };
}

// Taśma (GUI 2.0, makieta: ekran SoraFlux „Taśma”): pliki z własnym przepisem każdy, przepisy na wierzchu,
// „Dostosuj szczegóły” (pełny panel ustawień 1.x) zwinięte. Pasek transportu: suma przed/po, zapis,
// po zakończeniu, ile naraz, priorytet w tle, Start/Pauza. Logika w `src/tasma.ts`.
import { api } from "../api";
import { debounce, h, ikona } from "../dom";
import { IKONY } from "../ikony";
import { jezyk, t, tekstBledu, tlumaczBlad } from "../i18n";
import { formatujCzas, formatujRozmiar, nazwaPliku, sklonuj, toObraz } from "../logika";
import { CELE, rodzajMediow, type Cel } from "../prosty";
import { AKCJA_NAPISOW, gotowosc, infoModelu, rozmiarModelu, HOST_MODELI } from "../napisy";
import { panelUstawien, type Panel } from "../komponenty/PanelUstawien";
import { uwagi, nazwaFolderu, podgladKomendy, dymekPominietych, dopiszOstatni } from "../komponenty/wspolne";
import { klasyfikujUpuszczone } from "../upuszczanie";
import { dymekDodano, pokazDymek, sklep } from "../sklep";
import {
  blokada, domyslnyPrzepis, LIMITY, pasujeDoFiltra, profilKoncowy, profilPrzepisu, przepisyDla, rodzajPozycji, rozmiarPo, sprzetZEnkoderow,
  stanPozycji, sumy, WLASNY, zadanieDla, type Blokada, type Filtr, type Pozycja, type RodzajPliku,
} from "../tasma";
import type { Media, Profil, StanNapisow } from "../typy";
import { przelacznik2, segment2 } from "./wspolne2";

export interface WidokTasmy {
  el: HTMLElement;
  odswiez(): void;
  /** Pliki na taśmę; `profil` = przepis „Własny” z tym profilem (wejście z trybu Prostego). */
  dodaj(sciezki: string[], o?: { profil?: Profil }): Promise<void>;
  wybierzPliki(): Promise<void>;
  start(): Promise<void>;
  /** Pliki z taśmy (Narzędzia: „użyj na plikach z taśmy”). */
  sciezki(): string[];
  /** Link wklejony w pole taśmy → ekran Z linku. */
  naLink(f: (url: string) => void): void;
}

const IKONA_PRZEPISU: Record<string, string> = {
  wyslij: IKONY.wyslij, telefon: IKONY.telefon, mp3: IKONY.nuta, gif: IKONY.iskra, napisy: IKONY.napisy, wlasny: IKONY.suwaki,
  mowa: IKONY.wyslij, glosnosc: IKONY.glosnosc, www: IKONY.wyslij, jpg: IKONY.obrazy, pol: IKONY.zmniejsz,
};
const IKONA_RODZAJU: Record<RodzajPliku, string> = { film: IKONY.film, dzwiek: IKONY.nuta, zdjecia: IKONY.obrazy };
const GRADIENTY = [
  "linear-gradient(135deg,#1e6091,#76c893)", "linear-gradient(135deg,#6a4c93,#f08a5d)", "linear-gradient(135deg,#3d405b,#e07a5f)",
  "linear-gradient(135deg,#22223b,#c9184a)", "linear-gradient(135deg,#2b2d42,#8d99ae)", "linear-gradient(135deg,#264653,#e9c46a)",
];
const gradient = (s: string) => GRADIENTY[[...s].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7) % GRADIENTY.length];

/** Nazwa przepisu: akcje trybu Prostego mają już tłumaczenia (`prosty.akcja.*`). */
export function nazwaPrzepisu(r: RodzajPliku, p: string): string {
  return p === WLASNY ? t("tasma.przepis.wlasny") : t(`prosty.akcja.${r}.${p}`);
}
function opisPrzepisu(r: RodzajPliku, p: string): string {
  return p === WLASNY ? t("tasma.przepis.wlasny.opis") : t(`prosty.akcja.${r}.${p}.opis`);
}

export function opisMedia(m: Media): string {
  const cz: string[] = [];
  if (m.wideo && !m.obraz) cz.push(`${m.wideo.w}×${m.wideo.h}`);
  if (m.obraz && m.wideo) cz.push(`${m.wideo.w}×${m.wideo.h}`);
  if (m.wideo?.fps && !m.obraz) cz.push(`${(Math.round(m.wideo.fps * 100) / 100).toLocaleString(jezyk())} fps`);
  if (m.czas_s && !m.obraz) cz.push(formatujCzas(Math.round(m.czas_s)));
  const kodek = m.wideo && !m.obraz ? m.wideo.kodek : m.audio?.kodek;
  if (kodek) cz.push(kodek.toUpperCase() + (m.wideo?.hdr ? " HDR" : ""));
  return cz.join(" · ");
}

export function stworzWidokTasmy(): WidokTasmy {
  let pozycje: Pozycja[] = [];
  let licznik = 1;
  let wybrana = 0;
  let filtr: Filtr = "wszystko";
  let usuniete: { p: Pozycja; i: number } | null = null;
  const szacunki = new Map<number, number | null>();
  /** Szacunki kart przepisów dla wybranej pozycji (przepis → bajty). */
  let szacunkiKart: Record<string, number | null> = {};
  let poZakonczeniu: "nic" | "folder" = "nic";
  let wstrzymana = false;
  let wystartowane: number[] = [];
  let stanNapisow: StanNapisow | null = null;
  let pobieranieModelu: { pobrane: number; calosc: number | null } | null = null;
  let panel: Panel | null = null;
  let panelDla = -1;
  let dostosujOtwarte = false;
  let sluchaczLinku: ((url: string) => void) | null = null;

  const el = h("div", { class: "v2 flux", "data-ekran": "tasma" });
  const lewa = h("div", { class: "flux-lewa" });
  const prawa = h("aside", { class: "panel2c", "aria-label": t("tasma.przepis_dla") });
  el.append(lewa, prawa);

  const biezaca = () => pozycje[wybrana] ?? null;
  const sprzetDostepny = () => sprzetZEnkoderow(sklep.stan.narzedzia?.sprzet ?? []);

  // ---------- dane ----------
  async function sonduj(p: Pozycja) {
    try {
      p.media = await api.sonda(p.sciezka);
      const r = rodzajMediow(p.media);
      if (!r) p.blad = t("tasma.nieznany_plik");
      else if (p.przepis === "") p.przepis = domyslnyPrzepis(r);
    } catch (e) {
      p.blad = tekstBledu(e);
    }
    if (!p.przepis) p.przepis = WLASNY;
    await szacuj(p);
  }

  async function szacuj(p: Pozycja) {
    const prof = p.media ? profilKoncowy(p) : null;
    if (!prof || !p.media) {
      szacunki.set(p.nr, p.przepis === AKCJA_NAPISOW ? 4_000 : null);
      return;
    }
    try {
      szacunki.set(p.nr, (await api.szacuj(p.media, prof)).bajty);
    } catch {
      szacunki.set(p.nr, null);
    }
  }

  async function szacujKarty() {
    const p = biezaca();
    const r = p && rodzajPozycji(p);
    if (!p || !r || !p.media) {
      szacunkiKart = {};
      return;
    }
    const wyniki: Record<string, number | null> = {};
    await Promise.all(
      przepisyDla(r).map(async (przepis) => {
        const kopia = { ...p, przepis };
        if (przepis === AKCJA_NAPISOW) return void (wyniki[przepis] = null);
        const prof = profilKoncowy(kopia);
        if (!prof) return void (wyniki[przepis] = null);
        const b = blokada(kopia);
        if (b?.typ === "miesci") return void (wyniki[przepis] = p.media!.rozmiar_b);
        if (b) return void (wyniki[przepis] = null);
        wyniki[przepis] = (await api.szacuj(p.media!, prof).catch(() => ({ bajty: null }))).bajty;
      }),
    );
    if (biezaca() === p) szacunkiKart = wyniki;
  }

  const przeliczWybrana = debounce(async () => {
    const p = biezaca();
    if (!p) return;
    await Promise.all([szacuj(p), szacujKarty()]);
    rysujListe();
    rysujTransport();
    rysujPanel(false);
  }, 120);

  async function dodaj(sciezki: string[], o: { profil?: Profil } = {}) {
    const rozwiniete = await api.rozwinFoldery(sciezki, []);
    const { przyjete, pominiete } = klasyfikujUpuszczone(sciezki, rozwiniete.map((r) => r.sciezka), "konwertuj");
    dymekPominietych(pominiete);
    const nowe: Pozycja[] = rozwiniete
      .filter((r) => przyjete.includes(r.sciezka) && !pozycje.some((p) => p.sciezka === r.sciezka && p.zadanie === null))
      .map((r) => ({
        nr: licznik++, sciezka: r.sciezka, podkatalog: r.podkatalog, media: null, blad: null,
        przepis: o.profil ? WLASNY : "", cel: "discord" as Cel, profil: o.profil ? sklonuj(o.profil) : sklonuj(PUSTY), glosnosc: false,
        sprzet: null, gifOd: 0, zadanie: null,
      }));
    if (!nowe.length) return;
    const bylyPuste = pozycje.length === 0;
    pozycje.push(...nowe);
    if (bylyPuste) wybrana = 0;
    rysuj();
    for (const p of nowe) {
      await sonduj(p);
      if (p.przepis !== WLASNY) p.profil = profilPrzepisu(p) ?? p.profil;
      rysujListe();
      rysujTransport();
      if (p === biezaca()) {
        await szacujKarty();
        rysujPanel(true);
      }
    }
  }

  async function wybierzPliki() {
    const s = await api.wybierzPliki(false);
    if (s.length) await dodaj(s);
  }

  // ---------- start / pauza ----------
  async function start() {
    const k = sklep.stan.konfig;
    const gotoweNapisy = (p: Pozycja) => p.przepis !== AKCJA_NAPISOW || gotowosc(stanNapisow, "base") === "gotowe";
    const doKolejki = pozycje.filter((p) => p.zadanie === null && !blokada(p) && gotoweNapisy(p));
    const pominieteNapisy = pozycje.filter((p) => p.zadanie === null && !blokada(p) && !gotoweNapisy(p)).length;
    if (!doKolejki.length) {
      if (wstrzymana) return void (await pauza(false));
      pokazDymek(pominieteNapisy ? t("tasma.napisy.najpierw_model") : t("tasma.nic_do_zrobienia"), "blad");
      return;
    }
    const zadania = doKolejki.map((p) => zadanieDla(p, k?.katalog_wyjscia ?? null, (x) => t(x))!);
    try {
      if (wstrzymana) await pauza(false);
      const ids = await api.dodajZadania(zadania);
      doKolejki.forEach((p, i) => (p.zadanie = ids[i] ?? null));
      wystartowane = [...wystartowane, ...ids];
      dymekDodano(ids.length, t);
      if (pominieteNapisy) pokazDymek(t("tasma.napisy.najpierw_model"), "blad");
    } catch (e) {
      pokazDymek(tekstBledu(e), "blad");
    }
    rysuj();
  }

  async function pauza(tak: boolean) {
    try {
      wstrzymana = await api.kolejkaWstrzymaj(tak);
    } catch (e) {
      pokazDymek(tekstBledu(e), "blad");
    }
    rysujTransport();
  }

  const trwaPraca = () => pozycje.some((p) => ["trwa", "w_kolejce"].includes(stanPozycji(p, sklep.stan.zadania)));

  // ---------- rysowanie ----------
  function rysuj() {
    if (wybrana >= pozycje.length) wybrana = Math.max(0, pozycje.length - 1);
    const fokus = document.activeElement instanceof HTMLElement && el.contains(document.activeElement) ? document.activeElement.dataset.fokus : undefined;
    lewa.replaceChildren(wejscie(), naglowekListy(), lista(), transport());
    rysujPanel(true);
    if (fokus) el.querySelector<HTMLElement>(`[data-fokus="${fokus}"]`)?.focus();
  }

  function wejscie(): HTMLElement {
    const pole = h("input", {
      type: "text", placeholder: t("tasma.wejscie"), "aria-label": t("tasma.wejscie"), spellcheck: "false", "data-fokus": "link",
    }) as HTMLInputElement;
    const wyslij = () => {
      const url = pole.value.trim();
      if (/^https?:\/\//i.test(url)) {
        pole.value = "";
        sluchaczLinku?.(url);
      } else if (url) pokazDymek(t("tasma.to_nie_link"), "blad");
    };
    pole.addEventListener("keydown", (e) => e.key === "Enter" && (e.preventDefault(), wyslij()));
    pole.addEventListener("paste", () => setTimeout(() => /^https?:\/\//i.test(pole.value.trim()) && wyslij(), 0));
    return h(
      "label",
      { class: "wejscie" },
      ikona(IKONY.link, "ikona ic d"),
      pole,
      h("span", { class: "kbd" }, "Ctrl V"),
      h("button", { type: "button", class: "btn", "data-fokus": "dodaj", onclick: () => void wybierzPliki() }, ikona(IKONY.upusc, "ikona ic m"), t("tasma.dodaj_pliki")),
    );
  }

  function naglowekListy(): HTMLElement {
    const ile = (f: Filtr) => pozycje.filter((p) => pasujeDoFiltra(stanPozycji(p, sklep.stan.zadania), blokada(p), f)).length;
    const chip = (f: Filtr) =>
      h("button", { type: "button", class: "pil", "aria-pressed": String(filtr === f), "data-fokus": `filtr-${f}`, onclick: () => ((filtr = f), rysuj()) }, t(`tasma.filtr.${f}`), h("span", { class: "n" }, String(ile(f))));
    return h(
      "div",
      { class: "tasma-g" },
      h("h2", null, t("zakladka.tasma")),
      chip("wszystko"),
      chip("w_toku"),
      chip("bledy"),
      h(
        "div",
        { class: "prawo" },
        usuniete
          ? h("button", { type: "button", class: "btn cichy maly", "data-fokus": "cofnij", onclick: cofnij }, ikona(IKONY.cofnij, "ikona ic m"), t("tasma.cofnij"))
          : null,
        pozycje.length
          ? h("button", { type: "button", class: "btn cichy maly", "data-fokus": "wyczysc", onclick: wyczyscGotowe }, t("tasma.wyczysc"))
          : null,
      ),
    );
  }

  function cofnij() {
    if (!usuniete) return;
    pozycje.splice(Math.min(usuniete.i, pozycje.length), 0, usuniete.p);
    usuniete = null;
    rysuj();
  }

  function wyczyscGotowe() {
    pozycje = pozycje.filter((p) => !["gotowe", "anulowane"].includes(stanPozycji(p, sklep.stan.zadania)));
    usuniete = null;
    rysuj();
  }

  function usun(p: Pozycja) {
    const s = stanPozycji(p, sklep.stan.zadania);
    if ((s === "trwa" || s === "w_kolejce") && p.zadanie !== null) void api.anulujZadanie(p.zadanie);
    const i = pozycje.indexOf(p);
    pozycje.splice(i, 1);
    usuniete = { p, i };
    if (wybrana >= pozycje.length) wybrana = Math.max(0, pozycje.length - 1);
    rysuj();
    void przeliczWybrana();
  }

  const lista2 = h("div", { class: "lista2", role: "listbox", "aria-label": t("zakladka.tasma") });
  function lista(): HTMLElement {
    rysujListe();
    return lista2;
  }

  function tekstBlokady(b: Blokada): string {
    if (b.typ === "format") return t(`plik.blokada.${b.powod}`);
    if (b.typ === "miesci") return t("tasma.miesci");
    if (b.typ === "sonda") return t("tasma.sprawdzam");
    return "";
  }

  function rysujListe() {
    const zadania = sklep.stan.zadania;
    if (!pozycje.length) {
      lista2.replaceChildren(
        h("div", { class: "pusto2" }, ikona(IKONY.upusc, "ikona"), h("b", null, t("tasma.pusto")), h("span", null, t("tasma.pusto.pomoc"))),
      );
      return;
    }
    const widoczne = pozycje.filter((p) => pasujeDoFiltra(stanPozycji(p, zadania), blokada(p), filtr));
    lista2.replaceChildren(
      ...widoczne.map((p) => {
        const r = rodzajPozycji(p);
        const s = stanPozycji(p, zadania);
        const z = p.zadanie !== null ? zadania.get(p.zadanie) : undefined;
        const postep = p.zadanie !== null ? sklep.stan.postepy.get(p.zadanie) : undefined;
        const procent = s === "gotowe" ? 100 : postep?.procent ?? z?.procent ?? 0;
        const b = blokada(p);
        const po = rozmiarPo(p, szacunki.get(p.nr) ?? null, zadania);
        const przed = p.media?.rozmiar_b ?? null;
        let meta: HTMLElement;
        if (p.blad) meta = h("span", { class: "meta zle" }, p.blad.split("\n")[0]);
        else if (s === "blad" && z?.stan.typ === "blad") meta = h("span", { class: "meta zle", title: tlumaczBlad(z.stan.komunikat) }, tlumaczBlad(z.stan.komunikat).split("\n")[0]);
        else if (b && b.typ !== "sonda" && s === "czeka") meta = h("span", { class: "meta uwaga" }, tekstBlokady(b));
        else if (s === "trwa") meta = h("span", { class: "meta" }, t("tasma.trwa", { p: Math.floor(procent) }));
        else meta = h("span", { class: "meta", title: p.media ? opisMedia(p.media) : "" }, p.media ? opisMedia(p.media) : t("tasma.sprawdzam"));
        const status =
          s === "gotowe" ? h("span", { class: "status ok", title: t("tasma.stan.gotowe") }, ikona(IKONY.ok, "ikona ic m"))
          : s === "trwa" ? h("span", { class: "status trwa mono" }, `${Math.floor(procent)}%`)
          : s === "w_kolejce" ? h("span", { class: "status", title: t("tasma.stan.w_kolejce") }, "…")
          : s === "blad" ? h("span", { class: "status zle", title: t("tasma.stan.blad") }, ikona(IKONY.uwaga, "ikona ic m"))
          : null;
        const wiersz = h(
          "div",
          {
            class: "poz", role: "option", tabindex: pozycje.indexOf(p) === wybrana ? "0" : "-1", "aria-selected": String(pozycje.indexOf(p) === wybrana),
            "data-fokus": `poz-${p.nr}`, "data-poz": String(p.nr),
            onclick: () => wybierzPozycje(p),
            onkeydown: (e: KeyboardEvent) => {
              if (e.target !== e.currentTarget) return;
              if (e.key === "Delete") usun(p);
              else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                e.preventDefault();
                const n = widoczne[(widoczne.indexOf(p) + (e.key === "ArrowDown" ? 1 : widoczne.length - 1)) % widoczne.length];
                wybierzPozycje(n);
                lista2.querySelector<HTMLElement>(`[data-poz="${n.nr}"]`)?.focus();
              }
            },
          },
          h("span", { class: "min", style: { background: gradient(p.sciezka) } }, ikona(r ? IKONA_RODZAJU[r] : IKONY.plik, "ikona ic d")),
          h("span", { style: { minWidth: "0" } }, h("span", { class: "nazwa", title: p.sciezka }, nazwaPliku(p.sciezka)), meta),
          r ? h("span", { class: "przepis", title: nazwaPrzepisu(r, p.przepis) }, ikona(IKONA_PRZEPISU[p.przepis] ?? IKONY.suwaki, "ikona ic m"), nazwaPrzepisu(r, p.przepis), p.przepis === "wyslij" ? ` · ${LIMITY[p.cel]} MB` : "") : h("span"),
          h("span", { class: "lcd" }, h("span", { class: "sz" }, `${przed ? formatujRozmiar(przed, jezyk()) : "—"} →`), " ", po !== null ? `${s === "gotowe" ? "" : "~"}${formatujRozmiar(po, jezyk())}` : "—"),
          status ?? h("button", { type: "button", class: "usun", "aria-label": t("tasma.usun", { nazwa: nazwaPliku(p.sciezka) }), title: t("tasma.usun", { nazwa: nazwaPliku(p.sciezka) }), onclick: (e: Event) => (e.stopPropagation(), usun(p)) }, ikona(IKONY.x, "ikona ic m")),
          h("span", { class: "tor", style: { width: `${s === "czeka" ? 0 : procent}%` } }),
        );
        return wiersz;
      }),
    );
  }

  function wybierzPozycje(p: Pozycja) {
    const i = pozycje.indexOf(p);
    if (i < 0 || i === wybrana) return;
    wybrana = i;
    szacunkiKart = {};
    rysujListe();
    rysujPanel(true);
    void szacujKarty().then(() => rysujPanel(false));
  }

  // ---------- pasek transportu ----------
  const transportEl = h("div", { class: "transport" });
  function transport(): HTMLElement {
    rysujTransport();
    return transportEl;
  }

  function rysujTransport() {
    const k = sklep.stan.konfig;
    const zadania = sklep.stan.zadania;
    const s = sumy(pozycje.map((p) => ({ przed: p.media?.rozmiar_b ?? null, po: rozmiarPo(p, szacunki.get(p.nr) ?? null, zadania) })));
    const trwa = trwaPraca();
    const naraz = k?.rownolegle_wideo ?? 1;
    const ostatnie = (k?.ostatnie_foldery ?? []).filter((f) => f !== k?.katalog_wyjscia).slice(0, 4);
    const folder = h(
      "select",
      {
        "aria-label": t("tasma.zapisz"), "data-fokus": "folder", title: k?.katalog_wyjscia ?? t("folder.obok"),
        onchange: async (e: Event) => {
          const v = (e.target as HTMLSelectElement).value;
          let nowy: string | null = v === "__obok" ? null : v;
          if (v === "__wybierz") nowy = await api.wybierzFolder(k?.katalog_wyjscia ?? undefined);
          if (v === "__wybierz" && !nowy) return rysujTransport();
          const biezacy = sklep.stan.konfig;
          if (!biezacy) return;
          const konfig = { ...biezacy, katalog_wyjscia: nowy, ostatnie_foldery: nowy ? dopiszOstatni(biezacy.ostatnie_foldery ?? [], nowy) : biezacy.ostatnie_foldery };
          await api.konfigZapisz(konfig);
          sklep.ustaw({ konfig });
        },
      },
      h("option", { value: "__obok", selected: !k?.katalog_wyjscia }, t("folder.obok")),
      k?.katalog_wyjscia ? h("option", { value: k.katalog_wyjscia, selected: true }, nazwaFolderu(k.katalog_wyjscia)) : null,
      ostatnie.map((f) => h("option", { value: f }, nazwaFolderu(f))),
      h("option", { value: "__wybierz" }, t("tasma.zapisz.wybierz")),
    );
    const poKoncu = h(
      "select",
      { "aria-label": t("tasma.po_zakonczeniu"), "data-fokus": "po", onchange: (e: Event) => (poZakonczeniu = (e.target as HTMLSelectElement).value as "nic" | "folder") },
      h("option", { value: "nic", selected: poZakonczeniu === "nic" }, t("tasma.po.nic")),
      h("option", { value: "folder", selected: poZakonczeniu === "folder" }, t("tasma.po.folder")),
    );
    const zapiszKonfig = async (z: Partial<NonNullable<typeof k>>) => {
      const b = sklep.stan.konfig;
      if (!b) return;
      const konfig = { ...b, ...z };
      await api.konfigZapisz(konfig);
      sklep.ustaw({ konfig });
    };
    const doZrobienia = pozycje.filter((p) => p.zadanie === null && !blokada(p)).length;
    transportEl.replaceChildren(
      h(
        "div",
        { class: "suma" },
        h("span", { class: "lcd", style: { fontSize: "14px" } }, h("span", { class: "sz" }, `${formatujRozmiar(s.przed, jezyk())} →`), " ", s.znane ? `~${formatujRozmiar(s.po, jezyk())}` : "—"),
        h("small", null, t("tasma.suma", { n: pozycje.length })),
      ),
      h("label", { class: "sel" }, h("small", null, t("tasma.zapisz")), folder),
      h("label", { class: "sel" }, h("small", null, t("tasma.po_zakonczeniu")), poKoncu),
      h("div", { class: "sel opc" }, h("small", null, t("tasma.naraz")),
        segment2([1, 2, 3].map((n) => ({ v: n, e: String(n) })), naraz, (n) => void zapiszKonfig({ rownolegle_wideo: n, rownolegle: Math.max(k?.rownolegle ?? 2, n) }), t("tasma.naraz"), "maly"),
      ),
      h("div", { class: "sel opc" }, h("small", null, t("tasma.w_tle")),
        przelacznik2(k?.niski_priorytet ?? false, (v) => void zapiszKonfig({ niski_priorytet: v }), t("tasma.w_tle.opis")),
      ),
      trwa && !wstrzymana
        ? h("button", { type: "button", class: "btn-wcisk", "data-fokus": "start", onclick: () => void pauza(true) }, ikona(IKONY.pauza, "ikona ic m"), t("tasma.pauza"))
        : h(
            "button",
            { type: "button", class: "btn-wcisk", "data-fokus": "start", "aria-keyshortcuts": "Control+Enter", disabled: !doZrobienia && !wstrzymana, onclick: () => void start() },
            ikona(IKONY.start, "ikona ic m"),
            wstrzymana ? t("tasma.wznow") : doZrobienia > 1 ? t("tasma.start_n", { n: doZrobienia }) : t("tasma.start"),
            h("span", { class: "kbd" }, "Ctrl ↵"),
          ),
    );
  }

  // ---------- panel przepisu ----------
  function rysujPanel(pelny: boolean) {
    const p = biezaca();
    const r = p && rodzajPozycji(p);
    if (!p || !r) {
      panel = null;
      panelDla = -1;
      prawa.replaceChildren(
        h("div", { class: "panel-g" }, h("span", { class: "etyk-s" }, t("tasma.przepis_dla")), h("h3", null, p ? nazwaPliku(p.sciezka) : t("tasma.nic_nie_wybrano"))),
        h("div", { class: "panel-s" }, h("p", { class: "tx3" }, p?.blad ?? (p ? t("tasma.sprawdzam") : t("tasma.pusto.panel")))),
      );
      return;
    }
    if (!pelny && panelDla === p.nr) {
      // lekka aktualizacja: karty i wskaźnik (bez przebudowy panelu ustawień, żeby nie gubić fokusu)
      const s = prawa.querySelector(".panel-s");
      const karty = prawa.querySelector(".karty-p");
      const wsk = prawa.querySelector(".wskaznik");
      if (s && karty && wsk) {
        karty.replaceWith(kartyPrzepisow(p, r));
        wsk.replaceWith(wskaznik(p));
        return;
      }
    }
    const b = blokada(p);
    const sprzet = sprzetDostepny();
    const maDzwiek = !!p.media?.audio;
    const s = h(
      "div",
      { class: "panel-s" },
      kartyPrzepisow(p, r),
      p.przepis === "wyslij"
        ? h(
            "div",
            { class: "wiersz-zawijany", role: "group", "aria-label": t("prosty.cel.etykieta") },
            (Object.keys(CELE) as Cel[]).map((c) =>
              h("button", { type: "button", class: "pil", "aria-pressed": String(p.cel === c), "data-fokus": `cel-${c}`, onclick: () => ustawPrzepis(p, "wyslij", c) }, t(`prosty.cel.${c}`)),
            ),
          )
        : null,
      p.przepis === "gif" && p.media?.czas_s ? suwakGif(p) : null,
      p.przepis === AKCJA_NAPISOW ? panelNapisow() : wskaznik(p),
      b && b.typ !== "sonda" ? h("div", { class: "baner" }, ikona(IKONY.uwaga, "ikona ic m"), h("span", null, tekstBlokady(b))) : null,
      maDzwiek && p.przepis !== AKCJA_NAPISOW
        ? h("div", { class: "wiersz-op" }, h("span", null, t("tasma.glosnosc"), " ", h("span", { class: "mono tx3" }, "−14 LUFS")),
            przelacznik2(p.glosnosc, (v) => {
              p.glosnosc = v;
              void przeliczWybrana();
              rysujListe();
            }, t("tasma.glosnosc"), "glosnosc"),
          )
        : null,
      r === "film" && p.przepis !== AKCJA_NAPISOW
        ? h("div", { class: "wiersz-op" },
            h("span", null, t("tasma.karta")),
            sprzet
              ? h("span", { class: "wiersz-zawijany" }, h("span", { class: "pigu jest" }, ikona(IKONY.ok, "ikona ic m"), t("tasma.karta.wykryto", { nazwa: sprzet.toUpperCase() })),
                  przelacznik2(p.sprzet !== null, (v) => {
                    p.sprzet = v ? sprzet : null;
                    rysujPanel(true);
                  }, t("tasma.karta.uzyj"), "karta"))
              : h("span", { class: "pigu" }, t("tasma.karta.brak")),
          )
        : null,
      p.przepis !== AKCJA_NAPISOW ? dostosuj(p, r) : null,
    );
    prawa.replaceChildren(
      h("div", { class: "panel-g" }, h("span", { class: "etyk-s" }, t("tasma.przepis_dla")), h("h3", { title: p.sciezka }, nazwaPliku(p.sciezka))),
      s,
      h(
        "div",
        { class: "panel-d" },
        h("button", { type: "button", class: "btn", "data-fokus": "wszystkim", disabled: pozycje.length < 2, onclick: () => wszystkim(p, r) }, ikona(IKONY.warstwy, "ikona ic m"), t("tasma.wszystkim")),
      ),
    );
  }

  function kartyPrzepisow(p: Pozycja, r: RodzajPliku): HTMLElement {
    return h(
      "div",
      { class: "karty-p", role: "group", "aria-label": t("tasma.przepisy") },
      przepisyDla(r).map((przepis) => {
        const est = szacunkiKart[przepis];
        return h(
          "button",
          { type: "button", class: "karta-p", "aria-pressed": String(p.przepis === przepis), "data-przepis": przepis, "data-fokus": `przepis-${przepis}`, onclick: () => ustawPrzepis(p, przepis) },
          h("span", { class: "g" }, ikona(IKONA_PRZEPISU[przepis] ?? IKONY.suwaki, "ikona ic m"), h("span", { title: nazwaPrzepisu(r, przepis) }, nazwaPrzepisu(r, przepis))),
          h("small", null, opisPrzepisu(r, przepis)),
          h("span", { class: "est" }, przepis === AKCJA_NAPISOW ? t("tasma.napisy.srt") : est ? `~${formatujRozmiar(est, jezyk())}` : "—"),
        );
      }),
    );
  }

  function wskaznik(p: Pozycja): HTMLElement {
    const przed = p.media?.rozmiar_b ?? null;
    const po = rozmiarPo(p, szacunki.get(p.nr) ?? null, sklep.stan.zadania);
    const proc = przed && po !== null ? Math.round((1 - po / przed) * 100) : null;
    const prof = profilKoncowy(p);
    const opis: string[] = [];
    if (prof) {
      opis.push(prof.kontener.toUpperCase());
      const w = prof.wideo;
      if (w && !["mp3", "m4a", "aac", "opus", "ogg", "flac", "wav"].includes(prof.kontener)) {
        if (w.rozdzielczosc.typ === "wysokosc") opis.push(`${w.rozdzielczosc.h}p`);
        if (w.jakosc.typ === "rozmiar_mb") opis.push(`≤ ${w.jakosc.mb} MB`);
        opis.push(w.kodek === "kopiuj" ? t("tasma.bez_kodowania") : w.kodek.toUpperCase() + (w.sprzet ? ` ${w.sprzet.toUpperCase()}` : ""));
      }
      if (prof.audio && prof.kontener !== "gif") opis.push(`${prof.audio.kodek.toUpperCase()}${["flac", "pcm", "kopiuj"].includes(prof.audio.kodek) ? "" : ` ${prof.audio.kbps} kb/s`}`);
      if (prof.audio?.normalizacja) opis.push(`${prof.audio.lufs ?? -16} LUFS`);
    }
    return h(
      "div",
      { class: "wskaznik", "aria-live": "polite" },
      h(
        "div",
        { class: "liczby" },
        h("span", { class: "przed" }, przed ? formatujRozmiar(przed, jezyk()) : "—"),
        h("span", { class: "po" }, po !== null ? `~${formatujRozmiar(po, jezyk())}` : "—"),
        proc !== null ? h("span", { class: "proc" }, proc >= 0 ? `−${proc}%` : `+${-proc}%`) : null,
      ),
      h("div", { class: "slupki", "aria-hidden": "true" }, h("div", { class: "slupek", style: { width: "100%" } }), h("div", { class: "slupek po-s", style: { width: `${proc !== null ? Math.max(2, Math.min(100, 100 - proc)) : 0}%` } })),
      h("div", { class: "opis" }, opis.join(" · ") || "—"),
    );
  }

  function suwakGif(p: Pozycja): HTMLElement {
    const czas = p.media?.czas_s ?? 0;
    const suwak = h("input", { type: "range", min: "0", max: String(Math.max(0, Math.floor(czas - 1))), step: "0.5", value: String(p.gifOd), "aria-label": t("tasma.gif_od"), "data-fokus": "gif" }) as HTMLInputElement;
    const etykieta = h("span", { class: "mono" }, formatujCzas(Math.round(p.gifOd)));
    suwak.addEventListener("input", () => (etykieta.textContent = formatujCzas(Math.round(Number(suwak.value)))));
    suwak.addEventListener("change", () => {
      p.gifOd = Number(suwak.value);
      p.profil = profilPrzepisu(p) ?? p.profil;
      void przeliczWybrana();
    });
    return h("label", { class: "pole-w kolumna" }, h("span", null, t("tasma.gif_od"), " ", etykieta), suwak);
  }

  function panelNapisow(): HTMLElement {
    if (!stanNapisow) {
      void api.napisyStan().then((s) => ((stanNapisow = s), rysujPanel(true))).catch(() => undefined);
      return h("div", { class: "baner ak" }, ikona(IKONY.info, "ikona ic m"), h("span", null, t("tasma.sprawdzam")));
    }
    const g = gotowosc(stanNapisow, "base");
    const m = infoModelu(stanNapisow, "base");
    if (g === "gotowe") return h("div", { class: "baner ak" }, ikona(IKONY.ok, "ikona ic m"), h("span", null, t("tasma.napisy.gotowe")));
    if (g === "brak_whisper") return h("div", { class: "baner" }, ikona(IKONY.uwaga, "ikona ic m"), h("span", null, t("tasma.napisy.brak_whisper")));
    if (g === "brak_sumy" || !m) return h("div", { class: "baner" }, ikona(IKONY.uwaga, "ikona ic m"), h("span", null, t("tasma.napisy.brak_sumy", { plik: m?.plik ?? "", folder: stanNapisow.katalog_modeli })));
    // zgoda na pobranie modelu: jedyne połączenie sieciowe napisów, na żądanie, z SHA-256
    const rozmiar = rozmiarModelu(m, jezyk());
    return h(
      "div",
      { class: "grupa-d" },
      h("span", null, t("tasma.napisy.zgoda", { rozmiar, host: HOST_MODELI })),
      pobieranieModelu
        ? h("span", { class: "mono" }, `${formatujRozmiar(pobieranieModelu.pobrane, jezyk())} / ${pobieranieModelu.calosc ? formatujRozmiar(pobieranieModelu.calosc, jezyk()) : "?"}`)
        : h("button", { type: "button", class: "btn", "data-fokus": "model", onclick: () => void pobierzModel() }, ikona(IKONY.pobierzPlik, "ikona ic m"), t("tasma.napisy.pobierz", { rozmiar })),
    );
  }

  async function pobierzModel() {
    pobieranieModelu = { pobrane: 0, calosc: null };
    rysujPanel(true);
    const stop = api.naPostepModelu((x) => {
      pobieranieModelu = { pobrane: x.pobrane, calosc: x.calosc };
      rysujPanel(true);
    });
    try {
      stanNapisow = await api.napisyPobierzModel("base", true);
    } catch (e) {
      pokazDymek(tekstBledu(e), "blad");
    } finally {
      stop();
      pobieranieModelu = null;
      rysujPanel(true);
      rysujTransport();
    }
  }

  function dostosuj(p: Pozycja, r: RodzajPliku): HTMLElement {
    const d = h("details", { class: "dost", open: dostosujOtwarte, "data-fokus": "dostosuj" }) as HTMLDetailsElement;
    d.addEventListener("toggle", () => (dostosujOtwarte = d.open));
    if (!panel || panelDla !== p.nr) {
      panelDla = p.nr;
      panel = panelUstawien({
        tryb: r === "zdjecia" ? "obraz" : "wideo",
        profil: profilKoncowy(p) ?? p.profil,
        media: () => p.media,
        sprzet: () => sklep.stan.narzedzia?.sprzet ?? [],
        enkodery: () => sklep.stan.narzedzia?.enkodery ?? [],
        onZmiana: (nowy) => {
          // ręczna zmiana = przepis „Własny” z tym profilem (głośność i karta są już w profilu)
          p.profil = sklonuj(nowy);
          p.przepis = WLASNY;
          p.glosnosc = false;
          p.sprzet = null;
          void przeliczWybrana();
          void planUwagi(p);
          rysujListe();
        },
      });
    }
    const uw = h("div", { class: "uwagi-tasmy" });
    void planUwagi(p, uw);
    d.append(
      h("summary", null, ikona(IKONY.strzalka, "ikona ic m obrot"), t("tasma.dostosuj"), h("span", { class: "tryb" }, t("tasma.dostosuj.pelny"))),
      h("div", { class: "w" }, panel.el, uw),
    );
    return d;
  }

  async function planUwagi(p: Pozycja, miejsce?: HTMLElement) {
    const cel = miejsce ?? prawa.querySelector<HTMLElement>(".uwagi-tasmy");
    const prof = profilKoncowy(p);
    if (!cel || !prof || !p.media) return;
    const plan = await api.planKomendy(p.sciezka, p.media, prof).catch(() => null);
    if (!plan) return;
    cel.replaceChildren(...[uwagi(plan.podpowiedzi, plan.blad), podgladKomendy(plan.przebiegi)].filter((x): x is HTMLElement => !!x));
  }

  function ustawPrzepis(p: Pozycja, przepis: string, cel?: Cel) {
    p.przepis = przepis;
    if (cel) p.cel = cel;
    if (przepis !== WLASNY) p.profil = profilPrzepisu(p) ?? p.profil;
    panelDla = -1; // panel „Dostosuj” od nowa z profilem przepisu
    if (przepis === AKCJA_NAPISOW && !stanNapisow) void api.napisyStan().then((s) => ((stanNapisow = s), rysujPanel(true))).catch(() => undefined);
    rysujListe();
    rysujPanel(true);
    rysujTransport();
    void przeliczWybrana();
  }

  function wszystkim(wzor: Pozycja, r: RodzajPliku) {
    let n = 0;
    for (const p of pozycje) {
      if (p === wzor || p.zadanie !== null || rodzajPozycji(p) !== r) continue;
      Object.assign(p, { przepis: wzor.przepis, cel: wzor.cel, glosnosc: wzor.glosnosc, sprzet: wzor.sprzet, profil: sklonuj(wzor.profil) });
      n++;
      void szacuj(p).then(() => (rysujListe(), rysujTransport()));
    }
    pokazDymek(t("tasma.wszystkim.gotowe", { n }));
    rysujListe();
  }

  // ---------- zdarzenia kolejki ----------
  let ostatnieZadania = sklep.stan.zadania;
  let ostatniePostepy = sklep.stan.postepy;
  let ostatniKonfig = sklep.stan.konfig;
  let ostatnieNarzedzia = sklep.stan.narzedzia;
  let bylaPraca = false;
  sklep.subskrybuj((s) => {
    if (s.zadania !== ostatnieZadania || s.postepy !== ostatniePostepy) {
      const zmianaZadan = s.zadania !== ostatnieZadania;
      ostatnieZadania = s.zadania;
      ostatniePostepy = s.postepy;
      if (!pozycje.some((p) => p.zadanie !== null)) return;
      rysujListe();
      if (zmianaZadan) {
        rysujTransport();
        const praca = trwaPraca();
        if (bylaPraca && !praca) poKoncu();
        bylaPraca = praca;
      }
    }
    if (s.konfig !== ostatniKonfig) {
      ostatniKonfig = s.konfig;
      rysujTransport();
    }
    if (s.narzedzia !== ostatnieNarzedzia) {
      ostatnieNarzedzia = s.narzedzia;
      rysujPanel(true);
    }
  });

  function poKoncu() {
    if (poZakonczeniu !== "folder") return;
    const z = pozycje.map((p) => (p.zadanie !== null ? sklep.stan.zadania.get(p.zadanie) : undefined)).find((x) => x?.stan.typ === "gotowe");
    if (z?.stan.typ === "gotowe") void api.pokazWFolderze(z.stan.wyjscie);
  }

  void api.kolejkaWstrzymana().then((w) => ((wstrzymana = w), rysujTransport())).catch(() => undefined);
  rysuj();

  return {
    el,
    odswiez: rysuj,
    dodaj,
    wybierzPliki,
    start,
    sciezki: () => pozycje.filter((p) => p.media && !p.blad && !toObraz(p.sciezka)).map((p) => p.sciezka),
    naLink: (f) => (sluchaczLinku = f),
  };
}

/** Profil zastępczy przed sondą (nadpisany przepisem po rozpoznaniu pliku). */
const PUSTY: Profil = {
  kontener: "mp4", wideo: null, audio: null, obraz: null, gif: null, ciecie: null, obrot: "brak", odbicie: { poziomo: false, pionowo: false },
  przyciecie: { gora: 0, dol: 0, lewo: 0, prawo: 0 }, deinterlace: false, predkosc: 1, sciezki_audio: { typ: "pierwsza" }, napisy: true,
};

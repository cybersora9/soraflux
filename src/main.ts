import "./tokeny.css";
import "./style.css";
import "./dna.css";
import "./fonty";
import { czyCiemny, doKonfigu, ID_MOTYWOW, naloz, ustawStan, zKonfigu } from "./motywy";
import { api } from "./api";
import { h, ikona, zamien } from "./dom";
import { IKONY } from "./ikony";
import { jezyk, jezykSystemu, naZmianeJezyka, t, ustawJezyk } from "./i18n";
import { formatujRozmiar, zmianaRozmiaru } from "./logika";
import { aktywneZadania, pokazDymek, sklep, trybApki, ZAKLADKI_TRYBU, type Zakladka } from "./sklep";
import { rozstrzygnijTryb } from "./prosty";
import { ustawTryb } from "./tryb";
import { biezacaSkala, krokSkali, SKALE, skalaZKlawisza, ustawSkale } from "./skala";
import { czyPokazacInformacje, pokazInformacje } from "./przegladarka";
import { stworzWidokPlikowy, type WidokPlikowy } from "./widoki/plikowy";
import { stworzWidokKolejki } from "./widoki/kolejka";
import { stworzWidokUstawien } from "./widoki/ustawienia";
import { stworzWidokPobierania } from "./widoki/pobierz";
import { stworzWidokProsty, type Przekazanie, type WidokProsty } from "./widoki/prosty";
import { stworzWidokTasmy, type WidokTasmy } from "./widoki/tasma";
import { stworzWidokLinku, type WidokLinku } from "./widoki/link";
import { stworzWidokPorownania } from "./widoki/porownaj";
import { stworzWidokNarzedzi } from "./widoki/narzedzia";
import { stworzWidokGotowe } from "./widoki/gotowe";
import { pokazKreator } from "./widoki/kreator";
import { otworzPalete, paletaOtwarta, type Polecenie } from "./komponenty/paleta";
import { sprawdzAktualizacje } from "./aktualizacje";

/** Zakładki szyny w bieżącym trybie: Prosty ma trzy (decyzja 3), Pełny 2.0 = ekrany z makiety. */
const zakladki = (): Zakladka[] => ZAKLADKI_TRYBU[trybApki()];

interface Widok {
  el: HTMLElement;
  odswiez(): void;
}

let widoki: Record<Zakladka, Widok> | null = null;

function stworzWidoki(): Record<Zakladka, Widok> {
  const tasma = stworzWidokTasmy();
  const link = stworzWidokLinku();
  const porownaj = stworzWidokPorownania();
  tasma.naLink((url) => {
    sklep.ustaw({ zakladka: "link" });
    link.wstaw(url);
  });
  return {
    prosty: stworzWidokProsty({ doPelnego }),
    // widoki 1.4 trybu Pełnego: dostępne z palety (Ctrl K) jako zapas na czas testu 2.0
    konwertuj: stworzWidokPlikowy("konwertuj"),
    pobierz: stworzWidokPobierania(),
    // P3: wideo/audio upuszczone na Obrazy → przycisk w dymku przenosi je do Konwertuj
    obrazy: stworzWidokPlikowy("obrazy", {
      doKonwertuj: (s) => {
        sklep.ustaw({ zakladka: "konwertuj" });
        void (widoki?.konwertuj as WidokPlikowy | undefined)?.dodaj(s);
      },
    }),
    kolejka: stworzWidokKolejki(),
    ustawienia: stworzWidokUstawien(),
    tasma,
    link,
    porownaj,
    narzedzia: stworzWidokNarzedzi({
      plikiTasmy: () => tasma.sciezki(),
      doTasmyNapisy: () => {
        sklep.ustaw({ zakladka: "tasma" });
        pokazDymek(t("narzedzia2.napisy.wskazowka"));
      },
    }),
    gotowe: stworzWidokGotowe({
      porownaj: (id) => {
        sklep.ustaw({ zakladka: "porownaj" });
        porownaj.pokaz(id);
      },
    }),
  };
}

/** „Więcej ustawień (tryb Pełny)”: ten plik i ta akcja (te same struktury `Profil`) na Taśmie albo w Z linku. */
function doPelnego(p: Przekazanie): void {
  if (!widoki) return;
  if (p.typ === "link") {
    void ustawTryb("pelny", "link");
    (widoki.link as WidokLinku).wstaw(p.url);
    return;
  }
  void ustawTryb("pelny", "tasma");
  void (widoki.tasma as WidokTasmy).dodaj(p.sciezki, { profil: p.profil });
}

const app = document.querySelector<HTMLDivElement>("#app")!;
app.classList.add("app2");
const pasekT = h("header", { class: "pasek-t" });
const szyna = h("nav", { class: "szyna", "aria-label": t("app.nazwa") });
const tresc = h("main", { class: "tresc", id: "tresc" });
const pasekStanu = h("footer", { class: "pasek-stanu" });
const dymek = h("div", { class: "dymek", role: "status", "aria-live": "polite" });
const nakladkaUpuszczania = h("div", { class: "nakladka-upuszczania", "aria-hidden": "true" });
app.append(pasekT, szyna, tresc, pasekStanu, dymek, nakladkaUpuszczania);

// Logo SoraFlux zawsze karmazynowe na ciemnym kaflu (DNA rodziny), niezależnie od motywu i akcentu.
const LOGO = `<svg class="kafel-logo" viewBox="0 0 120 120" aria-hidden="true"><rect width="120" height="120" rx="26" fill="#0e0e12"/><g transform="translate(12 12) scale(.8)"><path d="M18 26H38L72 60L38 94H18L52 60Z" fill="#f6f2f3"/><path d="M48 26H68L102 60L68 94H48L82 60Z" fill="#e11d33"/></g></svg>`;

const IKONA_ZAKLADKI: Record<Zakladka, string> = {
  prosty: IKONY.upusc, konwertuj: IKONY.konwertuj, pobierz: IKONY.pobierz, obrazy: IKONY.obrazy, kolejka: IKONY.kolejka, ustawienia: IKONY.ustawienia,
  tasma: IKONY.tasma, link: IKONY.link, porownaj: IKONY.porownaj, narzedzia: IKONY.narzedzia, gotowe: IKONY.gotowe,
};

function rysujPasekT(): void {
  pasekT.replaceChildren(
    h("div", { class: "marka2" }, h("span", { html: LOGO, style: { display: "contents" } }), h("b", null, t("app.nazwa")), h("span", null, t("app.opis"))),
    h(
      "button",
      { type: "button", class: "szukaj-pill", "aria-keyshortcuts": "Control+K", "aria-haspopup": "dialog", onclick: () => paleta() },
      ikona(IKONY.szukaj, "ikona ic m"),
      h("span", null, t("paleta.pill")),
      h("span", { class: "kbd" }, "Ctrl K"),
    ),
    h(
      "div",
      { class: "prawo" },
      h(
        "div",
        { class: "seg maly przelacznik-trybu", role: "radiogroup", "aria-label": t("tryb.etykieta") },
        (["prosty", "pelny"] as const).map((tr) =>
          h(
            "button",
            {
              type: "button", role: "radio", "aria-checked": String(tr === trybApki()), "aria-pressed": String(tr === trybApki()), "data-tryb": tr,
              onclick: () => tr !== trybApki() && void ustawTryb(tr),
            },
            t(`tryb.${tr}`),
          ),
        ),
      ),
    ),
  );
}

function rysujNawigacje(): void {
  const aktywne = aktywneZadania(sklep.stan);
  const tryb = trybApki();
  const lista = zakladki();
  const przycisk = (z: Zakladka) =>
    h(
      "button",
      {
        type: "button",
        role: "tab",
        "aria-selected": String(sklep.stan.zakladka === z),
        tabindex: sklep.stan.zakladka === z ? "0" : "-1",
        "aria-keyshortcuts": `Control+${lista.indexOf(z) + 1}`,
        "aria-controls": "tresc",
        class: "nawigacja-przycisk" + (sklep.stan.zakladka === z ? " aktywny" : ""),
        "data-zakladka": z,
        title: tryb === "prosty" && z === "kolejka" ? t("prosty.zakladka.kolejka") : t(`zakladka.${z}`),
        onclick: () => sklep.ustaw({ zakladka: z }),
      },
      ikona(IKONA_ZAKLADKI[z], "ikona ic"),
      h("span", null, tryb === "prosty" && z === "kolejka" ? t("prosty.zakladka.kolejka") : t(`zakladka.${z}`)),
      (z === "kolejka" || z === "gotowe") && aktywne > 0 ? h("span", { class: "licznik" }, String(aktywne)) : null,
    );
  szyna.replaceChildren(
    h(
      "div",
      { class: "szyna-lista nawigacja-lista", role: "tablist", "aria-orientation": "vertical" },
      lista.filter((z) => z !== "ustawienia").map(przycisk),
      h("div", { class: "dol" }, przycisk("ustawienia")),
    ),
  );
  // widok 1.4 otwarty z palety: żadna pozycja szyny nie jest zaznaczona, ale fokus ma dokąd wrócić
  if (!lista.includes(sklep.stan.zakladka)) szyna.querySelector<HTMLElement>("[data-zakladka]")?.setAttribute("tabindex", "0");
}

function rysujPasekStanu(): void {
  const aktywne = aktywneZadania(sklep.stan);
  const n = sklep.stan.narzedzia;
  zamien(pasekStanu,
    h("span", { class: "lok" }, h("i"), t("app.lokalnie")),
    aktywne ? h("span", null, t("stan.w_toku", { n: aktywne })) : null,
    h(
      "span",
      { class: "prawo" },
      n?.sprzet.length ? h("span", null, t("stan.karta", { nazwa: n.sprzet[0].split("_").pop()!.toUpperCase() })) : null,
      h("span", { class: "mono", title: t("skala.tytul") }, `${Math.round(biezacaSkala() * 100)}%`),
      n?.wersje.ffmpeg ? h("span", { class: "mono", title: "ffmpeg" }, `ffmpeg ${n.wersje.ffmpeg.split("-")[0]}`) : null,
    ),
  );
}

// Klawiatura: strzałki w szynie (jak w ARIA tablist), Ctrl+1…6, Ctrl+O, Ctrl+K, Ctrl + / − / 0, Ctrl+Enter.
szyna.addEventListener("keydown", (e) => {
  if (!["ArrowDown", "ArrowUp", "ArrowRight", "ArrowLeft", "Home", "End"].includes(e.key)) return;
  const lista = zakladki();
  const i = Math.max(0, lista.indexOf(sklep.stan.zakladka));
  const n = lista.length;
  const j = e.key === "Home" ? 0 : e.key === "End" ? n - 1 : e.key === "ArrowDown" || e.key === "ArrowRight" ? (i + 1) % n : (i - 1 + n) % n;
  e.preventDefault();
  sklep.ustaw({ zakladka: lista[j] });
  szyna.querySelector<HTMLButtonElement>(`[data-zakladka="${lista[j]}"]`)?.focus();
});
window.addEventListener("keydown", (e) => {
  if (paletaOtwarta()) return;
  const skala = skalaZKlawisza(e, biezacaSkala());
  if (skala !== null) {
    e.preventDefault();
    void ustawSkale(skala);
    return;
  }
  if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
  const nr = Number(e.key);
  const lista = zakladki();
  if (e.key.toLowerCase() === "k") {
    e.preventDefault();
    paleta();
  } else if (e.key === "Enter" && widoki && trybApki() === "pelny") {
    const z = sklep.stan.zakladka;
    if (z === "tasma" || z === "link") {
      e.preventDefault();
      void (z === "tasma" ? (widoki.tasma as WidokTasmy).start() : (widoki.link as WidokLinku).start());
    }
  } else if (nr >= 1 && nr <= lista.length) {
    e.preventDefault();
    sklep.ustaw({ zakladka: lista[nr - 1] });
  } else if (e.key.toLowerCase() === "o" && widoki && trybApki() === "prosty") {
    e.preventDefault();
    sklep.ustaw({ zakladka: "prosty" });
    void (widoki.prosty as WidokProsty).wybierz();
  } else if (e.key.toLowerCase() === "o" && widoki) {
    e.preventDefault();
    const z = sklep.stan.zakladka;
    if (z === "konwertuj" || z === "obrazy") {
      void api.wybierzPliki(z === "obrazy").then((s) => s.length && void (widoki![z] as WidokPlikowy).dodaj(s));
      return;
    }
    sklep.ustaw({ zakladka: "tasma" });
    void (widoki.tasma as WidokTasmy).wybierzPliki();
  }
});

/** Polecenia palety (Ctrl K): ekrany, akcje, wygląd, skala, tryb, widoki 1.4. */
function polecenia(): Polecenie[] {
  const L: Polecenie[] = [];
  const idz = (z: Zakladka) => () => sklep.ustaw({ zakladka: z });
  const lista = zakladki();
  lista.forEach((z, i) => L.push({ id: `idz-${z}`, sekcja: t("paleta.sekcja.idz"), tekst: t(`zakladka.${z}`), ikona: IKONA_ZAKLADKI[z], skrot: `Ctrl ${i + 1}`, wykonaj: idz(z) }));
  if (trybApki() === "pelny" && widoki) {
    const tasma = widoki.tasma as WidokTasmy;
    L.push({ id: "dodaj", sekcja: t("paleta.sekcja.akcje"), tekst: t("tasma.dodaj_pliki"), ikona: IKONY.upusc, skrot: "Ctrl O", wykonaj: () => (sklep.ustaw({ zakladka: "tasma" }), void tasma.wybierzPliki()) });
    L.push({ id: "start", sekcja: t("paleta.sekcja.akcje"), tekst: t("paleta.start"), ikona: IKONY.start, skrot: "Ctrl ↵", wykonaj: () => (sklep.ustaw({ zakladka: "tasma" }), void tasma.start()) });
    L.push({
      id: "wklej", sekcja: t("paleta.sekcja.akcje"), tekst: t("paleta.wklej_link"), ikona: IKONY.link,
      wykonaj: () => void api.czytajSchowek().then((x) => {
        sklep.ustaw({ zakladka: "link" });
        if (/https?:\/\//.test(x)) (widoki!.link as WidokLinku).wstaw(x.trim());
      }),
    });
    for (const n of ["kontener", "sciezki", "polacz", "glosnosc", "kadr"] as const) {
      L.push({ id: `narz-${n}`, sekcja: t("paleta.sekcja.narzedzia"), tekst: t(`narzedzia2.${n}`), ikona: IKONY.narzedzia, wykonaj: () => (sklep.ustaw({ zakladka: "narzedzia" }), (widoki!.narzedzia as unknown as { wybierz(n: string): void }).wybierz(n)) });
    }
  }
  for (const id of ID_MOTYWOW) {
    L.push({
      id: `motyw-${id}`, sekcja: t("paleta.sekcja.wyglad"), tekst: t("paleta.motyw", { nazwa: t(`motyw2.${id}`) }), ikona: IKONY.paleta,
      wykonaj: () => {
        const k = sklep.stan.konfig;
        if (!k) return;
        const w = zKonfigu(k);
        const konfig = { ...k, ...doKonfigu({ motyw: id, wlasny: id === "wlasny" ? w.wlasny ?? { akcent: "#ff7ac6", baza: "neon" } : w.wlasny }) };
        void api.konfigZapisz(konfig);
        sklep.ustaw({ konfig });
      },
    });
  }
  for (const [tr, ik] of [["system", IKONY.monitor], ["dark", IKONY.ksiezyc], ["light", IKONY.slonce]] as const) {
    L.push({
      id: `jasnosc-${tr}`, sekcja: t("paleta.sekcja.wyglad"), tekst: t("paleta.jasnosc", { tryb: t(`ustawienia.motyw.${tr === "dark" ? "ciemny" : tr === "light" ? "jasny" : "system"}`) }), ikona: ik,
      wykonaj: () => {
        const k = sklep.stan.konfig;
        if (!k) return;
        const konfig = { ...k, motyw: tr };
        void api.konfigZapisz(konfig);
        sklep.ustaw({ konfig });
      },
    });
  }
  for (const s of SKALE) {
    L.push({ id: `skala-${s}`, sekcja: t("paleta.sekcja.wyglad"), tekst: t("paleta.skala", { p: Math.round(s * 100) }), ikona: IKONY.tekst, skrot: s === 1 ? "Ctrl 0" : undefined, wykonaj: () => void ustawSkale(s) });
  }
  L.push({ id: "skala+", sekcja: t("paleta.sekcja.wyglad"), tekst: t("paleta.skala_wieksza"), ikona: IKONY.tekst, skrot: "Ctrl +", wykonaj: () => void ustawSkale(krokSkali(biezacaSkala(), 1)) });
  L.push({ id: "skala-", sekcja: t("paleta.sekcja.wyglad"), tekst: t("paleta.skala_mniejsza"), ikona: IKONY.tekst, skrot: "Ctrl −", wykonaj: () => void ustawSkale(krokSkali(biezacaSkala(), -1)) });
  const inny = trybApki() === "prosty" ? "pelny" : "prosty";
  L.push({ id: "tryb", sekcja: t("paleta.sekcja.apka"), tekst: t("paleta.tryb", { tryb: t(`tryb.${inny}`) }), ikona: IKONY.suwaki, wykonaj: () => void ustawTryb(inny) });
  L.push({ id: "aktualizacje", sekcja: t("paleta.sekcja.apka"), tekst: t("aktualizacje.sprawdz"), ikona: IKONY.odswiez, wykonaj: () => void sprawdzAktualizacje(true) });
  if (trybApki() === "pelny") {
    for (const z of ["konwertuj", "obrazy", "pobierz", "kolejka"] as const) {
      L.push({ id: `klasyczny-${z}`, sekcja: t("paleta.sekcja.klasyczne"), tekst: t("paleta.klasyczny", { nazwa: t(`zakladka.${z}`) }), ikona: IKONA_ZAKLADKI[z], wykonaj: idz(z) });
    }
  }
  return L;
}

function paleta(): void {
  otworzPalete(polecenia);
}

let pokazana: Zakladka | null = null;
function pokazZakladke(): void {
  if (!widoki) return;
  const z = sklep.stan.zakladka;
  if (pokazana === z) return;
  pokazana = z;
  // Fokus nie może zostać na kontrolce ze schowanej zakładki (np. kafel motywu): Enter/spacja
  // trafiłyby w nią po powrocie z okna dialogowego (usterka 5 z testów 07.10).
  const a = document.activeElement;
  if (a instanceof HTMLElement && tresc.contains(a)) a.blur();
  tresc.replaceChildren(widoki[z].el);
  if (["gotowe", "porownaj", "narzedzia"].includes(z)) widoki[z].odswiez();
  tresc.scrollTop = 0;
}

function zastosujMotyw(): void {
  ustawStan(zKonfigu(sklep.stan.konfig));
  naloz(czyCiemny(sklep.stan.konfig?.motyw ?? "dark"));
}

let ostatniaZakladka = sklep.stan.zakladka;
let ostatniTryb = trybApki();
let ostatniKonfig = sklep.stan.konfig;
let ostatniDymek = sklep.stan.dymek;
let ostatnieAktywne = 0;
let ostatnieNarzedzia = sklep.stan.narzedzia;
sklep.subskrybuj((s) => {
  const aktywne = aktywneZadania(s);
  if (s.zakladka !== ostatniaZakladka || aktywne !== ostatnieAktywne) {
    ostatniaZakladka = s.zakladka;
    ostatnieAktywne = aktywne;
    rysujNawigacje();
    rysujPasekStanu();
    pokazZakladke();
  }
  if (trybApki(s) !== ostatniTryb) {
    ostatniTryb = trybApki(s);
    rysujNawigacje();
    rysujPasekT();
    pokazZakladke();
    // Kolejka i Ustawienia wyglądają trochę inaczej w każdym trybie
    widoki?.kolejka.odswiez();
    widoki?.ustawienia.odswiez();
  }
  if (s.narzedzia !== ostatnieNarzedzia) {
    ostatnieNarzedzia = s.narzedzia;
    rysujPasekStanu();
  }
  if (s.konfig !== ostatniKonfig) {
    const zmianaJezyka = s.konfig?.jezyk !== ostatniKonfig?.jezyk;
    ostatniKonfig = s.konfig;
    zastosujMotyw();
    rysujPasekStanu();
    if (zmianaJezyka) ustawJezyk(s.konfig?.jezyk ?? jezykSystemu());
  }
  if (s.dymek !== ostatniDymek) {
    ostatniDymek = s.dymek;
    dymek.className = "dymek" + (s.dymek ? ` widoczny dymek-${s.dymek.rodzaj}` : "");
    const akcja = s.dymek?.akcja;
    const czesci: HTMLElement[] = [h("span", null, s.dymek?.tekst ?? "")];
    if (akcja) czesci.push(h("span", { class: "dymek-kropka", "aria-hidden": "true" }, "·"), h("button", { type: "button", class: "dymek-akcja", onclick: akcja.zrob }, akcja.etykieta));
    dymek.replaceChildren(...czesci);
  }
});

naZmianeJezyka(() => {
  rysujPasekT();
  rysujNawigacje();
  rysujPasekStanu();
  if (widoki) Object.values(widoki).forEach((w) => w.odswiez());
});

window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", zastosujMotyw);

// Upuszczanie plików gdziekolwiek w oknie → aktywna zakładka (albo Konwertuj/Obrazy).
api.naUpuszczenie((sciezki, najechanie) => {
  nakladkaUpuszczania.classList.toggle("widoczna", najechanie);
  if (!sciezki || sciezki.length === 0 || !widoki) return;
  if (trybApki() === "prosty") {
    sklep.ustaw({ zakladka: "prosty" });
    void (widoki.prosty as WidokProsty).dodaj(sciezki);
    return;
  }
  const cel: Zakladka = sklep.stan.zakladka;
  if (cel === "konwertuj" || cel === "obrazy") return void (widoki[cel] as WidokPlikowy).dodaj(sciezki);
  sklep.ustaw({ zakladka: "tasma" });
  void (widoki.tasma as WidokTasmy).dodaj(sciezki);
});

// Pliki z Eksploratora („Konwertuj w SoraFlux”): przy starcie i do już otwartego okna.
function otworzPliki(sciezki: string[]): void {
  if (!widoki || sciezki.length === 0) return;
  if (trybApki() === "prosty") {
    sklep.ustaw({ zakladka: "prosty" });
    void (widoki.prosty as WidokProsty).dodaj(sciezki);
    return;
  }
  sklep.ustaw({ zakladka: "tasma" });
  void (widoki.tasma as WidokTasmy).dodaj(sciezki);
}
api.naOtworzPliki(otworzPliki);
// Atrapa (podgląd w przeglądarce, zrzuty): „upuszczenie” ścieżek bez Tauri.
if (!api.wTauri) (window as unknown as { __dodajDoKonwertuj: typeof otworzPliki }).__dodajDoKonwertuj = otworzPliki;

// Po zakończeniu kolejki: powiadomienie systemowe (gdy okno nie jest na wierzchu) z porównaniem rozmiaru.
let bylyAktywne = 0;
function powiadomOKoncu(): void {
  const zadania = [...sklep.stan.zadania.values()];
  const gotowe = zadania.filter((z) => z.stan.typ === "gotowe");
  const bledy = zadania.filter((z) => z.stan.typ === "blad").length;
  const przed = gotowe.reduce((s, z) => s + (z.rozmiar_wejscia ?? 0), 0);
  const po = gotowe.reduce((s, z) => s + (z.rozmiar_wyniku ?? 0), 0);
  const tresc = [
    t("powiadomienie.gotowe", { n: gotowe.length }),
    przed > 0 && po > 0 ? `${formatujRozmiar(przed, jezyk())} → ${formatujRozmiar(po, jezyk())} (${zmianaRozmiaru(przed, po)})` : "",
    bledy ? t("powiadomienie.bledy", { n: bledy }) : "",
  ].filter(Boolean).join(" · ");
  if (!document.hasFocus()) void api.powiadom(t("app.nazwa"), tresc);
}

// Zdarzenia kolejki
api.naStan((z) => {
  const zadania = new Map(sklep.stan.zadania);
  zadania.set(z.id, z);
  const postepy = new Map(sklep.stan.postepy);
  if (z.stan.typ !== "trwa") postepy.delete(z.id);
  sklep.ustaw({ zadania, postepy });
  const aktywne = aktywneZadania(sklep.stan);
  if (bylyAktywne > 0 && aktywne === 0) powiadomOKoncu();
  bylyAktywne = aktywne;
});
api.naPostep((p) => {
  const postepy = new Map(sklep.stan.postepy);
  postepy.set(p.id, p);
  sklep.ustaw({ postepy });
});

async function start(): Promise<void> {
  let konfig = await api.konfigWczytaj();
  ustawJezyk(konfig.jezyk ?? jezykSystemu());
  // DNA 2.0: motywy sprzed 2.0 (sora-a…jp-c, własne 1.x) przechodzą na najbliższy nowy, zapis od razu
  const wyglad = zKonfigu(konfig);
  if (wyglad.zmieniony) {
    konfig = { ...konfig, ...doKonfigu(wyglad) };
    await api.konfigZapisz(konfig);
  }
  // Tryb (decyzja 2): nowa instalacja → Prosty; aktualizacja z 1.x → Pełny + podpowiedź raz. Zapis od razu,
  // bo po zamknięciu kreatora nowa instalacja wyglądałaby już jak aktualizacja.
  const tryb = rozstrzygnijTryb(konfig);
  if (tryb.zapisz) {
    konfig = { ...konfig, tryb: tryb.tryb, podpowiedz_prosty_pokazana: konfig.podpowiedz_prosty_pokazana || tryb.tryb === "prosty" };
    await api.konfigZapisz(konfig);
  }
  ostatniTryb = tryb.tryb;
  const [presety, zadania] = await Promise.all([api.presetyLista(), api.listaZadan()]);
  sklep.ustaw({ konfig, presety, zadania: new Map(zadania.map((z) => [z.id, z])), zakladka: tryb.tryb === "prosty" ? "prosty" : "tasma" });
  zastosujMotyw();
  // skala z konfigu: w Tauri zoom WebView ustawia już Rust przy starcie, tu tylko upewniamy się (i atrapa)
  void api.ustawSkale(biezacaSkala()).catch(() => undefined);
  widoki = stworzWidoki();
  rysujPasekT();
  rysujNawigacje();
  rysujPasekStanu();
  pokazZakladke();
  const narzedzia = await api.narzedziaStan();
  sklep.ustaw({ narzedzia });
  Object.values(widoki).forEach((w) => w.odswiez());
  otworzPliki(await api.plikiStartowe());
  const brakuje = !narzedzia.sciezki.ffmpeg || !narzedzia.sciezki.ffprobe;
  if (!konfig.kreator_zakonczony || brakuje) pokazKreator();
  else if (tryb.podpowiedz) {
    // pokazana = zapis od razu: po zamknięciu dymka nie wraca
    const k = { ...konfig, podpowiedz_prosty_pokazana: true };
    await api.konfigZapisz(k);
    sklep.ustaw({ konfig: k });
    pokazDymek(t("prosty.podpowiedz"), "info", { etykieta: t("prosty.podpowiedz.wyprobuj"), zrob: () => void ustawTryb("prosty").then(() => sklep.ustaw({ dymek: null })) }, 15000);
  }
}

if (czyPokazacInformacje(api.wTauri, location.hostname)) pokazInformacje(app, jezykSystemu());
else void start();

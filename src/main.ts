import "./tokeny.css";
import "./style.css";
import "./fonty";
import { czyCiemny, naloz, ustawStan, zKonfigu } from "./motywy";
import { api } from "./api";
import { h, ikona } from "./dom";
import { IKONY } from "./ikony";
import { jezyk, jezykSystemu, naZmianeJezyka, t, ustawJezyk } from "./i18n";
import { formatujRozmiar, toObraz, zmianaRozmiaru } from "./logika";
import { aktywneZadania, pokazDymek, sklep, trybApki, ZAKLADKI_TRYBU, type Zakladka } from "./sklep";
import { rozstrzygnijTryb } from "./prosty";
import { ustawTryb } from "./tryb";
import { stworzWidokPlikowy, type WidokPlikowy } from "./widoki/plikowy";
import { stworzWidokKolejki } from "./widoki/kolejka";
import { stworzWidokUstawien } from "./widoki/ustawienia";
import { stworzWidokPobierania, type WidokPobierania } from "./widoki/pobierz";
import { stworzWidokProsty, type Przekazanie, type WidokProsty } from "./widoki/prosty";
import { pokazKreator } from "./widoki/kreator";

/** Zakładki paska w bieżącym trybie: Prosty ma trzy (decyzja 3), Pełny pięć jak dotąd. */
const zakladki = (): Zakladka[] => ZAKLADKI_TRYBU[trybApki()];

interface Widok {
  el: HTMLElement;
  odswiez(): void;
}

let widoki: Record<Zakladka, Widok> | null = null;

function stworzWidoki(): Record<Zakladka, Widok> {
  return {
    prosty: stworzWidokProsty({ doPelnego }),
    konwertuj: stworzWidokPlikowy("konwertuj"),
    pobierz: stworzWidokPobierania(),
    obrazy: stworzWidokPlikowy("obrazy"),
    kolejka: stworzWidokKolejki(),
    ustawienia: stworzWidokUstawien(),
  };
}

/** „Więcej ustawień (tryb Pełny)”: ten plik i ta akcja (te same struktury `Profil`) w zakładce Pełnego. */
function doPelnego(p: Przekazanie): void {
  if (!widoki) return;
  if (p.typ === "link") {
    void ustawTryb("pelny", "pobierz");
    (widoki.pobierz as WidokPobierania).wstaw(p.url, p.wybor);
    return;
  }
  const cel: Zakladka = p.obrazy ? "obrazy" : "konwertuj";
  void ustawTryb("pelny", cel);
  const w = widoki[cel] as WidokPlikowy;
  w.ustawProfil(p.profil);
  void w.dodaj(p.sciezki);
}

const app = document.querySelector<HTMLDivElement>("#app")!;
const nawigacja = h("nav", { class: "nawigacja", "aria-label": t("app.nazwa") });
const tresc = h("main", { class: "tresc", id: "tresc" });
const dymek = h("div", { class: "dymek", role: "status", "aria-live": "polite" });
const nakladkaUpuszczania = h("div", { class: "nakladka-upuszczania", "aria-hidden": "true" });
app.append(nawigacja, tresc, dymek, nakladkaUpuszczania);

function rysujNawigacje(): void {
  const aktywne = aktywneZadania(sklep.stan);
  const tryb = trybApki();
  const lista = zakladki();
  nawigacja.replaceChildren(
    h("div", { class: "marka" }, h("span", { class: "marka-znak", html: MARKA }), h("span", { class: "marka-nazwa" }, t("app.nazwa"))),
    h(
      "div",
      { class: "nawigacja-lista", role: "tablist", "aria-orientation": "vertical" },
      lista.map((z) =>
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
            onclick: () => sklep.ustaw({ zakladka: z }),
          },
          ikona(z === "prosty" ? IKONY.upusc : IKONY[z]),
          h("span", null, tryb === "prosty" && z === "kolejka" ? t("prosty.zakladka.kolejka") : t(`zakladka.${z}`)),
          z === "kolejka" && aktywne > 0 ? h("span", { class: "plakietka plakietka-akcent" }, String(aktywne)) : null,
        ),
      ),
    ),
    h(
      "div",
      { class: "nawigacja-stopka" },
      h(
        "div",
        { class: "segmenty przelacznik-trybu", role: "radiogroup", "aria-label": t("tryb.etykieta") },
        (["prosty", "pelny"] as const).map((tr) =>
          h(
            "button",
            {
              type: "button", role: "radio", class: "segment" + (tr === tryb ? " aktywny" : ""), "aria-checked": String(tr === tryb), "data-tryb": tr,
              onclick: () => tr !== tryb && void ustawTryb(tr),
            },
            t(`tryb.${tr}`),
          ),
        ),
      ),
      h("span", null, t("app.lokalnie")),
    ),
  );
}

// Znak SoraFlux (08.10, cybersora-assets/logo/produkty/soraflux): dwa szewrony, z jednego w drugie.
// Pierwszy w kolorze tekstu, drugi w akcencie motywu (wszystkie motywy w Ustawieniach).
const MARKA = `<svg viewBox="12 20 96 80" aria-hidden="true"><path d="M18 26H38L72 60L38 94H18L52 60Z" fill="currentColor"/><path d="M48 26H68L102 60L68 94H48L82 60Z" fill="var(--akcent)"/></svg>`;

// Klawiatura: strzałki w liście zakładek (jak w ARIA tablist), Ctrl+1…5, Ctrl+O (dodaj pliki).
nawigacja.addEventListener("keydown", (e) => {
  if (!["ArrowDown", "ArrowUp", "ArrowRight", "ArrowLeft", "Home", "End"].includes(e.key)) return;
  if (!(e.target as HTMLElement).closest(".nawigacja-lista")) return;
  const lista = zakladki();
  const i = lista.indexOf(sklep.stan.zakladka);
  const n = lista.length;
  const j = e.key === "Home" ? 0 : e.key === "End" ? n - 1 : e.key === "ArrowDown" || e.key === "ArrowRight" ? (i + 1) % n : (i - 1 + n) % n;
  e.preventDefault();
  sklep.ustaw({ zakladka: lista[j] });
  nawigacja.querySelector<HTMLButtonElement>(`[data-zakladka="${lista[j]}"]`)?.focus();
});
window.addEventListener("keydown", (e) => {
  if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
  const nr = Number(e.key);
  const lista = zakladki();
  if (nr >= 1 && nr <= lista.length) {
    e.preventDefault();
    sklep.ustaw({ zakladka: lista[nr - 1] });
  } else if (e.key.toLowerCase() === "o" && widoki && trybApki() === "prosty") {
    e.preventDefault();
    sklep.ustaw({ zakladka: "prosty" });
    void (widoki.prosty as WidokProsty).wybierz();
  } else if (e.key.toLowerCase() === "o" && widoki) {
    e.preventDefault();
    const cel: Zakladka = sklep.stan.zakladka === "obrazy" ? "obrazy" : "konwertuj";
    sklep.ustaw({ zakladka: cel });
    void api.wybierzPliki(cel === "obrazy").then((s) => {
      if (s.length) void (widoki![cel] as WidokPlikowy).dodaj(s);
    });
  }
});

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
sklep.subskrybuj((s) => {
  const aktywne = aktywneZadania(s);
  if (s.zakladka !== ostatniaZakladka || aktywne !== ostatnieAktywne) {
    ostatniaZakladka = s.zakladka;
    ostatnieAktywne = aktywne;
    rysujNawigacje();
    pokazZakladke();
  }
  if (trybApki(s) !== ostatniTryb) {
    ostatniTryb = trybApki(s);
    rysujNawigacje();
    pokazZakladke();
    // Kolejka i Ustawienia wyglądają trochę inaczej w każdym trybie
    widoki?.kolejka.odswiez();
    widoki?.ustawienia.odswiez();
  }
  if (s.konfig !== ostatniKonfig) {
    const zmianaJezyka = s.konfig?.jezyk !== ostatniKonfig?.jezyk;
    ostatniKonfig = s.konfig;
    zastosujMotyw();
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
  rysujNawigacje();
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
  let cel: Zakladka = sklep.stan.zakladka;
  if (cel !== "konwertuj" && cel !== "obrazy") cel = sciezki.every(toObraz) ? "obrazy" : "konwertuj";
  sklep.ustaw({ zakladka: cel });
  void (widoki[cel] as WidokPlikowy).dodaj(sciezki);
});

// Pliki z Eksploratora („Konwertuj w SoraFlux”): przy starcie i do już otwartego okna.
function otworzPliki(sciezki: string[]): void {
  if (!widoki || sciezki.length === 0) return;
  if (trybApki() === "prosty") {
    sklep.ustaw({ zakladka: "prosty" });
    void (widoki.prosty as WidokProsty).dodaj(sciezki);
    return;
  }
  const cel: Zakladka = sciezki.every(toObraz) ? "obrazy" : "konwertuj";
  sklep.ustaw({ zakladka: cel });
  void (widoki[cel] as WidokPlikowy).dodaj(sciezki);
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
  // Tryb (decyzja 2): nowa instalacja → Prosty; aktualizacja z 1.x → Pełny + podpowiedź raz. Zapis od razu,
  // bo po zamknięciu kreatora nowa instalacja wyglądałaby już jak aktualizacja.
  const tryb = rozstrzygnijTryb(konfig);
  if (tryb.zapisz) {
    konfig = { ...konfig, tryb: tryb.tryb, podpowiedz_prosty_pokazana: konfig.podpowiedz_prosty_pokazana || tryb.tryb === "prosty" };
    await api.konfigZapisz(konfig);
  }
  ostatniTryb = tryb.tryb;
  const [presety, zadania] = await Promise.all([api.presetyLista(), api.listaZadan()]);
  sklep.ustaw({ konfig, presety, zadania: new Map(zadania.map((z) => [z.id, z])), zakladka: tryb.tryb === "prosty" ? "prosty" : "konwertuj" });
  zastosujMotyw();
  widoki = stworzWidoki();
  rysujNawigacje();
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

void start();

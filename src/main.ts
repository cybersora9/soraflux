import "./tokeny.css";
import "./style.css";
import "./fonty";
import { czyCiemny, naloz, ustawStan, zKonfigu } from "./motywy";
import { api } from "./api";
import { h, ikona } from "./dom";
import { IKONY } from "./ikony";
import { jezyk, jezykSystemu, naZmianeJezyka, t, ustawJezyk } from "./i18n";
import { formatujRozmiar, toObraz, zmianaRozmiaru } from "./logika";
import { aktywneZadania, sklep, type Zakladka } from "./sklep";
import { stworzWidokPlikowy, type WidokPlikowy } from "./widoki/plikowy";
import { stworzWidokKolejki } from "./widoki/kolejka";
import { stworzWidokUstawien } from "./widoki/ustawienia";
import { stworzWidokPobierania } from "./widoki/pobierz";
import { pokazKreator } from "./widoki/kreator";

const ZAKLADKI: Zakladka[] = ["konwertuj", "pobierz", "obrazy", "kolejka", "ustawienia"];

interface Widok {
  el: HTMLElement;
  odswiez(): void;
}

let widoki: Record<Zakladka, Widok> | null = null;

function stworzWidoki(): Record<Zakladka, Widok> {
  return {
    konwertuj: stworzWidokPlikowy("konwertuj"),
    pobierz: stworzWidokPobierania(),
    obrazy: stworzWidokPlikowy("obrazy"),
    kolejka: stworzWidokKolejki(),
    ustawienia: stworzWidokUstawien(),
  };
}

const app = document.querySelector<HTMLDivElement>("#app")!;
const nawigacja = h("nav", { class: "nawigacja", "aria-label": "SoraConverter" });
const tresc = h("main", { class: "tresc", id: "tresc" });
const dymek = h("div", { class: "dymek", role: "status", "aria-live": "polite" });
const nakladkaUpuszczania = h("div", { class: "nakladka-upuszczania", "aria-hidden": "true" });
app.append(nawigacja, tresc, dymek, nakladkaUpuszczania);

function rysujNawigacje(): void {
  const aktywne = aktywneZadania(sklep.stan);
  nawigacja.replaceChildren(
    h("div", { class: "marka" }, h("span", { class: "marka-znak", html: MARKA }), h("span", { class: "marka-nazwa" }, "SoraConverter")),
    h(
      "div",
      { class: "nawigacja-lista", role: "tablist", "aria-orientation": "vertical" },
      ZAKLADKI.map((z) =>
        h(
          "button",
          {
            type: "button",
            role: "tab",
            "aria-selected": String(sklep.stan.zakladka === z),
            tabindex: sklep.stan.zakladka === z ? "0" : "-1",
            "aria-keyshortcuts": `Control+${ZAKLADKI.indexOf(z) + 1}`,
            "aria-controls": "tresc",
            class: "nawigacja-przycisk" + (sklep.stan.zakladka === z ? " aktywny" : ""),
            "data-zakladka": z,
            onclick: () => sklep.ustaw({ zakladka: z }),
          },
          ikona(IKONY[z]),
          h("span", null, t(`zakladka.${z}`)),
          z === "kolejka" && aktywne > 0 ? h("span", { class: "plakietka plakietka-akcent" }, String(aktywne)) : null,
        ),
      ),
    ),
    h("div", { class: "nawigacja-stopka" }, t("app.lokalnie")),
  );
}

const MARKA = `<svg viewBox="0 0 512 512" aria-hidden="true"><defs><linearGradient id="mg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="var(--akcent)"/><stop offset="1" stop-color="var(--akcent-2)"/></linearGradient></defs><path d="M136 316c48 0 64-120 120-120s72 120 120 120" fill="none" stroke="url(#mg)" stroke-width="44" stroke-linecap="round"/><path d="M136 196c48 0 64 120 120 120s72-120 120-120" fill="none" stroke="currentColor" stroke-opacity=".85" stroke-width="44" stroke-linecap="round"/></svg>`;

// Klawiatura: strzałki w liście zakładek (jak w ARIA tablist), Ctrl+1…5, Ctrl+O (dodaj pliki).
nawigacja.addEventListener("keydown", (e) => {
  if (!["ArrowDown", "ArrowUp", "ArrowRight", "ArrowLeft", "Home", "End"].includes(e.key)) return;
  const i = ZAKLADKI.indexOf(sklep.stan.zakladka);
  const n = ZAKLADKI.length;
  const j = e.key === "Home" ? 0 : e.key === "End" ? n - 1 : e.key === "ArrowDown" || e.key === "ArrowRight" ? (i + 1) % n : (i - 1 + n) % n;
  e.preventDefault();
  sklep.ustaw({ zakladka: ZAKLADKI[j] });
  nawigacja.querySelector<HTMLButtonElement>(`[data-zakladka="${ZAKLADKI[j]}"]`)?.focus();
});
window.addEventListener("keydown", (e) => {
  if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
  const nr = Number(e.key);
  if (nr >= 1 && nr <= ZAKLADKI.length) {
    e.preventDefault();
    sklep.ustaw({ zakladka: ZAKLADKI[nr - 1] });
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
  let cel: Zakladka = sklep.stan.zakladka;
  if (cel !== "konwertuj" && cel !== "obrazy") cel = sciezki.every(toObraz) ? "obrazy" : "konwertuj";
  sklep.ustaw({ zakladka: cel });
  void (widoki[cel] as WidokPlikowy).dodaj(sciezki);
});

// Pliki z Eksploratora („Konwertuj w SoraConverter”): przy starcie i do już otwartego okna.
function otworzPliki(sciezki: string[]): void {
  if (!widoki || sciezki.length === 0) return;
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
  if (!document.hasFocus()) void api.powiadom("SoraConverter", tresc);
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
  const konfig = await api.konfigWczytaj();
  ustawJezyk(konfig.jezyk ?? jezykSystemu());
  const [presety, zadania] = await Promise.all([api.presetyLista(), api.listaZadan()]);
  sklep.ustaw({ konfig, presety, zadania: new Map(zadania.map((z) => [z.id, z])) });
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
}

void start();

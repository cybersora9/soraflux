// Tryb Prosty (S4, 1.4.0): jedno pole na plik albo link → 3–4 gotowe akcje → jeden duży przycisk,
// który mówi, co się stanie. Stany: start, wybór akcji, w toku, gotowe / gotowe z uwagą / błąd.
// Logika (rozpoznanie, profile, napisy) w `src/prosty.ts`; tu tylko DOM. Z trybem Pełnym łączy go
// wyłącznie `doPelnego` („Więcej ustawień”), żeby dało się go przenieść do wspólnego `sora-ui`.
import { api } from "../api";
import { h, ikona } from "../dom";
import { IKONY } from "../ikony";
import { jezyk, t, tlumaczBlad } from "../i18n";
import { formatujCzas, formatujEta, formatujRozmiar, nazwaPliku, parsujCzas, wyciagnijUrl, zmianaRozmiaru } from "../logika";
import {
  akcjeDla, CELE, DLUGOSC_GIF, dopisekAkcji, formaLiczby, fragmentGif, kluczBledu, napisPrzycisku, naprawaBledu, opcjeLinku, opisPliku,
  opisWyniku, postepPaczki, profilAkcji, rodzajMediow, rozpoznaj, tytulGotowe, wyborLinku, type Cel, type Rodzaj,
} from "../prosty";
import { przycisk, uwaga } from "../komponenty/pola";
import { nazwaFolderu } from "../komponenty/wspolne";
import { pokazDymek, sklep } from "../sklep";
import type { Info, InfoZadania, Media, NoweZadanie, Profil, Wybor } from "../typy";

/** „Więcej ustawień (tryb Pełny)”: ten plik i ta akcja przechodzą do Pełnego. */
export type Przekazanie =
  | { typ: "pliki"; sciezki: string[]; profil: Profil; obrazy: boolean }
  | { typ: "link"; url: string; wybor: Wybor };

export interface WidokProsty {
  el: HTMLElement;
  odswiez(): void;
  dodaj(sciezki: string[]): Promise<void>;
  wybierz(): Promise<void>;
}

interface Plik {
  sciezka: string;
  media: Media | null;
  blad?: string;
}

interface Praca {
  ids: number[];
  zadania: NoweZadanie[];
  rodzaj: Rodzaj;
  akcja: string;
  cel: Cel;
  nazwa: string;
}

const IKONA_AKCJI: Record<string, string> = {
  "film.wyslij": IKONY.wyslij, "film.telefon": IKONY.telefon, "film.mp3": IKONY.nuta, "film.gif": IKONY.gif,
  "dzwiek.mp3": IKONY.nuta, "dzwiek.mowa": IKONY.wyslij, "dzwiek.glosnosc": IKONY.glosnosc,
  "zdjecia.www": IKONY.wyslij, "zdjecia.jpg": IKONY.obrazy, "zdjecia.pol": IKONY.zmniejsz,
  "link.film": IKONY.film, "link.mp3": IKONY.nuta, "link.telefon": IKONY.telefon,
};
const IKONA_RODZAJU: Record<Rodzaj, string> = { film: IKONY.film, dzwiek: IKONY.nuta, zdjecia: IKONY.obrazy, link: IKONY.link };
/** Kafle linku: format zamiast szacunku (rozmiar zna dopiero yt-dlp przy pobieraniu). */
const FORMAT_LINKU: Record<string, string> = { film: "MP4", mp3: "MP3", telefon: "MP4 · 480p" };

export function stworzWidokProsty(o: { doPelnego(p: Przekazanie): void }): WidokProsty {
  let ekran: "start" | "wybor" | "praca" = "start";
  let pliki: Plik[] = [];
  let sondowanie = false;
  let link: { url: string; info: Info | null; blad: string | null } | null = null;
  let tekstLinku = "";
  let linkZeSchowka: string | null = null;
  let ostatniSchowek = "";
  let rodzaj: Rodzaj | null = null;
  let pozostale = 0;
  let akcja = "";
  const wybrane: Partial<Record<Rodzaj, string>> = {};
  let cel: Cel = "mail";
  let gifOd = 0;
  let szacunki: Record<string, string> = {};
  let pokolenie = 0;
  let pokolenieSzacunku = 0;
  let praca: Praca | null = null;
  let wTokuEl: HTMLElement | null = null;

  const el = h("div", { class: "widok widok-prosty" });

  const pasujace = () => pliki.filter((p) => p.media && rodzaj && rodzaj !== "link" && rodzajMediow(p.media) === rodzaj);
  const czasPierwszego = () => pasujace()[0]?.media?.czas_s ?? null;
  const opcjeAkcji = (p: Plik) => ({ cel, zrodlo: p.sciezka, gifOd, czas: p.media?.czas_s ?? null });

  // ---------- rysowanie z zachowaniem fokusu (kafle, chipy, przyciski mają data-fokus) ----------
  function rysuj() {
    const fokus = document.activeElement instanceof HTMLElement && el.contains(document.activeElement) ? document.activeElement.dataset.fokus : undefined;
    wTokuEl = null;
    el.replaceChildren(...(ekran === "start" ? ekranStart() : ekran === "wybor" ? ekranWybor() : ekranPraca()));
    if (fokus) el.querySelector<HTMLElement>(`[data-fokus="${fokus}"]`)?.focus();
  }

  const naglowek = (tytul: string, podtytul?: string) =>
    h("header", { class: "naglowek" }, h("div", null, h("h1", null, tytul), podtytul ? h("p", { class: "podtytul" }, podtytul) : null));

  function brakNarzedzi(): HTMLElement | null {
    const n = sklep.stan.narzedzia;
    if (!n || (n.sciezki.ffmpeg && n.sciezki.ffprobe)) return null;
    return uwaga("uwaga", ikona(IKONY.uwaga), h("span", null, t("narzedzia.brak_ffmpeg")), przycisk(t("narzedzia.przejdz"), () => sklep.ustaw({ zakladka: "ustawienia" }), "przycisk-tekstowy"));
  }

  /** Pasek „W toku: 46% · Pokaż”, gdy ktoś wrócił na start w trakcie pracy. */
  function paskWToku(): HTMLElement | null {
    if (!praca || stanPracy().koniec) return null;
    wTokuEl = h("span", null, t("prosty.w_toku", { p: Math.floor(stanPracy().procent) }));
    return uwaga("info", ikona(IKONY.kolejka), wTokuEl, przycisk(t("prosty.w_toku.pokaz"), () => ((ekran = "praca"), rysuj()), "przycisk-maly"));
  }

  // ---------- start ----------
  function ekranStart(): HTMLElement[] {
    const pole = h("input", {
      type: "text", class: "tekst prosty-link-pole", placeholder: t("prosty.link.placeholder"), "aria-label": t("prosty.link.placeholder"),
      spellcheck: "false", "data-fokus": "link", value: tekstLinku,
    });
    pole.addEventListener("input", () => (tekstLinku = pole.value));
    pole.addEventListener("keydown", (e) => e.key === "Enter" && (e.preventDefault(), void sprawdzLink()));
    const schowek = linkZeSchowka;
    return [
      naglowek(t("prosty.tytul"), t("prosty.podtytul")),
      ...[brakNarzedzi(), paskWToku()].filter((x): x is HTMLElement => !!x),
      h(
        "section",
        { class: "karta prosty-start" },
        h(
          "div",
          {
            class: "strefa prosty-strefa", role: "button", tabindex: "0", "data-fokus": "strefa", "aria-label": `${t("prosty.upusc")}. ${t("prosty.wybierz")}`,
            "aria-keyshortcuts": "Control+O",
            onclick: () => void wybierz(),
            onkeydown: (e: KeyboardEvent) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), void wybierz()),
          },
          ikona(IKONY.upusc, "ikona prosty-strefa-ikona"),
          h("span", { class: "prosty-strefa-tytul" }, t("prosty.upusc")),
          h("span", { class: "prosty-strefa-wiersz" }, h("span", { class: "przycisk przycisk-drugorzedny", "aria-hidden": "true" }, t("prosty.wybierz")), h("span", { class: "prosty-strefa-pomoc" }, t("prosty.wybierz.pomoc"))),
        ),
        h("div", { class: "prosty-lub" }, t("prosty.lub")),
        h("div", { class: "prosty-link" }, pole, przycisk(t("prosty.link.sprawdz"), () => void sprawdzLink(), "przycisk-drugorzedny", { "data-fokus": "sprawdz" })),
        schowek
          ? h(
              "div",
              { class: "prosty-schowek" },
              ikona(IKONY.link),
              h("span", null, t("prosty.schowek"), " ", h("strong", null, schowek.length > 60 ? schowek.slice(0, 60) + "…" : schowek)),
              przycisk(t("prosty.schowek.wklej"), () => {
                tekstLinku = schowek;
                linkZeSchowka = null;
                void sprawdzLink();
              }, "przycisk-maly"),
            )
          : null,
      ),
      h(
        "p",
        { class: "prosty-przyklady" },
        h("span", null, t("prosty.przyklady")),
        [1, 2, 3, 4].map((i) => h("b", null, t(`prosty.przyklad.${i}`))),
      ),
    ];
  }

  // ---------- wybór akcji ----------
  function kartaPliku(): HTMLElement {
    let tytul = "";
    let opis = "";
    let miniatura: HTMLElement = ikona(IKONA_RODZAJU[rodzaj ?? "film"]);
    let blad: string | null = null;
    if (link) {
      const i = link.info;
      tytul = i?.typ === "film" ? i.tytul : i?.typ === "playlista" ? i.tytul : link.url;
      // surowy błąd yt-dlp (bez klucza i18n) laik zobaczy tylko po „Kopiuj szczegóły błędu”
      if (link.blad) blad = kluczBledu(link.blad) ? tlumaczBlad(link.blad).split("\n")[0] : t("prosty.link.blad");
      else if (!i) opis = t("prosty.link.sprawdzam");
      else if (i.typ === "film") {
        let host = "";
        try {
          host = new URL(i.url).hostname.replace(/^www\./, "");
        } catch {
          /* bez hosta */
        }
        opis = [host, i.czas_s ? formatujCzas(Math.round(i.czas_s)) : null, i.wysokosci.length ? t("prosty.link.do", { r: `${Math.max(...i.wysokosci)}p` }) : null].filter(Boolean).join(" · ");
        if (i.miniatura) miniatura = h("img", { src: i.miniatura, alt: "", referrerpolicy: "no-referrer", onerror: (e: Event) => (e.target as HTMLElement).remove() });
      } else opis = t("pobierz.playlista_n", { n: i.wpisy.length });
    } else {
      const lista = rodzaj ? pasujace() : pliki;
      const j = jezyk();
      if (lista.length === 1 && lista[0].media) {
        tytul = nazwaPliku(lista[0].sciezka);
        const op = opisPliku(lista[0].media, j);
        opis = [t(op.rodzaj), ...op.czesci, op.cechy.map((c) => t(c)).join(", ")].filter(Boolean).join(" · ");
      } else {
        const n = lista.length;
        tytul = n === 1 ? nazwaPliku(lista[0].sciezka) : t(`prosty.pliki_${formaLiczby(n) === "1" ? "kilka" : formaLiczby(n)}`, { n });
        const suma = lista.reduce((s, p) => s + (p.media?.rozmiar_b ?? 0), 0);
        const nazwy = lista.slice(0, 3).map((p) => nazwaPliku(p.sciezka)).join(", ") + (lista.length > 3 ? "…" : "");
        opis = sondowanie ? t("prosty.sprawdzam") : [nazwy, suma ? t("prosty.razem", { r: formatujRozmiar(suma, j) }) : null].filter(Boolean).join(" · ");
      }
      if (!sondowanie && !rodzaj) blad = t("prosty.nierozpoznany");
    }
    return h(
      "div",
      { class: `karta prosty-plik prosty-plik-${rodzaj ?? "film"}` },
      h("span", { class: "prosty-miniatura", "aria-hidden": "true" }, miniatura),
      h("div", { class: "prosty-plik-opis" }, h("strong", null, tytul), blad ? h("span", { class: "prosty-plik-blad" }, blad) : h("span", null, opis)),
      link?.blad
        ? przycisk(t("prosty.blad.kopiuj"), () => void api.piszSchowek(tlumaczBlad(link?.blad ?? "")).then(() => pokazDymek(t("prosty.blad.skopiowano"))), "przycisk-tekstowy", { "data-fokus": "kopiuj-link" })
        : null,
      przycisk(t("prosty.zmien"), resetuj, "przycisk-tekstowy", { "data-fokus": "zmien" }),
    );
  }

  function opcjeKafla(a: string): HTMLElement | null {
    if (rodzaj === "film" && a === "wyslij") {
      return h(
        "div",
        { class: "prosty-chipy", role: "group", "aria-label": t("prosty.cel.etykieta") },
        (Object.keys(CELE) as Cel[]).map((c) =>
          h("button", {
            type: "button", class: "chip" + (c === cel ? " aktywny" : ""), "aria-pressed": String(c === cel), "data-fokus": `cel-${c}`,
            onclick: () => ((cel = c), przeliczSzacunki(), rysuj()),
          }, t(`prosty.cel.${c}`)),
        ),
      );
    }
    if (rodzaj === "film" && a === "gif") {
      const f = fragmentGif(gifOd, czasPierwszego());
      const pole = h("input", { type: "text", class: "tekst czas", value: formatujCzas(f.od), "aria-label": t("prosty.gif.od"), "data-fokus": "gif-od", inputmode: "decimal" });
      pole.addEventListener("change", () => {
        gifOd = parsujCzas(pole.value) ?? 0;
        przeliczSzacunki();
        rysuj();
      });
      return h("label", { class: "prosty-gif" }, h("span", null, t("prosty.gif.od")), pole, h("span", { class: "prosty-gif-dl" }, `→ ${formatujCzas(f.koniec)} · ${t("prosty.gif.dlugosc", { s: DLUGOSC_GIF })}`));
    }
    return null;
  }

  function kafle(): HTMLElement {
    const r = rodzaj!;
    const lista = akcjeDla(r);
    const grupa = h(
      "div",
      { class: "prosty-akcje", role: "radiogroup", "aria-label": t("prosty.pytanie") },
      lista.map((a, i) => {
        const wl = a === akcja;
        return h(
          "div",
          { class: "prosty-akcja" + (wl ? " wybrana" : "") },
          h(
            "button",
            {
              type: "button", role: "radio", "aria-checked": String(wl), tabindex: wl ? "0" : "-1", class: "prosty-akcja-przycisk",
              "data-akcja-prosta": a, "data-fokus": `akcja-${a}`,
              onclick: () => wybierzAkcje(a),
              onkeydown: (e: KeyboardEvent) => e.key === "Enter" && (e.preventDefault(), wybierzAkcje(a), void uruchom()),
            },
            i === 0 ? h("span", { class: "prosty-znaczek" }, ikona(IKONY.gwiazdka), t("prosty.najczesciej")) : h("span", { class: "prosty-znaczek", "aria-hidden": "true" }),
            h("span", { class: "prosty-akcja-tytul" }, ikona(IKONA_AKCJI[`${r}.${a}`] ?? IKONY.konwertuj), t(`prosty.akcja.${r}.${a}`)),
            h("span", { class: "prosty-akcja-opis" }, t(`prosty.akcja.${r}.${a}.opis`)),
            h("span", { class: "prosty-akcja-wynik" }, r === "link" ? FORMAT_LINKU[a] : (szacunki[a] ?? "")),
          ),
          wl ? opcjeKafla(a) : null,
        );
      }),
    );
    // strzałki zmieniają wybór (ARIA radiogroup), Enter na kaflu = przycisk główny
    grupa.addEventListener("keydown", (e) => {
      const krok = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 0;
      if (!krok || !(e.target as HTMLElement).matches(".prosty-akcja-przycisk")) return;
      e.preventDefault();
      const j = (lista.indexOf(akcja) + krok + lista.length) % lista.length;
      wybierzAkcje(lista[j]);
      el.querySelector<HTMLElement>(`[data-fokus="akcja-${lista[j]}"]`)?.focus();
    });
    return grupa;
  }

  function wybierzAkcje(a: string) {
    if (!rodzaj) return;
    akcja = a;
    wybrane[rodzaj] = a;
    rysuj();
  }

  function ekranWybor(): HTMLElement[] {
    const k = sklep.stan.konfig;
    const doLinku = rodzaj === "link";
    const folder = doLinku ? k?.katalog_pobierania : k?.katalog_wyjscia;
    const gotowe = !sondowanie && !!rodzaj && (doLinku ? !!link?.info : pasujace().length > 0);
    const n = doLinku ? 1 : pasujace().length;
    const [klucz, par] = rodzaj ? napisPrzycisku(rodzaj, akcja, { cel, n }) : ["prosty.link.sprawdz", {}];
    const naprawaLinku = link?.blad && naprawaBledu(link.blad) === "aktualizuj";
    return [
      naglowek(t("prosty.pytanie")),
      ...[brakNarzedzi(), paskWToku()].filter((x): x is HTMLElement => !!x),
      kartaPliku(),
      naprawaLinku ? uwaga("uwaga", ikona(IKONY.uwaga), h("span", null, t("prosty.blad.aktualizuj.opis")), przycisk(t("prosty.blad.aktualizuj"), () => void aktualizujISprawdz(), "przycisk-maly")) : null,
      pozostale > 0 ? uwaga("info", ikona(IKONY.info), h("span", null, t("prosty.mieszane", { n: pozostale }))) : null,
      // link nie działa: kafle nic by nie dały, zostaje opis błędu i „Zmień”
      rodzaj && !(doLinku && link?.blad) ? kafle() : null,
      doLinku ? h("p", { class: "notka" }, t("prosty.prawa")) : null,
      h(
        "footer",
        { class: "prosty-stopka" },
        h(
          "div",
          { class: "prosty-stopka-lewa" },
          h(
            "span",
            { class: "prosty-gdzie" },
            t("prosty.zapisze"), " ",
            h("strong", { title: folder ?? undefined }, folder ? nazwaFolderu(folder) : t(doLinku ? "prosty.zapisze.pobrane" : "prosty.zapisze.obok")),
            " · ",
            przycisk(t("prosty.zapisze.zmien"), () => void zmienFolder(doLinku), "przycisk-tekstowy prosty-zmien-folder", { "data-fokus": "folder" }),
          ),
          rodzaj && gotowe ? przycisk([ikona(IKONY.strzalka), t("prosty.wiecej")], doPelnego, "przycisk-tekstowy prosty-wiecej", { "data-fokus": "wiecej" }) : null,
        ),
        przycisk(t(klucz, par), () => void uruchom(), "przycisk-glowny prosty-start-przycisk", { disabled: !gotowe, "data-fokus": "start" }),
      ),
    ].filter((x): x is HTMLElement => !!x);
  }

  async function zmienFolder(doLinku: boolean): Promise<boolean> {
    const klucz = doLinku ? "katalog_pobierania" : "katalog_wyjscia";
    const k = sklep.stan.konfig;
    const w = await api.wybierzFolder(k?.[klucz] ?? undefined);
    if (!w || !sklep.stan.konfig) return false;
    const nowy = { ...sklep.stan.konfig, [klucz]: w };
    await api.konfigZapisz(nowy);
    sklep.ustaw({ konfig: nowy });
    rysuj();
    return true;
  }

  function doPelnego() {
    if (!rodzaj) return;
    if (rodzaj === "link" && link) {
      o.doPelnego({ typ: "link", url: link.url, wybor: wyborLinku(akcja) });
    } else if (rodzaj !== "link") {
      const p = pasujace();
      if (p.length === 0) return;
      o.doPelnego({ typ: "pliki", sciezki: p.map((x) => x.sciezka), profil: profilAkcji(rodzaj, akcja, opcjeAkcji(p[0])), obrazy: rodzaj === "zdjecia" });
    }
    resetuj();
  }

  // ---------- szacunek na kaflach („412 MB → ok. 24 MB”) ----------
  function przeliczSzacunki() {
    if (!rodzaj || rodzaj === "link") return;
    const r = rodzaj;
    const lista = pasujace().slice(0, 50);
    const moje = ++pokolenieSzacunku;
    const przed = lista.reduce((s, p) => s + (p.media?.rozmiar_b ?? 0), 0);
    for (const a of akcjeDla(r)) {
      void Promise.all(lista.map((p) => api.szacuj(p.media!, profilAkcji(r, a, opcjeAkcji(p))).catch(() => null))).then((w) => {
        if (moje !== pokolenieSzacunku) return;
        const po = w.some((x) => !x || x.bajty === null) ? null : w.reduce((s, x) => s + (x!.bajty ?? 0), 0);
        const porownaj = !(r === "film" && (a === "mp3" || a === "gif"));
        // kilka filmów „do wysłania”: każdy osobno mieści się w limicie, suma by myliła
        const kazdy = r === "film" && a === "wyslij" && lista.length > 1 && po !== null;
        const tekst = kazdy
          ? `${lista.length} × ${opisWyniku(null, po! / lista.length, { jezyk: jezyk(), ok: t("prosty.ok"), porownaj: false })}`
          : opisWyniku(przed || null, po, { jezyk: jezyk(), ok: t("prosty.ok"), porownaj });
        szacunki[a] = r === "film" && a === "gif" && tekst ? `${t("prosty.gif.dlugosc", { s: DLUGOSC_GIF })} · ${tekst}` : tekst;
        const wynik = el.querySelector(`[data-akcja-prosta="${a}"] .prosty-akcja-wynik`);
        if (wynik) wynik.textContent = szacunki[a];
      });
    }
  }

  // ---------- wejście: pliki i link ----------
  function resetuj() {
    pliki = [];
    link = null;
    rodzaj = null;
    pozostale = 0;
    szacunki = {};
    gifOd = 0;
    pokolenie++;
    pokolenieSzacunku++;
    ekran = "start";
    rysuj();
  }

  async function wybierz() {
    const s = await api.wybierzPliki(false);
    if (s.length) await dodaj(s);
  }

  async function dodaj(sciezki: string[]) {
    const rozwiniete = await api.rozwinFoldery(sciezki, []);
    if (rozwiniete.length === 0) return;
    pliki = rozwiniete.map((r) => ({ sciezka: r.sciezka, media: null }));
    link = null;
    rodzaj = null;
    pozostale = 0;
    szacunki = {};
    gifOd = 0;
    sondowanie = true;
    ekran = "wybor";
    const moje = ++pokolenie;
    rysuj();
    const wpisy = pliki;
    await Promise.all(
      wpisy.map(async (p) => {
        try {
          p.media = await api.sonda(p.sciezka);
        } catch (e) {
          p.blad = String(e);
        }
      }),
    );
    if (moje !== pokolenie || wpisy !== pliki) return;
    sondowanie = false;
    const r = rozpoznaj(pliki.filter((p) => p.media).map((p) => p.media!));
    rodzaj = r?.rodzaj ?? null;
    pozostale = r ? pliki.length - pasujace().length : 0;
    if (rodzaj) akcja = wybrane[rodzaj] ?? akcjeDla(rodzaj)[0];
    rysuj();
    przeliczSzacunki();
    el.querySelector<HTMLElement>(`[data-fokus="akcja-${akcja}"]`)?.focus();
  }

  async function sprawdzLink() {
    const url = wyciagnijUrl(tekstLinku)[0];
    if (!url) {
      pokazDymek(t("prosty.link.brak"), "blad");
      return;
    }
    pliki = [];
    link = { url, info: null, blad: null };
    rodzaj = "link";
    pozostale = 0;
    akcja = wybrane.link ?? akcjeDla("link")[0];
    ekran = "wybor";
    const moje = ++pokolenie;
    rysuj();
    const biezacy = link;
    try {
      // pierwszy link: brak yt-dlp albo stary z PATH → własna kopia (jak przy wejściu na Pobierz)
      const n = sklep.stan.narzedzia;
      if (n && (!n.sciezki.ytdlp || (n.ytdlp?.pochodzenie === "path" && n.ytdlp.stary)) && (await api.ytdlpZapewnij())) {
        sklep.ustaw({ narzedzia: await api.narzedziaStan() });
      }
      biezacy.info = await api.ytdlpInfo(url, false);
    } catch (e) {
      biezacy.blad = String(e);
    }
    if (moje !== pokolenie || biezacy !== link) return;
    tekstLinku = "";
    rysuj();
    el.querySelector<HTMLElement>(`[data-fokus="akcja-${akcja}"]`)?.focus();
  }

  async function aktualizujISprawdz() {
    try {
      sklep.ustaw({ narzedzia: await api.ytdlpAktualizuj() });
    } catch (e) {
      pokazDymek(tlumaczBlad(String(e)), "blad");
      return;
    }
    if (link) {
      tekstLinku = link.url;
      await sprawdzLink();
    }
  }

  // ---------- start pracy ----------
  function zadaniaDoKolejki(): NoweZadanie[] {
    if (!rodzaj) return [];
    if (rodzaj === "link") {
      const i = link?.info;
      if (!link || !i) return [];
      const zrodla = i.typ === "playlista" ? i.wpisy.map((e) => ({ url: e.url, tytul: e.tytul })) : [{ url: link.url, tytul: i.tytul }];
      return zrodla.map((z) => ({ rodzaj: { typ: "pobranie", url: z.url, opcje: opcjeLinku(akcja, z.tytul), potem: null }, katalog: null }));
    }
    const r = rodzaj;
    const d = dopisekAkcji(r, akcja, cel);
    const katalog = sklep.stan.konfig?.katalog_wyjscia ?? null;
    return pasujace().map((p) => ({
      rodzaj: { typ: "konwersja", wejscie: p.sciezka, profil: profilAkcji(r, akcja, opcjeAkcji(p)) },
      katalog,
      dopisek: d ? t(d) : null,
    }));
  }

  async function uruchom(zadania = zadaniaDoKolejki(), opis?: Omit<Praca, "ids" | "zadania">) {
    if (zadania.length === 0 || (!rodzaj && !opis)) return;
    const meta = opis ?? {
      rodzaj: rodzaj!,
      akcja,
      cel,
      nazwa: link?.info && link.info.typ === "film" ? link.info.tytul : pasujace().length === 1 ? nazwaPliku(pasujace()[0].sciezka) : t(`prosty.pliki_${formaLiczby(zadania.length) === "1" ? "kilka" : formaLiczby(zadania.length)}`, { n: zadania.length }),
    };
    try {
      const ids = await api.dodajZadania(zadania);
      praca = { ids, zadania, ...meta };
      bylKoniec = false;
      ekran = "praca";
      pliki = [];
      link = null;
      rodzaj = null;
      rysuj();
      el.querySelector<HTMLElement>(".prosty-praca .przycisk")?.focus();
    } catch (e) {
      pokazDymek(tlumaczBlad(String(e)), "blad");
    }
  }

  // ---------- praca: w toku, gotowe, uwaga, błąd ----------
  function zadaniaPracy(): InfoZadania[] {
    return (praca?.ids ?? []).map((id) => sklep.stan.zadania.get(id)).filter((z): z is InfoZadania => !!z);
  }

  function stanPracy() {
    const z = zadaniaPracy();
    return postepPaczki(z, z.map((x) => sklep.stan.postepy.get(x.id)?.eta_s ?? null));
  }

  function ekranPraca(): HTMLElement[] {
    const p = praca;
    const zad = zadaniaPracy();
    // zadania wyczyszczone w „Gotowe pliki” albo brak pracy: wracamy na start
    if (!p || zad.length === 0) {
      praca = null;
      ekran = "start";
      return ekranStart();
    }
    const s = stanPracy();
    const pobieranie = p.rodzaj === "link";
    const podtytul = `${p.nazwa} · ${t(`prosty.akcja.${p.rodzaj}.${p.akcja}`)}`;
    if (!s.koniec) {
      const procent = Math.floor(s.procent);
      return [
        naglowek(t(pobieranie ? "prosty.trwa.pobieram" : "prosty.trwa"), podtytul),
        h(
          "section",
          { class: "karta prosty-praca" },
          h("div", { class: "pasek prosty-pasek", role: "progressbar", "aria-valuemin": "0", "aria-valuemax": "100", "aria-valuenow": String(procent), "aria-label": podtytul },
            h("div", { class: "pasek-wypelnienie", style: { width: `${s.procent}%` } })),
          h("div", { class: "prosty-praca-wiersz" }, h("span", { class: "prosty-procent" }, `${procent}%`), h("span", { class: "prosty-zostalo" }, s.eta ? t("prosty.zostalo", { czas: formatujEta(s.eta) }) : "")),
          h("p", { class: "prosty-cicho" }, t(pobieranie ? "prosty.trwa.pomoc_link" : "prosty.trwa.pomoc")),
          h(
            "div",
            { class: "wiersz" },
            przycisk(t("prosty.anuluj"), () => p.ids.forEach((id) => void api.anulujZadanie(id)), "przycisk-drugorzedny", { "data-fokus": "anuluj" }),
            przycisk(t("prosty.kolejny"), () => ((ekran = "start"), rysuj()), "przycisk-tekstowy", { "data-fokus": "kolejny" }),
          ),
        ),
      ];
    }
    const nastepny = przycisk(t("prosty.nastepny"), zakoncz, "przycisk-drugorzedny", { "data-fokus": "nastepny" });
    const bledy = zad.filter((z) => z.stan.typ === "blad");
    if (bledy.length) {
      const surowy = bledy[0].stan.typ === "blad" ? bledy[0].stan.komunikat : "";
      const naprawa = naprawaBledu(surowy);
      const tytul = pobieranie && naprawa === "aktualizuj" ? t("prosty.blad.pobieranie") : t("prosty.blad.tytul");
      const opis = naprawa === "inny" ? t(pobieranie ? "prosty.blad.inny_link.opis" : "prosty.blad.inny.opis") : t(`prosty.blad.${naprawa}.opis`);
      const glowny =
        naprawa === "aktualizuj"
          ? przycisk(t("prosty.blad.aktualizuj"), () => void napraw("aktualizuj"), "przycisk-glowny", { "data-fokus": "napraw" })
          : naprawa === "folder"
            ? przycisk(t("prosty.blad.folder"), () => void napraw("folder"), "przycisk-glowny", { "data-fokus": "napraw" })
            : przycisk(t("prosty.blad.inny"), zakoncz, "przycisk-glowny", { "data-fokus": "napraw" });
      return [
        h(
          "section",
          { class: "karta prosty-wynik prosty-wynik-blad", role: "alert" },
          h("h1", { class: "prosty-wynik-tytul" }, ikona(IKONY.uwaga), tytul),
          h("p", { class: "prosty-cicho" }, podtytul),
          h("p", null, opis),
          h("div", { class: "wiersz" }, glowny, przycisk(t("prosty.blad.kopiuj"), () => void api.piszSchowek(tlumaczBlad(surowy)).then(() => pokazDymek(t("prosty.blad.skopiowano"))), "przycisk-tekstowy", { "data-fokus": "kopiuj" })),
          h("p", { class: "prosty-cicho" }, t("prosty.blad.pomoc")),
        ),
      ];
    }
    const gotowe = zad.filter((z) => z.stan.typ === "gotowe" || z.stan.typ === "pominiete");
    if (gotowe.length === 0) {
      return [h("section", { class: "karta prosty-wynik" }, h("h1", { class: "prosty-wynik-tytul" }, t("prosty.anulowano")), h("p", { class: "prosty-cicho" }, podtytul), h("div", { class: "wiersz" }, nastepny))];
    }
    const j = jezyk();
    const przed = gotowe.reduce((a, z) => a + (z.rozmiar_wejscia ?? 0), 0);
    const po = gotowe.reduce((a, z) => a + (z.rozmiar_wyniku ?? 0), 0);
    const pierwszy = gotowe[0].stan.typ === "gotowe" || gotowe[0].stan.typ === "pominiete" ? gotowe[0].stan.wyjscie : null;
    const lcd = po ? h("span", { class: "prosty-lcd" }, przed && !pobieranie ? `${formatujRozmiar(przed, j)} → ${formatujRozmiar(po, j)} ` : formatujRozmiar(po, j), przed && !pobieranie ? h("small", null, zmianaRozmiaru(przed, po)) : null) : null;
    const pokaz = pierwszy ? przycisk([ikona(IKONY.folder), t("prosty.pokaz")], () => void api.pokazWFolderze(pierwszy), "przycisk-glowny", { "data-fokus": "pokaz" }) : null;
    const ostrz = gotowe.find((z) => z.ostrzezenie)?.ostrzezenie;
    if (ostrz) {
      return [
        h(
          "section",
          { class: "karta prosty-wynik prosty-wynik-uwaga" },
          h("h1", { class: "prosty-wynik-tytul" }, ikona(IKONY.uwaga), t("prosty.uwaga.tytul")),
          h("p", { class: "prosty-cicho" }, podtytul),
          lcd,
          h("p", null, t("prosty.uwaga.uciete", { czas: formatujCzas(ostrz.zrodlo_konczy_s), oczekiwane: formatujCzas(ostrz.oczekiwane_s) })),
          h("div", { class: "wiersz" }, pokaz, przycisk(t("prosty.uwaga.inny"), zakoncz, "przycisk-drugorzedny", { "data-fokus": "nastepny" })),
        ),
      ];
    }
    const tytul = t(tytulGotowe(p.rodzaj, p.akcja, p.cel));
    return [
      h(
        "section",
        { class: "karta prosty-wynik prosty-wynik-ok", role: "status" },
        h("h1", { class: "prosty-wynik-tytul" }, ikona(IKONY.ok), tytul),
        h("p", { class: "prosty-cicho" }, podtytul),
        lcd,
        h("p", { class: "prosty-cicho" }, gotowe.length === 1 && pierwszy ? t("prosty.zapisano", { nazwa: nazwaPliku(pierwszy) }) : t("prosty.zapisano_n", { n: gotowe.length })),
        h("div", { class: "wiersz" }, pokaz, nastepny),
      ),
    ];
  }

  async function napraw(rodzajNaprawy: "aktualizuj" | "folder") {
    const p = praca;
    if (!p) return;
    const nieudane = p.zadania.filter((_, i) => sklep.stan.zadania.get(p.ids[i])?.stan.typ === "blad");
    if (rodzajNaprawy === "aktualizuj") {
      try {
        sklep.ustaw({ narzedzia: await api.ytdlpAktualizuj() });
      } catch (e) {
        pokazDymek(tlumaczBlad(String(e)), "blad");
        return;
      }
      await uruchom(nieudane, p);
    } else if (await zmienFolder(p.rodzaj === "link")) {
      const k = sklep.stan.konfig;
      const katalog = (p.rodzaj === "link" ? k?.katalog_pobierania : k?.katalog_wyjscia) ?? null;
      await uruchom(nieudane.map((z) => ({ ...z, katalog })), p);
    }
  }

  function zakoncz() {
    praca = null;
    resetuj();
    el.querySelector<HTMLElement>('[data-fokus="strefa"]')?.focus();
  }

  // Postęp: na ekranie pracy aktualizujemy tylko pasek i liczby (fokus zostaje na „Anuluj”), całość przy końcu.
  let bylKoniec = false;
  let ostatnieZadania = sklep.stan.zadania;
  let ostatniePostepy = sklep.stan.postepy;
  sklep.subskrybuj((s) => {
    if (s.zadania === ostatnieZadania && s.postepy === ostatniePostepy) return;
    ostatnieZadania = s.zadania;
    ostatniePostepy = s.postepy;
    if (!praca) return;
    const st = stanPracy();
    if (wTokuEl) wTokuEl.textContent = t("prosty.w_toku", { p: Math.floor(st.procent) });
    if (ekran !== "praca") return;
    if (st.koniec !== bylKoniec) {
      bylKoniec = st.koniec;
      rysuj();
      if (st.koniec) el.querySelector<HTMLElement>(".prosty-wynik .przycisk-glowny")?.focus();
      return;
    }
    const pasek = el.querySelector<HTMLElement>(".prosty-pasek");
    pasek?.setAttribute("aria-valuenow", String(Math.floor(st.procent)));
    const w = pasek?.querySelector<HTMLElement>(".pasek-wypelnienie");
    if (w) w.style.width = `${st.procent}%`;
    const pr = el.querySelector(".prosty-procent");
    if (pr) pr.textContent = `${Math.floor(st.procent)}%`;
    const zo = el.querySelector(".prosty-zostalo");
    if (zo) zo.textContent = st.eta ? t("prosty.zostalo", { czas: formatujEta(st.eta) }) : "";
  });

  // Link w schowku przy powrocie do okna (jak w Pobierz; wyłączane w Ustawieniach).
  api.naPowrotOkna(async () => {
    if (!sklep.stan.konfig?.schowek || sklep.stan.konfig.tryb !== "prosty" || ekran !== "start") return;
    const tekst = (await api.czytajSchowek()).trim();
    if (!tekst || tekst === ostatniSchowek) return;
    ostatniSchowek = tekst;
    const url = wyciagnijUrl(tekst)[0];
    if (!url || tekstLinku.includes(url)) return;
    linkZeSchowka = url;
    rysuj();
  });

  rysuj();
  return {
    el,
    odswiez() {
      if (ekran === "wybor") przeliczSzacunki();
      rysuj();
    },
    dodaj,
    wybierz,
  };
}

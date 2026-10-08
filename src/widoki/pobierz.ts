// Zakładka Pobierz: yt-dlp (info, wybór jakości, napisy/miniatura/metadane/rozdziały),
// opcjonalne „po pobraniu przekonwertuj” tym samym PanelUstawien, aktualizacja yt-dlp.
// v1.2: chipy obsługiwanych źródeł, szybkie akcje, wiek yt-dlp + ostrzeżenie, własna
// kopia yt-dlp zamiast starej z PATH (przyczyna 403 z testu na żywo 07.10).
import { api } from "../api";
import { h, ikona } from "../dom";
import { IKONY } from "../ikony";
import { t } from "../i18n";
import { etykietaWysokosci, formatujCzas, profilDla, sklonuj, wyborSzybki, wyciagnijUrl, ZRODLA_POBIERANIA } from "../logika";
import { panelUstawien } from "../komponenty/PanelUstawien";
import { przelacznik, przycisk, tekst, uwaga, wybor, type Opcja } from "../komponenty/pola";
import { folderWyjscia } from "../komponenty/wspolne";
import { dymekDodano, pokazDymek, sklep } from "../sklep";
import type { Info, NoweZadanie, OpcjePobrania, Profil, Wybor } from "../typy";

interface Wynik {
  url: string;
  info: Info | null;
  blad: string | null;
  wybor: Wybor;
}

const AUDIO = ["mp3", "m4a", "opus", "flac"];

export function stworzWidokPobierania(): { el: HTMLElement; odswiez(): void } {
  let tekstUrl = "";
  let playlista = false;
  let wyniki: Wynik[] = [];
  let sprawdzanie = false;
  let potem = false;
  let profilPotem: Profil = profilDla("mp4");
  let opcje: Omit<OpcjePobrania, "wybor" | "tytul" | "playlista"> = {
    kontener: "mp4", napisy: false, jezyki_napisow: "pl,en", miniatura: true, metadane: true, rozdzialy: true,
  };
  let linkZeSchowka: string | null = null;
  let ostatniSchowek = "";
  let aktualizacja: "nic" | "trwa" = "nic";
  let szybka: "mp3" | "najlepsza" | null = null;
  let zapewnione = false;

  const el = h("div", { class: "widok widok-pobierz" });
  const panelPotem = panelUstawien({
    tryb: "wideo",
    profil: profilPotem,
    sprzet: () => sklep.stan.narzedzia?.sprzet ?? [],
    onZmiana: (p) => (profilPotem = p),
  });

  function naglowek(): HTMLElement {
    const n = sklep.stan.narzedzia;
    const wersja = n?.ytdlp?.wersja ?? n?.wersje.ytdlp;
    return h(
      "header",
      { class: "naglowek" },
      h("div", null, h("h1", null, t("zakladka.pobierz")), h("p", { class: "podtytul" }, t("pobierz.podtytul"))),
      h(
        "div",
        { class: "wiersz" },
        n?.sciezki.ytdlp
          ? h("span", { class: "wersja" }, "yt-dlp", h("code", null, wersja ?? "?"), n.sciezki.deno ? h("span", { class: "plakietka", title: t("pobierz.deno_ok") }, "deno") : null)
          : null,
        n?.sciezki.ytdlp
          ? przycisk([ikona(IKONY.odswiez), t(aktualizacja === "trwa" ? "pobierz.aktualizuje" : "pobierz.aktualizuj")], () => void aktualizuj(), "przycisk-maly przycisk-aktualizuj", { disabled: aktualizacja === "trwa" })
          : null,
      ),
    );
  }

  // Aktualizujemy tylko WŁASNĄ kopię (pobranie oficjalnego wydania), nigdy pipa użytkownika.
  async function aktualizuj() {
    aktualizacja = "trwa";
    rysuj();
    try {
      const narzedzia = await api.ytdlpAktualizuj();
      sklep.ustaw({ narzedzia });
      pokazDymek(t("pobierz.zaktualizowano", { w: narzedzia.ytdlp?.wersja ?? "?" }));
    } catch (e) {
      pokazDymek(String(e), "blad");
    }
    aktualizacja = "nic";
    rysuj();
  }

  // Pierwsze wejście na Pobierz: brak yt-dlp albo stary z PATH bez własnej kopii → pobierz własną.
  async function zapewnij() {
    if (zapewnione || !sklep.stan.narzedzia) return;
    zapewnione = true;
    const y = sklep.stan.narzedzia.ytdlp;
    if (y && (y.pochodzenie !== "path" || !y.stary)) return;
    pokazDymek(t("pobierz.pobieram_ytdlp"));
    try {
      if (await api.ytdlpZapewnij()) {
        sklep.ustaw({ narzedzia: await api.narzedziaStan() });
        pokazDymek(t("pobierz.wlasna_pobrana"));
      }
    } catch (e) {
      pokazDymek(String(e), "blad");
    }
  }

  function ostrzezenia(): HTMLElement[] {
    const n = sklep.stan.narzedzia;
    const lista: HTMLElement[] = [];
    const y = n?.ytdlp;
    if (y?.stary && y.wiek_dni !== null) {
      lista.push(
        uwaga(
          "uwaga",
          ikona(IKONY.uwaga),
          h("span", { class: "kolumna" }, h("strong", null, t("pobierz.wiek", { n: y.wiek_dni })), y.pochodzenie === "path" ? h("small", null, t("pobierz.z_path")) : null),
          przycisk(t(aktualizacja === "trwa" ? "pobierz.aktualizuje" : "pobierz.aktualizuj"), () => void aktualizuj(), "przycisk-maly", { disabled: aktualizacja === "trwa" }),
        ),
      );
    }
    if (n && !n.sciezki.ytdlp) {
      lista.push(uwaga("uwaga", ikona(IKONY.uwaga), h("span", null, t("pobierz.brak_ytdlp")), przycisk(t("narzedzia.przejdz"), () => sklep.ustaw({ zakladka: "ustawienia" }), "przycisk-tekstowy")));
    } else if (n && !n.sciezki.deno) {
      lista.push(uwaga("info", ikona(IKONY.info), h("span", null, t("pobierz.brak_deno")), przycisk(t("narzedzia.przejdz"), () => sklep.ustaw({ zakladka: "ustawienia" }), "przycisk-tekstowy")));
    }
    if (linkZeSchowka) {
      const link = linkZeSchowka;
      lista.push(
        uwaga(
          "info",
          ikona(IKONY.link),
          h("span", null, t("pobierz.schowek"), " ", h("strong", null, link.length > 70 ? link.slice(0, 70) + "…" : link)),
          przycisk(t("pobierz.wklej"), () => {
            tekstUrl = [tekstUrl.trim(), link].filter(Boolean).join("\n");
            linkZeSchowka = null;
            rysuj();
          }, "przycisk-maly"),
          przycisk(t("pobierz.pomin"), () => ((linkZeSchowka = null), rysuj()), "przycisk-tekstowy"),
        ),
      );
    }
    return lista;
  }

  function zrodla(): HTMLElement {
    return h(
      "div",
      { class: "zrodla-pobierania", role: "list", "aria-label": t("pobierz.zrodla") },
      h("span", { class: "pole-etykieta" }, t("pobierz.zrodla")),
      ...ZRODLA_POBIERANIA.map((z) => h("span", { class: "chip-zrodlo", role: "listitem" }, z)),
      h("span", { class: "chip-zrodlo", role: "listitem" }, ikona(IKONY.link), t("pobierz.zrodlo.link")),
    );
  }

  function szybkieAkcje(): HTMLElement {
    const zastosuj = (a: "mp3" | "najlepsza") => {
      szybka = a;
      for (const w of wyniki) w.wybor = wyborSzybki(a);
      rysuj();
    };
    const akcja = (a: "mp3" | "najlepsza", ik: string) =>
      h(
        "div",
        { class: "akcja" + (szybka === a ? " aktywna" : "") },
        h(
          "button",
          { type: "button", class: "akcja-przycisk", "data-akcja-pobierania": a, "aria-pressed": String(szybka === a), onclick: () => zastosuj(a) },
          ikona(ik),
          h("span", null, t(`pobierz.szybko.${a}`)),
        ),
      );
    return h("div", { class: "szybkie-akcje", role: "group", "aria-label": t("pobierz.szybko") }, akcja("mp3", IKONY.nuta), akcja("najlepsza", IKONY.film));
  }

  function wejscie(): HTMLElement {
    const pole = h("textarea", { class: "pole-url", placeholder: t("pobierz.placeholder"), "aria-label": t("pobierz.placeholder"), spellcheck: "false" });
    pole.value = tekstUrl;
    pole.addEventListener("input", () => (tekstUrl = pole.value));
    pole.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) void sprawdz();
    });
    return h(
      "div",
      { class: "karta pobierz-wejscie" },
      pole,
      h(
        "div",
        { class: "wiersz wiersz-rozsuniety" },
        przelacznik(t("pobierz.playlista"), playlista, (v) => (playlista = v)),
        przycisk(t(sprawdzanie ? "pobierz.sprawdzam" : "pobierz.sprawdz"), () => void sprawdz(), "przycisk-sprawdz", { disabled: sprawdzanie }),
      ),
    );
  }

  async function sprawdz() {
    const urle = wyciagnijUrl(tekstUrl);
    if (urle.length === 0) {
      pokazDymek(t("pobierz.brak_linku"), "blad");
      return;
    }
    sprawdzanie = true;
    wyniki = urle.map((url) => ({ url, info: null, blad: null, wybor: wyborSzybki(szybka ?? "najlepsza") }));
    rysuj();
    await Promise.all(
      wyniki.map(async (w) => {
        try {
          w.info = await api.ytdlpInfo(w.url, playlista);
        } catch (e) {
          w.blad = String(e);
        }
        rysuj();
      }),
    );
    sprawdzanie = false;
    rysuj();
  }

  function opcjeWyboru(w: Wynik): Opcja<Wybor>[] {
    const wysokosci = w.info?.typ === "film" ? w.info.wysokosci : [2160, 1440, 1080, 720, 480, 360];
    return [
      { wartosc: { typ: "najlepsza" }, etykieta: t("pobierz.najlepsza"), grupa: t("pobierz.grupa.wideo") },
      ...wysokosci.map((hh): Opcja<Wybor> => ({ wartosc: { typ: "wysokosc", h: hh }, etykieta: t("pobierz.do", { r: etykietaWysokosci(hh) }), grupa: t("pobierz.grupa.wideo") })),
      ...AUDIO.map((f): Opcja<Wybor> => ({ wartosc: { typ: "tylko_audio", format: f }, etykieta: f.toUpperCase(), grupa: t("pobierz.grupa.audio") })),
    ];
  }

  function karta(w: Wynik): HTMLElement {
    const i = w.info;
    let tytul = w.url;
    let opis = "";
    let miniatura: string | null = null;
    if (i?.typ === "film") {
      tytul = i.tytul;
      miniatura = i.miniatura;
      opis = [i.autor, i.czas_s ? formatujCzas(i.czas_s) : null, i.napisy.length ? t("pobierz.napisy_dostepne", { j: i.napisy.join(", ") }) : null, i.rozdzialy ? t("pobierz.rozdzialy_n", { n: i.rozdzialy }) : null, i.na_zywo ? t("pobierz.na_zywo") : null]
        .filter(Boolean)
        .join(" · ");
    } else if (i?.typ === "playlista") {
      tytul = i.tytul;
      opis = t("pobierz.playlista_n", { n: i.wpisy.length });
    }
    const obrazek = miniatura
      ? h("img", { src: miniatura, alt: "", loading: "lazy", referrerpolicy: "no-referrer", onerror: (e: Event) => ((e.target as HTMLElement).remove()) })
      : ikona(i?.typ === "playlista" ? IKONY.kolejka : IKONY.film);
    return h(
      "article",
      { class: "karta film" },
      h("div", { class: "film-miniatura" }, obrazek),
      h(
        "div",
        { class: "film-tresc" },
        h("div", { class: "film-tytul" }, tytul),
        w.blad
          ? uwaga("blad", ikona(IKONY.uwaga), h("span", null, w.blad))
          : !i
            ? h("div", { class: "film-opis" }, t("pobierz.sprawdzam"))
            : h("div", { class: "film-opis" }, opis),
        i
          ? h(
              "div",
              { class: "film-wybor" },
              wybor(opcjeWyboru(w), w.wybor, (v) => ((w.wybor = v), (szybka = null)), { "aria-label": t("pobierz.jakosc") }),
              przycisk(t("pobierz.usun"), () => {
                wyniki = wyniki.filter((x) => x !== w);
                rysuj();
              }, "przycisk-tekstowy"),
            )
          : null,
      ),
    );
  }

  function panelOpcji(): HTMLElement {
    return h(
      "section",
      { class: "karta opcje-pobierania" },
      h(
        "div",
        { class: "wiersz" },
        h("span", { class: "pole-etykieta" }, t("pobierz.kontener")),
        wybor(["mp4", "mkv", "webm"].map((k) => ({ wartosc: k, etykieta: k.toUpperCase() })), opcje.kontener, (v) => (opcje.kontener = v), { style: { width: "auto" } }),
      ),
      h(
        "div",
        { class: "opcje-siatka" },
        przelacznik(t("pobierz.napisy"), opcje.napisy, (v) => ((opcje.napisy = v), rysuj())),
        przelacznik(t("pobierz.miniatura"), opcje.miniatura, (v) => (opcje.miniatura = v)),
        przelacznik(t("pobierz.metadane"), opcje.metadane, (v) => (opcje.metadane = v)),
        przelacznik(t("pobierz.rozdzialy"), opcje.rozdzialy, (v) => (opcje.rozdzialy = v)),
      ),
      opcje.napisy
        ? h("label", { class: "wiersz" }, h("span", { class: "pole-etykieta" }, t("pobierz.jezyki")), tekst(opcje.jezyki_napisow, (v) => (opcje.jezyki_napisow = v), { style: { width: "12em" } }))
        : null,
      przelacznik(t("pobierz.potem"), potem, (v) => ((potem = v), rysuj()), t("pobierz.potem.opis")),
    );
  }

  async function pobierz() {
    const zadania: NoweZadanie[] = [];
    for (const w of wyniki) {
      if (!w.info) continue;
      const wspolne: Omit<OpcjePobrania, "tytul"> = { ...opcje, wybor: w.wybor, playlista: false };
      const zrodla = w.info.typ === "playlista" ? w.info.wpisy.map((e) => ({ url: e.url, tytul: e.tytul })) : [{ url: w.url, tytul: w.info.tytul }];
      for (const z of zrodla) {
        zadania.push({
          rodzaj: { typ: "pobranie", url: z.url, opcje: { ...wspolne, tytul: z.tytul }, potem: potem ? sklonuj(profilPotem) : null },
          katalog: null,
        });
      }
    }
    if (zadania.length === 0) return;
    try {
      await api.dodajZadania(zadania);
      dymekDodano(zadania.length, t);
      wyniki = [];
      tekstUrl = "";
      rysuj();
    } catch (e) {
      pokazDymek(String(e), "blad");
    }
  }

  function rysuj() {
    const gotowe = wyniki.filter((w) => w.info).reduce((s, w) => s + (w.info?.typ === "playlista" ? w.info.wpisy.length : 1), 0);
    const czesci: (HTMLElement | null)[] = [
      naglowek(),
      ...ostrzezenia(),
      zrodla(),
      szybkieAkcje(),
      wejscie(),
      wyniki.length ? h("div", { class: "filmy" }, wyniki.map(karta)) : null,
      wyniki.length ? panelOpcji() : null,
      wyniki.length && potem ? h("section", { class: "karta potem" }, h("h3", { class: "sekcja-tytul" }, t("pobierz.potem.tytul")), panelPotem.el) : null,
      h("p", { class: "notka" }, t("pobierz.prawa")),
      h(
        "footer",
        { class: "pasek-akcji" },
        folderWyjscia("katalog_pobierania"),
        przycisk(
          [t("pobierz.start"), gotowe > 1 ? h("span", { class: "plakietka plakietka-akcent" }, String(gotowe)) : ""],
          () => void pobierz(),
          "przycisk-glowny",
          { disabled: gotowe === 0 || (!sklep.stan.narzedzia?.sciezki.ytdlp && api.wTauri) },
        ),
      ),
    ];
    el.replaceChildren(...czesci.filter((x): x is HTMLElement => x !== null));
    panelPotem.odswiez();
  }

  // Link w schowku przy powrocie do okna (można wyłączyć w Ustawieniach).
  api.naPowrotOkna(async () => {
    if (!sklep.stan.konfig?.schowek) return;
    const t0 = (await api.czytajSchowek()).trim();
    if (!t0 || t0 === ostatniSchowek) return;
    ostatniSchowek = t0;
    const link = wyciagnijUrl(t0)[0];
    if (!link || tekstUrl.includes(link) || wyniki.some((w) => w.url === link)) return;
    linkZeSchowka = link;
    rysuj();
    if (sklep.stan.zakladka !== "pobierz") pokazDymek(t("pobierz.schowek_dymek"));
  });

  let ostatniaZakladka = sklep.stan.zakladka;
  sklep.subskrybuj((s) => {
    if (s.zakladka === ostatniaZakladka) return;
    ostatniaZakladka = s.zakladka;
    if (s.zakladka === "pobierz") void zapewnij();
  });

  rysuj();
  return {
    el,
    odswiez() {
      rysuj();
      if (sklep.stan.zakladka === "pobierz") void zapewnij();
    },
  };
}

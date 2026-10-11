// Wspólny szkielet zakładek Konwertuj i Obrazy: upuszczanie plików i folderów,
// lista, karta informacji, szybkie akcje, PanelUstawien, podgląd przed/po,
// szacunek rozmiaru na żywo, podgląd komendy, kolejka.
import { api } from "../api";
import { debounce, h, ikona } from "../dom";
import { IKONY } from "../ikony";
import { jezyk, t, tekstBledu } from "../i18n";
import { blokadaFormatu, formatujRozmiar, profilDla, profilSzybkiejAkcji, sklonuj, stanCiecia, SZYBKIE_AKCJE, toObraz, type SzybkaAkcja, type ZdarzenieCiecia } from "../logika";
import { panelUstawien, type Panel } from "../komponenty/PanelUstawien";
import { liczba, przelacznik, przycisk, tekst, uwaga } from "../komponenty/pola";
import { kartaInformacji } from "../komponenty/info";
import { podgladPrzedPo } from "../komponenty/podglad";
import {
  dymekPominietych, folderWyjscia, listaPlikow, opisSzacunku, podpisyStrefy, pasekPresetow, podgladKomendy, strefaUpuszczania, uwagi, type PlikWejscia,
} from "../komponenty/wspolne";
import { dymekDodano, pokazDymek, sklep } from "../sklep";
import type { NoweZadanie, Preset, Profil } from "../typy";
import { klasyfikujUpuszczone } from "../upuszczanie";

export interface WidokPlikowy {
  el: HTMLElement;
  /** `zachowajCiecie`: wejście z trybu Prostego niesie własny fragment (GIF), nie kasujemy go. */
  dodaj(sciezki: string[], o?: { zachowajCiecie?: boolean }): Promise<void>;
  odswiez(): void;
  /** Wejście z trybu Prostego („Więcej ustawień”): profil akcji bez zaznaczonego presetu ani szybkiej akcji. */
  ustawProfil(p: Profil): void;
}

/** Opcje folderów wsadowo (punkt 4.3). */
export interface OpcjeFolderu {
  struktura: boolean;
  rozszerzenia: string;
  pomin: boolean;
}

/** Katalog wyniku dla pliku z folderu: folder wyjścia + podfolder, gdy zachowujemy strukturę. */
export function katalogDlaPliku(p: PlikWejscia, katalogWyjscia: string | null, o: OpcjeFolderu): string | null {
  if (!katalogWyjscia || !o.struktura || !p.podkatalog) return null;
  const sep = katalogWyjscia.includes("\\") ? "\\" : "/";
  return [katalogWyjscia.replace(/[\\/]+$/, ""), ...p.podkatalog.split(/[\\/]/)].join(sep);
}

export function rozszerzeniaZTekstu(t: string): string[] {
  return [...new Set(t.toLowerCase().split(/[\s,;]+/).map((x) => x.replace(/^\*?\./, "")).filter(Boolean))];
}

export function stworzWidokPlikowy(rodzaj: "konwertuj" | "obrazy", opcje: { doKonwertuj?: (sciezki: string[]) => void } = {}): WidokPlikowy {
  const obrazy = rodzaj === "obrazy";
  let pliki: PlikWejscia[] = [];
  let wybrany = 0;
  let profil: Profil = obrazy ? profilDla("webp") : profilDla("mp4");
  let aktywnyPreset: string | null = null;
  let aktywnaAkcja: SzybkaAkcja | null = null;
  let mbAkcji = 10;
  let szacunek = { tekst: "", ostrzezenie: null as string | null };
  let przebiegi: string[][] = [];
  /** „Zmniejsz do X MB”: pliki, które już są mniejsze (P1). Nie trafiają do kolejki, wiersz mówi dlaczego. */
  let mieszczace = new Set<string>();
  let ostatnieUwagi = "";
  let uwagiEl: HTMLElement | null = null;
  let foldery: string[] = [];
  const opcjeFolderu: OpcjeFolderu = { struktura: true, rozszerzenia: "", pomin: true };

  const el = h("div", { class: `widok widok-${rodzaj}` });
  const presetyMiejsce = h("div");
  const akcjeMiejsce = h("div");
  const lewa = h("div", { class: "kolumna-lewa" });
  const uwagiMiejsce = h("div", { class: "uwagi-miejsce" });
  const komendaMiejsce = h("div");
  const stopka = h("footer", { class: "pasek-akcji" });

  const zMedia = () => pliki.filter((p) => p.media);
  // Szacunek animacji z próbki (wolny, ~1–2 s na plik): przychodzi po szybkim szacunku i go zastępuje.
  // `pokolenie` odrzuca spóźnione wyniki po zmianie ustawień albo plików.
  let pokolenie = 0;
  const animacja = () => !!profil.gif && (profil.kontener === "gif" || profil.kontener === "webp");
  const biezacy = () => {
    const p = pliki[wybrany] ?? pliki.find((x) => x.media);
    return p?.media ? { sciezka: p.sciezka, media: p.media } : null;
  };

  const panel: Panel = panelUstawien({
    tryb: obrazy ? "obraz" : "wideo",
    profil,
    media: () => biezacy()?.media ?? null,
    sprzet: () => sklep.stan.narzedzia?.sprzet ?? [],
    enkodery: () => sklep.stan.narzedzia?.enkodery ?? [],
    onZmiana: (p) => {
      profil = p;
      // blokada formatu (P4) od razu: wiersze i przycisk nie czekają na przeliczenie szacunku
      const uwagi = pliki.map((x) => uwagaPliku(x)?.tekst ?? "").join("\n");
      if (uwagi !== ostatnieUwagi) {
        ostatnieUwagi = uwagi;
        rysujLewa();
      }
      rysujStopke();
      if (aktywnyPreset || aktywnaAkcja) {
        aktywnyPreset = null;
        aktywnaAkcja = null;
        rysujPresety();
        rysujAkcje();
      }
      przelicz();
      podglad.odswiez();
    },
  });

  const podglad = podgladPrzedPo({ plik: biezacy, profil: () => profil });

  /** Fragment od–do po zdarzeniu (P2): zmiana listy plików i szybka akcja inna niż „Wytnij” go kasują. */
  function zdarzenieCiecia(z: ZdarzenieCiecia) {
    const nowe = stanCiecia({ ciecie: profil.ciecie, przyciete: false }, z).ciecie;
    if (nowe === profil.ciecie) return;
    profil = { ...profil, ciecie: nowe };
    panel.ustaw(profil);
  }

  function ustawProfil(p: Profil) {
    profil = sklonuj(p);
    panel.ustaw(profil);
    przelicz();
    podglad.odswiez();
  }

  function rysujPresety() {
    presetyMiejsce.replaceChildren(
      pasekPresetow({
        zakladka: rodzaj,
        aktywny: aktywnyPreset,
        profil: () => profil,
        zastosuj: (p: Preset) => {
          aktywnyPreset = p.id;
          aktywnaAkcja = null;
          ustawProfil(p.profil);
          rysujPresety();
          rysujAkcje();
        },
      }),
    );
  }

  // ---------- szybkie akcje (punkt 4.2) ----------
  function rysujAkcje() {
    if (obrazy) return;
    const zastosuj = (a: SzybkaAkcja) => {
      aktywnaAkcja = a;
      aktywnyPreset = null;
      const ciecie = stanCiecia({ ciecie: profil.ciecie, przyciete: false }, { typ: "akcja", akcja: a }).ciecie;
      ustawProfil(profilSzybkiejAkcji(a, { ...profil, ciecie }, { mb: mbAkcji, zrodlo: biezacy()?.sciezka ?? null }));
      rysujAkcje();
      rysujPresety();
    };
    const ikonaAkcji: Record<SzybkaAkcja, string> = { rozmiar: IKONY.zmniejsz, mp3: IKONY.nuta, gif: IKONY.obrazy, telefon: IKONY.telefon, wytnij: IKONY.nozyczki };
    akcjeMiejsce.replaceChildren(
      h(
        "div",
        { class: "szybkie-akcje", role: "group", "aria-label": t("akcje.tytul") },
        SZYBKIE_AKCJE.map((a) =>
          h(
            "div",
            { class: "akcja" + (aktywnaAkcja === a ? " aktywna" : "") },
            h(
              "button",
              { type: "button", class: "akcja-przycisk", "data-akcja": a, "aria-pressed": String(aktywnaAkcja === a), onclick: () => zastosuj(a) },
              ikona(ikonaAkcji[a]),
              h("span", null, a === "rozmiar" ? t("akcje.rozmiar", { mb: mbAkcji }) : t(`akcje.${a}`)),
            ),
            a === "rozmiar"
              ? liczba(mbAkcji, { min: 1, max: 4000, sufiks: "MB", szerokosc: "4.2em" }, (v) => {
                  mbAkcji = v ?? 10;
                  zastosuj("rozmiar");
                })
              : null,
          ),
        ),
      ),
      ...(aktywnaAkcja === "wytnij" ? [uwaga("info", ikona(IKONY.info), h("span", null, t("akcje.wytnij.pomoc")))] : []),
    );
  }

  // ---------- lewa kolumna: pliki, foldery, informacje ----------
  function opcjeFolderow(): HTMLElement | null {
    if (foldery.length === 0) return null;
    const katalog = sklep.stan.konfig?.katalog_wyjscia ?? null;
    return h(
      "section",
      { class: "karta foldery" },
      h("h3", { class: "info-tytul" }, ikona(IKONY.folder), t("foldery.tytul", { n: foldery.length })),
      przelacznik(t("foldery.struktura"), opcjeFolderu.struktura, (v) => ((opcjeFolderu.struktura = v), rysujLewa()), katalog ? undefined : t("foldery.struktura.obok")),
      przelacznik(t("foldery.pomin"), opcjeFolderu.pomin, (v) => (opcjeFolderu.pomin = v)),
      h(
        "label",
        { class: "pole" },
        h("span", { class: "pole-etykieta" }, t("foldery.rozszerzenia")),
        tekst(opcjeFolderu.rozszerzenia, (v) => {
          opcjeFolderu.rozszerzenia = v;
          void przeladujFoldery();
        }, { placeholder: t("foldery.rozszerzenia.placeholder"), "aria-label": t("foldery.rozszerzenia") }),
      ),
    );
  }

  function rysujLewa() {
    const lista = pliki.length
      ? listaPlikow(
          pliki,
          (i) => {
            pliki.splice(i, 1);
            if (wybrany >= pliki.length) wybrany = Math.max(0, pliki.length - 1);
            if (pliki.length === 0) foldery = [];
            zdarzenieCiecia({ typ: "pliki" });
            rysujLewa();
            przelicz();
            podglad.odswiez();
          },
          () => {
            pliki = [];
            foldery = [];
            wybrany = 0;
            zdarzenieCiecia({ typ: "pliki" });
            rysujLewa();
            przelicz();
            podglad.odswiez();
          },
          {
            wybrany,
            wybierz: (i) => {
              wybrany = i;
              rysujLewa();
              panel.odswiez();
              podglad.odswiez();
            },
          },
          uwagaPliku,
        )
      : null;
    const b = pliki[wybrany];
    lewa.replaceChildren(
      strefaUpuszczania({ obrazy, dodaj: (s) => void dodaj(s), kompaktowa: pliki.length > 0 }),
      lista ?? h("p", { class: "lewa-pomoc" }, t(podpisyStrefy(obrazy).pusto)),
      ...[opcjeFolderow(), b?.media ? kartaInformacji(b.sciezka, b.media) : null].filter((x): x is HTMLElement => !!x),
    );
  }

  function uwagaPliku(p: PlikWejscia): { tekst: string; blokuje: boolean } | null {
    // P4: ta sama reguła przy upuszczeniu i przy zmianie formatu, liczona od razu (bez czekania na szacunek)
    const blokada = p.media ? blokadaFormatu(p.media, profil) : null;
    if (blokada) return { tekst: t(`plik.blokada.${blokada}`), blokuje: true };
    if (mieszczace.has(p.sciezka)) return { tekst: t("plik.miesci", { r: formatujRozmiar(p.media?.rozmiar_b, jezyk()) }), blokuje: true };
    return null;
  }

  /** Pliki, które naprawdę pójdą do kolejki. */
  const doKonwersji = () => pliki.filter((p) => p.media && !p.blad && !uwagaPliku(p)?.blokuje);

  function rysujStopke() {
    const gotowe = doKonwersji().length;
    const zablokowane = gotowe === 0 || !!uwagiEl?.querySelector(".uwaga-blad");
    // powód blokady przy przycisku (tooltip + aria-describedby → uwaga przy wierszu pliku)
    const iZablokowanego = pliki.findIndex((p) => p.media && !p.blad && uwagaPliku(p)?.blokuje);
    const powod = zablokowane && iZablokowanego >= 0 ? uwagaPliku(pliki[iZablokowanego])!.tekst : undefined;
    stopka.replaceChildren(
      folderWyjscia("katalog_wyjscia"),
      h(
        "div",
        { class: "szacunek" + (szacunek.ostrzezenie ? " szacunek-uwaga" : ""), "aria-live": "polite" },
        h("span", { class: "szacunek-etykieta" }, t("szacunek.etykieta")),
        h("strong", { class: "szacunek-wartosc" }, szacunek.tekst || "—"),
        szacunek.ostrzezenie ? h("span", { class: "szacunek-ostrzezenie" }, ikona(IKONY.uwaga), szacunek.ostrzezenie) : null,
      ),
      przycisk(
        [t(obrazy ? "obrazy.start" : "konwertuj.start"), gotowe > 1 ? h("span", { class: "plakietka plakietka-akcent" }, String(gotowe)) : ""],
        () => void start(),
        "przycisk-glowny",
        { disabled: zablokowane, title: powod, "aria-describedby": powod ? `plik-uwaga-${iZablokowanego}` : undefined },
      ),
    );
  }

  const przelicz = debounce(async () => {
    const lista = zMedia();
    const mieszczaceBylo = [...mieszczace].join("\n");
    if (lista.length === 0) {
      szacunek = { tekst: "", ostrzezenie: null };
      przebiegi = [];
      uwagiEl = null;
      mieszczace = new Set();
    } else {
      const wszystkie = await Promise.all(lista.slice(0, 200).map((p) => api.szacuj(p.media!, profil)));
      mieszczace = new Set(lista.slice(0, 200).filter((_, i) => wszystkie[i].ostrzezenie === "juz_sie_miesci").map((p) => p.sciezka));
      // do sumy tylko to, co naprawdę zostanie zakodowane (bez „już się mieści” i plików, których ten format nie przyjmie)
      const wyniki = wszystkie.filter((w, i) => w.ostrzezenie !== "juz_sie_miesci" && !blokadaFormatu(lista[i].media!, profil));
      const znane = wyniki.filter((w) => w.bajty !== null);
      const suma = znane.reduce((s, w) => s + (w.bajty ?? 0), 0);
      const dokladny = wyniki.every((w) => w.dokladny);
      const ostrz = wyniki.find((w) => w.ostrzezenie)?.ostrzezenie ?? null;
      const zrodloKbps = wyniki.find((w) => w.zrodlo_kbps)?.zrodlo_kbps ?? null;
      const moje = ++pokolenie;
      if (animacja()) {
        const probki = lista.slice(0, 5);
        void Promise.all(probki.map((p) => api.szacujZProbki(p.sciezka, p.media!, profil).catch(() => null))).then((b) => {
          if (moje !== pokolenie || b.some((x) => x === null)) return;
          const zProbki = (b as number[]).reduce((s, x) => s + x, 0);
          // pozostałe pliki (ponad 5) dokładamy z szybkiego szacunku
          const reszta = wyniki.slice(probki.length).reduce((s, w) => s + (w.bajty ?? 0), 0);
          szacunek = { ...szacunek, tekst: opisSzacunku(zProbki + reszta, false) };
          rysujStopke();
        });
      }
      const nMiesci = mieszczace.size;
      szacunek = {
        tekst: wyniki.length === 0 ? "" : znane.length ? opisSzacunku(suma, dokladny) : t("szacunek.brak"),
        ostrzezenie:
          nMiesci && wyniki.length === 0 ? t("szacunek.juz_sie_miesci")
          : nMiesci ? t("szacunek.juz_sie_miesci_czesc", { n: nMiesci, z: wszystkie.length })
          : ostrz === "ogromny" ? t("szacunek.ogromny") : ostrz === "wiekszy_niz_zrodlo" ? t("szacunek.wiekszy") : zrodloKbps ? t("szacunek.zrodlo_kbps", { n: zrodloKbps }) : null,
      };
      const b = biezacy() ?? { sciezka: lista[0].sciezka, media: lista[0].media! };
      const plan = await api.planKomendy(b.sciezka, b.media, profil);
      przebiegi = plan.przebiegi;
      // błędy jednego pliku („już się mieści”, brak dźwięku/obrazu) blokują tylko jego wiersz, chyba że dotyczą wszystkich
      const bladPliku = ["juz_sie_miesci", "brak_dzwieku", "brak_wideo", "pusty_wynik"].includes(plan.blad?.typ ?? "");
      const blokujeWszystko = !bladPliku || doKonwersji().length === 0;
      uwagiEl = uwagi(plan.podpowiedzi, blokujeWszystko ? plan.blad : null, blokujeWszystko ? null : plan.blad);
    }
    if ([...mieszczace].join("\n") !== mieszczaceBylo) rysujLewa();
    uwagiMiejsce.replaceChildren(...(uwagiEl ? [uwagiEl] : []));
    komendaMiejsce.replaceChildren(...[podgladKomendy(przebiegi)].filter((x): x is HTMLElement => !!x));
    rysujStopke();
  }, 150);

  async function sonduj(nowe: PlikWejscia[], bylyPuste: boolean) {
    for (const wpis of nowe) {
      try {
        wpis.media = await api.sonda(wpis.sciezka);
      } catch (e) {
        wpis.blad = String(e);
      }
      if (!pliki.includes(wpis)) continue;
      rysujLewa();
      rysujStopke(); // reguła blokady (P4) i liczba plików od razu po sondzie, nie dopiero po szacunku
      if (bylyPuste && wpis === pliki[0]) {
        panel.odswiez();
        podglad.odswiez();
      }
      przelicz();
    }
  }

  async function dodaj(sciezki: string[], o: { zachowajCiecie?: boolean } = {}) {
    const rozwiniete = await api.rozwinFoldery(sciezki, rozszerzeniaZTekstu(opcjeFolderu.rozszerzenia));
    const noweFoldery = sciezki.filter((s) => rozwiniete.some((r) => r.podkatalog !== null && r.sciezka.startsWith(s)));
    foldery = [...new Set([...foldery, ...noweFoldery])];
    // P3: nieobsługiwane pliki (i wideo na Obrazach) już nie znikają bez słowa
    const { przyjete, pominiete } = klasyfikujUpuszczone(sciezki, rozwiniete.map((r) => r.sciezka), rodzaj);
    dymekPominietych(pominiete, opcje.doKonwertuj);
    const nowe: PlikWejscia[] = rozwiniete
      .filter((r) => przyjete.includes(r.sciezka) && !pliki.some((p) => p.sciezka === r.sciezka))
      .map((r) => ({ sciezka: r.sciezka, media: null, podkatalog: r.podkatalog }));
    if (nowe.length === 0) {
      if (foldery.length) rysujLewa();
      return;
    }
    const bylyPuste = pliki.length === 0;
    pliki.push(...nowe);
    if (!o.zachowajCiecie) zdarzenieCiecia({ typ: "pliki" });
    rysujLewa();
    rysujStopke();
    await sonduj(nowe, bylyPuste);
  }

  /** Zmiana filtra rozszerzeń: pliki z folderów od nowa, luźne zostają. */
  async function przeladujFoldery() {
    if (foldery.length === 0) return;
    const luzne = pliki.filter((p) => p.podkatalog === null || p.podkatalog === undefined);
    const rozwiniete = await api.rozwinFoldery(foldery, rozszerzeniaZTekstu(opcjeFolderu.rozszerzenia));
    const stare = new Map(pliki.map((p) => [p.sciezka, p]));
    const zFolderow: PlikWejscia[] = rozwiniete
      .filter((r) => r.podkatalog !== null && (!obrazy || toObraz(r.sciezka) || r.sciezka.toLowerCase().endsWith(".gif")))
      .map((r) => stare.get(r.sciezka) ?? { sciezka: r.sciezka, media: null, podkatalog: r.podkatalog });
    pliki = [...luzne, ...zFolderow];
    wybrany = Math.min(wybrany, Math.max(0, pliki.length - 1));
    rysujLewa();
    przelicz();
    await sonduj(zFolderow.filter((p) => !p.media && !p.blad), false);
  }

  async function start() {
    const katalog = sklep.stan.konfig?.katalog_wyjscia ?? null;
    const doKolejki: NoweZadanie[] = doKonwersji()
      .map((p) => ({
        rodzaj: { typ: "konwersja", wejscie: p.sciezka, profil: sklonuj(profil) },
        katalog: katalogDlaPliku(p, katalog, opcjeFolderu),
        pomin_istniejace: foldery.length > 0 && opcjeFolderu.pomin,
      }));
    if (doKolejki.length === 0) return;
    try {
      await api.dodajZadania(doKolejki);
      dymekDodano(doKolejki.length, t);
      pliki = [];
      foldery = [];
      wybrany = 0;
      rysujLewa();
      przelicz();
      podglad.odswiez();
    } catch (e) {
      pokazDymek(tekstBledu(e), "blad");
    }
  }

  const brakNarzedzi = () => {
    const n = sklep.stan.narzedzia;
    return n && (!n.sciezki.ffmpeg || !n.sciezki.ffprobe)
      ? uwaga("uwaga", ikona(IKONY.uwaga), h("span", null, t("narzedzia.brak_ffmpeg")), przycisk(t("narzedzia.przejdz"), () => sklep.ustaw({ zakladka: "ustawienia" }), "przycisk-tekstowy"))
      : null;
  };
  const ostrzezenieMiejsce = h("div");

  const naglowek = h("header", { class: "naglowek" });
  el.append(
    naglowek,
    ostrzezenieMiejsce,
    akcjeMiejsce,
    presetyMiejsce,
    h("div", { class: "uklad" }, lewa, h("div", { class: "kolumna-prawa karta" }, panel.el, uwagiMiejsce, podglad.el, komendaMiejsce)),
    stopka,
  );

  function odswiez() {
    naglowek.replaceChildren(h("div", null, h("h1", null, t(`zakladka.${rodzaj}`)), h("p", { class: "podtytul" }, t(`${rodzaj}.podtytul`))));
    ostrzezenieMiejsce.replaceChildren(...[brakNarzedzi()].filter((x): x is HTMLElement => !!x));
    rysujAkcje();
    rysujPresety();
    rysujLewa();
    panel.odswiez();
    rysujStopke();
    przelicz();
    podglad.odswiez();
  }
  odswiez();

  return {
    el,
    dodaj,
    odswiez,
    ustawProfil(p: Profil) {
      aktywnyPreset = null;
      aktywnaAkcja = null;
      ustawProfil(p);
      rysujPresety();
      rysujAkcje();
    },
  };
}

// Elementy wspólne widoków: strefa upuszczania, lista plików, presety,
// podgląd komendy, uwagi z budowniczego, wybór folderu wyjścia.
import { api } from "../api";
import { h, ikona } from "../dom";
import { IKONY } from "../ikony";
import { jezyk, maKlucz, t } from "../i18n";
import { formatujCzas, formatujRozmiar, komendaDoPokazania, nazwaPliku, sciezkaDoPokazania, sklonuj } from "../logika";
import { pokazDymek, sklep } from "../sklep";
import type { BladProfilu, Media, Podpowiedz, Preset, Profil } from "../typy";
import { przycisk, uwaga } from "./pola";

export interface PlikWejscia {
  sciezka: string;
  media: Media | null;
  blad?: string;
  /** Z upuszczonego folderu: podfolder względem niego (do zachowania struktury). */
  podkatalog?: string | null;
}

export function opisMediow(m: Media | null): string {
  if (!m) return t("pliki.sprawdzam");
  const cz: string[] = [];
  if (m.wideo) cz.push(`${m.wideo.w}×${m.wideo.h}`);
  if (m.wideo?.fps && !m.obraz) cz.push(`${Math.round(m.wideo.fps * 100) / 100} fps`);
  if (!m.wideo && m.audio) cz.push(`${m.audio.kodek.toUpperCase()}${m.audio.kbps ? ` ${m.audio.kbps} kb/s` : ""}`);
  if (m.czas_s) cz.push(formatujCzas(m.czas_s));
  if (m.rozmiar_b) cz.push(formatujRozmiar(m.rozmiar_b, jezyk()));
  return cz.join(" · ");
}

export function strefaUpuszczania(opcje: { obrazy: boolean; dodaj: (s: string[]) => void; kompaktowa: boolean }): HTMLElement {
  const wybierz = async () => opcje.dodaj(await api.wybierzPliki(opcje.obrazy));
  const el = h(
    "div",
    {
      class: "strefa" + (opcje.kompaktowa ? " strefa-kompaktowa" : ""),
      role: "button",
      tabindex: "0",
      "aria-label": t(opcje.obrazy ? "strefa.obrazy" : "strefa.pliki"),
      onclick: wybierz,
      onkeydown: (e: KeyboardEvent) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), wybierz()),
    },
    ikona(IKONY.upusc, "ikona strefa-ikona"),
    h("div", { class: "strefa-tytul" }, t(opcje.obrazy ? "strefa.obrazy" : "strefa.pliki")),
    opcje.kompaktowa ? null : h("div", { class: "strefa-pomoc" }, t("strefa.pomoc")),
  );
  return el;
}

/** Błąd odczytu pliku po ludzku; surowy komunikat ffprobe zostaje w dymku (title). */
export function opisBleduPliku(surowy: string): string {
  const s = surowy.toLowerCase();
  if (s.includes("no such file") || s.includes("nie znaleziono")) return t("plik.blad.brak");
  if (s.includes("permission denied") || s.includes("odmowa dostępu")) return t("plik.blad.dostep");
  if (s.includes("moov atom") || s.includes("invalid data") || s.includes("end of file") || s.includes("could not find codec")) return t("plik.blad.uszkodzony");
  return t("plik.blad.inny");
}

export function listaPlikow(
  pliki: PlikWejscia[],
  usun: (i: number) => void,
  wyczysc: () => void,
  wybor?: { wybrany: number; wybierz: (i: number) => void },
): HTMLElement {
  return h(
    "div",
    { class: "pliki" },
    h(
      "div",
      { class: "pliki-naglowek" },
      h("span", null, t("pliki.liczba", { n: pliki.length })),
      przycisk(t("pliki.wyczysc"), wyczysc, "przycisk-tekstowy"),
    ),
    h(
      "ul",
      { class: "pliki-lista" },
      pliki.map((p, i) =>
        h(
          "li",
          {
            class: "plik" + (p.blad ? " plik-blad" : "") + (wybor?.wybrany === i ? " plik-wybrany" : ""),
            "aria-current": wybor?.wybrany === i ? "true" : undefined,
          },
          ikona(p.media?.obraz ? IKONY.obrazy : p.media && !p.media.wideo ? IKONY.nuta : IKONY.film, "ikona plik-ikona"),
          h(
            wybor ? "button" : "div",
            wybor
              ? { type: "button", class: "plik-tekst plik-wybierz", onclick: () => wybor.wybierz(i), title: t("info.pokaz") }
              : { class: "plik-tekst" },
            h("div", { class: "plik-nazwa", title: sciezkaDoPokazania(p.sciezka) }, nazwaPliku(p.sciezka)),
            h("div", { class: "plik-opis", title: p.blad ?? undefined }, p.blad ? opisBleduPliku(p.blad) : opisMediow(p.media)),
          ),
          h("button", { type: "button", class: "ikona-przycisk", "aria-label": t("pliki.usun"), title: t("pliki.usun"), onclick: () => usun(i) }, ikona(IKONY.x)),
        ),
      ),
    ),
  );
}

export function nazwaPresetu(p: Preset): string {
  return p.wbudowany && maKlucz(p.nazwa) ? t(p.nazwa) : p.nazwa;
}

export function pasekPresetow(opcje: {
  zakladka: "konwertuj" | "obrazy";
  aktywny: string | null;
  profil: () => Profil;
  zastosuj: (p: Preset) => void;
}): HTMLElement {
  const lista = sklep.stan.presety.filter((p) => p.zakladka === opcje.zakladka);
  let zapisywanie = false;
  const el = h("div", { class: "presety" });

  const rysuj = () => {
    const chipy = lista.map((p) =>
      h(
        "span",
        { class: "preset" + (opcje.aktywny === p.id ? " aktywny" : "") + (p.wbudowany ? "" : " preset-wlasny") },
        h("button", { type: "button", class: "preset-przycisk", onclick: () => opcje.zastosuj(p) }, nazwaPresetu(p)),
        p.wbudowany
          ? null
          : h(
              "button",
              {
                type: "button",
                class: "preset-usun",
                "aria-label": t("presety.usun", { nazwa: p.nazwa }),
                title: t("presety.usun", { nazwa: p.nazwa }),
                onclick: async () => {
                  await api.presetUsun(p.id);
                  sklep.ustaw({ presety: await api.presetyLista() });
                },
              },
              ikona(IKONY.x),
            ),
      ),
    );
    const zapis = zapisywanie
      ? (() => {
          const input = h("input", { type: "text", class: "tekst preset-nazwa", placeholder: t("presety.nazwa"), "aria-label": t("presety.nazwa") });
          const zapisz = async () => {
            const nazwa = input.value.trim();
            if (!nazwa) return;
            await api.presetZapisz({ id: "", nazwa, zakladka: opcje.zakladka, wbudowany: false, profil: sklonuj(opcje.profil()) });
            sklep.ustaw({ presety: await api.presetyLista() });
            pokazDymek(t("presety.zapisano", { nazwa }));
          };
          input.addEventListener("keydown", (e) => {
            if (e.key === "Enter") zapisz();
            if (e.key === "Escape") ((zapisywanie = false), rysuj());
          });
          setTimeout(() => input.focus(), 0);
          return h("span", { class: "preset-zapis" }, input, przycisk(t("presety.zapisz"), zapisz, "przycisk-maly"));
        })()
      : h("button", { type: "button", class: "preset preset-dodaj", onclick: () => ((zapisywanie = true), rysuj()) }, ikona(IKONY.plus), t("presety.zapisz_jako"));
    el.replaceChildren(h("span", { class: "presety-etykieta" }, t("presety")), ...chipy, zapis);
  };
  rysuj();
  return el;
}

export function opisPodpowiedzi(p: Podpowiedz): string {
  switch (p.typ) {
    case "mono_niski_hz":
      return t("podpowiedz.mono_niski_hz");
    case "jeden_przebieg":
      return t("podpowiedz.jeden_przebieg");
    case "wymiary_parzyste":
      return t("podpowiedz.wymiary_parzyste", { w: p.w, h: p.h });
    case "opus_hz":
      return t("podpowiedz.opus_hz", { hz: p.hz });
    case "mp3_niski_hz":
      return t("podpowiedz.mp3_niski_hz", { hz: p.hz });
    case "ico_maks256":
      return t("podpowiedz.ico");
    case "hdr_na_sdr":
      return t("podpowiedz.hdr_na_sdr");
    case "hdr_bez_tonemapowania":
      return t("podpowiedz.hdr_bez_tonemapowania");
    case "dziesiec_bit":
      return t(p.hdr ? "podpowiedz.dziesiec_bit_hdr" : "podpowiedz.dziesiec_bit");
    case "dziesiec_bit_niedostepne":
      return t("podpowiedz.dziesiec_bit_niedostepne");
    case "mp4_opus":
      return t("podpowiedz.mp4_opus");
    case "napisy_pominiete":
      return t("podpowiedz.napisy_pominiete", { n: p.n });
    case "napisy_nieobslugiwane":
      return t("podpowiedz.napisy_nieobslugiwane");
    case "ciecie_klatka_kluczowa":
      return t("podpowiedz.ciecie_klatka_kluczowa");
  }
}

export function opisBledu(b: BladProfilu): string {
  switch (b.typ) {
    case "niezgodny_kodek_wideo":
      return t("blad.kodek_wideo", { kodek: t(`kodek.${b.kodek}`), kontener: b.kontener.toUpperCase() });
    case "niezgodny_kodek_audio":
      return t("blad.kodek_audio", { kodek: t(`kodek.${b.kodek}`), kontener: b.kontener.toUpperCase() });
    case "za_maly_rozmiar":
      return t("blad.za_maly_rozmiar");
    default:
      return t(`blad.${b.typ}`);
  }
}

/** Uwagi pod panelem: błędy profilu i podpowiedzi (bez tej o AAC, którą pokazuje panel). */
export function uwagi(podpowiedzi: Podpowiedz[], blad: BladProfilu | null): HTMLElement | null {
  const lista: HTMLElement[] = [];
  if (blad) lista.push(uwaga("blad", ikona(IKONY.uwaga), h("span", null, opisBledu(blad))));
  for (const p of podpowiedzi) {
    if (p.typ === "mono_niski_hz") continue;
    lista.push(uwaga("info", ikona(IKONY.info), h("span", null, opisPodpowiedzi(p))));
  }
  return lista.length ? h("div", { class: "uwagi" }, lista) : null;
}

export function podgladKomendy(przebiegi: string[][]): HTMLElement | null {
  if (przebiegi.length === 0) return null;
  const tekst = przebiegi.map(komendaDoPokazania).join("\n\n");
  return h(
    "details",
    { class: "komenda" },
    h("summary", null, t("komenda.tytul"), przebiegi.length > 1 ? h("span", { class: "plakietka" }, t("komenda.przebiegi", { n: przebiegi.length })) : null),
    h(
      "div",
      { class: "komenda-tresc" },
      h("pre", { class: "komenda-pre" }, h("code", null, tekst)),
      przycisk([ikona(IKONY.kopiuj), t("komenda.kopiuj")], async () => {
        await api.piszSchowek(tekst);
        pokazDymek(t("komenda.skopiowano"));
      }, "przycisk-maly"),
    ),
  );
}

/** Ostatni człon ścieżki (nazwa folderu), z obsługą \\ i /. */
export function nazwaFolderu(sciezka: string): string {
  const czesci = sciezka.replace(/[\\/]+$/, "").split(/[\\/]/);
  return czesci[czesci.length - 1] || sciezka;
}

/** Lista ostatnich folderów po dodaniu nowego (najnowszy pierwszy, bez powtórek, maks. 6). */
export function dopiszOstatni(lista: string[], sciezka: string): string[] {
  return [sciezka, ...lista.filter((x) => x !== sciezka)].slice(0, 6);
}

/** Wybór folderu wyniku: tryb (obok źródła / Pobrane albo wybrany folder), duży przycisk zmiany,
 *  podgląd w Eksploratorze i lista ostatnio używanych (w konfigu). Zapis w konfigu od razu. */
export function folderWyjscia(klucz: "katalog_wyjscia" | "katalog_pobierania" = "katalog_wyjscia"): HTMLElement {
  const k = sklep.stan.konfig;
  const sciezka = k?.[klucz] ?? null;
  const domyslny = klucz === "katalog_wyjscia" ? t("folder.obok") : t("folder.pobrane");
  const ustaw = async (v: string | null) => {
    const biezacy = sklep.stan.konfig;
    if (!biezacy) return;
    const nowy = { ...biezacy, [klucz]: v, ostatnie_foldery: v ? dopiszOstatni(biezacy.ostatnie_foldery ?? [], v) : biezacy.ostatnie_foldery };
    await api.konfigZapisz(nowy);
    sklep.ustaw({ konfig: nowy });
    pokazDymek(v ? t("folder.zapisano", { folder: nazwaFolderu(v) }) : t("folder.zapisano_domyslny", { folder: domyslny }));
  };
  const wybierz = async () => {
    const w = await api.wybierzFolder(sciezka ?? undefined);
    if (w) await ustaw(w);
  };
  const ostatnie = (k?.ostatnie_foldery ?? []).filter((x) => x !== sciezka);

  const tryb = h(
    "div",
    { class: "segmenty", role: "group", "aria-label": t("folder.zapisz_do") },
    h("button", { type: "button", class: `segment${sciezka ? "" : " aktywny"}`, "aria-pressed": String(!sciezka), onclick: () => sciezka && void ustaw(null) }, domyslny),
    h("button", { type: "button", class: `segment${sciezka ? " aktywny" : ""}`, "aria-pressed": String(!!sciezka), onclick: () => void wybierz() }, t("folder.wybrany")),
  );

  const wybrany = sciezka
    ? h(
        "div",
        { class: "folder-wiersz" },
        h(
          "button",
          { type: "button", class: "folder-wybrany", title: t("folder.zmien_pomoc"), onclick: () => void wybierz() },
          ikona(IKONY.folder),
          h("span", { class: "folder-tekst" }, h("span", { class: "folder-nazwa" }, nazwaFolderu(sciezka)), h("span", { class: "folder-pelna" }, sciezkaDoPokazania(sciezka))),
        ),
        przycisk(t("folder.zmien"), () => void wybierz(), "przycisk-maly"),
        przycisk(t("folder.pokaz"), () => void api.pokazWFolderze(sciezka), "przycisk-maly przycisk-drugorzedny"),
      )
    : null;

  const lista = ostatnie.length
    ? h(
        "select",
        {
          class: "wybor folder-ostatnie",
          "aria-label": t("folder.ostatnie"),
          onchange: (e: Event) => {
            const v = (e.target as HTMLSelectElement).value;
            if (v) void ustaw(v);
          },
        },
        h("option", { value: "" }, t("folder.ostatnie")),
        ostatnie.map((f) => h("option", { value: f, title: f }, `${nazwaFolderu(f)}  ·  ${sciezkaDoPokazania(f)}`)),
      )
    : null;

  return h(
    "div",
    { class: "folder-blok" },
    h("div", { class: "folder-wiersz" }, h("span", { class: "folder-etykieta" }, t("folder.zapisz_do")), tryb, lista),
    wybrany,
  );
}

export function opisSzacunku(bajty: number | null, dokladny: boolean): string {
  if (bajty === null) return t("szacunek.brak");
  return `${dokladny ? "" : "≈ "}${formatujRozmiar(bajty, jezyk())}`;
}

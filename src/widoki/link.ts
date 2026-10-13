// Z linku (GUI 2.0, makieta: ekran „Z linku”): link → podgląd → klip (fragment od–do) → cel → łańcuch
// pobierz → konwertuj w jednym zadaniu kolejki. Playlisty: cała, zakres, tylko nowe. Błędy yt-dlp po ludzku
// (`komunikat_bledu` w Rust), z „Zaktualizuj silnik”, gdy to pomoże. Logika w `src/link.ts`.
import { api } from "../api";
import { h, ikona, zamien } from "../dom";
import { IKONY } from "../ikony";
import { jezyk, rozdzielBlad, t, tekstBledu } from "../i18n";
import { formatujCzas, formatujRozmiar } from "../logika";
import { naprawaBledu } from "../prosty";
import {
  CELE_LINKU, fragment, lancuch, linkPlaylisty, opcjePobrania, profilCelu, stanPoczatkowy, szacunekLinku, wyciagnijLink,
  type CelLinku, type StanLinku,
} from "../link";
import { dymekDodano, pokazDymek, sklep } from "../sklep";
import type { Info, InfoFilmu } from "../typy";
import { pil, przelacznik2, segment2 } from "./wspolne2";

export interface WidokLinku {
  el: HTMLElement;
  odswiez(): void;
  /** Link z Taśmy, palety albo trybu Prostego („Więcej ustawień”). */
  wstaw(url: string): void;
  start(): Promise<void>;
}

const IKONA_CELU: Record<CelLinku, string> = { discord: IKONY.film, gif: IKONY.iskra, mp3: IKONY.nuta, rolka: IKONY.telefon, oryg: IKONY.pobierzPlik };

export function stworzWidokLinku(): WidokLinku {
  let url = "";
  let info: Info | null = null;
  let blad: string | null = null;
  let sprawdzam = false;
  let aktualizuje = false;
  let s: StanLinku = stanPoczatkowy();
  let pokolenie = 0;

  const el = h("div", { class: "v2 ekran-2", "data-ekran": "link" });
  const lewa = h("div", { class: "l" });
  const prawa = h("aside", { class: "panel2c", "aria-label": t("link.lancuch") });
  el.append(lewa, prawa);

  const film = (): InfoFilmu | null => (info?.typ === "film" ? info : null);
  const czas = () => film()?.czas_s ?? null;

  async function sprawdz(nowy?: string) {
    const u = wyciagnijLink(nowy ?? url);
    if (!u) {
      blad = t("pobierz.brak_linku");
      rysuj();
      return;
    }
    url = u;
    const moje = ++pokolenie;
    info = null;
    blad = null;
    sprawdzam = true;
    s = { ...stanPoczatkowy(), cel: s.cel, glosnosc: s.glosnosc, napisy: s.napisy };
    rysuj();
    try {
      const wynik = await api.ytdlpInfo(u, linkPlaylisty(u));
      if (moje !== pokolenie) return;
      info = wynik;
      s.playlista = wynik.typ === "playlista";
      if (wynik.typ === "playlista") {
        s.cel = s.cel === "mp3" ? "mp3" : "oryg";
        s.zakresDo = Math.max(1, wynik.wpisy.length);
      }
      if (wynik.typ === "film") s.do_ = wynik.czas_s;
    } catch (e) {
      if (moje !== pokolenie) return;
      blad = String(e);
    }
    sprawdzam = false;
    rysuj();
  }

  async function aktualizuj() {
    aktualizuje = true;
    rysuj();
    try {
      const n = await api.ytdlpAktualizuj();
      sklep.ustaw({ narzedzia: n });
      pokazDymek(t("pobierz.zaktualizowano", { w: n.ytdlp?.wersja ?? "?" }));
      aktualizuje = false;
      await sprawdz();
    } catch (e) {
      aktualizuje = false;
      pokazDymek(tekstBledu(e), "blad");
      rysuj();
    }
  }

  async function start() {
    if (!info || sprawdzam) return;
    const tytul = info.typ === "film" ? { tytul: info.tytul, czas_s: info.czas_s } : { tytul: info.tytul, czas_s: null };
    const potem = s.playlista ? (s.cel === "mp3" && s.glosnosc ? profilCelu("mp3", true) : null) : profilCelu(s.cel, s.glosnosc);
    try {
      const ids = await api.dodajZadania([{ rodzaj: { typ: "pobranie", url: info.url || url, opcje: opcjePobrania(s, tytul), potem }, katalog: null }]);
      dymekDodano(ids.length, t);
    } catch (e) {
      pokazDymek(tekstBledu(e), "blad");
    }
  }

  // ---------- rysowanie ----------
  function rysuj() {
    const fokus = document.activeElement instanceof HTMLElement && el.contains(document.activeElement) ? document.activeElement.dataset.fokus : undefined;
    zamien(lewa, ...lewaKolumna());
    rysujPanel();
    if (fokus) el.querySelector<HTMLElement>(`[data-fokus="${fokus}"]`)?.focus();
  }

  function lewaKolumna(): (HTMLElement | null)[] {
    const pole = h("input", { type: "text", value: url, placeholder: t("link.wklej"), "aria-label": t("link.wklej"), spellcheck: "false", "data-fokus": "url" }) as HTMLInputElement;
    pole.addEventListener("input", () => (url = pole.value));
    pole.addEventListener("keydown", (e) => e.key === "Enter" && (e.preventDefault(), void sprawdz()));
    pole.addEventListener("paste", () => setTimeout(() => wyciagnijLink(pole.value) && void sprawdz(pole.value), 0));
    const stanPola = sprawdzam
      ? h("span", { class: "pigu" }, t("pobierz.sprawdzam"))
      : info
        ? h("span", { class: "pigu jest" }, ikona(IKONY.ok, "ikona ic m"), t("link.rozpoznano"))
        : h("button", { type: "button", class: "btn", "data-fokus": "sprawdz", onclick: () => void sprawdz() }, t("pobierz.sprawdz"));
    const n = sklep.stan.narzedzia;
    return [
      h("div", { class: "naglowek2" }, h("h2", { class: "tytul-ekr" }, t("zakladka.link")), h("span", { class: "opis" }, t("link.podtytul"))),
      n && !n.sciezki.ytdlp ? h("div", { class: "baner" }, ikona(IKONY.uwaga, "ikona ic m"), h("span", null, t("pobierz.brak_ytdlp"))) : null,
      h("label", { class: "wejscie", style: { margin: "0" } }, ikona(IKONY.link, "ikona ic d"), pole, stanPola),
      blad ? bladLinku(blad) : null,
      info?.typ === "film" ? podgladFilmu(info) : null,
      info?.typ === "playlista" ? podgladPlaylisty(info) : null,
      info?.typ === "film" && info.czas_s && !info.na_zywo ? klip(info) : null,
      info ? h("div", { class: "sekcja-g" }, h("h2", null, t("link.co_zrobic"))) : null,
      info ? cele() : null,
      info ? opcje() : null,
      h("p", { class: "tx3", style: { fontSize: "12px", margin: "0" } }, t("pobierz.prawa")),
    ];
  }

  function bladLinku(b: string): HTMLElement {
    const { tekst, szczegoly } = rozdzielBlad(b);
    const naprawa = naprawaBledu(b);
    return h(
      "div",
      { class: "baner zle", role: "alert" },
      ikona(IKONY.uwaga, "ikona ic m"),
      h(
        "span",
        null,
        h("b", null, tekst.split("\n")[0]),
        szczegoly ? h("details", null, h("summary", null, t("link.szczegoly")), h("pre", { class: "mono", style: { whiteSpace: "pre-wrap", fontSize: "11px", margin: "6px 0 0" } }, szczegoly)) : null,
        naprawa === "aktualizuj"
          ? h("span", { style: { display: "block", marginTop: "8px" } }, h("button", { type: "button", class: "btn maly", disabled: aktualizuje, "data-fokus": "aktualizuj", onclick: () => void aktualizuj() }, aktualizuje ? t("pobierz.aktualizuje") : t("link.aktualizuj_ponow")))
          : null,
      ),
    );
  }

  function podgladFilmu(f: InfoFilmu): HTMLElement {
    const wysokosci = f.wysokosci.slice(0, 4);
    return h(
      "div",
      { class: "podgl-link" },
      h(
        "span",
        { class: "min" },
        f.miniatura ? h("img", { src: f.miniatura, alt: "", referrerpolicy: "no-referrer", onerror: (e: Event) => (e.target as HTMLElement).remove() }) : ikona(IKONY.start, "ikona ic d"),
        f.czas_s ? h("span", { class: "czas" }, formatujCzas(Math.round(f.czas_s))) : null,
      ),
      h(
        "div",
        { style: { minWidth: "0", display: "flex", flexDirection: "column", gap: "6px" } },
        h("b", { class: "tytul", title: f.tytul }, f.tytul),
        h("span", { class: "kanal" }, [f.autor, f.wysokosci[0] ? t("pobierz.do", { r: `${f.wysokosci[0]}p` }) : null, f.rozdzialy ? t("pobierz.rozdzialy_n", { n: f.rozdzialy }) : null, f.na_zywo ? t("pobierz.na_zywo") : null].filter(Boolean).join(" · ")),
        s.cel !== "mp3"
          ? h(
              "div",
              { class: "wiersz-zawijany", role: "group", "aria-label": t("pobierz.jakosc") },
              pil(t("pobierz.najlepsza"), s.wysokosc === null, () => ((s.wysokosc = null), rysuj()), { "data-fokus": "jakosc-max" }),
              wysokosci.map((w) => pil(`${w}p`, s.wysokosc === w, () => ((s.wysokosc = w), rysuj()), { "data-fokus": `jakosc-${w}` })),
            )
          : null,
      ),
    );
  }

  function podgladPlaylisty(p: Extract<Info, { typ: "playlista" }>): HTMLElement {
    return h(
      "div",
      { class: "grupa-d" },
      h("b", { class: "tnij", title: p.tytul }, p.tytul || t("link.playlista")),
      h("span", { class: "tx3" }, t("pobierz.playlista_n", { n: p.wpisy.length })),
      segment2<StanLinku["trybPlaylisty"]>(
        [
          { v: "wszystko", e: t("link.playlista.wszystko") },
          { v: "zakres", e: t("link.playlista.zakres") },
          { v: "nowe", e: t("link.playlista.nowe") },
        ],
        s.trybPlaylisty,
        (v) => ((s.trybPlaylisty = v), rysuj()),
        t("link.playlista"),
      ),
      s.trybPlaylisty === "zakres"
        ? h(
            "div",
            { class: "wiersz-zawijany" },
            h("label", { class: "pole-w" }, t("link.od"), liczbaPola(s.zakresOd, (v) => (s.zakresOd = v), "zakres-od", p.wpisy.length)),
            h("label", { class: "pole-w" }, t("link.do"), liczbaPola(s.zakresDo, (v) => (s.zakresDo = v), "zakres-do", p.wpisy.length)),
          )
        : null,
      s.trybPlaylisty === "nowe" ? h("small", { class: "tx3" }, t("link.playlista.nowe.opis")) : null,
      h("small", { class: "tx3" }, t("link.playlista.bez_konwersji")),
    );
  }

  function liczbaPola(v: number, zmiana: (v: number) => void, fokus: string, maks: number): HTMLInputElement {
    const p = h("input", { type: "number", min: "1", max: String(Math.max(1, maks)), value: String(v), "data-fokus": fokus, style: { width: "5.5em" } }) as HTMLInputElement;
    p.addEventListener("change", () => {
      zmiana(Math.max(1, Math.min(maks || 9999, Math.round(Number(p.value) || 1))));
      rysuj();
    });
    return p;
  }

  function klip(f: InfoFilmu): HTMLElement {
    const dl = f.czas_s ?? 0;
    const od = Math.max(0, Math.min(s.od, dl));
    const doo = Math.max(od, Math.min(s.do_ ?? dl, dl));
    const proc = (x: number) => (dl ? (x / dl) * 100 : 0);
    const suwak = (wartosc: number, etykieta: string, fokus: string, zmiana: (v: number) => void) => {
      const i = h("input", { type: "range", min: "0", max: String(dl), step: dl > 600 ? "1" : "0.5", value: String(wartosc), "aria-label": etykieta, "data-fokus": fokus, "aria-valuetext": formatujCzas(Math.round(wartosc)) }) as HTMLInputElement;
      i.addEventListener("input", () => {
        zmiana(Number(i.value));
        // bez przebudowy całego widoku w trakcie przeciągania: tylko oś, czasy i panel
        const wyb = el.querySelector<HTMLElement>(".os .wyb");
        if (wyb) Object.assign(wyb.style, { left: `${proc(Math.min(s.od, s.do_ ?? dl))}%`, right: `${100 - proc(Math.max(s.od, s.do_ ?? dl))}%` });
        const czasy = el.querySelector(".os-czasy");
        if (czasy) czasy.replaceWith(osCzasy(dl));
        rysujPanel();
      });
      i.addEventListener("change", () => {
        if (s.do_ !== null && s.od > s.do_) [s.od, s.do_] = [s.do_, s.od];
        rysuj();
      });
      return i;
    };
    return h(
      "div",
      { style: { display: "flex", flexDirection: "column", gap: "8px" } },
      h("div", { class: "sekcja-g" }, h("h2", null, t("link.klip")), h("span", null, t("link.klip.opis"))),
      h(
        "div",
        { class: "os", "aria-hidden": "true" },
        Array.from({ length: 14 }, (_, j) => h("span", { style: { background: `linear-gradient(${120 + j * 9}deg,#22223b,${["#c9184a", "#7b2cbf", "#ff6d00", "#3a0ca3"][j % 4]})` } })),
        h("span", { class: "wyb", style: { left: `${proc(od)}%`, right: `${100 - proc(doo)}%` } }),
      ),
      h("div", { class: "os-suwaki" }, suwak(od, t("link.poczatek"), "od", (v) => (s.od = v)), suwak(doo, t("link.koniec"), "do", (v) => (s.do_ = v))),
      osCzasy(dl),
    );
  }

  function osCzasy(dl: number): HTMLElement {
    const od = Math.min(s.od, s.do_ ?? dl);
    const doo = Math.max(s.od, s.do_ ?? dl);
    return h(
      "div",
      { class: "os-czasy" },
      h("span", null, t("link.od"), " ", h("b", null, formatujCzas(Math.round(od)))),
      h("span", null, t("link.dlugosc"), " ", h("b", null, formatujCzas(Math.round(doo - od)))),
      h("span", null, t("link.do"), " ", h("b", null, formatujCzas(Math.round(doo)))),
    );
  }

  function cele(): HTMLElement {
    return h(
      "div",
      { class: "wiersz-zawijany", role: "group", "aria-label": t("link.co_zrobic") },
      CELE_LINKU.map((c) =>
        pil(t(`link.cel.${c}`), s.cel === c, () => ((s.cel = c), rysuj()), { "data-fokus": `cel-${c}`, disabled: s.playlista && c !== "oryg" && c !== "mp3" }, IKONA_CELU[c]),
      ),
    );
  }

  function opcje(): HTMLElement {
    const audio = s.cel === "mp3";
    const wiersz = (klucz: keyof StanLinku, etykieta: string, wylaczone = false) =>
      h("div", { class: "wiersz-op" }, h("span", null, etykieta), przelacznik2(!!s[klucz] && !wylaczone, (v) => (((s as unknown as Record<string, unknown>)[klucz] = v), rysuj()), etykieta, `opt-${klucz}`, wylaczone));
    return h(
      "div",
      { class: "opcje-siatka" },
      wiersz("napisy", t("link.opt.napisy"), audio),
      wiersz("rozdzialy", t("link.opt.rozdzialy"), audio),
      wiersz("okladka", t("link.opt.okladka")),
      wiersz("glosnosc", t("link.opt.glosnosc"), s.cel === "gif" || (s.playlista && !audio)),
    );
  }

  function rysujPanel() {
    const f = film();
    const est = szacunekLinku(s, f);
    const fr = fragment(s, czas());
    const n = sklep.stan.narzedzia;
    const y = n?.ytdlp;
    prawa.replaceChildren(
      h("div", { class: "panel-g" }, h("span", { class: "etyk-s" }, t("link.lancuch")), h("h3", null, t(s.playlista ? "link.lancuch.playlista" : fr ? "link.lancuch.klip" : "link.lancuch.film"))),
      h(
        "div",
        { class: "panel-s" },
        h(
          "div",
          { class: "lancuch" },
          lancuch(s, czas()).map(([k, p], i) =>
            h("div", { class: "ogniwo" }, h("i", null, String(i + 1)), h("span", null, h("b", null, t(k, { ...p, od: typeof p.od === "number" ? formatujCzas(Math.round(p.od)) : p.od ?? "", do: typeof p.do === "number" && !s.playlista ? formatujCzas(Math.round(p.do)) : p.do ?? "" })), h("small", null, t(`${k}.opis`)))),
          ),
        ),
        f
          ? h(
              "div",
              { class: "wskaznik" },
              h("div", { class: "liczby" }, h("span", { class: "po" }, est !== null ? `~${formatujRozmiar(est, jezyk())}` : "—"), fr ? h("span", { class: "proc" }, formatujCzas(Math.round(fr.do_ - fr.od))) : null),
              h("div", { class: "opis" }, fr ? t("link.zamiast", { r: f.czas_s ? formatujCzas(Math.round(f.czas_s)) : "?" }) : t("link.caly")),
            )
          : null,
        h(
          "div",
          { class: "wiersz-op" },
          h("span", null, t("link.silnik")),
          y
            ? h("span", { class: `pigu ${y.stary ? "uwaga" : "jest"}`, title: y.stary ? t("pobierz.wiek", { n: y.wiek_dni ?? "?" }) : t("link.silnik.aktualny", { w: y.wersja ?? "?" }) }, ikona(y.stary ? IKONY.uwaga : IKONY.ok, "ikona ic m"), y.stary ? t("pobierz.wiek", { n: y.wiek_dni ?? "?" }) : t("link.silnik.aktualny", { w: y.wersja ?? "?" }))
            : h("span", { class: "pigu zle" }, t("link.silnik.brak")),
        ),
        y?.stary ? h("button", { type: "button", class: "btn maly", disabled: aktualizuje, "data-fokus": "aktualizuj2", onclick: () => void aktualizuj() }, aktualizuje ? t("pobierz.aktualizuje") : t("pobierz.aktualizuj")) : null,
      ),
      h(
        "div",
        { class: "panel-d" },
        h(
          "button",
          { type: "button", class: "btn-wcisk", style: { width: "100%" }, disabled: !info || sprawdzam, "data-fokus": "start", "aria-keyshortcuts": "Control+Enter", title: t(s.playlista ? "link.start.playlista" : fr ? "link.start.klip" : "link.start"), onclick: () => void start() },
          ikona(IKONY.pobierzPlik, "ikona ic m"),
          t(s.playlista ? "link.start.playlista" : fr ? "link.start.klip" : "link.start"),
          h("span", { class: "kbd" }, "Ctrl ↵"),
        ),
      ),
    );
  }

  rysuj();
  return {
    el,
    odswiez: rysuj,
    wstaw(u: string) {
      url = u;
      void sprawdz(u);
    },
    start,
  };
}

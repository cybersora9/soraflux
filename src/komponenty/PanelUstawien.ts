// JEDEN panel ustawień dla Konwertuj i Obrazy.
// Podstawy widoczne od razu, reszta w zwijanej sekcji „Zaawansowane”.
import { h } from "../dom";
import { t } from "../i18n";
import {
  BITRATY_AUDIO, CZESTOTLIWOSCI, FPS, KODEKI_AUDIO, KODEKI_WIDEO, KONTENERY_ANIMACJI, KONTENERY_AUDIO,
  KONTENERY_OBRAZU, KONTENERY_WIDEO, WYSOKOSCI, audioDomyslne, etykietaWysokosci, formatujCzas, gifDomyslny,
  obrazDomyslny, parsujCzas, podpowiedzAac, sklonuj, tylkoAudio, wideoDomyslne, zmienKontener, niskiAac,
} from "../logika";
import type {
  Dopasowanie, Dithering, Fps, JakoscWideo, KodekAudio, KodekWideo, Kontener, Media, Petla, Profil, ProfilAudio,
  ProfilWideo, Rozdzielczosc, RozmiarObrazu, Skaler, Sprzet, WyborAudio,
} from "../typy";
import { liczba, pole, przelacznik, segmenty, suwak, tekst, uwaga, wybor, type Opcja } from "./pola";

export type TrybPanelu = "wideo" | "obraz";

export interface OpcjePanelu {
  tryb: TrybPanelu;
  profil: Profil;
  /** Media pierwszego pliku (do podpowiedzi „oryginalne: 1080p”). */
  media?: () => Media | null;
  /** Działające enkodery sprzętowe (np. `h264_nvenc`). */
  sprzet?: () => string[];
  /** Wszystkie enkodery z `ffmpeg -encoders`; kodeki bez enkodera są wyszarzone. Pusta lista = nie wiadomo. */
  enkodery?: () => string[];
  onZmiana: (p: Profil) => void;
}

export interface Panel {
  el: HTMLElement;
  profil(): Profil;
  ustaw(p: Profil): void;
  odswiez(): void;
}

const SKALERY: Skaler[] = ["lanczos", "bicubic", "bilinear", "neighbor"];
const PREDKOSCI = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4];

const nazwaKontenera = (k: Kontener) => k.toUpperCase();

/** Programowy enkoder ffmpeg dla kodeku (sprawdzamy `-encoders`, nie zakładamy). */
export const ENKODER_WIDEO: Partial<Record<KodekWideo, string>> = {
  h264: "libx264", h265: "libx265", av1: "libsvtav1", vp9: "libvpx-vp9", mpeg4: "mpeg4",
};
export const ENKODER_AUDIO: Partial<Record<KodekAudio, string>> = {
  aac: "aac", mp3: "libmp3lame", opus: "libopus", vorbis: "libvorbis", flac: "flac", pcm: "pcm_s16le",
};

export function panelUstawien(o: OpcjePanelu): Panel {
  let p = sklonuj(o.profil);
  let zaawansowaneOtwarte = false;
  const brakEnkodera = (e: string | undefined) => {
    const lista = o.enkodery?.() ?? [];
    return !!e && lista.length > 0 && !lista.includes(e);
  };
  const el = h("div", { class: "panel-ustawien" });

  const zmien = (f: (p: Profil) => void, przebuduj = true) => {
    f(p);
    o.onZmiana(sklonuj(p));
    if (przebuduj) rysuj();
  };

  // ---------- format ----------

  function chipyFormatu(): HTMLElement {
    const grupy: [string, Kontener[]][] =
      o.tryb === "obraz"
        ? [[t("panel.format.obraz"), KONTENERY_OBRAZU]]
        : [
            [t("panel.format.wideo"), KONTENERY_WIDEO],
            [t("panel.format.audio"), KONTENERY_AUDIO],
            [t("panel.format.animacja"), KONTENERY_ANIMACJI],
          ];
    return h(
      "div",
      { class: "formaty" },
      grupy.map(([nazwa, lista]) =>
        h(
          "div",
          { class: "formaty-grupa" },
          h("span", { class: "formaty-nazwa" }, nazwa),
          h(
            "div",
            { class: "formaty-chipy", role: "radiogroup", "aria-label": nazwa },
            lista.map((k) =>
              h(
                "button",
                {
                  type: "button",
                  class: "chip" + (p.kontener === k ? " aktywny" : ""),
                  role: "radio",
                  "aria-checked": String(p.kontener === k),
                  title: o.tryb === "wideo" && k === "webp" ? t("panel.format.webp_anim") : undefined,
                  onclick: () => zmien((x) => Object.assign(x, zmienKontener(x, k, o.tryb === "obraz"))),
                },
                nazwaKontenera(k),
              ),
            ),
          ),
        ),
      ),
    );
  }

  // ---------- wideo ----------

  function opcjeRozdzielczosci(): Opcja<Rozdzielczosc>[] {
    const m = o.media?.();
    const zrodlo = m?.wideo ? ` (${m.wideo.w}×${m.wideo.h})` : "";
    const wlasna = p.wideo?.rozdzielczosc.typ === "wlasna" ? p.wideo.rozdzielczosc : { typ: "wlasna" as const, w: 1280, h: 720 };
    return [
      { wartosc: { typ: "zachowaj" }, etykieta: t("panel.oryginalna") + zrodlo },
      ...WYSOKOSCI.map((h): Opcja<Rozdzielczosc> => ({ wartosc: { typ: "wysokosc", h }, etykieta: etykietaWysokosci(h) })),
      { wartosc: wlasna, etykieta: t("panel.wlasna") },
    ];
  }

  function opcjeFps(): Opcja<Fps>[] {
    const m = o.media?.();
    const zrodlo = m?.wideo?.fps ? ` (${Math.round(m.wideo.fps * 100) / 100})` : "";
    const wlasne = p.wideo?.fps.typ === "wartosc" && !FPS.includes(p.wideo.fps.fps) ? p.wideo.fps.fps : 12;
    return [
      { wartosc: { typ: "zachowaj" }, etykieta: t("panel.oryginalne") + zrodlo },
      ...FPS.map((f): Opcja<Fps> => ({ wartosc: { typ: "wartosc", fps: f }, etykieta: `${f} fps` })),
      { wartosc: { typ: "wartosc", fps: wlasne }, etykieta: t("panel.wlasne") },
    ];
  }

  function rozdzielczosc(w: ProfilWideo): HTMLElement {
    const r = w.rozdzielczosc;
    const sel = wybor(opcjeRozdzielczosci(), r, (v) => zmien((x) => (x.wideo!.rozdzielczosc = v)));
    const wlasna =
      r.typ === "wlasna"
        ? h(
            "div",
            { class: "wymiary" },
            liczba(r.w, { min: 2, max: 16384, szerokosc: "5.5em" }, (v) => zmien((x) => ((x.wideo!.rozdzielczosc as { w: number }).w = v ?? 2), false)),
            h("span", { class: "razy" }, "×"),
            liczba(r.h, { min: 2, max: 16384, szerokosc: "5.5em" }, (v) => zmien((x) => ((x.wideo!.rozdzielczosc as { h: number }).h = v ?? 2), false)),
          )
        : null;
    return pole(t("panel.rozdzielczosc"), h("div", { class: "kolumna" }, sel, wlasna));
  }

  function fps(w: ProfilWideo): HTMLElement {
    const opcje = opcjeFps();
    const wlasneWybrane = w.fps.typ === "wartosc" && !FPS.includes(w.fps.fps);
    const wybrane = wlasneWybrane ? opcje[opcje.length - 1].wartosc : w.fps;
    const sel = wybor(opcje, wybrane, (v) => zmien((x) => (x.wideo!.fps = v)));
    const reczne =
      wlasneWybrane && w.fps.typ === "wartosc"
        ? liczba(w.fps.fps, { min: 1, max: 240, krok: 0.001, sufiks: "fps", szerokosc: "5.5em" }, (v) =>
            zmien((x) => (x.wideo!.fps = { typ: "wartosc", fps: v ?? 25 }), false),
          )
        : null;
    return pole(t("panel.fps"), h("div", { class: "kolumna" }, sel, reczne));
  }

  function jakosc(w: ProfilWideo): HTMLElement {
    const j = w.jakosc;
    const tryb = segmenty<JakoscWideo["typ"]>(
      [
        { wartosc: "crf", etykieta: t("panel.jakosc.crf") },
        { wartosc: "bitrate", etykieta: t("panel.jakosc.bitrate") },
        { wartosc: "rozmiar_mb", etykieta: t("panel.jakosc.rozmiar") },
      ],
      j.typ,
      (typ) =>
        zmien((x) => {
          x.wideo!.jakosc =
            typ === "crf" ? { typ, crf: domyslnyCrf(x.wideo!.kodek) } : typ === "bitrate" ? { typ, kbps: 2500 } : { typ, mb: 25 };
        }),
      t("panel.jakosc"),
    );
    let szczegoly: HTMLElement;
    if (j.typ === "crf") {
      const maks = w.kodek === "av1" || w.kodek === "vp9" ? 63 : 51;
      const wartosc = h("output", { class: "suwak-wartosc" }, String(j.crf));
      szczegoly = h(
        "div",
        { class: "suwak-blok" },
        h(
          "div",
          { class: "suwak-wiersz" },
          suwak(j.crf, 0, maks, (v) => {
            wartosc.textContent = String(v);
            zmien((x) => ((x.wideo!.jakosc as { crf: number }).crf = v), false);
          }, { "aria-label": "CRF" }),
          wartosc,
        ),
        h("div", { class: "suwak-opisy" }, h("span", null, t("panel.crf.lepsza")), h("span", null, t("panel.crf.mniejszy"))),
      );
    } else if (j.typ === "bitrate") {
      szczegoly = liczba(j.kbps, { min: 50, max: 200000, sufiks: "kb/s" }, (v) =>
        zmien((x) => (x.wideo!.jakosc = { typ: "bitrate", kbps: v ?? 2500 }), false),
        (v) => v !== null && zmien((x) => (x.wideo!.jakosc = { typ: "bitrate", kbps: v }), false),
      );
    } else {
      szczegoly = h(
        "div",
        { class: "kolumna" },
        liczba(j.mb, { min: 0.1, max: 100000, krok: 0.1, sufiks: "MB" }, (v) =>
          zmien((x) => (x.wideo!.jakosc = { typ: "rozmiar_mb", mb: v ?? 10 }), false),
          (v) => v !== null && zmien((x) => (x.wideo!.jakosc = { typ: "rozmiar_mb", mb: v }), false),
        ),
        h("div", { class: "pole-pomoc" }, t("panel.rozmiar.pomoc")),
      );
    }
    return pole(t("panel.jakosc"), h("div", { class: "kolumna" }, tryb, szczegoly), null, "pole-szerokie");
  }

  function domyslnyCrf(k: KodekWideo): number {
    return k === "av1" ? 32 : k === "vp9" ? 31 : k === "h265" ? 26 : 23;
  }

  // ---------- audio ----------

  function zmienAudio(f: (a: ProfilAudio) => void, przebuduj = true) {
    zmien((x) => {
      if (!x.audio) return;
      const przed = sklonuj(x.audio);
      f(x.audio);
      x.audio = podpowiedzAac(przed, x.audio);
    }, przebuduj);
  }

  function kodekAudio(): HTMLElement {
    const dostepne = KODEKI_AUDIO[p.kontener] ?? [];
    const opcje: Opcja<KodekAudio | null>[] = dostepne.map((k) => {
      const brak = brakEnkodera(ENKODER_AUDIO[k]);
      return { wartosc: k, etykieta: t(`kodek.${k}`) + (brak ? ` (${t("panel.brak_enkodera")})` : ""), wylaczona: brak };
    });
    if (!tylkoAudio(p.kontener)) opcje.push({ wartosc: null, etykieta: t("panel.bez_dzwieku") });
    return pole(
      t("panel.dzwiek"),
      wybor(opcje, p.audio?.kodek ?? null, (k) =>
        zmien((x) => {
          if (k === null) x.audio = null;
          else {
            const przed = x.audio ? sklonuj(x.audio) : null;
            x.audio = x.audio ? { ...x.audio, kodek: k } : audioDomyslne(k);
            x.audio = podpowiedzAac(przed, x.audio);
          }
        }),
      ),
    );
  }

  function bitrateAudio(a: ProfilAudio): HTMLElement | null {
    if (["flac", "pcm", "kopiuj"].includes(a.kodek)) return null;
    const lista = BITRATY_AUDIO.includes(a.kbps) ? BITRATY_AUDIO : [...BITRATY_AUDIO, a.kbps].sort((x, y) => x - y);
    return pole(
      t("panel.bitrate_audio"),
      wybor(lista.map((k) => ({ wartosc: k, etykieta: `${k} kb/s` })), a.kbps, (v) => zmienAudio((x) => (x.kbps = v))),
    );
  }

  function hz(a: ProfilAudio): HTMLElement | null {
    if (a.kodek === "kopiuj") return null;
    return pole(
      t("panel.czestotliwosc"),
      wybor<number | null>(
        [{ wartosc: null, etykieta: t("panel.oryginalna") }, ...CZESTOTLIWOSCI.map((f) => ({ wartosc: f, etykieta: `${(f / 1000).toLocaleString()} kHz` }))],
        a.hz,
        (v) => zmienAudio((x) => (x.hz = v)),
      ),
    );
  }

  function kanaly(a: ProfilAudio): HTMLElement | null {
    if (a.kodek === "kopiuj") return null;
    return pole(
      t("panel.kanaly"),
      wybor<number | null>(
        [
          { wartosc: null, etykieta: t("panel.oryginalne") },
          { wartosc: 1, etykieta: t("panel.mono") },
          { wartosc: 2, etykieta: t("panel.stereo") },
        ],
        a.kanaly,
        (v) => zmienAudio((x) => (x.kanaly = v)),
      ),
    );
  }

  function uwagaAac(): HTMLElement | null {
    if (!niskiAac(p.audio)) return null;
    return uwaga("info", t("panel.aac_niski"));
  }

  // ---------- GIF / animowany WebP ----------

  function animacja(): HTMLElement[] {
    const g = p.gif ?? gifDomyslny();
    const petla = wybor<Petla["typ"]>(
      [
        { wartosc: "nieskonczona", etykieta: t("gif.petla.nieskonczona") },
        { wartosc: "razy", etykieta: t("gif.petla.razy") },
        { wartosc: "brak", etykieta: t("gif.petla.brak") },
      ],
      g.petla.typ,
      (typ) => zmien((x) => (x.gif!.petla = typ === "razy" ? { typ, n: 3 } : { typ })),
    );
    const ileRazy =
      g.petla.typ === "razy"
        ? liczba(g.petla.n, { min: 1, max: 100, sufiks: "×", szerokosc: "4.5em" }, (v) => zmien((x) => (x.gif!.petla = { typ: "razy", n: v ?? 1 }), false))
        : null;
    const pola: HTMLElement[] = [
      pole(t("gif.fps"), liczba(g.fps, { min: 1, max: 50, sufiks: "fps", szerokosc: "5em" }, (v) => zmien((x) => (x.gif!.fps = v ?? 15), false), (v) => v && zmien((x) => (x.gif!.fps = v), false))),
      pole(t("gif.szerokosc"), liczba(g.szerokosc, { min: 16, max: 3840, sufiks: "px", szerokosc: "5.5em" }, (v) => zmien((x) => (x.gif!.szerokosc = v ?? 480), false), (v) => v && zmien((x) => (x.gif!.szerokosc = v), false))),
      pole(t("gif.petla"), h("div", { class: "kolumna" }, petla, ileRazy)),
    ];
    if (p.kontener === "gif") {
      pola.push(
        pole(
          t("gif.dithering"),
          wybor<Dithering>(
            [
              { wartosc: { typ: "sierra2_4a" }, etykieta: t("gif.dither.sierra") },
              { wartosc: { typ: "floyd_steinberg" }, etykieta: t("gif.dither.floyd") },
              { wartosc: { typ: "bayer", skala: 3 }, etykieta: t("gif.dither.bayer") },
              { wartosc: { typ: "brak" }, etykieta: t("gif.dither.brak") },
            ],
            g.dithering,
            (v) => zmien((x) => (x.gif!.dithering = v)),
          ),
        ),
      );
    } else {
      const q = p.obraz?.jakosc ?? 75;
      pola.push(pole(t("obraz.jakosc"), suwakJakosci(q, (v) => zmien((x) => (x.obraz = { ...(x.obraz ?? obrazDomyslny()), jakosc: v }), false))));
    }
    return pola;
  }

  function ciecie(): HTMLElement {
    const c = p.ciecie;
    const ustaw = (od: number | null, koniec: number | null) =>
      zmien((x) => (x.ciecie = od === null && koniec === null ? null : { od: od ?? 0, koniec }), false);
    const czasMedia = o.media?.()?.czas_s ?? null;
    const od = tekst(c && c.od > 0 ? formatujCzas(c.od) : "", (v) => ustaw(parsujCzas(v), p.ciecie?.koniec ?? null), {
      placeholder: "00:00", class: "tekst czas", "aria-label": t("panel.ciecie.od"),
    });
    const koniec = tekst(c?.koniec != null ? formatujCzas(c.koniec) : "", (v) => ustaw(p.ciecie?.od ?? null, parsujCzas(v)), {
      placeholder: czasMedia ? formatujCzas(czasMedia) : t("panel.ciecie.koniec_pliku"), class: "tekst czas", "aria-label": t("panel.ciecie.do"),
    });
    return pole(t("panel.ciecie"), h("div", { class: "wymiary" }, od, h("span", { class: "razy" }, "–"), koniec), t("panel.ciecie.pomoc"));
  }

  // ---------- zaawansowane wideo ----------

  function kodekWideo(w: ProfilWideo): HTMLElement {
    const lista = KODEKI_WIDEO[p.kontener] ?? [];
    return pole(
      t("panel.kodek_wideo"),
      wybor(lista.map((k) => {
        const brak = brakEnkodera(ENKODER_WIDEO[k]);
        return { wartosc: k, etykieta: t(`kodek.${k}`) + (brak ? ` (${t("panel.brak_enkodera")})` : ""), wylaczona: brak };
      }), w.kodek, (k) =>
        zmien((x) => {
          const stary = x.wideo!;
          x.wideo = { ...stary, kodek: k, sprzet: null };
          if (stary.jakosc.typ === "crf") x.wideo.jakosc = { typ: "crf", crf: domyslnyCrf(k) };
        }),
      ),
    );
  }

  function sprzet(w: ProfilWideo): HTMLElement | null {
    const prefiks: Partial<Record<KodekWideo, string>> = { h264: "h264", h265: "hevc", av1: "av1" };
    const pre = prefiks[w.kodek];
    if (!pre) return null;
    const dostepne = (o.sprzet?.() ?? []).filter((e) => e.startsWith(pre + "_")).map((e) => e.split("_")[1] as Sprzet);
    if (dostepne.length === 0) return null;
    return pole(
      t("panel.enkoder"),
      wybor<Sprzet | null>(
        [{ wartosc: null, etykieta: t("panel.enkoder.programowy") }, ...dostepne.map((s) => ({ wartosc: s, etykieta: t(`sprzet.${s}`) }))],
        w.sprzet,
        (v) => zmien((x) => (x.wideo!.sprzet = v)),
      ),
      t("panel.enkoder.pomoc"),
    );
  }

  function dziesiecBit(w: ProfilWideo): HTMLElement | null {
    if (!["h265", "av1", "vp9"].includes(w.kodek)) return null;
    const hdr = !!o.media?.()?.wideo?.hdr;
    return pole(
      t("panel.dziesiec_bit"),
      przelacznik(t(hdr ? "panel.dziesiec_bit.hdr" : "panel.dziesiec_bit.opis"), w.dziesiec_bit, (v) => zmien((x) => (x.wideo!.dziesiec_bit = v))),
    );
  }

  function sciezkiAudio(): HTMLElement | null {
    const sciezki = o.media?.()?.sciezki_audio ?? [];
    if (sciezki.length < 2 || !p.audio) return null;
    const opcje: Opcja<WyborAudio>[] = [
      ...sciezki.map((s, n): Opcja<WyborAudio> => ({
        wartosc: n === 0 ? { typ: "pierwsza" } : { typ: "numer", n },
        etykieta: `${n + 1}: ${s.kodek.toUpperCase()}${s.kanaly ? ` ${s.kanaly} kan.` : ""}${s.jezyk ? ` (${s.jezyk})` : ""}`,
      })),
    ];
    if (!tylkoAudio(p.kontener)) opcje.push({ wartosc: { typ: "wszystkie" }, etykieta: t("panel.sciezki.wszystkie") });
    return pole(t("panel.sciezki"), wybor(opcje, p.sciezki_audio, (v) => zmien((x) => (x.sciezki_audio = v))));
  }

  function napisy(): HTMLElement | null {
    const n = o.media?.()?.napisy ?? [];
    if (n.length === 0 || tylkoAudio(p.kontener)) return null;
    return pole(t("panel.napisy"), przelacznik(t("panel.napisy.opis", { n: n.length }), p.napisy, (v) => zmien((x) => (x.napisy = v))));
  }

  function dopasowanie(d: Dopasowanie, ustaw: (d: Dopasowanie) => void, zRozmyciem: boolean): HTMLElement {
    const opcje: Opcja<Dopasowanie["typ"]>[] = [
      { wartosc: "proporcje", etykieta: t("dopasowanie.proporcje") },
      { wartosc: "rozciagnij", etykieta: t("dopasowanie.rozciagnij") },
      { wartosc: "pasy", etykieta: t("dopasowanie.pasy") },
      ...(zRozmyciem ? [{ wartosc: "rozmycie" as const, etykieta: t("dopasowanie.rozmycie") }] : []),
      { wartosc: "przytnij", etykieta: t("dopasowanie.przytnij") },
    ];
    const sel = wybor(opcje, d.typ, (typ) => ustaw(typ === "pasy" ? { typ, kolor: "black" } : { typ }));
    const kolor =
      d.typ === "pasy"
        ? wybor(
            [
              { wartosc: "black", etykieta: t("kolor.czarny") },
              { wartosc: "white", etykieta: t("kolor.bialy") },
              { wartosc: "#808080", etykieta: t("kolor.szary") },
            ],
            d.kolor,
            (kolor) => ustaw({ typ: "pasy", kolor }),
          )
        : null;
    return pole(t("panel.dopasowanie"), h("div", { class: "kolumna" }, sel, kolor));
  }

  function skaler(s: Skaler, ustaw: (s: Skaler) => void): HTMLElement {
    return pole(t("panel.skaler"), wybor(SKALERY.map((k) => ({ wartosc: k, etykieta: t(`skaler.${k}`) })), s, ustaw));
  }

  function geometria(): HTMLElement[] {
    const r = p.przyciecie;
    const bok = (k: keyof Profil["przyciecie"]) =>
      h(
        "label",
        { class: "bok" },
        h("span", null, t(`panel.przyciecie.${k}`)),
        liczba(r[k], { min: 0, max: 8000, szerokosc: "4.5em" }, (v) => zmien((x) => (x.przyciecie[k] = v ?? 0), false)),
      );
    return [
      pole(
        t("panel.obrot"),
        wybor(
          [
            { wartosc: "brak" as const, etykieta: "0°" },
            { wartosc: "o90" as const, etykieta: t("panel.obrot.90") },
            { wartosc: "o180" as const, etykieta: "180°" },
            { wartosc: "o270" as const, etykieta: t("panel.obrot.270") },
          ],
          p.obrot,
          (v) => zmien((x) => (x.obrot = v)),
        ),
      ),
      pole(
        t("panel.odbicie"),
        h(
          "div",
          { class: "kolumna kolumna-ciasna" },
          przelacznik(t("panel.odbicie.poziomo"), p.odbicie.poziomo, (v) => zmien((x) => (x.odbicie.poziomo = v), false)),
          przelacznik(t("panel.odbicie.pionowo"), p.odbicie.pionowo, (v) => zmien((x) => (x.odbicie.pionowo = v), false)),
        ),
      ),
      pole(t("panel.przyciecie"), h("div", { class: "boki" }, bok("gora"), bok("dol"), bok("lewo"), bok("prawo")), null, "pole-szerokie"),
    ];
  }

  function zaawansowaneWideo(w: ProfilWideo | null): HTMLElement[] {
    const pola: (HTMLElement | null)[] = [];
    if (w) {
      pola.push(kodekWideo(w), sprzet(w), dziesiecBit(w));
      if (w.rozdzielczosc.typ === "wlasna") pola.push(dopasowanie(w.dopasowanie, (d) => zmien((x) => (x.wideo!.dopasowanie = d)), true));
      if (w.rozdzielczosc.typ !== "zachowaj")
        pola.push(pole(t("panel.nie_powiekszaj"), przelacznik(t("panel.nie_powiekszaj.opis"), w.nie_powiekszaj, (v) => zmien((x) => (x.wideo!.nie_powiekszaj = v), false))));
      pola.push(skaler(w.skaler, (s) => zmien((x) => (x.wideo!.skaler = s))));
    }
    pola.push(ciecie(), napisy());
    pola.push(...geometria());
    pola.push(
      pole(t("panel.deinterlace"), przelacznik(t("panel.deinterlace.opis"), p.deinterlace, (v) => zmien((x) => (x.deinterlace = v), false))),
      pole(t("panel.predkosc"), wybor(PREDKOSCI.map((s) => ({ wartosc: s, etykieta: `${s.toLocaleString()}×` })), p.predkosc, (v) => zmien((x) => (x.predkosc = v)))),
    );
    return pola.filter((x): x is HTMLElement => x !== null);
  }

  function zaawansowaneAudio(a: ProfilAudio | null): HTMLElement[] {
    if (!a) return [];
    return [
      sciezkiAudio(),
      hz(a),
      kanaly(a),
      a.kodek === "kopiuj"
        ? null
        : pole(t("panel.normalizacja"), przelacznik(t("panel.normalizacja.opis"), a.normalizacja, (v) => zmienAudio((x) => (x.normalizacja = v), false))),
    ].filter((x): x is HTMLElement => x !== null);
  }

  // ---------- obrazy ----------

  function suwakJakosci(q: number, ustaw: (v: number) => void): HTMLElement {
    const wartosc = h("output", { class: "suwak-wartosc" }, String(q));
    return h(
      "div",
      { class: "suwak-wiersz" },
      suwak(q, 1, 100, (v) => {
        wartosc.textContent = String(v);
        ustaw(v);
      }, { "aria-label": t("obraz.jakosc") }),
      wartosc,
    );
  }

  function panelObrazu(): HTMLElement[] {
    const ob = p.obraz ?? obrazDomyslny();
    const r = ob.rozmiar;
    const zmienOb = (f: (x: NonNullable<Profil["obraz"]>) => void, przebuduj = true) =>
      zmien((x) => {
        x.obraz = x.obraz ?? obrazDomyslny();
        f(x.obraz);
      }, przebuduj);
    const tryb = segmenty<RozmiarObrazu["typ"]>(
      [
        { wartosc: "zachowaj", etykieta: t("obraz.rozmiar.oryginalny") },
        { wartosc: "wymiary", etykieta: t("obraz.rozmiar.wymiary") },
        { wartosc: "procent", etykieta: t("obraz.rozmiar.procent") },
      ],
      r.typ,
      (typ) => zmienOb((x) => (x.rozmiar = typ === "wymiary" ? { typ, w: 1600, h: null } : typ === "procent" ? { typ, p: 50 } : { typ })),
      t("obraz.rozmiar"),
    );
    let szczegoly: HTMLElement | null = null;
    if (r.typ === "wymiary") {
      szczegoly = h(
        "div",
        { class: "kolumna" },
        h(
          "div",
          { class: "wymiary" },
          liczba(r.w, { min: 1, max: 30000, pusta: true, placeholder: t("obraz.auto"), szerokosc: "6em" }, (v) => zmienOb((x) => ((x.rozmiar as { w: number | null }).w = v))),
          h("span", { class: "razy" }, "×"),
          liczba(r.h, { min: 1, max: 30000, pusta: true, placeholder: t("obraz.auto"), szerokosc: "6em" }, (v) => zmienOb((x) => ((x.rozmiar as { h: number | null }).h = v))),
          h("span", { class: "sufiks" }, "px"),
        ),
        h("div", { class: "pole-pomoc" }, t("obraz.wymiary.pomoc")),
      );
    } else if (r.typ === "procent") {
      szczegoly = liczba(r.p, { min: 1, max: 1000, sufiks: "%", szerokosc: "5.5em" }, (v) => zmienOb((x) => (x.rozmiar = { typ: "procent", p: v ?? 100 }), false), (v) => v && zmienOb((x) => (x.rozmiar = { typ: "procent", p: v }), false));
    }
    const pola: (HTMLElement | null)[] = [
      pole(t("obraz.rozmiar"), h("div", { class: "kolumna" }, tryb, szczegoly), null, "pole-szerokie"),
    ];
    if (r.typ === "wymiary" && r.w && r.h) pola.push(dopasowanie(ob.dopasowanie, (d) => zmienOb((x) => (x.dopasowanie = d)), true));
    if (r.typ !== "zachowaj") pola.push(pole(t("panel.nie_powiekszaj"), przelacznik(t("panel.nie_powiekszaj.opis"), ob.nie_powiekszaj, (v) => zmienOb((x) => (x.nie_powiekszaj = v), false))));
    if (["jpg", "webp", "avif"].includes(p.kontener)) pola.push(pole(t("obraz.jakosc"), suwakJakosci(ob.jakosc, (v) => zmienOb((x) => (x.jakosc = v), false)), p.kontener === "webp" ? t("obraz.jakosc.webp100") : null));
    if (p.kontener === "ico") pola.push(uwaga("info", t("obraz.ico")));
    return pola.filter((x): x is HTMLElement => x !== null);
  }

  // ---------- składanie ----------

  function sekcja(tytul: string | null, pola: HTMLElement[], klasa = ""): HTMLElement | null {
    if (pola.length === 0) return null;
    return h("section", { class: `sekcja ${klasa}`.trim() }, tytul ? h("h3", { class: "sekcja-tytul" }, tytul) : null, h("div", { class: "siatka-pol" }, pola));
  }

  function rysuj(): void {
    const czesci: (HTMLElement | null)[] = [sekcja(null, [chipyFormatu()], "sekcja-formaty")];
    let zaawansowane: (HTMLElement | null)[] = [];

    if (o.tryb === "obraz") {
      czesci.push(sekcja(null, panelObrazu()));
      zaawansowane = [
        sekcja(null, [
          skaler(p.obraz?.skaler ?? "lanczos", (s) => zmien((x) => (x.obraz = { ...(x.obraz ?? obrazDomyslny()), skaler: s }))),
          ...geometria().slice(0, 2),
        ]),
      ];
    } else if (p.kontener === "gif" || (p.kontener === "webp" && p.gif)) {
      if (!p.gif) p.gif = gifDomyslny();
      czesci.push(sekcja(t("panel.animacja"), [...animacja(), ciecie()]));
      zaawansowane = [sekcja(null, [...geometria(), pole(t("panel.predkosc"), wybor(PREDKOSCI.map((s) => ({ wartosc: s, etykieta: `${s.toLocaleString()}×` })), p.predkosc, (v) => zmien((x) => (x.predkosc = v))))])];
    } else if (tylkoAudio(p.kontener)) {
      if (!p.audio) p.audio = audioDomyslne(KODEKI_AUDIO[p.kontener]![0]);
      const a = p.audio;
      czesci.push(sekcja(t("panel.audio"), [kodekAudio(), bitrateAudio(a), hz(a), kanaly(a)].filter((x): x is HTMLElement => !!x)));
      czesci.push(uwagaAac());
      zaawansowane = [sekcja(null, [ciecie(), ...[sciezkiAudio()].filter((x): x is HTMLElement => !!x), ...zaawansowaneAudio(a).filter((x) => x.querySelector(".przelacznik")), pole(t("panel.predkosc"), wybor(PREDKOSCI.map((s) => ({ wartosc: s, etykieta: `${s.toLocaleString()}×` })), p.predkosc, (v) => zmien((x) => (x.predkosc = v))))])];
    } else {
      if (!p.wideo) p.wideo = wideoDomyslne(KODEKI_WIDEO[p.kontener]![0]);
      const w = p.wideo;
      // Kopia strumieni (cięcie bez ponownego kodowania): od–do od razu na wierzchu.
      const podstawowe: (HTMLElement | null)[] = w.kodek === "kopiuj"
        ? [ciecie(), kodekAudio(), p.audio ? bitrateAudio(p.audio) : null]
        : [rozdzielczosc(w), fps(w), jakosc(w), kodekAudio(), p.audio ? bitrateAudio(p.audio) : null];
      czesci.push(sekcja(null, podstawowe.filter((x): x is HTMLElement => !!x)));
      czesci.push(uwagaAac());
      zaawansowane = [
        sekcja(t("panel.sekcja.wideo"), zaawansowaneWideo(w)),
        sekcja(t("panel.sekcja.audio"), zaawansowaneAudio(p.audio)),
      ];
    }

    const szczegoly = h(
      "details",
      { class: "zaawansowane", open: zaawansowaneOtwarte, ontoggle: (e: Event) => (zaawansowaneOtwarte = (e.target as HTMLDetailsElement).open) },
      h("summary", null, t("panel.zaawansowane")),
      h("div", { class: "zaawansowane-tresc" }, zaawansowane),
    );
    el.replaceChildren(...czesci.filter((x): x is HTMLElement => !!x), szczegoly);
  }

  rysuj();
  return {
    el,
    profil: () => sklonuj(p),
    ustaw(nowy: Profil) {
      p = sklonuj(nowy);
      rysuj();
    },
    odswiez: rysuj,
  };
}


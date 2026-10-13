// Porównaj (GUI 2.0, makieta: „Porównaj przed i po”): suwak A/B na tej samej klatce z oryginału i wyniku
// (ffmpeg), liczby przed/po: rozmiar, SSIM, głośność; VMAF tylko gdy ffmpeg ma libvmaf (inaczej kafla nie ma).
import { api } from "../api";
import { h, ikona, zamien } from "../dom";
import { IKONY } from "../ikony";
import { jezyk, t, tekstBledu } from "../i18n";
import { formatujCzas, formatujRozmiar, nazwaPliku } from "../logika";
import { sklep } from "../sklep";
import type { InfoZadania, Metryki, PodgladKlatki } from "../typy";
import { pil } from "./wspolne2";

export interface WidokPorownania {
  el: HTMLElement;
  odswiez(): void;
  /** Otwiera porównanie wyniku zadania (z Gotowe). */
  pokaz(id: number): void;
}

/** Wyniki, które da się porównać: gotowa konwersja z oryginałem obok. */
export function doPorownania(zadania: Iterable<InfoZadania>): InfoZadania[] {
  return [...zadania].filter((z) => z.rodzaj === "konwersja" && z.stan.typ === "gotowe" && !!z.wejscie && !!z.wyjscie).reverse();
}

export type Werdykt = "licze" | "bardzo_dobry" | "dobry" | "widac" | "brak";

/** Werdykt po ludzku z VMAF (gdy jest) albo SSIM (teksty: `porownaj.werdykt.<werdykt>.tytul/.opis`). */
export function werdykt(m: Pick<Metryki, "vmaf" | "ssim"> | null): Werdykt {
  if (!m) return "licze";
  const ocena = (x: number, bardzo: number, dobrze: number): Werdykt => (x >= bardzo ? "bardzo_dobry" : x >= dobrze ? "dobry" : "widac");
  if (m.vmaf !== null) return ocena(m.vmaf, 93, 85);
  if (m.ssim !== null) return ocena(m.ssim, 0.98, 0.95);
  return "brak";
}

/** Momenty klatek do porównania: 10%, 35%, 65% i 90% długości wyniku. */
export function momenty(czas: number | null): number[] {
  if (!czas || czas <= 0) return [0];
  return [0.1, 0.35, 0.65, 0.9].map((u) => Math.round(czas * u * 10) / 10);
}

const lufs = (x: number | null) => (x === null ? "—" : `${x.toLocaleString(jezyk(), { maximumFractionDigits: 1 })} LUFS`);

export function stworzWidokPorownania(): WidokPorownania {
  let wybrany: number | null = null;
  let ab = 50;
  let klatka = 1;
  let czasy: number[] = [];
  let obraz: PodgladKlatki | null = null;
  let metryki: Metryki | null = null;
  let blad: string | null = null;
  let maObraz = true;
  let pokolenie = 0;

  const el = h("div", { class: "v2 ekran-2", "data-ekran": "porownaj" });
  const lewa = h("div", { class: "l" });
  const prawa = h("aside", { class: "panel2c", "aria-label": t("porownaj.werdykt") });
  el.append(lewa, prawa);

  const zadanie = () => (wybrany !== null ? sklep.stan.zadania.get(wybrany) ?? null : null);

  async function wczytaj() {
    const z = zadanie();
    if (!z?.wejscie || !z.wyjscie) return;
    const moje = ++pokolenie;
    obraz = null;
    metryki = null;
    blad = null;
    rysuj();
    try {
      const m = await api.sonda(z.wyjscie);
      if (moje !== pokolenie) return;
      maObraz = !!m.wideo && !m.obraz;
      czasy = momenty(m.czas_s);
      klatka = Math.min(klatka, czasy.length - 1);
      rysuj();
      const [k, me] = await Promise.all([maObraz ? api.porownajKlatke(z.wejscie, z.wyjscie, czasy[klatka] ?? 0) : Promise.resolve(null), api.porownajMetryki(z.wejscie, z.wyjscie)]);
      if (moje !== pokolenie) return;
      obraz = k;
      metryki = me;
    } catch (e) {
      if (moje !== pokolenie) return;
      blad = tekstBledu(e);
    }
    rysuj();
  }

  async function zmienKlatke(i: number) {
    const z = zadanie();
    if (!z?.wejscie || !z.wyjscie) return;
    klatka = i;
    const moje = ++pokolenie;
    rysuj();
    try {
      const k = await api.porownajKlatke(z.wejscie, z.wyjscie, czasy[i] ?? 0);
      if (moje === pokolenie) obraz = k;
    } catch (e) {
      blad = tekstBledu(e);
    }
    rysuj();
  }

  function rysuj() {
    const lista = doPorownania(sklep.stan.zadania.values());
    if (wybrany === null || !lista.some((z) => z.id === wybrany)) {
      const pierwszy = lista[0]?.id ?? null;
      if (pierwszy !== wybrany) {
        wybrany = pierwszy;
        if (wybrany !== null) return void wczytaj();
      }
    }
    const z = zadanie();
    const fokus = document.activeElement instanceof HTMLElement && el.contains(document.activeElement) ? document.activeElement.dataset.fokus : undefined;
    zamien(
      lewa,
      h("div", { class: "naglowek2" }, h("h2", { class: "tytul-ekr" }, t("porownaj.tytul")), z ? h("span", { class: "opis tnij", title: z.wyjscie ?? "" }, nazwaPliku(z.wejscie ?? ""), " → ", nazwaPliku(z.wyjscie ?? "")) : null),
      ...(z ? tresc(z) : [h("div", { class: "pusto2" }, ikona(IKONY.porownaj, "ikona"), h("b", null, t("porownaj.pusto")), h("span", null, t("porownaj.pusto.pomoc")))]),
      lista.length > 1
        ? h("div", { class: "sekcja-g" }, h("h2", null, t("porownaj.inne")))
        : null,
      lista.length > 1
        ? h("div", { class: "wiersz-zawijany", role: "group", "aria-label": t("porownaj.inne") },
            lista.slice(0, 12).map((x) => pil(nazwaPliku(x.wyjscie ?? ""), x.id === wybrany, () => ((wybrany = x.id), void wczytaj()), { "data-fokus": `wynik-${x.id}`, title: x.wyjscie ?? "" })))
        : null,
    );
    rysujPanel(z);
    if (fokus) el.querySelector<HTMLElement>(`[data-fokus="${fokus}"]`)?.focus();
  }

  function tresc(z: InfoZadania): (HTMLElement | null)[] {
    const suwak = h("input", { type: "range", min: "0", max: "100", value: String(ab), "aria-label": t("porownaj.suwak"), "data-fokus": "ab" }) as HTMLInputElement;
    const scena = h(
      "div",
      { class: "ab", style: { "--x": `${ab}%` } as unknown as Record<string, string> },
      obraz ? h("img", { src: obraz.przed, alt: t("porownaj.oryginal") }) : null,
      obraz ? h("img", { src: obraz.po, alt: t("porownaj.wynik"), class: "po-ab" }) : null,
      h("span", { class: "linia" }),
      h("span", { class: "et", style: { left: "10px" } }, t("porownaj.oryginal"), z.rozmiar_wejscia ? ` · ${formatujRozmiar(z.rozmiar_wejscia, jezyk())}` : ""),
      h("span", { class: "et", style: { right: "10px" } }, t("porownaj.wynik"), z.rozmiar_wyniku ? ` · ${formatujRozmiar(z.rozmiar_wyniku, jezyk())}` : ""),
      suwak,
    );
    scena.style.setProperty("--x", `${ab}%`);
    suwak.addEventListener("input", () => {
      ab = Number(suwak.value);
      scena.style.setProperty("--x", `${ab}%`);
    });
    const kafle: HTMLElement[] = [];
    if (z.rozmiar_wejscia && z.rozmiar_wyniku) {
      const proc = Math.round((1 - z.rozmiar_wyniku / z.rozmiar_wejscia) * 100);
      kafle.push(h("div", { class: "metryka" }, t("porownaj.rozmiar"), h("b", null, proc >= 0 ? `−${proc}%` : `+${-proc}%`), `${formatujRozmiar(z.rozmiar_wejscia, jezyk())} → ${formatujRozmiar(z.rozmiar_wyniku, jezyk())}`));
    }
    // VMAF tylko, gdy ffmpeg ma libvmaf i policzył wynik: inaczej kafla nie ma wcale
    if (metryki?.vmaf != null) kafle.push(h("div", { class: "metryka", "data-metryka": "vmaf" }, t("porownaj.vmaf"), h("b", null, metryki.vmaf.toLocaleString(jezyk(), { maximumFractionDigits: 1 })), t("porownaj.vmaf.opis")));
    if (metryki?.ssim != null) kafle.push(h("div", { class: "metryka", "data-metryka": "ssim" }, t("porownaj.ssim"), h("b", null, metryki.ssim.toLocaleString(jezyk(), { minimumFractionDigits: 3, maximumFractionDigits: 3 })), t("porownaj.ssim.opis")));
    if (metryki && (metryki.lufs_przed !== null || metryki.lufs_po !== null)) kafle.push(h("div", { class: "metryka", "data-metryka": "lufs" }, t("porownaj.glosnosc"), h("b", null, lufs(metryki.lufs_po)), t("porownaj.bylo", { v: lufs(metryki.lufs_przed) })));
    return [
      maObraz ? scena : h("div", { class: "baner ak" }, ikona(IKONY.nuta, "ikona ic m"), h("span", null, t("porownaj.tylko_dzwiek"))),
      maObraz && czasy.length > 1
        ? h(
            "div",
            { class: "wiersz-zawijany" },
            h("span", { class: "tx3", style: { fontSize: "12px" } }, t("porownaj.klatka")),
            czasy.map((c, i) => pil(formatujCzas(Math.round(c)), i === klatka, () => void zmienKlatke(i), { "data-fokus": `klatka-${i}` })),
            h("span", { class: "tx3", style: { fontSize: "12px", marginLeft: "auto" } }, t("porownaj.przeciagnij")),
          )
        : null,
      blad ? h("div", { class: "baner zle" }, ikona(IKONY.uwaga, "ikona ic m"), h("span", null, blad.split("\n")[0])) : null,
      h("div", { class: "metryki", "aria-live": "polite" }, kafle),
      metryki ? h("small", { class: "tx3" }, t("porownaj.analiza", { s: Math.round(metryki.analiza_s) })) : null,
    ];
  }

  function rysujPanel(z: InfoZadania | null) {
    const w = z ? werdykt(metryki) : "brak";
    prawa.replaceChildren(
      h("div", { class: "panel-g" }, h("span", { class: "etyk-s" }, t("porownaj.werdykt")), h("h3", null, t(`porownaj.werdykt.${w}.tytul`))),
      h(
        "div",
        { class: "panel-s" },
        h("p", { class: "tx3", style: { margin: "0", fontSize: "13px" } }, t(`porownaj.werdykt.${w}.opis`)),
        z?.wyjscie ? h("div", { class: "wiersz-op" }, h("span", null, t("porownaj.wynik")), h("span", { class: "mono tnij", title: z.wyjscie }, nazwaPliku(z.wyjscie))) : null,
        z?.wejscie ? h("div", { class: "wiersz-op" }, h("span", null, t("porownaj.oryginal")), h("span", { class: "mono tnij", title: z.wejscie }, nazwaPliku(z.wejscie))) : null,
      ),
      h(
        "div",
        { class: "panel-d" },
        z?.wyjscie ? h("button", { type: "button", class: "btn", "data-fokus": "pokaz", onclick: () => void api.pokazWFolderze(z.wyjscie!) }, ikona(IKONY.folder, "ikona ic m"), t("folder.pokaz")) : null,
      ),
    );
  }

  let ostatnie = sklep.stan.zadania;
  sklep.subskrybuj((s) => {
    if (s.zadania === ostatnie) return;
    const bylo = doPorownania(ostatnie.values()).length;
    ostatnie = s.zadania;
    if (doPorownania(s.zadania.values()).length !== bylo && el.isConnected) rysuj();
  });

  rysuj();
  return {
    el,
    odswiez: rysuj,
    pokaz(id: number) {
      wybrany = id;
      void wczytaj();
    },
  };
}

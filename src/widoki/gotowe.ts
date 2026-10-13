// Gotowe (GUI 2.0, makieta: „Gotowe”): wyniki z „% oryginału”, zaoszczędzone miejsce, „Pokaż w folderze”,
// przeciągnięcie pliku do innej apki (mail, komunikator, folder) za uchwyt. Też to, co w toku i błędy.
import { api } from "../api";
import { h, ikona, zamien } from "../dom";
import { IKONY } from "../ikony";
import { jezyk, rozdzielBlad, t } from "../i18n";
import { formatujEta, formatujRozmiar, nazwaPliku, rozszerzenie } from "../logika";
import { sklep } from "../sklep";
import type { InfoZadania } from "../typy";

export interface WidokGotowe {
  el: HTMLElement;
  odswiez(): void;
}

/** „% oryginału” (zaokrąglone, min. 1 dla niezerowych). `null` = nie da się policzyć. */
export function procentOryginalu(przed: number | null | undefined, po: number | null | undefined): number | null {
  if (!przed || !po) return null;
  return Math.max(1, Math.round((po / przed) * 100));
}

/** Zaoszczędzone miejsce: suma (przed − po) tylko tam, gdzie wynik jest mniejszy. */
export function zaoszczedzone(zadania: InfoZadania[]): number {
  return zadania.reduce((s, z) => (z.stan.typ === "gotowe" && z.rozmiar_wejscia && z.rozmiar_wyniku && z.rozmiar_wyniku < z.rozmiar_wejscia ? s + z.rozmiar_wejscia - z.rozmiar_wyniku : s), 0);
}

const AUDIO = ["mp3", "m4a", "aac", "opus", "ogg", "flac", "wav"];
const OBRAZ = ["png", "jpg", "jpeg", "webp", "avif", "bmp", "ico", "gif", "srt", "vtt"];

export function stworzWidokGotowe(o: { porownaj: (id: number) => void }): WidokGotowe {
  const el = h("div", { class: "v2 ekran-1", "data-ekran": "gotowe" });

  /** Przeciąganie systemowe startuje po ruchu o kilka pikseli z wciśniętym przyciskiem (inaczej to klik). */
  function uchwyt(sciezka: string): HTMLElement {
    const u = h("span", { class: "uchwyt", role: "button", tabindex: "-1", title: t("gotowe.przeciagnij"), "aria-label": t("gotowe.przeciagnij") }, ikona(IKONY.uchwyt, "ikona ic m"));
    let start: { x: number; y: number } | null = null;
    u.addEventListener("pointerdown", (e) => (start = { x: e.clientX, y: e.clientY }));
    u.addEventListener("pointermove", (e) => {
      if (!start || e.buttons !== 1) return;
      if (Math.hypot(e.clientX - start.x, e.clientY - start.y) < 4) return;
      start = null;
      void api.przeciagnijWynik(sciezka).catch(() => undefined);
    });
    u.addEventListener("pointerup", () => (start = null));
    return u;
  }

  function wiersz(z: InfoZadania): HTMLElement {
    const wyjscie = z.stan.typ === "gotowe" ? z.stan.wyjscie : z.wyjscie;
    const ext = wyjscie ? rozszerzenie(wyjscie) : "";
    const ik = z.rodzaj === "sciezki" ? IKONY.warstwy : z.rodzaj === "napisy" ? IKONY.napisy : AUDIO.includes(ext) ? IKONY.nuta : OBRAZ.includes(ext) ? IKONY.obrazy : IKONY.film;
    const pc = procentOryginalu(z.rozmiar_wejscia, z.rozmiar_wyniku);
    const postep = sklep.stan.postepy.get(z.id);
    let meta = "";
    if (z.stan.typ === "gotowe") {
      const czesci = [pc !== null ? t("gotowe.procent", { p: pc }) : null, z.wyniki?.length ? t("gotowe.pliki_n", { n: z.wyniki.length }) : null, z.bez_kodowania ? t("gotowe.bez_kodowania") : null, z.awaria_sprzetu ? t("gotowe.awaria_sprzetu") : null];
      meta = czesci.filter(Boolean).join(" · ") || t("gotowe.gotowe");
    } else if (z.stan.typ === "trwa") meta = t("gotowe.trwa", { p: Math.floor(postep?.procent ?? z.procent), eta: postep?.eta_s ? formatujEta(postep.eta_s) : "…" });
    else if (z.stan.typ === "oczekuje") meta = t("gotowe.czeka");
    else if (z.stan.typ === "anulowane") meta = t("gotowe.anulowane");
    else if (z.stan.typ === "pominiete") meta = t("gotowe.pominiete");
    const bladTekst = z.stan.typ === "blad" ? rozdzielBlad(z.stan.komunikat) : null;
    return h(
      "div",
      { class: "wynik2", "data-zadanie": String(z.id) },
      wyjscie && z.stan.typ === "gotowe" ? uchwyt(wyjscie) : h("span"),
      h("span", { class: "min", style: { background: "linear-gradient(135deg,#22223b,#c9184a)" } }, ikona(ik, "ikona ic d")),
      h(
        "div",
        { style: { minWidth: "0" } },
        h("span", { class: "nazwa", title: wyjscie ?? z.nazwa }, wyjscie ? nazwaPliku(wyjscie) : z.nazwa),
        bladTekst ? h("span", { class: "meta zle", title: bladTekst.szczegoly ?? "" }, bladTekst.tekst.split("\n")[0]) : h("span", { class: "meta" }, meta),
      ),
      pc !== null && z.stan.typ === "gotowe"
        ? h(
            "div",
            { class: "por", "aria-label": t("gotowe.procent", { p: pc }) },
            h("div", null, h("i", { style: { width: "100%" } }), formatujRozmiar(z.rozmiar_wejscia, jezyk())),
            h("div", null, h("i", { class: "po", style: { width: `${Math.min(100, Math.max(2, pc))}%` } }), formatujRozmiar(z.rozmiar_wyniku, jezyk())),
          )
        : h("div", { class: "por" }),
      h(
        "div",
        { class: "akcje" },
        z.stan.typ === "gotowe" && z.rodzaj === "konwersja" && z.wejscie
          ? h("button", { type: "button", class: "btn cichy maly", title: t("gotowe.porownaj"), onclick: () => o.porownaj(z.id) }, ikona(IKONY.porownaj, "ikona ic m"))
          : null,
        wyjscie && z.stan.typ === "gotowe"
          ? h("button", { type: "button", class: "btn maly", onclick: () => void api.pokazWFolderze(wyjscie) }, ikona(IKONY.folder, "ikona ic m"), t("gotowe.pokaz"))
          : null,
        z.stan.typ === "trwa" || z.stan.typ === "oczekuje"
          ? h("button", { type: "button", class: "btn cichy maly", onclick: () => void api.anulujZadanie(z.id) }, t("gotowe.anuluj"))
          : null,
      ),
    );
  }

  function rysuj() {
    const wszystkie = [...sklep.stan.zadania.values()].reverse();
    const gotowe = wszystkie.filter((z) => z.stan.typ === "gotowe");
    const wToku = wszystkie.filter((z) => z.stan.typ === "trwa" || z.stan.typ === "oczekuje");
    const inne = wszystkie.filter((z) => !gotowe.includes(z) && !wToku.includes(z));
    const oszcz = zaoszczedzone(gotowe);
    zamien(
      el,
      h(
        "div",
        { class: "gotowe-g" },
        h("div", { style: { minWidth: "0" } }, h("h2", { class: "tytul-ekr" }, t("zakladka.gotowe")), h("div", { class: "tx3", style: { fontSize: "13px", marginTop: "4px" } }, t("gotowe.podtytul", { n: gotowe.length }))),
        h("div", { style: { marginLeft: "auto", textAlign: "right" } }, h("div", { class: "etyk-s", style: { marginBottom: "6px" } }, t("gotowe.zaoszczedzone")), h("span", { class: "lcd" }, formatujRozmiar(oszcz, jezyk()))),
      ),
      ...(wszystkie.length === 0 ? [h("div", { class: "pusto2" }, ikona(IKONY.gotowe, "ikona"), h("b", null, t("gotowe.pusto")), h("span", null, t("gotowe.pusto.pomoc")))] : []),
      wToku.length ? h("div", { class: "sekcja-g" }, h("h2", null, t("gotowe.w_toku")), h("span", null, String(wToku.length))) : null,
      ...wToku.map(wiersz),
      gotowe.length ? h("div", { class: "sekcja-g" }, h("h2", null, t("gotowe.wyniki")), h("span", null, String(gotowe.length))) : null,
      ...gotowe.map(wiersz),
      inne.length ? h("div", { class: "sekcja-g" }, h("h2", null, t("gotowe.inne")), h("span", null, String(inne.length))) : null,
      ...inne.map(wiersz),
      gotowe.length ? h("div", { class: "baner ak" }, ikona(IKONY.iskra, "ikona ic m"), h("span", null, t("gotowe.wskazowka"))) : null,
      gotowe.length || inne.length
        ? h("div", null, h("button", { type: "button", class: "btn cichy", onclick: () => void api.wyczyscZakonczone().then(() => api.listaZadan()).then((l) => sklep.ustaw({ zadania: new Map(l.map((z) => [z.id, z])) })) }, ikona(IKONY.kosz, "ikona ic m"), t("gotowe.wyczysc")))
        : null,
    );
  }

  let ostatnie = sklep.stan.zadania;
  let ostatniePostepy = sklep.stan.postepy;
  sklep.subskrybuj((s) => {
    if (s.zadania === ostatnie && s.postepy === ostatniePostepy) return;
    ostatnie = s.zadania;
    ostatniePostepy = s.postepy;
    if (el.isConnected) rysuj();
  });
  rysuj();
  return { el, odswiez: rysuj };
}

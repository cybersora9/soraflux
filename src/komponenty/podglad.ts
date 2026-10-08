// Podgląd przed/po (punkt 4.1): jedna klatka wyniku z tym samym łańcuchem filtrów,
// z wybranego suwakiem momentu, porównanie suwakiem dzielącym obraz. Przy audio:
// odsłuch 5 s wyniku z dokładnie tymi ustawieniami (np. AAC 8 kb/s).
import { api } from "../api";
import { debounce, h, ikona } from "../dom";
import { IKONY } from "../ikony";
import { t } from "../i18n";
import { formatujCzas, tylkoAudio } from "../logika";
import type { Media, Profil } from "../typy";
import { przycisk } from "./pola";

export interface OpcjePodgladu {
  plik: () => { sciezka: string; media: Media } | null;
  profil: () => Profil;
}

export function podgladPrzedPo(o: OpcjePodgladu): { el: HTMLElement; odswiez(): void } {
  let otwarty = false;
  let czas: number | null = null;
  let podzial = 50;
  let licznik = 0;
  let audio: HTMLAudioElement | null = null;
  const el = h("details", { class: "podglad" });
  const tresc = h("div", { class: "podglad-tresc" });
  const stan = h("p", { class: "pole-pomoc", "aria-live": "polite" });

  const zaladuj = debounce(async () => {
    const p = o.plik();
    if (!otwarty || !p) return;
    const profil = o.profil();
    if (tylkoAudio(profil.kontener) || !p.media.wideo) return;
    const nr = ++licznik;
    stan.textContent = t("podglad.licze");
    try {
      const k = await api.podgladKlatki(p.sciezka, p.media, profil, czas);
      if (nr !== licznik) return;
      czas = k.czas_s;
      rysujObrazy(k.przed, k.po);
      stan.textContent = "";
    } catch (e) {
      if (nr === licznik) stan.textContent = t("podglad.blad", { blad: String(e) });
    }
  }, 500);

  const obrazy = h("div", { class: "porownanie", style: { "--podzial": `${podzial}%` } });
  function rysujObrazy(przed: string, po: string) {
    const suwakPodzialu = h("input", {
      type: "range", min: 0, max: 100, value: String(podzial), class: "porownanie-suwak", "aria-label": t("podglad.podzial"),
    });
    suwakPodzialu.addEventListener("input", () => {
      podzial = Number(suwakPodzialu.value);
      obrazy.style.setProperty("--podzial", `${podzial}%`);
    });
    obrazy.replaceChildren(
      h("img", { class: "porownanie-przed", src: przed, alt: t("podglad.przed") }),
      h("img", { class: "porownanie-po", src: po, alt: t("podglad.po") }),
      h("span", { class: "porownanie-etykieta lewa" }, t("podglad.przed")),
      h("span", { class: "porownanie-etykieta prawa" }, t("podglad.po")),
      h("div", { class: "porownanie-linia", "aria-hidden": "true" }),
      suwakPodzialu,
    );
  }

  function rysuj() {
    const p = o.plik();
    const profil = o.profil();
    const czasPliku = p?.media.czas_s ?? null;
    if (!p) {
      tresc.replaceChildren(h("p", { class: "pole-pomoc" }, t("podglad.brak_pliku")));
      return;
    }
    if (tylkoAudio(profil.kontener) || !p.media.wideo) {
      const od = h("input", { type: "range", class: "suwak", min: 0, max: Math.max(0, Math.floor((czasPliku ?? 5) - 5)), value: String(Math.floor(czas ?? 0)), "aria-label": t("podglad.moment") });
      const opis = h("output", { class: "suwak-wartosc" }, formatujCzas(czas ?? 0));
      od.addEventListener("input", () => ((czas = Number(od.value)), (opis.textContent = formatujCzas(czas))));
      tresc.replaceChildren(
        h("div", { class: "suwak-wiersz" }, od, opis),
        przycisk([ikona(IKONY.nuta), t("podglad.odsluchaj")], async () => {
          stan.textContent = t("podglad.licze");
          try {
            const url = await api.odsluch(p.sciezka, p.media, o.profil(), czas ?? 0);
            audio?.pause();
            audio = new Audio(url);
            await audio.play().catch(() => undefined);
            stan.textContent = t("podglad.gra");
          } catch (e) {
            stan.textContent = t("podglad.blad", { blad: String(e) });
          }
        }, "przycisk-maly"),
        stan,
      );
      return;
    }
    const moment = czasPliku && !p.media.obraz
      ? (() => {
          const s = h("input", { type: "range", class: "suwak", min: 0, max: Math.floor(czasPliku * 10), value: String(Math.floor((czas ?? czasPliku / 3) * 10)), "aria-label": t("podglad.moment") });
          const opis = h("output", { class: "suwak-wartosc" }, formatujCzas(czas ?? czasPliku / 3));
          s.addEventListener("input", () => {
            czas = Number(s.value) / 10;
            opis.textContent = formatujCzas(czas);
            zaladuj();
          });
          return h("div", { class: "suwak-wiersz" }, s, opis);
        })()
      : null;
    tresc.replaceChildren(obrazy, moment ?? "", stan);
    zaladuj();
  }

  el.append(h("summary", null, t("podglad.tytul")), tresc);
  el.addEventListener("toggle", () => {
    otwarty = el.open;
    if (otwarty) rysuj();
    else audio?.pause();
  });
  return {
    el,
    odswiez() {
      if (otwarty) rysuj();
    },
  };
}

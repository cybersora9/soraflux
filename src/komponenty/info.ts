// Karta informacji o pliku (punkt 4.5): czytelnie to, co zwrócił ffprobe.
import { h } from "../dom";
import { t } from "../i18n";
import { nazwaPliku, wierszeInformacji } from "../logika";
import type { Media } from "../typy";

export function kartaInformacji(sciezka: string, m: Media): HTMLElement {
  const wiersze = wierszeInformacji(m).map(([klucz, wartosc]) => {
    const [k, n] = klucz.split(":");
    return h("div", { class: "info-wiersz" }, h("dt", null, n ? t(k, { n }) : t(k)), h("dd", null, wartosc));
  });
  return h(
    "section",
    { class: "karta info", "aria-label": t("info.tytul") },
    h("h3", { class: "info-tytul", title: sciezka }, nazwaPliku(sciezka)),
    h("dl", { class: "info-lista" }, wiersze),
  );
}

// Kreator pierwszego uruchomienia: co jest, czego brakuje, pobieranie jednym kliknięciem.
import { api } from "../api";
import { h } from "../dom";
import { t } from "../i18n";
import { przycisk, uwaga } from "../komponenty/pola";
import { brakujacePakiety, listaNarzedzi, pobierzPakiet } from "../komponenty/narzedzia";
import { sklep } from "../sklep";

export function pokazKreator(): void {
  if (document.querySelector(".kreator-tlo")) return;
  let pobieranie = false;
  const lista = listaNarzedzi();
  const stopka = h("div", { class: "kreator-stopka" });

  const zamknij = async () => {
    if (sklep.stan.konfig) {
      const konfig = { ...sklep.stan.konfig, kreator_zakonczony: true };
      await api.konfigZapisz(konfig);
      sklep.ustaw({ konfig });
    }
    tlo.remove();
  };

  const rysujStopke = () => {
    const brak = brakujacePakiety();
    const przyciski: (HTMLElement | null)[] = [
      przycisk(t(brak.length ? "kreator.pozniej" : "kreator.gotowe"), () => void zamknij(), brak.length ? "przycisk-drugorzedny" : "przycisk-glowny"),
      brak.length
        ? przycisk(t(pobieranie ? "kreator.pobieram" : "kreator.pobierz_brakujace"), async () => {
            pobieranie = true;
            rysujStopke();
            for (const p of brak) await pobierzPakiet(p);
            pobieranie = false;
            rysujStopke();
          }, "przycisk-glowny", { disabled: pobieranie })
        : null,
    ];
    stopka.replaceChildren(...przyciski.filter((x): x is HTMLElement => x !== null));
  };

  const okno = h(
    "div",
    { class: "karta kreator", role: "dialog", "aria-modal": "true", "aria-labelledby": "kreator-tytul" },
    h("h2", { id: "kreator-tytul" }, t("kreator.tytul")),
    h("p", null, t("kreator.opis")),
    lista,
    uwaga("info", h("span", null, t("kreator.zrodla"))),
    stopka,
  );
  const tlo = h("div", { class: "kreator-tlo" }, okno);
  document.body.append(tlo);
  rysujStopke();
  let ostatnie = sklep.stan.narzedzia;
  sklep.subskrybuj((s) => {
    if (s.narzedzia !== ostatnie) {
      ostatnie = s.narzedzia;
      if (!pobieranie) rysujStopke();
    }
  });
}

// Zakładka Ustawienia: język, motyw, równoległość, folder wyników, narzędzia, enkodery.
import { api } from "../api";
import { h, ikona } from "../dom";
import { IKONY } from "../ikony";
import { t } from "../i18n";
import { liczba, pole, przelacznik, przycisk, segmenty, wybor } from "../komponenty/pola";
import { listaNarzedzi, odswiezNarzedzia } from "../komponenty/narzedzia";
import { folderWyjscia } from "../komponenty/wspolne";
import { sekcjaMotywow } from "../komponenty/wyglad";
import { pokazDymek, sklep, trybApki } from "../sklep";
import { ustawTryb } from "../tryb";
import { sprawdzAktualizacje } from "../aktualizacje";
import type { Konfig } from "../typy";

const PROGRAMOWE = ["libx264", "libx265", "libsvtav1", "libaom-av1", "libvpx-vp9", "mpeg4", "aac", "libmp3lame", "libopus", "libvorbis", "flac", "libwebp", "png", "mjpeg", "gif"];

async function zapisz(zmiana: Partial<Konfig>): Promise<void> {
  if (!sklep.stan.konfig) return;
  const konfig = { ...sklep.stan.konfig, ...zmiana };
  await api.konfigZapisz(konfig);
  sklep.ustaw({ konfig });
}

export function stworzWidokUstawien(): { el: HTMLElement; odswiez(): void } {
  const el = h("div", { class: "widok widok-ustawienia" });
  const narzedzia = listaNarzedzi();
  let wersja = "";
  void api.wersjaApki().then((v) => ((wersja = v), rysuj()));

  function rysuj() {
    const k = sklep.stan.konfig;
    const n = sklep.stan.narzedzia;
    if (!k) return;
    const enkodery = n ? PROGRAMOWE.filter((e) => n.enkodery.includes(e)) : [];
    el.replaceChildren(
      h("header", { class: "naglowek" }, h("div", null, h("h1", null, t("zakladka.ustawienia")), h("p", { class: "podtytul" }, t("ustawienia.podtytul")))),
      h(
        "div",
        { class: "ustawienia" },
        h(
          "section",
          { class: "karta ustawienia-karta ustawienia-tryb" },
          h("h2", null, t("tryb.etykieta")),
          segmenty(
            [
              { wartosc: "prosty", etykieta: t("tryb.prosty") },
              { wartosc: "pelny", etykieta: t("tryb.pelny") },
            ],
            trybApki(),
            (v) => void ustawTryb(v),
            t("tryb.etykieta"),
          ),
          h("p", { class: "pole-pomoc" }, t("tryb.pomoc")),
        ),
        h(
          "section",
          { class: "karta ustawienia-karta" },
          h("h2", null, t("ustawienia.wyglad")),
          h(
            "div",
            { class: "siatka-pol" },
            pole(
              t("ustawienia.jezyk"),
              wybor<Konfig["jezyk"]>(
                [
                  { wartosc: null, etykieta: t("ustawienia.jezyk.auto") },
                  { wartosc: "pl", etykieta: "Polski" },
                  { wartosc: "en", etykieta: "English" },
                ],
                k.jezyk,
                (v) => void zapisz({ jezyk: v }),
              ),
            ),
            pole(
              t("ustawienia.motyw"),
              wybor<Konfig["motyw"]>(
                [
                  { wartosc: "dark", etykieta: t("ustawienia.motyw.ciemny") },
                  { wartosc: "light", etykieta: t("ustawienia.motyw.jasny") },
                  { wartosc: "system", etykieta: t("ustawienia.motyw.system") },
                ],
                k.motyw,
                (v) => void zapisz({ motyw: v }),
              ),
            ),
          ),
          sekcjaMotywow(),
        ),
        h(
          "section",
          { class: "karta ustawienia-karta" },
          h("h2", null, t("ustawienia.praca")),
          h(
            "div",
            { class: "siatka-pol" },
            pole(t("ustawienia.rownolegle"), liczba(k.rownolegle, { min: 1, max: 8, szerokosc: "5em" }, (v) => v && void zapisz({ rownolegle: v })), t("ustawienia.rownolegle.pomoc")),
            pole(t("ustawienia.rownolegle_wideo"), liczba(k.rownolegle_wideo, { min: 1, max: 8, szerokosc: "5em" }, (v) => v && void zapisz({ rownolegle_wideo: v })), t("ustawienia.rownolegle_wideo.pomoc")),
            pole(t("ustawienia.priorytet"), przelacznik(t("ustawienia.priorytet.opis"), k.niski_priorytet, (v) => void zapisz({ niski_priorytet: v }))),
            pole(t("ustawienia.schowek"), przelacznik(t("ustawienia.schowek.opis"), k.schowek, (v) => void zapisz({ schowek: v }))),
          ),
          h("div", { class: "kolumna" }, h("span", { class: "pole-etykieta" }, t("ustawienia.folder_konwersji")), folderWyjscia("katalog_wyjscia")),
          h("div", { class: "kolumna" }, h("span", { class: "pole-etykieta" }, t("ustawienia.folder_pobierania")), folderWyjscia("katalog_pobierania")),
        ),
        h(
          "section",
          { class: "karta ustawienia-karta" },
          h("div", { class: "wiersz wiersz-rozsuniety" }, h("h2", null, t("ustawienia.narzedzia")), przycisk([ikona(IKONY.odswiez), t("narzedzia.wykryj")], () => void odswiezNarzedzia(), "przycisk-maly przycisk-drugorzedny")),
          h("p", { class: "pole-pomoc" }, t("ustawienia.narzedzia.pomoc"), n?.katalog ? h("code", null, ` ${n.katalog}`) : null),
          n?.przenosny ? h("p", { class: "pole-pomoc" }, t("ustawienia.przenosny")) : null,
          narzedzia,
        ),
        h(
          "section",
          { class: "karta ustawienia-karta" },
          h("h2", null, t("ustawienia.enkodery")),
          n?.sprzet.length
            ? h("div", { class: "chipy-enkoderow" }, n.sprzet.map((e) => h("span", { class: "chip-enkoder sprzet" }, e)))
            : h("p", { class: "pole-pomoc" }, t("ustawienia.enkodery.brak_sprzetu")),
          h("div", { class: "chipy-enkoderow" }, enkodery.map((e) => h("span", { class: "chip-enkoder" }, e))),
        ),
        h(
          "section",
          { class: "karta ustawienia-karta" },
          h("h2", null, t("ustawienia.prywatnosc")),
          h("p", null, t("ustawienia.prywatnosc.opis")),
          h(
            "div",
            { class: "wiersz" },
            przycisk([ikona(IKONY.odswiez), t("aktualizacje.sprawdz")], () => void sprawdzAktualizacje(true), "przycisk-maly przycisk-drugorzedny"),
            przycisk([ikona(IKONY.kopiuj), t("raport.kopiuj")], async () => {
              await api.piszSchowek(await api.raport());
              pokazDymek(t("raport.skopiowano"));
            }, "przycisk-maly przycisk-drugorzedny"),
          ),
          h("p", { class: "pole-pomoc" }, t("raport.opis")),
          h("p", { class: "pole-pomoc" }, `SoraFlux ${wersja} · MIT · ${t("ustawienia.licencje")}`),
        ),
      ),
    );
  }

  let ostatnie = [sklep.stan.konfig, sklep.stan.narzedzia] as const;
  sklep.subskrybuj((s) => {
    if (s.konfig !== ostatnie[0] || s.narzedzia !== ostatnie[1]) {
      ostatnie = [s.konfig, s.narzedzia];
      rysuj();
    }
  });
  rysuj();
  return { el, odswiez: rysuj };
}

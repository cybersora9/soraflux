// Lista narzędzi (ffmpeg, ffprobe, yt-dlp, deno): stan, wersja, wskaż, pobierz.
// Używana w Ustawieniach i w kreatorze pierwszego uruchomienia.
import { api } from "../api";
import { h, ikona } from "../dom";
import { IKONY } from "../ikony";
import { jezyk, t, tekstBledu } from "../i18n";
import { formatujRozmiar, sciezkaDoPokazania } from "../logika";
import { pokazDymek, sklep } from "../sklep";
import type { Narzedzie, Pakiet } from "../typy";
import { przycisk } from "./pola";

const NARZEDZIA: Narzedzie[] = ["ffmpeg", "ffprobe", "ytdlp", "deno"];
const PAKIET: Record<Narzedzie, Pakiet> = { ffmpeg: "ffmpeg", ffprobe: "ffmpeg", ytdlp: "ytdlp", deno: "deno" };
const NAZWA: Record<Narzedzie, string> = { ffmpeg: "ffmpeg", ffprobe: "ffprobe", ytdlp: "yt-dlp", deno: "Deno" };

const postep = new Map<Pakiet, { pobrane: number; calosc: number | null }>();
const sluchacze = new Set<() => void>();
api.naPostepNarzedzi((p) => {
  postep.set(p.pakiet, { pobrane: p.pobrane, calosc: p.calosc });
  sluchacze.forEach((f) => f());
});

export async function odswiezNarzedzia(): Promise<void> {
  await api.narzedziaWykryj();
  sklep.ustaw({ narzedzia: await api.narzedziaStan() });
}

export async function pobierzPakiet(p: Pakiet): Promise<void> {
  postep.set(p, { pobrane: 0, calosc: null });
  sluchacze.forEach((f) => f());
  try {
    await api.narzedziaPobierz(p);
    pokazDymek(t("narzedzia.zainstalowano", { nazwa: p === "ytdlp" ? "yt-dlp" : p }));
  } catch (e) {
    pokazDymek(tekstBledu(e), "blad");
  } finally {
    postep.delete(p);
    sklep.ustaw({ narzedzia: await api.narzedziaStan() });
  }
}

export function brakujacePakiety(): Pakiet[] {
  const n = sklep.stan.narzedzia;
  if (!n) return [];
  const brak = new Set<Pakiet>();
  // Kreator: tylko to, bez czego konwersja nie ruszy (yt-dlp i Deno doinstalowuje zakładka Pobierz).
  for (const x of ["ffmpeg", "ffprobe"] as const) if (!n.sciezki[x]) brak.add(PAKIET[x]);
  return [...brak].filter((p) => n.do_pobrania.includes(p));
}

export function listaNarzedzi(): HTMLElement {
  const el = h("ul", { class: "narzedzia" });
  const rysuj = () => {
    const n = sklep.stan.narzedzia;
    el.replaceChildren(
      ...NARZEDZIA.map((x) => {
        const sciezka = n?.sciezki[x] ?? null;
        const pakiet = PAKIET[x];
        const p = postep.get(pakiet);
        const moznaPobrac = n?.do_pobrania.includes(pakiet) ?? false;
        const akcje: HTMLElement[] = [];
        if (p) {
          const procent = p.calosc ? (p.pobrane / p.calosc) * 100 : 0;
          akcje.push(
            h("div", { class: "pasek-maly", role: "progressbar", "aria-valuenow": String(Math.round(procent)) }, h("div", { style: { width: `${procent}%` } })),
            h("span", { class: "pole-pomoc" }, formatujRozmiar(p.pobrane, jezyk())),
          );
        } else {
          akcje.push(
            przycisk(t("narzedzia.wskaz"), async () => {
              const plik = await api.wybierzPlik();
              if (!plik || !sklep.stan.konfig) return;
              const konfig = { ...sklep.stan.konfig, sciezki: { ...sklep.stan.konfig.sciezki, [x]: plik } };
              await api.konfigZapisz(konfig);
              sklep.ustaw({ konfig });
              await odswiezNarzedzia();
            }, "przycisk-maly przycisk-drugorzedny"),
          );
          if (moznaPobrac && (!sciezka || x === "ytdlp" || x === "deno") && (x !== "ffprobe" || !!n?.sciezki.ffmpeg)) {
            akcje.push(przycisk(t(sciezka ? "narzedzia.pobierz_ponownie" : "narzedzia.pobierz"), () => void pobierzPakiet(pakiet), "przycisk-maly"));
          }
        }
        const opis = x === "deno" ? t("narzedzia.deno_opis") : x === "ytdlp" ? t("narzedzia.ytdlp_opis") : t("narzedzia.ffmpeg_opis");
        return h(
          "li",
          { class: "narzedzie" },
          h("span", { class: `narzedzie-stan ${sciezka ? "narzedzie-ok" : "narzedzie-brak"}`, title: t(sciezka ? "narzedzia.jest" : "narzedzia.brak") }, ikona(sciezka ? IKONY.ok : IKONY.uwaga)),
          h("div", { class: "narzedzie-nazwa" }, NAZWA[x], h("small", null, sciezka ? (n?.wersje[x] ?? t("narzedzia.jest")) : opis)),
          h(
            "div",
            { class: "narzedzie-sciezka", title: sciezka ? sciezkaDoPokazania(sciezka) : "" },
            (sciezka && sciezkaDoPokazania(sciezka)) ?? (!moznaPobrac && (x === "ffmpeg" || x === "ffprobe") ? t("narzedzia.menedzer") : t("narzedzia.brak")),
          ),
          h("div", { class: "narzedzie-akcje" }, akcje),
        );
      }),
    );
  };
  rysuj();
  sluchacze.add(rysuj);
  let ostatnie = sklep.stan.narzedzia;
  sklep.subskrybuj((s) => {
    if (s.narzedzia !== ostatnie) {
      ostatnie = s.narzedzia;
      rysuj();
    }
  });
  return el;
}

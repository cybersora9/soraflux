// Skala interfejsu GUI 2.0: 90–150%, Ctrl + / Ctrl − / Ctrl 0. W apce to zoom WebView (Tauri
// `Webview::set_zoom`), w przeglądarce (atrapa) zoom CSS. Zapis w konfigu (Rust), nie w localStorage.
import { api } from "./api";
import { sklep } from "./sklep";

export const SKALE = [0.9, 1, 1.1, 1.25, 1.5] as const;
export const SKALA_MIN = 0.9;
export const SKALA_MAX = 1.5;

/** Skala w zakresie, do setnych; śmieci = 100% (jak `skala_poprawna` w Rust). */
export function poprawSkale(s: number): number {
  if (!Number.isFinite(s)) return 1;
  return Math.round(Math.min(SKALA_MAX, Math.max(SKALA_MIN, s)) * 100) / 100;
}

/** Następna skala po Ctrl + / Ctrl − (krok 10 punktów procentowych, jak w makiecie). */
export function krokSkali(s: number, kierunek: 1 | -1): number {
  return poprawSkale(Math.round((s + kierunek * 0.1) * 100) / 100);
}

export function biezacaSkala(): number {
  return poprawSkale(sklep.stan.konfig?.skala ?? 1);
}

export async function ustawSkale(s: number): Promise<void> {
  const k = sklep.stan.konfig;
  const nowa = await api.ustawSkale(poprawSkale(s));
  if (k) sklep.ustaw({ konfig: { ...k, skala: nowa } });
}

/** Skrót klawiszowy skali → nowa skala albo `null` (to nie był skrót skali). */
export function skalaZKlawisza(e: Pick<KeyboardEvent, "ctrlKey" | "metaKey" | "altKey" | "key">, s: number): number | null {
  if (!(e.ctrlKey || e.metaKey) || e.altKey) return null;
  if (e.key === "+" || e.key === "=") return krokSkali(s, 1);
  if (e.key === "-" || e.key === "_") return krokSkali(s, -1);
  if (e.key === "0") return 1;
  return null;
}

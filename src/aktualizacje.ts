// Aktualizacje apki (updater Tauri, GitHub Releases, podpis sprawdzany kluczem publicznym).
// Sprawdzenie ręczne w Ustawieniach; nic nie dzieje się bez zgody użytkownika.
import { api } from "./api";
import { t, tekstBledu } from "./i18n";
import { pokazDymek } from "./sklep";

export const STRONA_WYDAN = "https://github.com/cybersora9/soraflux/releases/latest";

export async function sprawdzAktualizacje(reczne: boolean): Promise<void> {
  try {
    const nowa = await api.sprawdzAktualizacje();
    if (!nowa) {
      if (reczne) pokazDymek(t("aktualizacje.brak"));
      return;
    }
    if (window.confirm(t("aktualizacje.jest", { wersja: nowa.wersja }))) {
      pokazDymek(t("aktualizacje.pobieram"));
      await api.zainstalujAktualizacje();
    }
  } catch (e) {
    if (reczne)
      pokazDymek(t("aktualizacje.blad", { blad: tekstBledu(e) }), "blad", { etykieta: t("aktualizacje.strona"), zrob: () => void api.otworzLink(STRONA_WYDAN) });
  }
}

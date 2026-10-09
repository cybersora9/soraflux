// Przełączanie trybu Prosty/Pełny (pasek boczny, Ustawienia, „Więcej ustawień”, podpowiedź po aktualizacji).
import { api } from "./api";
import type { Tryb } from "./prosty";
import { sklep, ZAKLADKI_TRYBU, type Zakladka } from "./sklep";

/** Zakładka po zmianie trybu: Prosty ↔ Konwertuj, wspólne (Kolejka, Ustawienia) zostają. */
export function zakladkaWTrybie(z: Zakladka, tryb: Tryb): Zakladka {
  if (ZAKLADKI_TRYBU[tryb].includes(z)) return z;
  return tryb === "prosty" ? "prosty" : "konwertuj";
}

/** Zapis trybu w konfigu od razu i przejście na pasującą zakładkę. */
export async function ustawTryb(tryb: Tryb, zakladka?: Zakladka): Promise<void> {
  const k = sklep.stan.konfig;
  if (!k) return;
  const konfig = { ...k, tryb };
  await api.konfigZapisz(konfig);
  sklep.ustaw({ konfig, zakladka: zakladka ?? zakladkaWTrybie(sklep.stan.zakladka, tryb) });
}

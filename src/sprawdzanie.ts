// Wyniki „Sprawdź” na zakładce Pobierz jako reduktor (P6 z testu na żywo 1.4.0): po sprawdzeniu
// nieistniejącego linku (karta 404) i wpisaniu „abc to nie jest link” + „Sprawdź” dymek mówił, że linku
// nie ma, a stara karta 404 zostawała. Teraz każde „Sprawdź” zastępuje wyniki, a edycja pola oznacza
// jako nieaktualne te, których linku już w polu nie ma. Czysta logika, testowana vitestem.
import { wyciagnijUrl } from "./logika";
import type { Info, Wybor } from "./typy";

export interface WynikSprawdzenia {
  url: string;
  info: Info | null;
  blad: string | null;
  wybor: Wybor;
  /** Link zniknął z pola po sprawdzeniu: karta wyszarzona i pomijana przy pobieraniu. */
  nieaktualny: boolean;
}

export interface StanSprawdzania {
  wyniki: WynikSprawdzenia[];
  /** Numer sprawdzenia: odpowiedzi z poprzednich sprawdzeń są ignorowane. */
  pokolenie: number;
}

export type ZdarzenieSprawdzania =
  | { typ: "sprawdz"; tekst: string; wybor: Wybor }
  | { typ: "edycja"; tekst: string }
  | { typ: "wynik"; pokolenie: number; url: string; info?: Info; blad?: string }
  | { typ: "usun"; url: string }
  | { typ: "wybor"; url: string; wybor: Wybor }
  | { typ: "wszystkie_wybor"; wybor: Wybor }
  | { typ: "wyczysc" };

export const POCZATEK: StanSprawdzania = { wyniki: [], pokolenie: 0 };

export function sprawdzanie(s: StanSprawdzania, z: ZdarzenieSprawdzania): StanSprawdzania {
  switch (z.typ) {
    case "sprawdz": {
      // zawsze nowe pokolenie: także „brak linku” czyści stare karty
      const urle = wyciagnijUrl(z.tekst);
      return { pokolenie: s.pokolenie + 1, wyniki: urle.map((url) => ({ url, info: null, blad: null, wybor: z.wybor, nieaktualny: false })) };
    }
    case "edycja": {
      const urle = new Set(wyciagnijUrl(z.tekst));
      let zmiana = false;
      const wyniki = s.wyniki.map((w) => {
        const nieaktualny = !urle.has(w.url);
        if (nieaktualny === w.nieaktualny) return w;
        zmiana = true;
        return { ...w, nieaktualny };
      });
      return zmiana ? { ...s, wyniki } : s;
    }
    case "wynik": {
      if (z.pokolenie !== s.pokolenie) return s;
      return { ...s, wyniki: s.wyniki.map((w) => (w.url === z.url ? { ...w, info: z.info ?? null, blad: z.blad ?? null } : w)) };
    }
    case "usun":
      return { ...s, wyniki: s.wyniki.filter((w) => w.url !== z.url) };
    case "wybor":
      return { ...s, wyniki: s.wyniki.map((w) => (w.url === z.url ? { ...w, wybor: z.wybor } : w)) };
    case "wszystkie_wybor":
      return { ...s, wyniki: s.wyniki.map((w) => ({ ...w, wybor: z.wybor })) };
    case "wyczysc":
      return { pokolenie: s.pokolenie + 1, wyniki: [] };
  }
}

/** Wyniki, które pójdą do pobrania: sprawdzone, bez błędu i nadal w polu. */
export function doPobrania(s: StanSprawdzania): WynikSprawdzenia[] {
  return s.wyniki.filter((w) => w.info && !w.blad && !w.nieaktualny);
}

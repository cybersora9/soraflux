// GUI 2.0: logika Taśmy, Z linku, Narzędzi, Porównaj, Gotowe, skali i palety + widoki na atrapie backendu.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "./api";
import { sklep } from "./sklep";
import { t, ustawJezyk } from "./i18n";
import { profilDla } from "./logika";
import type { InfoZadania, Media, NoweZadanie } from "./typy";
import { blokada, katalogPozycji, profilKoncowy, przepisyDla, sprzetZEnkoderow, stanPozycji, sumy, WLASNY, zadanieDla, type Pozycja } from "./tasma";
import { fragment, lancuch, opcjePobrania, profilCelu, stanPoczatkowy, wyborLinku, linkPlaylisty } from "./link";
import { kopiaMozliwa, przyciecieDo, profilGlosnosci, profilKontenera, profilGeometrii } from "./obrobka";
import { krokSkali, poprawSkale, skalaZKlawisza } from "./skala";
import { bezOgonkow, filtruj, otworzPalete, paletaOtwarta } from "./komponenty/paleta";
import { momenty, werdykt, doPorownania } from "./widoki/porownaj";
import { procentOryginalu, zaoszczedzone } from "./widoki/gotowe";
import { stworzWidokTasmy } from "./widoki/tasma";
import { stworzWidokLinku } from "./widoki/link";
import { stworzWidokNarzedzi } from "./widoki/narzedzia";

const czekaj = (ms: number) => new Promise((r) => setTimeout(r, ms));

const film = (x: Partial<Media> = {}): Media => ({
  czas_s: 187, rozmiar_b: 432_000_000, kbps: 17_000, format: "mov,mp4", obraz: false, okladka: false, napisy: [],
  wideo: { indeks: 0, kodek: "h264", w: 1920, h: 1080, fps: 30, kbps: 17_000, piksele: "yuv420p", bity: 8, hdr: null, obrot: 0, vfr: false },
  audio: { indeks: 1, kodek: "aac", hz: 48000, kanaly: 2, kbps: 192, jezyk: null },
  sciezki_audio: [], ...x,
});

const pozycja = (x: Partial<Pozycja> = {}): Pozycja => ({
  nr: 1, sciezka: "C:/Wideo/a.mp4", podkatalog: null, media: film(), blad: null, przepis: "wyslij", cel: "discord",
  profil: profilDla("mp4"), glosnosc: false, sprzet: null, gifOd: 0, zadanie: null, ...x,
});

describe("Taśma: przepis dla każdego pliku osobno", () => {
  it("przepisy = akcje trybu Prostego + Własny", () => {
    expect(przepisyDla("film")).toEqual(["wyslij", "telefon", "mp3", "gif", "napisy", WLASNY]);
    expect(przepisyDla("zdjecia")).toEqual(["www", "jpg", "pol", WLASNY]);
  });

  it("Do wysłania → limit celu; głośność −14 LUFS i karta graficzna trafiają do profilu", () => {
    const p = profilKoncowy(pozycja({ glosnosc: true, sprzet: "nvenc" }))!;
    expect(p.wideo?.jakosc).toEqual({ typ: "rozmiar_mb", mb: 9.5 });
    expect(p.audio).toMatchObject({ normalizacja: true, lufs: -14 });
    expect(p.wideo?.sprzet).toBe("nvenc");
    expect(profilKoncowy(pozycja({ przepis: "mp3", sprzet: "nvenc" }))!.wideo?.sprzet ?? null).toBeNull();
  });

  it("P1/P4: już się mieści i brak dźwięku blokują tylko swój wiersz", () => {
    expect(blokada(pozycja({ media: film({ rozmiar_b: 3_000_000 }) }))).toEqual({ typ: "miesci" });
    expect(blokada(pozycja({ przepis: "mp3", media: film({ audio: null }) }))).toEqual({ typ: "format", powod: "brak_dzwieku" });
    expect(blokada(pozycja())).toBeNull();
    expect(blokada(pozycja({ media: null }))).toEqual({ typ: "sonda" });
  });

  it("zadanie: konwersja z dopiskiem, napisy jako zadanie whisper, folder z podkatalogiem", () => {
    const z = zadanieDla(pozycja(), null, (k) => t(k))!;
    expect(z.rodzaj.typ).toBe("konwersja");
    expect(z.dopisek).toBe("na Discorda");
    const n = zadanieDla(pozycja({ przepis: "napisy" }), null, (k) => k)!;
    expect(n.rodzaj).toMatchObject({ typ: "napisy", wejscie: "C:/Wideo/a.mp4" });
    expect(zadanieDla(pozycja({ zadanie: 5 }), null, (k) => k)).toBeNull();
    expect(katalogPozycji({ podkatalog: "dzien-1" }, "D:\\Gotowe\\")).toBe("D:\\Gotowe\\dzien-1");
    expect(katalogPozycji({ podkatalog: "x" }, null)).toBeNull();
  });

  it("stan z kolejki i sumy przed/po", () => {
    const zadania = new Map<number, InfoZadania>([[7, { id: 7, nazwa: "a", rodzaj: "konwersja", stan: { typ: "trwa" }, procent: 40, wyjscie: null, rozmiar_wejscia: null, rozmiar_wyniku: null, awaria_sprzetu: false, ostrzezenie: null }]]);
    expect(stanPozycji({ zadanie: null }, zadania)).toBe("czeka");
    expect(stanPozycji({ zadanie: 7 }, zadania)).toBe("trwa");
    expect(stanPozycji({ zadanie: 8 }, zadania)).toBe("w_kolejce");
    expect(sumy([{ przed: 100, po: 10 }, { przed: 50, po: null }, { przed: 20, po: 5 }])).toEqual({ przed: 120, po: 15, znane: 2 });
    expect(sprzetZEnkoderow(["hevc_qsv", "h264_qsv"])).toBe("qsv");
    expect(sprzetZEnkoderow([])).toBeNull();
  });
});

describe("Z linku: klip, łańcuch pobierz → cel, playlisty", () => {
  it("fragment tylko, gdy zaznaczono część filmu", () => {
    expect(fragment({ od: 20, do_: 31, playlista: false }, 764)).toEqual({ od: 20, do_: 31 });
    expect(fragment({ od: 0, do_: 764, playlista: false }, 764)).toBeNull();
    expect(fragment({ od: 10, do_: 5, playlista: false }, 764)).toBeNull();
    expect(fragment({ od: 20, do_: 31, playlista: true }, 764)).toBeNull();
  });

  it("opcje pobrania: --download-sections, zakres i tylko nowe", () => {
    const s = { ...stanPoczatkowy(), od: 80, do_: 125 };
    const o = opcjePobrania(s, { tytul: "Koncert", czas_s: 764 });
    expect(o.fragment).toEqual({ od: 80, do_: 125 });
    expect(o.wybor).toEqual({ typ: "wysokosc", h: 1080 });
    const p = opcjePobrania({ ...stanPoczatkowy(), playlista: true, trybPlaylisty: "zakres", zakresOd: 20, zakresDo: 5 }, null);
    expect(p).toMatchObject({ playlista: true, zakres_playlisty: "5-20", tylko_nowe: false, fragment: null });
    expect(opcjePobrania({ ...stanPoczatkowy(), playlista: true, trybPlaylisty: "nowe" }, null).tylko_nowe).toBe(true);
  });

  it("cele: Discord = limit 10 MB, MP3 bez konwersji (yt-dlp), z głośnością przez kolejkę, rolka 9:16", () => {
    expect(profilCelu("discord", false)?.wideo?.jakosc).toEqual({ typ: "rozmiar_mb", mb: 9.5 });
    expect(profilCelu("mp3", false)).toBeNull();
    expect(wyborLinku({ cel: "mp3", wysokosc: null, glosnosc: false })).toEqual({ typ: "tylko_audio", format: "mp3" });
    expect(wyborLinku({ cel: "mp3", wysokosc: null, glosnosc: true })).toEqual({ typ: "tylko_audio", format: "best" });
    expect(profilCelu("mp3", true)?.audio).toMatchObject({ kodek: "mp3", normalizacja: true, lufs: -14 });
    expect(profilCelu("rolka", false)?.wideo).toMatchObject({ rozdzielczosc: { typ: "wlasna", w: 1080, h: 1920 }, dopasowanie: { typ: "przytnij" } });
    expect(profilCelu("oryg", false)).toBeNull();
    expect(profilCelu("oryg", true)?.wideo?.kodek).toBe("kopiuj");
    expect(lancuch({ ...stanPoczatkowy(), od: 20, do_: 31, glosnosc: true }, 764).map((x) => x[0])).toEqual(["link.krok.fragment", "link.krok.ciecie", "link.krok.cel.discord", "link.krok.glosnosc", "link.krok.zapisz"]);
    expect(linkPlaylisty("https://example.com/watch?v=a&list=PL1")).toBe(true);
    expect(linkPlaylisty("https://example.com/watch?v=a")).toBe(false);
  });
});

describe("Narzędzia P1", () => {
  it("zmiana kontenera tylko, gdy kodeki pasują", () => {
    expect(kopiaMozliwa(film(), "mkv")).toBe(true);
    expect(kopiaMozliwa(film(), "webm")).toBe(false);
    const p = profilKontenera("mkv", film());
    expect([p.wideo?.kodek, p.audio?.kodek, p.sciezki_audio.typ]).toEqual(["kopiuj", "kopiuj", "wszystkie"]);
  });

  it("głośność: obraz kopiowany, dźwięk z celem LUFS; plik audio zostaje w swoim formacie", () => {
    const p = profilGlosnosci("C:/a.mkv", film(), -16);
    expect([p.kontener, p.wideo?.kodek, p.audio?.normalizacja, p.audio?.lufs]).toEqual(["mkv", "kopiuj", true, -16]);
    const a = profilGlosnosci("C:/a.flac", film({ wideo: null }), -23);
    expect([a.kontener, a.audio?.kodek]).toEqual(["flac", "flac"]);
  });

  it("kadr do proporcji na środku, parzyste wymiary", () => {
    expect(przyciecieDo(1920, 1080, "9:16")).toEqual({ gora: 0, dol: 0, lewo: 657, prawo: 657 });
    expect(przyciecieDo(1080, 1920, "1:1")).toEqual({ gora: 420, dol: 420, lewo: 0, prawo: 0 });
    expect(przyciecieDo(1920, 1080, "bez")).toEqual({ gora: 0, dol: 0, lewo: 0, prawo: 0 });
    const g = profilGeometrii("C:/a.mp4", film(), { proporcje: "1:1", obrot: "o90", poziomo: true, pionowo: false });
    expect([g.obrot, g.odbicie.poziomo, g.audio?.kodek, g.wideo?.kodek]).toEqual(["o90", true, "kopiuj", "h264"]);
  });
});

describe("Porównaj, Gotowe, skala, paleta", () => {
  it("werdykt z VMAF albo SSIM, momenty klatek", () => {
    expect(werdykt({ vmaf: 95, ssim: null })).toBe("bardzo_dobry");
    expect(werdykt({ vmaf: null, ssim: 0.96 })).toBe("dobry");
    expect(werdykt({ vmaf: null, ssim: 0.9 })).toBe("widac");
    expect(werdykt({ vmaf: null, ssim: null })).toBe("brak");
    expect(werdykt(null)).toBe("licze");
    expect(momenty(100)).toEqual([10, 35, 65, 90]);
    expect(momenty(null)).toEqual([0]);
  });

  it("% oryginału i zaoszczędzone miejsce", () => {
    expect(procentOryginalu(412, 9.4)).toBe(2);
    expect(procentOryginalu(100, 0.1)).toBe(1);
    expect(procentOryginalu(null, 5)).toBeNull();
    const z = (przed: number, po: number, typ: "gotowe" | "blad" = "gotowe") =>
      ({ stan: typ === "gotowe" ? { typ, wyjscie: "x" } : { typ, komunikat: "" }, rozmiar_wejscia: przed, rozmiar_wyniku: po }) as InfoZadania;
    expect(zaoszczedzone([z(100, 10), z(10, 20), z(50, 5, "blad")])).toBe(90);
    expect(doPorownania([{ ...z(1, 1), id: 1, rodzaj: "konwersja", wejscie: "a", wyjscie: "b" } as InfoZadania])).toHaveLength(1);
  });

  it("skala 90–150%, Ctrl + / − / 0", () => {
    expect(poprawSkale(3)).toBe(1.5);
    expect(poprawSkale(Number.NaN)).toBe(1);
    expect(krokSkali(1.5, 1)).toBe(1.5);
    expect(krokSkali(1, -1)).toBe(0.9);
    const k = (key: string, ctrlKey = true) => skalaZKlawisza({ key, ctrlKey, metaKey: false, altKey: false }, 1.1);
    expect([k("+"), k("="), k("-"), k("0"), k("a"), k("+", false)]).toEqual([1.2, 1.2, 1, 1, null, null]);
  });

  it("paleta: dopasowanie bez polskich znaków, ↓ i Enter wykonują, Esc zamyka i oddaje fokus", () => {
    expect(bezOgonkow("Wyrównaj Głośność")).toBe("wyrownaj glosnosc");
    const lista = [{ tekst: "Wyrównaj głośność", sekcja: "Narzędzia" }, { tekst: "Motyw: Neon noc", sekcja: "Wygląd" }];
    expect(filtruj(lista, "glos")).toHaveLength(1);
    expect(filtruj(lista, "neon wyg")).toEqual([lista[1]]);
    const wykonane: string[] = [];
    const przycisk = document.createElement("button");
    document.body.replaceChildren(przycisk);
    przycisk.focus();
    const pol = (id: string) => ({ id, sekcja: "S", tekst: id, ikona: "", wykonaj: () => void wykonane.push(id) });
    otworzPalete(() => [pol("a"), pol("b")]);
    expect(paletaOtwarta()).toBe(true);
    const pole = document.querySelector<HTMLInputElement>(".paleta input")!;
    expect(document.activeElement).toBe(pole);
    pole.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown" }));
    expect(document.querySelector('.pal-p[aria-selected="true"]')?.getAttribute("data-polecenie")).toBe("b");
    pole.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
    expect(wykonane).toEqual(["b"]);
    expect(paletaOtwarta()).toBe(false);
    otworzPalete(() => [pol("a")]);
    document.querySelector<HTMLInputElement>(".paleta input")!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(paletaOtwarta()).toBe(false);
    expect(document.activeElement).toBe(przycisk);
  });
});

describe("widoki 2.0 na atrapie backendu", () => {
  let dodane: NoweZadanie[][] = [];
  beforeEach(() => {
    ustawJezyk("pl");
    dodane = [];
    vi.restoreAllMocks();
    vi.spyOn(api, "dodajZadania").mockImplementation(async (z) => (dodane.push(z), z.map((_, i) => 100 + i)));
    sklep.ustaw({ zadania: new Map(), postepy: new Map(), konfig: { tryb: "pelny", katalog_wyjscia: null, rownolegle: 2, rownolegle_wideo: 1, niski_priorytet: false, ostatnie_foldery: [] } as never });
  });

  it("Taśma: każdy plik ma własny przepis, Start dodaje tylko to, co się da, z dopiskiem", async () => {
    const w = stworzWidokTasmy();
    document.body.replaceChildren(w.el);
    await w.dodaj(["C:/Wideo/wakacje.mp4", "C:/Wideo/maly-klip.mp4", "C:/Wideo/bez-dzwieku.mp4"]);
    await czekaj(300);
    expect(w.el.querySelectorAll(".poz")).toHaveLength(3);
    // drugi plik: już się mieści w Discordzie → zablokowany z powodem
    expect(w.el.querySelectorAll(".poz")[1].textContent).toContain("Już mieści się w limicie");
    // trzeci: przepis MP3 przy filmie bez dźwięku → powód przy wierszu
    (w.el.querySelectorAll<HTMLElement>(".poz")[2]).click();
    w.el.querySelector<HTMLButtonElement>('.karta-p[data-przepis="mp3"]')!.click();
    expect(w.el.querySelectorAll(".poz")[2].textContent).toContain("nie ma dźwięku");
    // pierwszy: Na telefon (inny przepis niż reszta)
    (w.el.querySelectorAll<HTMLElement>(".poz")[0]).click();
    w.el.querySelector<HTMLButtonElement>('.karta-p[data-przepis="telefon"]')!.click();
    expect(w.el.querySelectorAll(".poz")[0].textContent).toContain("Na telefon");
    await w.start();
    expect(dodane).toHaveLength(1);
    expect(dodane[0]).toHaveLength(1);
    expect(dodane[0][0]).toMatchObject({ rodzaj: { typ: "konwersja", wejscie: "C:/Wideo/wakacje.mp4" }, dopisek: "na telefon" });
    expect(w.sciezki()).toEqual(["C:/Wideo/wakacje.mp4", "C:/Wideo/maly-klip.mp4", "C:/Wideo/bez-dzwieku.mp4"]);
  });

  it("Taśma: Pauza wstrzymuje kolejkę, „Dostosuj” robi przepis Własny", async () => {
    const pauza = vi.spyOn(api, "kolejkaWstrzymaj").mockImplementation(async (t) => t);
    const w = stworzWidokTasmy();
    document.body.replaceChildren(w.el);
    await w.dodaj(["C:/Wideo/wakacje.mp4"]);
    await czekaj(200);
    const det = w.el.querySelector<HTMLDetailsElement>("details.dost")!;
    expect(det.open).toBe(false);
    // zmiana kontenera w panelu pełnym → przepis „Własny”
    const chip = [...det.querySelectorAll<HTMLButtonElement>(".formaty .chip")].find((b) => b.textContent === "MKV")!;
    chip.click();
    await czekaj(200);
    expect(w.el.querySelector(".poz")!.textContent).toContain("Własny");
    await w.start();
    expect(dodane[0][0].rodzaj).toMatchObject({ typ: "konwersja", profil: { kontener: "mkv" } });
    sklep.ustaw({ zadania: new Map([[100, { id: 100, nazwa: "x", rodzaj: "konwersja", stan: { typ: "trwa" }, procent: 10, wyjscie: null, rozmiar_wejscia: null, rozmiar_wyniku: null, awaria_sprzetu: false, ostrzezenie: null }]]) });
    w.el.querySelector<HTMLButtonElement>('[data-fokus="start"]')!.click();
    await czekaj(10);
    expect(pauza).toHaveBeenCalledWith(true);
  });

  it("Z linku: fragment i cel w jednym zadaniu pobrania z konwersją potem", async () => {
    const w = stworzWidokLinku();
    document.body.replaceChildren(w.el);
    w.wstaw("https://example.com/watch?v=test01");
    await czekaj(700);
    expect(w.el.textContent).toContain("Przykładowy film");
    const [od, doo] = [...w.el.querySelectorAll<HTMLInputElement>(".os-suwaki input")];
    od.value = "20";
    od.dispatchEvent(new Event("input"));
    od.dispatchEvent(new Event("change"));
    doo.value = "31";
    doo.dispatchEvent(new Event("input"));
    doo.dispatchEvent(new Event("change"));
    expect(w.el.querySelector(".lancuch")!.textContent).toContain("Pobierz fragment 00:20–00:31");
    await w.start();
    const z = dodane[0][0];
    expect(z.rodzaj.typ).toBe("pobranie");
    if (z.rodzaj.typ !== "pobranie") return;
    expect(z.rodzaj.opcje.fragment).toEqual({ od: 20, do_: 31 });
    expect(z.rodzaj.potem?.wideo?.jakosc).toEqual({ typ: "rozmiar_mb", mb: 9.5 });
  });

  it("Z linku: błąd yt-dlp po ludzku, surowy tekst tylko w szczegółach", async () => {
    const w = stworzWidokLinku();
    document.body.replaceChildren(w.el);
    w.wstaw("https://example.com/nie-ma");
    await czekaj(500);
    const b = w.el.querySelector<HTMLElement>('[role="alert"]')!;
    expect(b.querySelector("b")!.textContent).toBe("Pod tym adresem nic nie ma (błąd 404). Sprawdź link.");
    expect(b.querySelector("details")!.textContent).toContain("HTTP Error 404");
  });

  it("Narzędzia: połącz dwa pliki z Taśmy w jedno zadanie, głośność per plik", async () => {
    const w = stworzWidokNarzedzi({ plikiTasmy: () => ["C:/Wideo/a.mp4", "C:/Wideo/b.mp4"], doTasmyNapisy: () => undefined });
    document.body.replaceChildren(w.el);
    w.wybierz("polacz");
    await czekaj(300);
    w.el.querySelector<HTMLButtonElement>('[data-fokus="uruchom"]')!.click();
    await czekaj(10);
    expect(dodane[0]).toEqual([{ rodzaj: { typ: "polacz", wejscia: ["C:/Wideo/a.mp4", "C:/Wideo/b.mp4"], kontener: "mp4" }, katalog: null, dopisek: "połączone" }]);
    w.wybierz("glosnosc");
    await czekaj(100);
    w.el.querySelector<HTMLButtonElement>('[data-fokus="uruchom"]')!.click();
    await czekaj(10);
    expect(dodane[1]).toHaveLength(2);
    expect(dodane[1][0].rodzaj).toMatchObject({ typ: "konwersja", profil: { audio: { normalizacja: true, lufs: -14 } } });
  });
});

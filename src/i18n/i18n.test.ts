import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import pl from "./pl.json";
import en from "./en.json";
import { t, tlumaczBlad, ustawJezyk } from "./index";

function plikiRs(katalog: string): string[] {
  return readdirSync(katalog).flatMap((n) => {
    const p = join(katalog, n);
    return statSync(p).isDirectory() ? plikiRs(p) : p.endsWith(".rs") ? [p] : [];
  });
}

function plikiTs(katalog: string): string[] {
  return readdirSync(katalog).flatMap((n) => {
    const p = join(katalog, n);
    return statSync(p).isDirectory() ? plikiTs(p) : p.endsWith(".ts") && !p.endsWith(".test.ts") ? [p] : [];
  });
}

describe("i18n", () => {
  it("Pobierz bez nazw serwisów: jeden opis zamiast listy (S2b-1)", () => {
    for (const s of [pl, en] as Record<string, string>[]) {
      expect(s["pobierz.zrodla.opis"]).toMatch(/1000/);
      for (const [k, v] of Object.entries(s))
        expect(v, k).not.toMatch(/YouTube|SoundCloud|Bandcamp|Vimeo|Mixcloud|Internet Archive/i);
    }
    const widok = readFileSync(join(__dirname, "../widoki/pobierz.ts"), "utf8");
    expect(widok).toContain('t("pobierz.zrodla.opis")');
    expect(widok).not.toContain("ZRODLA_POBIERANIA");
  });
  it("PL i EN mają te same klucze", () => {
    expect(Object.keys(en).sort()).toEqual(Object.keys(pl).sort());
  });
  it("każdy dosłowny klucz użyty w kodzie istnieje", () => {
    const zrodla = plikiTs(join(__dirname, "..")).map((p) => readFileSync(p, "utf8")).join("\n");
    const uzyte = new Set<string>();
    for (const m of zrodla.matchAll(/\bt\(\s*"([a-z0-9_.]+)"/g)) uzyte.add(m[1]);
    for (const m of zrodla.matchAll(/\?\s*"([a-z][a-z0-9_]*\.[a-z0-9_.]+)"\s*:\s*"([a-z][a-z0-9_]*\.[a-z0-9_.]+)"/g)) {
      uzyte.add(m[1]);
      uzyte.add(m[2]);
    }
    const brak = [...uzyte].filter((k) => !(k in pl));
    expect(brak).toEqual([]);
  });
  it("podstawia parametry i przełącza język", () => {
    ustawJezyk("en");
    expect(t("pliki.liczba", { n: 3 })).toBe("Files: 3");
    ustawJezyk("pl");
    expect(t("pliki.liczba", { n: 3 })).toBe("Pliki: 3");
    expect(t("nie.ma.takiego")).toBe("nie.ma.takiego");
  });
  it("każdy klucz błędu wysyłany z Rusta ma tłumaczenie (rust.*)", () => {
    const rs = plikiRs(join(__dirname, "../../src-tauri/src")).map((p) => readFileSync(p, "utf8")).join("\n");
    const klucze = new Set<string>();
    for (const m of rs.matchAll(/blad::(?:kod|z_ogonem)\(\s*"([a-z0-9_.]+)"/g)) klucze.add(m[1]);
    for (const m of rs.matchAll(/"(yt\.[a-z_]+)"/g)) klucze.add(m[1]);
    expect(klucze.size).toBeGreaterThan(20);
    const brak = [...klucze].filter((k) => !(`rust.${k}` in pl) || !(`rust.${k}` in en));
    expect(brak).toEqual([]);
  });
  it("tłumaczy komunikat z Rusta i zostawia surowy ogon", () => {
    const k = '@i18n {"k":"folder_zapisu","a":{"folder":"D:/wynik","blad":"Access is denied"}}\n\nos error 5';
    ustawJezyk("en");
    expect(tlumaczBlad(k)).toBe("Can't use the folder D:/wynik (Access is denied). Choose another output folder.\n\nos error 5");
    ustawJezyk("pl");
    expect(tlumaczBlad(k)).toMatch(/^Nie można użyć folderu D:\/wynik /);
    expect(tlumaczBlad("zwykły tekst")).toBe("zwykły tekst");
    expect(tlumaczBlad("@i18n {zepsuty")).toBe("@i18n {zepsuty");
  });
});

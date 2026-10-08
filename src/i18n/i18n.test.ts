import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import pl from "./pl.json";
import en from "./en.json";
import { t, ustawJezyk } from "./index";

function plikiTs(katalog: string): string[] {
  return readdirSync(katalog).flatMap((n) => {
    const p = join(katalog, n);
    return statSync(p).isDirectory() ? plikiTs(p) : p.endsWith(".ts") && !p.endsWith(".test.ts") ? [p] : [];
  });
}

describe("i18n", () => {
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
});

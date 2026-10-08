import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// 08.10: nazwa wraca na SoraFlux (decyzja maisy). Pilnujemy tego, co widzi użytkownik:
// okno, instalator, napisy w GUI. Wewnętrzne nazwy (crate, katalog konfiguracji) zostają.
const korzen = join(__dirname, "..");
const czytaj = (p: string) => readFileSync(join(korzen, p), "utf8");

describe("nazwa produktu", () => {
  it("okno i instalator to SoraFlux", () => {
    const konf = JSON.parse(czytaj("src-tauri/tauri.conf.json"));
    expect(konf.productName).toBe("SoraFlux");
    expect(konf.app.windows[0].title).toBe("SoraFlux");
    expect(czytaj("index.html")).toContain("<title>SoraFlux</title>");
  });
  it("w napisach GUI nie ma starej nazwy", () => {
    for (const p of ["src/i18n/pl.json", "src/i18n/en.json", "src-tauri/nsis/hooks.nsh"]) {
      expect(czytaj(p)).not.toMatch(/SoraConverter"/);
      expect(czytaj(p)).not.toMatch(/w SoraConverter|with SoraConverter/);
    }
    expect(JSON.parse(czytaj("src/i18n/pl.json"))["app.nazwa"]).toBe("SoraFlux");
  });
});

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const korzen = join(__dirname, "..");
const czytaj = (p: string) => readFileSync(join(korzen, p), "utf8");
const konf = JSON.parse(czytaj("src-tauri/tauri.conf.json"));

describe("wydanie (B10, B11, E28)", () => {
  it("B11: instalator z bootstrapperem WebView2 i menu kontekstowym", () => {
    expect(konf.bundle.windows.webviewInstallMode.type).toBe("downloadBootstrapper");
    expect(konf.bundle.windows.nsis.installerHooks).toBe("./nsis/hooks.nsh");
    const hooks = czytaj("src-tauri/nsis/hooks.nsh");
    expect(hooks).toContain("NSIS_HOOK_POSTINSTALL");
    expect(hooks).toContain("NSIS_HOOK_POSTUNINSTALL");
    for (const typ of ["video", "audio", "image"]) expect(hooks).toContain(`SORA_USUN_MENU "${typ}"`);
  });

  it("B10: podpis SignPath tylko po włączeniu, sumy SHA256, szkic zamiast publikacji", () => {
    const r = czytaj(".github/workflows/release.yml");
    expect(r).toContain("signpath/github-action-submit-signing-request");
    const krok = r.slice(r.indexOf("- name: Podpis SignPath"));
    expect(krok.slice(0, 200)).toContain("if: env.SIGNPATH_WLACZONE == 'true'");
    expect(r).toContain("SHA256SUMS.txt");
    expect(r).toContain("draft: true");
    expect(r).not.toMatch(/draft:\s*false/);
  });

  it("E28: updater z GitHub Releases, klucz tylko publiczny, artefakty updatera nie psują lokalnego buildu", () => {
    const u = konf.plugins.updater;
    expect(u.endpoints).toEqual(["https://github.com/cybersora9/soraflux/releases/latest/download/latest.json"]);
    expect(typeof u.pubkey).toBe("string");
    expect(konf.bundle.createUpdaterArtifacts).toBe(false);
    expect(czytaj("src-tauri/capabilities/default.json")).toContain("updater:default");
    // klucz prywatny nigdy w repo
    expect(czytaj(".gitignore")).toMatch(/\.key/);
  });
});

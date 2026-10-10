import { describe, expect, it } from "vitest";
import { czyPokazacInformacje, LINK_INSTALATORA } from "./przegladarka";

describe("informacja w przeglądarce", () => {
  it("w apce Tauri nigdy, na localhost (testy, zrzuty) nie, gdzie indziej tak", () => {
    expect(czyPokazacInformacje(true, "tauri.localhost")).toBe(false);
    expect(czyPokazacInformacje(false, "localhost")).toBe(false);
    expect(czyPokazacInformacje(false, "127.0.0.1")).toBe(false);
    expect(czyPokazacInformacje(false, "example.com")).toBe(true);
    expect(czyPokazacInformacje(false, "")).toBe(true); // file://
  });
  it("link wskazuje stały plik z najnowszego wydania", () => {
    expect(LINK_INSTALATORA).toBe("https://github.com/cybersora9/soraflux/releases/latest/download/SoraFlux-setup.exe");
  });
});

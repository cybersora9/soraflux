import { defineConfig } from "vite";

// Tauri oczekuje stałego portu w trybie dev i nie czyści ekranu.
export default defineConfig({
  clearScreen: false,
  server: { port: 1420, strictPort: true },
  envPrefix: ["VITE_", "TAURI_ENV_"],
  build: {
    target: "es2022",
    outDir: "dist",
    emptyOutDir: true,
  },
  test: {
    environment: "jsdom",
    include: ["src/**/*.test.ts"],
  },
} as never);

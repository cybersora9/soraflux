# Contributing to SoraFlux

Thanks for helping! Issues and pull requests are welcome in English or Polish.

## Build and run

Requirements: [Rust](https://rustup.rs) (stable), Node.js 20+, ffmpeg and ffprobe in `PATH` (for the tests). On Windows: Visual Studio Build Tools (C++); run the scripts from Git Bash. On Linux: `libwebkit2gtk-4.1-dev libgtk-3-dev librsvg2-dev libayatana-appindicator3-dev libsoup-3.0-dev`.

```bash
npm install
npm run tauri dev            # the app with hot reload
npm run dev                  # UI only, in a browser: http://localhost:1420/?demo=1 (mock backend)
```

## The gate (run before every PR)

```bash
npm run bramka               # "bramka" = gate: cargo fmt --check, clippy -D warnings, cargo test,
                             # frontend build (tsc), vitest, Playwright screenshots (PL and EN)
```

CI (`.github/workflows/test.yml`) runs the same checks on Linux and Windows. A PR is merged only when CI is green.

## Rules

- **Tests with every change.** A bug fix comes with a test that fails without it. Argument building stays in pure functions (`src-tauri/src/budowniczy/`) so it can be tested without ffmpeg.
- **No links to other people's works in the repo**: no real video/song URLs, titles, thumbnails or logos in code, tests, fixtures or screenshots (the youtube-dl DMCA lesson). Test media comes from ffmpeg `lavfi` or freely licensed material (e.g. Big Buck Bunny); download tests use made-up fixtures and `example.com`.
- **Both languages in the UI.** Every user-visible text goes through `src/i18n` with the same key in `pl.json` and `en.json` (a test checks this). Errors from Rust are sent as keys via `src-tauri/src/blad.rs` (`blad::kod("key", &[("param", &value)])`) and translated by the frontend under `rust.key`; don't return Polish or English sentences from Rust to the GUI.
- **Code language.** Identifiers and code comments are in Polish; keep that style in existing modules (see the glossary in [ARCHITECTURE.md](ARCHITECTURE.md)). Don't send PRs that only rename identifiers.
- **Commits and PR descriptions in English**, short imperative summary line, e.g. `Download tab: generic description instead of a site list`.
- No telemetry, no network calls the user didn't ask for. New external tools are downloaded from official releases with SHA256 verification (`src-tauri/src/narzedzia/zrodla.rs`), never bundled.
- Don't name specific video platforms in the UI or the README ("most popular sites").

## Reporting bugs

Use the [bug report form](https://github.com/cybersora9/soraflux/issues/new/choose) and paste the report from Settings → "Copy report" (it leaves out your folder paths). Security problems: see [SECURITY.md](SECURITY.md), not a public issue.

## License

By contributing you agree that your contribution is licensed under the [MIT License](LICENSE).

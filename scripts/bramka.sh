#!/usr/bin/env bash
# Bramka v1.1: wszystko po kolei, jeden przebieg naraz. Wymaga ffmpeg/ffprobe w PATH.
set -euo pipefail
cd "$(dirname "$0")/.."
echo "== cargo fmt --check";  (cd src-tauri && cargo fmt --check)
echo "== cargo clippy";       (cd src-tauri && cargo clippy --all-targets -- -D warnings)
if rustup target list --installed 2>/dev/null | grep -q x86_64-pc-windows-gnu; then
  echo "== cargo clippy (Windows, kod #[cfg(windows)])"
  (cd src-tauri && cargo clippy --target x86_64-pc-windows-gnu --all-targets -- -D warnings)
fi
echo "== cargo test";         (cd src-tauri && cargo test -- --test-threads=2)
echo "== npm run build";      npm run build
echo "== vitest";             npm test
echo "== zrzuty";             npm run zrzuty
echo "== zrzuty (EN)";        npm run zrzuty:en
echo "Bramka zielona."

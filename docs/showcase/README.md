# Showcase assets

- `demo.webp`: the animated demo at the top of the README. Made with SoraFlux itself:
  `npm run build && node scripts/showcase.mjs` records screenshots of the app (mock backend,
  made-up files), joins them into a video with ffmpeg, then converts the video to an animated
  WebP with SoraFlux's own engine (`cargo run --example animacja`, the same `budowniczy::plan`
  as the "animated WebP" option in the app).
- `social.png` (1280×640): the repository's social preview image. It is set by hand on GitHub:
  **Settings → General → Social preview → Edit → Upload an image…** and pick this file.

# Slip Catch — agent notes

## Commands

- `npm run dev` — Vite dev server (default port 5173)
- `npm run build` — production build to `dist/`
- `npx vite preview --port 4173` — serve the production build
- `npm run convert-images` — repaint + convert `assets/stadium.png` → `assets/stadium.webp` (sharp; crop + fascia paint-out)
- `npm run capture-store` — BiDi (Firefox headless) store-asset capture → `store-assets/` (needs `npx vite preview --port 4173` + headless Firefox `--remote-debugging-port 9230`; env `BIDI_URL`, `BASE_URL`)
- `node cdp-profile.js <url>?debug 15` — FPS/long-task/heap profile via CDP (Chromium-only; do not use, see browser notes)

Deploy: Netlify builds with `npm run build` and publishes `dist/` (see `netlify.toml`).

## Browser notes

USER RULE: do NOT launch Chrome or Edge. The user removed Chrome because test
browsers were slowing the laptop. Use **Firefox only**
(`C:\Program Files\Mozilla Firefox\firefox.exe`), start at most ONE instance,
reuse it for every test (navigate the existing tab, do not open new
processes/tabs), and close it when done. Never touch the user's own Firefox
windows. Never `taskkill /T` unidentified process trees; kill only PIDs you
launched. Stop any dev/preview servers you start when finished.

## Debug flags

- `?debug` — FPS logging, `window.__debug` handle, keys W (wave), F (flash burst), M (board message)
- `?shot` — skip title, straight into play
- `?shot=title` — stay on title / attract mode
- `?shot=promo` — attract scene with all DOM UI hidden (store screenshots)

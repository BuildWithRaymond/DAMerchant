# Documentation screenshots

The README images are captures of the actual production renderer: a 1280 × 1200 dashboard and 1280 × 820 listings and history views. The 1600 × 1200 cover frames the listings capture in a presentation layout. Character names, messages, inventory quantities and trades are fictional sample data. Item names and sprites are illustrative fixtures, not an authoritative game item catalog.

```sh
npm ci
npm run screenshots
```

The command builds the app and runs a separate, hidden Electron window. It uses `scripts/screenshots/preload.cjs` in place of the real IPC bridge, blocks network requests, and writes PNGs to `docs/images/`. It never starts the proxy, opens a game client, reads the user's app database, or signs in to AE.

- `dashboard.png`: inventory, gold, character tabs and matched whispers.
- `listings.png`: sell, buy and trade listings with sync indicators.
- `history.png`: completed trades with both sides of each exchange.
- `cover.png`: a composed introduction using the unmodified listings capture.

Animations are disabled for capture, and external web fonts use the app's local fallback. The temporary Electron profile is ignored under `.screenshots-cache/`. Exact text rasterization can differ between operating systems; Windows is the reference platform.

Review each PNG after changing the UI or fixtures. The capture script checks page readiness and broken images; visual inspection still matters for clipping, spacing and readability.

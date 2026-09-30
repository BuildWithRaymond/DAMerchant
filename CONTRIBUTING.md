# Contributing

Merchant Mode is a Windows Electron application. Small, focused pull requests are easiest to review. Open an issue before starting a substantial feature or changing the game protocol.

## Set up

Use Windows, Node.js 22 or newer, and npm. A Dark Ages installation is needed for live trading checks, but not for compilation or documentation screenshots.

```sh
git clone https://github.com/BuildWithRaymond/merchantmode.git
cd merchantmode
npm ci
npm run electron:dev
```

`npm ci` rebuilds native dependencies for Electron. If that step fails, check the Node version and install the Windows C++ build tools required by the native dependency. After switching Electron versions, run `npm run postinstall` again.

## Checks

```sh
npm test
npm run typecheck
npm run build
```

The tests simulate exchange packets without a game account. The build checks both TypeScript configurations, bundles the renderer, and compiles the Electron entry points. There is no automated live-game integration suite; describe any manual trading, inventory, reconnect, or sync checks in your PR. Do not claim those paths were tested from a renderer capture alone.

### Enable GitHub Actions

The [Windows CI template](docs/ci.yml) runs a clean install, builds the app, and captures the renderer with sample data. A maintainer can enable it by copying it to `.github/workflows/ci.yml` and committing it with credentials allowed to manage workflows. It is provided as a template and is not active in this checkout.

For UI changes, run `npm run screenshots` and inspect the images. See [screenshot notes](docs/screenshots.md). `npm run dev` starts only Vite: the Electron bridge and live game features are unavailable in a regular browser.

## Code and commits

- Follow the existing TypeScript and React patterns, with two-space indentation.
- Keep game logic in `core/`, IPC in `electron/`, and UI in `src/`.
- Use Conventional Commits, such as `fix: preserve stack quantities during exchanges` or `docs: clarify first-run setup`.
- Add focused regression coverage when changing trading behavior. Explain limitations when a check requires a live server.
- Keep generated installers, local databases, credentials, and personal tool settings out of Git.

The code is provided under the [ISC license](LICENSE). Game art and third-party dependencies retain their respective owners' rights; see [third-party notices](docs/third-party-notices.md).

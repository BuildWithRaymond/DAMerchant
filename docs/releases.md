# Releases

Publishing is a maintainer workflow. Ordinary development and CI never publish a release.

## Build an installer locally

On Windows, after `npm ci`:

```sh
npm run dist:local
```

The NSIS installer is written to `release/`. This command explicitly disables publishing. Test installation and startup before releasing it.

## Publish a version

1. Start from a clean checkout and update `CHANGELOG.md`.
2. Run `npm version patch --no-git-tag-version` (or `minor` / `major`) to update both package manifests.
3. Run `npm test`, `npm run dist:local`, and complete the relevant app checks. The packet tests use simulated exchanges only.
4. Commit the version and changelog with a Conventional Commit and push.
5. Supply a `GH_TOKEN` authorized to create releases in `BuildWithRaymond/merchantmode` through your shell environment or secret manager. Do not put it in a tracked file. The build does not load `.env` automatically.
6. Run `npm run dist` to build and upload the release artifacts.
7. Review the release on GitHub and publish it if it is a draft. Keep the installer, blockmap and `latest.yml` together so Electron's updater can resolve the release.

For a manual asset upload, name the installer and blockmap exactly as `latest.yml` expects. A local NSIS build may write filenames with spaces while the updater metadata uses hyphens.

## App updates

With automatic updates enabled, packaged builds check at startup and every 30 minutes, download updates and install them on app quit. When automatic updates are disabled, use About to check manually and choose Download Update when one is available. Restart the app after changing this setting so the main process picks it up.

If an update is missing, check that the release is published, its version is newer than the installed version, and its updater artifacts are present.

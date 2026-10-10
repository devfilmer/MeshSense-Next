# TODO

## Windows

- [ ] Build and test on Windows. Needs the "Desktop development with C++" workload in Visual Studio Build Tools
      (MSVC, Windows SDK) and CMake on the PATH for the Bluetooth addon in `api/webbluetooth`
      (`npm i && npx cmake-js compile && npx tsc`), then `node update.mjs`, `build.mjs` or `npm run build:unpack` in `electron`.
- [ ] `api` `npm run dev` fails on Windows: the script quotes `'vite-node'` with single quotes, which `cmd` passes through literally.
- [ ] `update.mjs` aborts on a branch without an upstream (`git pull` fails) and the README uses POSIX env syntax;
      add PowerShell equivalents.
- [ ] npm 11 does not run install scripts unless approved; Electron's binary download and `webbluetooth`'s install
      script need `npm install-scripts approve` or a manual `node node_modules/electron/install.js`.
- [ ] Decide whether MeshSense Next should install beside MeshSense on Windows; today `appId` is unchanged, so the
      installer replaces an existing MeshSense install.
- [ ] Electron `build:win` signs with Affirmatech's certificate; use `build:unpack` or remove the signing settings
      for local builds.

## Other

- [ ] Test against a real radio over Bluetooth and WiFi (the Pi build is running at http://protouch:5920 and
      searching for the node last used there).
- [ ] Publish an update feed for MeshSense Next, then re-enable update checks (`updateChecksEnabled` in
      `electron/src/main/index.ts`).
- [ ] Commit the staged work on `perf-fw28` (needs a git name and email on this machine).
- [ ] Decide on the inert "traceroute when hops change" trigger (see REVIEW.md bug 15).

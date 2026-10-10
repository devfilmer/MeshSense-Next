# MeshSense-Next review: speed, bugs, firmware 2.6 → 2.8.0

Branch `perf-fw28`. Measured with the mock device in `api/test` (250 nodes, 10 packets/s),
original `master` and this branch running side by side on identical traffic.

## Measured result

| Scenario | Before | After |
|---|---|---|
| UI main thread blocked, steady traffic | 74–83 % (cannot keep up; a 25 s timer took 42–56 s) | 5–8 % |
| UI main thread blocked while loading a 250-node device | 15.7 s | 1.05 s |
| First live packet after connecting over WiFi | up to 60 s | immediate |
| WebSocket messages to each client | one per state change (≈110 per second in the test) | one per 50 ms at most |

## Why it was slow, and what changed

| Cause | Fix | Files |
|---|---|---|
| Every state change was its own WebSocket message and its own full UI render pass | Events are queued and sent as one `stateBatch` every 50 ms; the UI applies a batch in one task | `api/src/lib/server.ts`, `ui/src/lib/wsc.ts` |
| Node icon SVG regenerated for every row on every pass | Cached per node | `ui/src/Map.svelte` |
| Node names resolved by scanning the node list (≈1,000 scans per log pass) | Lazy number → node index | `ui/src/lib/util.ts` |
| Log: unkeyed list, `toLocaleString` per row | Keyed rows, one shared date formatter | `ui/src/Log.svelte` |
| Node list filter was O(n²); distance sort looked up own node per comparison | Set lookup, hoisted | `ui/src/Nodes.svelte` |
| Map layers rebuilt on every node change | At most once per second | `ui/src/Map.svelte` |
| Every FromRadio message was copied and broadcast to all clients | Only a tick while configuring | `api/src/meshtastic.ts` |
| Library logged every packet with stack capture | Info level by default (`MESHTASTIC_LOG_LEVEL` to change) | `api/meshtastic-js/src/meshDevice.ts` |
| HTTP read loop waited for an acknowledgement the device never sends | Read loop starts straight away | `api/meshtastic-js/src/adapters/httpConnection.ts` |

## Bugs

| # | Bug | Impact | Status |
|---|---|---|---|
| 1 | `isAuthorized` treated any address containing `ffff` as local, so every IPv4 client; also passed when no key was set and no header sent | Connect, Disconnect, Delete Nodes, Set Position and Send were open to the network | Fixed (`api/src/lib/auth.ts`) |
| 2 | WebSocket `state` messages were accepted from anyone and could call any method | Any viewer could change settings, the access key and radio channels | Fixed: per-socket authorization, mutator whitelist |
| 3 | Access key and channel PSKs were sent to every viewer; the key was checked in the browser | Keys leaked to read-only viewers | Fixed: withheld unless authorized; the server decides access |
| 4 | `/consoleLog` and `/deviceConfig` trusted the `Host` header and took the key in the URL | Readable remotely | Fixed: bearer token, same check as the rest |
| 5 | `State.subscribe` unsubscribed the wrong function | Listener leak on every component unmount | Fixed |
| 6 | Queued WebSocket messages were never cleared | Old changes replayed on every reconnect | Fixed |
| 7 | `/deleteNodes` never responded | Request hung | Fixed |
| 8 | `setPosition` sent `gpsMode: undefined` and could throw without position config | GPS mode silently reset | Fixed |
| 9 | Traceroute queue timer kept running after disconnect | `traceRoute(undefined)` on a dead connection | Fixed |
| 10 | Library threw on unknown port numbers and variants | With newer firmware the read loop aborted and status flapped | Fixed |
| 11 | Library never released ack listeners | Slow leak per packet sent | Fixed |
| 12 | Disabled channels were listed as message destinations (number compared with `'DISABLED'`) | Seven empty channels in the picker | Fixed |
| 13 | Message length counted characters, not bytes | Messages with emoji could exceed the radio limit | Fixed |
| 14 | A node heard directly kept showing its old multi-hop route on the map | Wrong route lines | Fixed in the map |
| 15 | "Traceroute when hops change" never triggers: the comparison reads the already-updated record | Traceroutes are only sent when a route is missing | **Not changed** – fixing it would add up to one traceroute per minute on a busy mesh. Marked in `api/src/meshtastic.ts` |
| 16 | BLE adapter polls every second and can overlap notification reads | Concurrent GATT reads | **Not changed** – could not be tested without Bluetooth hardware |
| 17 | `/traceRoute` and `/requestPosition` need no key | Remote viewers can trigger transmissions (rate limited) | **Not changed** – existing behaviour |
| 18 | Log Size setting applies per keystroke | Typing "5" on the way to "500" trims the log | **Not changed** |
| 19 | Every node showed "last heard: now" right after connecting to a 2.8 device (also in the public MeshSense) | 2.8 firmware replays each stored node's last position/telemetry/status as ordinary packets after configuration, stamped with the device's `last_heard`; MeshSense stamped every incoming packet with the current time, so history looked like live activity, RSSI was wiped (replays carry none), and replayed positions were forwarded to the global map | Fixed: last-heard now comes from the packet's own timestamp when present; RSSI kept; replays older than 10 min not forwarded; neighbor-info uses `lastRxTime` |

## Firmware support (protobufs 2.5.9 → 2.8.0)

`meshtastic-js` is now a normal folder in this repo.

| Feature | Since | Where it shows |
|---|---|---|
| XEdDSA packet signing | 2.8 | 🔏 on log rows and nodes; "Packet Signing" in own-node detail |
| Mesh beacon | 2.8 | Log row with the beacon text and offered channel |
| Lockdown status | 2.8 | Notice in the Address card when locked or unprovisioned |
| Lightning telemetry | 2.8 | ⚡ chip on the node |
| New presets, ham regions, signature policy, region preset map | 2.8 | Device Config |
| Node status message | 2.7 | Line under the node; log row |
| Transport label (MQTT / UDP / API) | 2.7 | Log SNR column |
| Device notifications | 2.6–2.7 | Log row |
| Relay node | 2.6 | Tooltip on the Hops cell |
| Unmessagable, favorite, muted, ignored | 2.6–2.7 | Node badges; unmessagable nodes left out of the message picker |
| PKI-encrypted packets | 2.5 | 🔒 on log rows |
| Alert messages | 2.6 | Message with 🔔 |
| Environment, power, air quality, local stats, health, host and traffic-management telemetry | 2.6–2.8 | Summary chip in the log |
| Any other port (`LORA_OTA`, `ATAK_PLUGIN_V2`, `REMOTE_SHELL`, …) | — | Shown by name instead of blank |

Checked against the 2.8.0.47db0e3 source: the firmware only signs a packet when the signature
still fits, so the 230-byte text limit stands (long messages go out unsigned).
Not checked: Set Position still asks for full precision on channel 0; 2.8 is expected to clamp that
on default-key channels.

## Raspberry Pi build (protouch, Pi 4, Debian 12, Node 18.20.4) — 2026-10-04

Built from source on the Pi and tested against the mock device and the access-control suite; no
real radio was in range during the session.

- Prerequisite beyond the README: `sudo apt install libdbus-1-dev` (SimpleBLE needs it; the README
  mentions it only for Debian desktops). Compile of the Bluetooth addon: ~2.5 min with
  `npx cmake-js compile --parallel 4`; whole build about 15 min including npm installs.
- The addon works for user `pi` without extra permissions: it scanned and listed nearby BLE devices,
  and `node-ble` reports adapter `hci0`.
- **Node 18 blocker, fixed:** Node 18 has no global Web Crypto, so `meshtastic-js` threw
  `crypto is not defined` on every connect and MeshSense stayed "disconnected" with the error swallowed.
  `api/src/lib/webcrypto.ts` now polyfills it (Electron and Node 19+ are unaffected).
- Production bundle (`node dist/index.cjs`) connects to the mock, serves the UI, and all 24
  access-control checks pass when run on the Pi with its LAN address as the remote client.
- `npm run build` in `api` does not copy the UI into `dist/static`; `ui`'s own build script writes
  there directly, so build the UI with its `npm run build` (not a custom `--outDir`) before bundling.
- `api/tsconfig.json` now excludes `webbluetooth` and `meshtastic-js`, which removes ~85 bogus
  TypeScript warnings from CMake-generated files during the rollup build.

## Not verified

- No real radio and no Bluetooth: everything above ran against the mock device over HTTP.
- `api/webbluetooth` could not be compiled here (no CMake), so the Electron package was not built.
- `svelte-check` still reports 3 type errors in `ui/src/lib/util.ts` that were there before.

## Reproducing

```sh
cd api
node test/mockDevice.mjs
ADDRESS=127.0.0.1:4403 npx vite-node -c test/vite.stub.config.mjs src/index.ts
node test/securityTest.mjs <port> <LAN address of this machine>
```

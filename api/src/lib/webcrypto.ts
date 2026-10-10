import { webcrypto } from 'node:crypto'

// Node 18 does not expose the Web Crypto global that meshtastic-js uses for packet ids (Electron and Node 19+ do).
// Imported first from the entry point so it is in place before any connection is created.
;(globalThis as any).crypto ??= webcrypto

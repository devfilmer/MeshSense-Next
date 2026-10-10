import { fileURLToPath } from 'url'
export default {
  resolve: {
    alias: [{ find: /^\.\/lib\/bluetooth$/, replacement: fileURLToPath(new URL('./bluetoothStub.ts', import.meta.url)) }]
  }
}

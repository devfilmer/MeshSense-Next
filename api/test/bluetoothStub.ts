// Stand-in for api/src/lib/bluetooth.ts when the native Bluetooth addon is not built
export let bluetoothDevices: Record<string, any> = {}
export async function beginScanning(targetId?: string) {}
export function stopScanning() {}

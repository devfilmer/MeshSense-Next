import { createBluetooth } from 'node-ble'

/** Reads and clears the Linux Bluetooth (BlueZ) link to a device, independent of the scanner. */

/** True when BlueZ still holds a connection to this address, e.g. left behind by a crashed process */
export async function isBluezConnected(address: string): Promise<boolean> {
  const { bluetooth, destroy } = createBluetooth()
  try {
    const adapter = await bluetooth.defaultAdapter()
    const device = await adapter.getDevice(address)
    return String(await device.isConnected()) == 'true'
  } catch {
    return false
  } finally {
    destroy()
  }
}

/** Drops the BlueZ link so the radio goes back to advertising and a scan can find it */
export async function clearBluezLink(address: string, shouldAbort?: () => boolean): Promise<boolean> {
  const { bluetooth, destroy } = createBluetooth()
  try {
    const adapter = await bluetooth.defaultAdapter()
    const device = await adapter.getDevice(address)
    // The app may have opened its own connection while this was starting; never drop that one
    if (shouldAbort?.()) return false
    await device.disconnect()
    return true
  } catch (e) {
    console.warn('[bluetooth] Unable to clear the Bluetooth link', String(e))
    return false
  } finally {
    destroy()
  }
}

/** True or false when BlueZ knows the device, undefined when it has no record of it yet */
export async function isBluezPaired(address: string): Promise<boolean | undefined> {
  const { bluetooth, destroy } = createBluetooth()
  try {
    const adapter = await bluetooth.defaultAdapter()
    const device = await adapter.getDevice(address)
    return String(await device.isPaired()) == 'true'
  } catch {
    return undefined
  } finally {
    destroy()
  }
}

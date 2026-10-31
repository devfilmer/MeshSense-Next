import dbus from 'dbus-next'
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

/** BlueZ pairing errors, in words a user can act on */
const pairingErrors: Record<string, string> = {
  'org.bluez.Error.AuthenticationFailed': 'The radio rejected the PIN. Check the PIN and try again.',
  'org.bluez.Error.AuthenticationRejected': 'The radio rejected the PIN. Check the PIN and try again.',
  'org.bluez.Error.AuthenticationCanceled': 'The radio stopped the pairing, which it can do after several wrong PINs in a row. Wait about 30 seconds, check the PIN, and try again.',
  'org.bluez.Error.AuthenticationTimeout': 'The radio did not respond in time. Move it closer and try again.',
  'org.bluez.Error.ConnectionAttemptFailed': 'Could not reach the radio. Move it closer and make sure no other app is connected to it.',
  'org.bluez.Error.AlreadyExists': 'The radio is already paired.',
  'org.bluez.Error.InProgress': 'Another pairing is already in progress. Wait a moment and try again.',
  'org.bluez.Error.Failed': 'Pairing failed. Make sure no other app is connected to the radio, then try again.'
}

const agentPath = '/org/meshsense/agent'

/** The pairing in progress, so the user can cancel it */
let currentPairing: { cancel: () => Promise<void>; cancelled: boolean } | undefined

/** The device object with its Device1 interface, or undefined when BlueZ does not currently have it */
async function getBluezDevice(bus: dbus.MessageBus, devicePath: string) {
  try {
    const device = await bus.getProxyObject('org.bluez', devicePath)
    device.getInterface('org.bluez.Device1')
    return device
  } catch {
    return undefined
  }
}

/** Cancels the pairing in progress, if any. Returns whether there was one. */
export async function cancelBluezPairing(): Promise<boolean> {
  if (!currentPairing) return false
  currentPairing.cancelled = true
  await currentPairing.cancel().catch(() => {})
  return true
}

/** Answers BlueZ's request for a PIN during one pairing, then goes away. Never logs or keeps the PIN beyond that. */
function createPinAgent(pin: string) {
  class PinAgent extends dbus.interface.Interface {
    Release() {}
    RequestPinCode(_device: string) {
      return pin
    }
    RequestPasskey(_device: string) {
      return Number(pin)
    }
    DisplayPinCode(_device: string, _code: string) {}
    DisplayPasskey(_device: string, _passkey: number, _entered: number) {}
    RequestConfirmation(_device: string, _passkey: number) {}
    RequestAuthorization(_device: string) {}
    AuthorizeService(_device: string, _uuid: string) {}
    Cancel() {}
  }
  PinAgent.configureMembers({
    methods: {
      Release: { inSignature: '', outSignature: '' },
      RequestPinCode: { inSignature: 'o', outSignature: 's' },
      RequestPasskey: { inSignature: 'o', outSignature: 'u' },
      DisplayPinCode: { inSignature: 'os', outSignature: '' },
      DisplayPasskey: { inSignature: 'ouq', outSignature: '' },
      RequestConfirmation: { inSignature: 'ou', outSignature: '' },
      RequestAuthorization: { inSignature: 'o', outSignature: '' },
      AuthorizeService: { inSignature: 'os', outSignature: '' },
      Cancel: { inSignature: '', outSignature: '' }
    }
  })
  return new PinAgent('org.bluez.Agent1')
}

/**
 * Pairs the radio with this computer using a PIN, as `bluetoothctl pair` would, so no one has to use the Pi's own
 * Bluetooth settings. Resolves to `{ ok, message }`; the message is meant to be shown to the user.
 */
export async function pairBluezDevice(address: string, pin: string, onStatus?: (message: string) => void): Promise<{ ok: boolean; message: string }> {
  const bus = dbus.systemBus()
  const agent = createPinAgent(pin)
  let registered = false
  // Cancel does nothing until the device is known; the cancelled flag is checked at each step before then
  currentPairing = { cancel: async () => {}, cancelled: false }
  try {
    const bluez = await bus.getProxyObject('org.bluez', '/org/bluez')
    const adapterPath = bluez.nodes.find((n) => /^\/org\/bluez\/hci\d+$/.test(n))
    if (!adapterPath) return { ok: false, message: 'No Bluetooth adapter was found on this computer.' }
    const devicePath = `${adapterPath}/dev_${address.toUpperCase().replace(/:/g, '_')}`

    bus.export(agentPath, agent)
    const manager = bluez.getInterface('org.bluez.AgentManager1')
    await manager.RegisterAgent(agentPath, 'KeyboardOnly')
    registered = true
    await manager.RequestDefaultAgent(agentPath)

    // BlueZ forgets an unpaired radio shortly after a failed pairing or once scanning stops. Then look for it
    // briefly with our own discovery, so trying again straight away works instead of failing with an internal error.
    let device = await getBluezDevice(bus, devicePath)
    if (!device) {
      onStatus?.('Looking for the radio over Bluetooth before sending the PIN…')
      const adapter1 = (await bus.getProxyObject('org.bluez', adapterPath)).getInterface('org.bluez.Adapter1')
      await adapter1.StartDiscovery().catch(() => {})
      for (let i = 0; i < 15 && !device && !currentPairing.cancelled; i++) {
        await new Promise((resolve) => setTimeout(resolve, 1000))
        device = await getBluezDevice(bus, devicePath)
      }
      await adapter1.StopDiscovery().catch(() => {})
      if (currentPairing.cancelled) return { ok: false, message: 'Pairing cancelled.' }
      if (!device) return { ok: false, message: 'The radio was not found over Bluetooth. Check that it is on and nearby, then try again.' }
      onStatus?.('Sending the PIN and waiting for the radio to accept it. This can take up to 30 seconds…')
    }
    const device1 = device.getInterface('org.bluez.Device1')
    currentPairing.cancel = () => device1.CancelPairing()
    if (currentPairing.cancelled) return { ok: false, message: 'Pairing cancelled.' }
    await device1.Pair()
    // Remember the radio so the link can be reopened without asking again
    await device.getInterface('org.freedesktop.DBus.Properties').Set('org.bluez.Device1', 'Trusted', new dbus.Variant('b', true)).catch(() => {})
    return { ok: true, message: 'Paired.' }
  } catch (e: any) {
    if (currentPairing?.cancelled) return { ok: false, message: 'Pairing cancelled.' }
    const known = pairingErrors[String(e?.type)]
    console.warn('[bluetooth] Pairing failed:', String(e?.type ?? e?.message ?? e))
    return { ok: false, message: known ?? 'Pairing failed. Make sure no other app is connected to the radio, then try again.' }
  } finally {
    currentPairing = undefined
    if (registered) {
      const bluez = await bus.getProxyObject('org.bluez', '/org/bluez').catch(() => undefined)
      await bluez?.getInterface('org.bluez.AgentManager1').UnregisterAgent(agentPath).catch(() => {})
    }
    try {
      bus.unexport(agentPath, agent)
    } catch {}
    bus.disconnect()
  }
}

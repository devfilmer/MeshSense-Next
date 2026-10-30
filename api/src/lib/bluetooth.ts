import { Bluetooth } from '../../webbluetooth/dist'
import { State } from './state'
import { bluetoothInfo, connectionStatus, radioName, radioNameAddress } from '../vars'
import { clearBluezLink, isBluezConnected, isBluezPaired } from './bluez'
import { BluetoothDeviceImpl } from '../../webbluetooth/dist/device'
import { createBluetooth } from 'node-ble'

export let bluetoothDevices: Record<string, BluetoothDeviceImpl> = {}
let bluetoothDeviceList = new State('bluetoothDeviceList', [], { primaryKey: 'id', hideLog: true })

let scanning = false
let exitScanning = false
let deviceTargetId = ''
/** Every device heard during the scan in progress, by id */
let heardThisScan = new Map<string, BluetoothDeviceImpl>()
/** Ends the scan in progress by selecting a device the library already reported */
let endScan: (() => void) | undefined
const bluetooth = new Bluetooth({
  scanTime: 10,
  // Keep listening through other devices' advertisements and end early only for the radio being looked for.
  // Ending at the first device heard meant busy devices nearby won almost every scan and a radio was rarely found.
  deviceFound(device, select) {
    heardThisScan.set(device.id, device)
    endScan = select
    return device.id == deviceTargetId
  }
})

/** Signal strength from the last advertisement. The library keeps it in its advertisement data, not on `rssi`. */
function deviceRssi(device: BluetoothDeviceImpl): number | undefined {
  return device.rssi ?? (device as any)._adData?.rssi
}

function updateBluetoothInfo(update: object) {
  bluetoothInfo.set({ ...bluetoothInfo.value, ...update })
}

/** Bumped whenever the scan loop is stopped or restarted, so a late-finishing old loop never schedules itself again */
let scanGeneration = 0
/** When the scan loop last started a scan; the watchdog restarts the loop when this gets old */
let lastScanCycleAt = 0
/** Settles when the scan in progress ends */
let scanCycle: Promise<void> = Promise.resolve()

/** Loop to show devices consistently */
export async function scanForDevice(expectedGeneration?: number) {
  // A tick scheduled by a loop that has since been stopped or replaced must not start a second loop
  if (exitScanning || (expectedGeneration !== undefined && expectedGeneration != scanGeneration)) return
  const generation = scanGeneration
  lastScanCycleAt = Date.now()
  let endCycle: () => void
  scanCycle = new Promise((resolve) => (endCycle = resolve))

  console.log('[bluetooth] scanning...')

  let scanError = ''
  heardThisScan = new Map()
  endScan = undefined
  // When no device is selected the library never settles its request, so end the scan just before its own timeout
  const scanTimer = setTimeout(() => endScan?.(), 9000)
  try {
    // The library throws "request in progress" synchronously instead of rejecting; turn that into a rejection
    // so it is handled like any other failed scan and the loop keeps going
    await Promise.resolve()
      .then(() => bluetooth.requestDevice({ acceptAllDevices: true }))
      .catch((e) => {
        // A scan that heard nothing at all is not an error
        if (String(e).includes('no devices found')) return
        scanError = String(e?.message ?? e)
        console.warn(e)
      })
    clearTimeout(scanTimer)

    for (const device of heardThisScan.values()) {
      console.log('[bluetooth] Device Detected |', device.id, device.name)
      bluetoothDevices[device.id] = device
      let { id, name } = device
      bluetoothDeviceList.upsert({ id, name, rssi: deviceRssi(device), seenAt: Date.now() })
    }

    const target = deviceTargetId ? heardThisScan.get(deviceTargetId) : undefined
    if (target) {
      updateBluetoothInfo({ targetSeenAt: Date.now(), targetRssi: deviceRssi(target) })
      // Without pairing the link opens and then fails, so tell the user instead of retrying silently
      isBluezPaired(target.id).then((paired) => {
        if (paired !== undefined) updateBluetoothInfo({ targetPaired: paired })
      })
      if (target.name && target.name != radioName.value) radioName.set(target.name)
      if (radioNameAddress.value != target.id) radioNameAddress.set(target.id)
      stopScanning()
    }

    updateBluetoothInfo({ scanning: !exitScanning, lastScanAt: Date.now(), devicesSeen: bluetoothDeviceList.value.length, lastError: scanError })
  } catch (e) {
    console.error('[bluetooth], Error encountered during scan', e)
  } finally {
    endCycle()
    // Always continue the loop, waiting longer after an error so a busy adapter is not hammered
    if (!exitScanning && generation == scanGeneration) setTimeout(() => scanForDevice(generation), scanError ? 2000 : 500)
  }
}

/** A scan takes at most about 10 s. If none has started for much longer, the loop has died; restart it. */
setInterval(() => {
  if (scanning && !exitScanning && Date.now() - lastScanCycleAt > 30000) {
    console.warn('[bluetooth] Scanning stalled; restarting it')
    scanning = false
    try {
      bluetooth.cancelRequest()
    } catch {}
    beginScanning(deviceTargetId)
  }
}, 10000)

/** Stops scanning and waits for the scan in progress to end, so the adapter is free (for example to pair) */
export async function pauseScanning() {
  stopScanning()
  try {
    bluetooth.cancelRequest()
  } catch {}
  await Promise.race([scanCycle, new Promise((resolve) => setTimeout(resolve, 12000))])
}

export async function beginScanning(targetId?: string) {
  // A different radio: forget what was learned about the previous one so its state is never shown for this one
  if (targetId && targetId != bluetoothInfo.value?.targetAddress) {
    updateBluetoothInfo({ targetAddress: targetId, targetPaired: undefined, targetSeenAt: 0, targetRssi: undefined, staleLinkCleared: false })
  }
  deviceTargetId = targetId
  delete bluetoothDevices[targetId]
  // Check pairing even if a scan is already running, so the status is right for this radio
  if (targetId) {
    isBluezPaired(targetId).then((paired) => {
      if (paired !== undefined && targetId == bluetoothInfo.value?.targetAddress) updateBluetoothInfo({ targetPaired: paired })
    })
  }
  // A second call while the first is still checking the adapter would start a second scan loop
  if (scanning || startingScan) {
    console.warn('Already Scanning')
    return
  }
  startingScan = true
  try {
    await startScanLoop(targetId)
  } finally {
    startingScan = false
  }
}

/** True while beginScanning checks the link and adapter, before the loop has started */
let startingScan = false

async function startScanLoop(targetId?: string) {
  console.log('[bluetooth] Begin Scanning')

  let adapterAvailable = false

  /** A radio still connected at the BlueZ level stops advertising, so the scan would never find it. Clear that link first. */
  if (targetId) {
    try {
      // Only a link nobody in this process owns is stale. Once the app is connecting or connected, the link is ours.
      const appOwnsLink = () => ['connecting', 'configuring', 'connected'].includes(connectionStatus.value as string)
      if (!appOwnsLink() && (await isBluezConnected(targetId)) && !appOwnsLink()) {
        console.log('[bluetooth] Radio still has a Bluetooth link from an earlier session; clearing it')
        const cleared = await clearBluezLink(targetId, appOwnsLink)
        updateBluetoothInfo({ staleLinkCleared: cleared })
      }
    } catch (e) {
      console.warn('[bluetooth] Unable to check the Bluetooth link', String(e))
    }
  }

  /** Look for an available bluetooth adapter */
  try {
    if (process.platform == 'linux') {
      // Each createBluetooth() opens a new system D-Bus connection; close it once the check is done
      let { bluetooth: dbusBluetooth, destroy } = createBluetooth()
      try {
        adapterAvailable = (await dbusBluetooth.adapters()).length > 0
      } finally {
        destroy()
      }
    } else {
      adapterAvailable = await bluetooth.getAvailability()
    }
  } catch (e) {
    console.warn('[bluetooth] Unable to detect Bluetooth adapters')
  }

  console.log('[bluetooth] Adapter available:', adapterAvailable)
  updateBluetoothInfo({ adapterAvailable })
  if (adapterAvailable) {
    scanning = true
    scanGeneration++
    exitScanning = false
    scanForDevice()
  }
}

export function stopScanning() {
  if (scanning) console.log('[bluetooth] Stop Scanning')
  exitScanning = true
  scanGeneration++
  scanning = false
  updateBluetoothInfo({ scanning: false })
}

// console.log('BLUETOOTH', await bluetooth.getDevices())

// console.log('BLUETOOTH', await bluetooth.requestDevice({ filters: [{ services: '' }] }))

// console.log(
//   'BLUETOOTH aAD',
//   await bluetooth.requestDevice({
//     acceptAllDevices: true
//     // exclusionFilters: [{ services: [] }]
//   })
// )

/** Custom deviceFound logic. Seems to stop at first device **/
// let b = new Bluetooth({
//   scanTime: 60,
//   deviceFound(device, selectFn) {
//     console.log('DEVICEFOUND', device.id, device.name)
//     return true
//   },
//   allowAllDevices: true
// })
// console.log('REQUESTDEVICE', await b.requestDevice({ acceptAllDevices: true }))

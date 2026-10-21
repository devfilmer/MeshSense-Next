import { Bluetooth } from '../../webbluetooth/dist'
import { State } from './state'
import { bluetoothInfo, connectionStatus, radioName } from '../vars'
import { clearBluezLink, isBluezConnected, isBluezPaired } from './bluez'
import { BluetoothDeviceImpl } from '../../webbluetooth/dist/device'
import { createBluetooth } from 'node-ble'

export let bluetoothDevices: Record<string, BluetoothDeviceImpl> = {}
let bluetoothDeviceList = new State('bluetoothDeviceList', [], { primaryKey: 'id', hideLog: true })

let scanning = false
let exitScanning = false
let deviceTargetId = ''
const bluetooth = new Bluetooth({ scanTime: 10 })

/** Signal strength from the last advertisement. The library keeps it in its advertisement data, not on `rssi`. */
function deviceRssi(device: BluetoothDeviceImpl): number | undefined {
  return device.rssi ?? (device as any)._adData?.rssi
}

function updateBluetoothInfo(update: object) {
  bluetoothInfo.set({ ...bluetoothInfo.value, ...update })
}

/** Loop to show devices consistently */
export async function scanForDevice() {
  if (exitScanning) return

  console.log('[bluetooth] scanning...')

  try {
    let scanError = ''
    let device: BluetoothDeviceImpl = await bluetooth.requestDevice({ acceptAllDevices: true }).catch((e) => {
      scanError = String(e?.message ?? e)
      console.warn(e)
    })
    // let device = await bluetooth.requestDevice({ filters: [{ services: [Constants.ServiceUuid] }] }).catch((e) => console.error(e))
    // let device = await bluetooth.requestDevice({ filters: [{ serviceData: [] }] }).catch((e) => console.error(e))
    // let device = await bluetooth
    //   .requestDevice({
    //     filters: [{ services: ['00001801-0000-1000-8000-00805f9b34fb'] }, { services: ['6ba1b218-15a8-461f-9fa8-5dcae273eafd'] }, { services: ['0000180f-0000-1000-8000-00805f9b34fb'] }]
    //   })
    //   .catch((e) => console.error(e))

    // device.gatt.disconnect()

    if (device) {
      console.log('[bluetooth] Device Detected |', device.id, device.name)
      bluetoothDevices[device.id] = device
      let { id, name } = device
      bluetoothDeviceList.upsert({ id, name, rssi: deviceRssi(device) })
      if (id == deviceTargetId) {
        updateBluetoothInfo({ targetSeenAt: Date.now(), targetRssi: deviceRssi(device) })
        // Without pairing the link opens and then fails, so tell the user instead of retrying silently
        isBluezPaired(id).then((paired) => {
          if (paired !== undefined) updateBluetoothInfo({ targetPaired: paired })
        })
        if (device.name && device.name != radioName.value) radioName.set(device.name)
        stopScanning()
      }
    }

    updateBluetoothInfo({ scanning: !exitScanning, lastScanAt: Date.now(), devicesSeen: bluetoothDeviceList.value.length, lastError: scanError })
    if (!exitScanning) setTimeout(scanForDevice, 500)
  } catch (e) {
    console.error('[bluetooth], Error encountered during scan', e)
  }
}

export async function beginScanning(targetId?: string) {
  deviceTargetId = targetId
  delete bluetoothDevices[targetId]
  if (scanning) {
    console.warn('Already Scanning')
    return
  }
  console.log('[bluetooth] Begin Scanning')

  let adapterAvailable = false

  /** A radio still connected at the BlueZ level stops advertising, so the scan would never find it. Clear that link first. */
  if (targetId) {
    try {
      const paired = await isBluezPaired(targetId)
      if (paired !== undefined) updateBluetoothInfo({ targetPaired: paired })
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
    exitScanning = false
    scanForDevice()
  }
}

export function stopScanning() {
  if (scanning) console.log('[bluetooth] Stop Scanning')
  exitScanning = true
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

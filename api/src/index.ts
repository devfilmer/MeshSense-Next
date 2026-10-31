import './lib/webcrypto'
import 'dotenv/config'
import './lib/persistence'
import { app, createRoutes, finalize, server } from './lib/server'
import './meshtastic'
import { connect, disconnect, deleteNodes, requestPosition, send, traceRoute, setPosition, deviceConfig } from './meshtastic'
import { address, apiPort, bluetoothInfo, currentTime, apiHostname, accessKey, autoConnectOnStartup, meshSenseNewsDate, allowRemoteMessaging, pairingStatus } from './vars'
import { cancelBluezPairing, pairBluezDevice } from './lib/bluez'
import { beginScanning, pauseScanning } from './lib/bluetooth'
import { hostname } from 'os'
import intercept from 'intercept-stdout'
import { createWriteStream } from 'fs'
import { dataDirectory } from './lib/paths'
import { join } from 'path'
import axios from 'axios'
import { isAuthorized } from './lib/auth'
setInterval(() => currentTime.set(Date.now()), 15000)

process.on('uncaughtException', (err, origin) => {
  console.error('[system] Uncaught Exception', err)
})

let consoleLog = []
let logSize = 1000
/** Set when the user cancels a pairing before the PIN has been sent */
let pairCancelRequested = false

let lastLogStream = createWriteStream(join(dataDirectory, 'lastLog.txt'))
intercept(
  (text) => {
    lastLogStream.write(text)
    consoleLog.push(text)
    while (consoleLog.length >= logSize) consoleLog.shift()
  },
  (err) => {
    if (err.includes('Possible EventTarget memory leak detected')) return
    consoleLog.push(err)
    while (consoleLog.length >= logSize) consoleLog.shift()
  }
)

createRoutes((app) => {
  app.post('/send', (req, res) => {
    if (!allowRemoteMessaging.value && !isAuthorized(req)) return res.sendStatus(403)
    let message = req.body.message
    let destination = req.body.destination
    let channel = req.body.channel
    let wantAck = req.body.wantAck
    send({ message, destination, channel, wantAck })
    return res.sendStatus(200)
  })

  app.post('/traceRoute', async (req, res) => {
    let destination = req.body.destination
    await traceRoute(destination)
    return res.sendStatus(200)
  })

  app.post('/requestPosition', async (req, res) => {
    let destination = req.body.destination
    await requestPosition(destination)
    return res.sendStatus(200)
  })

  app.post('/deleteNodes', async (req, res) => {
    if (!isAuthorized(req)) return res.sendStatus(403)
    let nodes = req.body.nodes
    await deleteNodes(nodes)
    return res.sendStatus(200)
  })

  app.post('/connect', async (req, res) => {
    if (!isAuthorized(req)) return res.sendStatus(403)
    console.log('[express]', '/connect')
    connect(req.body.address || address.value)
    return res.sendStatus(200)
  })

  app.post('/pair', async (req, res) => {
    if (!isAuthorized(req)) return res.sendStatus(403)
    const pairAddress = String(req.body.address ?? '')
    const pin = String(req.body.pin ?? '')
    if (process.platform != 'linux') return res.status(400).json({ ok: false, message: 'Pairing from MeshSense is only available on Linux. Pair the radio in your system Bluetooth settings.' })
    if (!/^([0-9A-F]{2}:){5}[0-9A-F]{2}$/i.test(pairAddress)) return res.status(400).json({ ok: false, message: 'That is not a Bluetooth address.' })
    if (!/^\d{1,6}$/.test(pin)) return res.status(400).json({ ok: false, message: 'Enter the PIN as digits only (up to 6).' })
    if (pairingStatus.value.state == 'pairing') return res.status(409).json({ ok: false, message: 'Pairing is already in progress.' })
    // The PIN is never logged or stored
    console.log('[express]', '/pair', pairAddress)
    const startedAt = Date.now()
    pairCancelRequested = false
    pairingStatus.set({ state: 'pairing', message: 'Stopping the Bluetooth scan so the adapter is free…', address: pairAddress, at: startedAt })
    // Scanning and pairing share the adapter; a scan running during pairing fails and used to stop the scanner
    await pauseScanning()
    let result = { ok: false, message: 'Pairing cancelled.' }
    if (!pairCancelRequested) {
      pairingStatus.set({ state: 'pairing', message: 'Sending the PIN and waiting for the radio to accept it. This can take up to 30 seconds…', address: pairAddress, at: startedAt })
      result = await pairBluezDevice(pairAddress, pin, (message) => pairingStatus.set({ ...pairingStatus.value, message }))
    }
    const state = result.ok ? 'paired' : pairCancelRequested ? 'cancelled' : 'failed'
    pairingStatus.set({ state, message: state == 'cancelled' ? 'Pairing cancelled. Enter the PIN and press Pair to try again.' : result.message, address: pairAddress, at: Date.now() })
    if (result.ok) {
      bluetoothInfo.set({ ...bluetoothInfo.value, needsPairing: '', targetPaired: true })
      connect(pairAddress)
    } else beginScanning(pairAddress)
    return res.json(result)
  })

  app.post('/pair/cancel', async (req, res) => {
    if (!isAuthorized(req)) return res.sendStatus(403)
    console.log('[express]', '/pair/cancel')
    if (pairingStatus.value.state != 'pairing') return res.sendStatus(200)
    pairCancelRequested = true
    pairingStatus.set({ ...pairingStatus.value, message: 'Cancelling…' })
    await cancelBluezPairing()
    return res.sendStatus(200)
  })

  app.post('/disconnect', async (req, res) => {
    if (!isAuthorized(req)) return res.sendStatus(403)
    console.log('[express]', '/disconnect')
    disconnect()
    return res.sendStatus(200)
  })

  app.get('/consoleLog', async (req, res) => {
    if (!isAuthorized(req)) return res.sendStatus(403)
    return res.json(consoleLog)
  })

  app.get('/deviceConfig', async (req, res) => {
    if (!isAuthorized(req)) return res.sendStatus(403)
    return res.json(deviceConfig)
  })

  app.post('/position', async (req, res) => {
    if (!isAuthorized(req)) return res.sendStatus(403)
    console.log('[express]', '/position', req.body)
    setPosition(req.body)
    return res.sendStatus(200)
  })

  //** Set accessKey via environment variable */
  if (process.env.ACCESS_KEY) {
    accessKey.set(process.env.ACCESS_KEY)
  }

  if (process.env.ADDRESS) {
    address.set(process.env.ADDRESS)
  }

  //** Capture current hostname and port */
  apiHostname.set(hostname())
  apiPort.set((server.address() as any)?.port)

  // ** Check News Update */
  function checkForNews() {
    console.log('[news] Checking for news')
    axios
      .get('https://affirmatech.com/meshSenseNewsDate')
      .then((newDate) => {
        if (meshSenseNewsDate.value < newDate.data) {
          meshSenseNewsDate.set(newDate.data)
        }
      })
      .catch(() => {
        console.log('[news] Unable to get latest news')
      })
  }

  checkForNews()

  if ((process.env.ADDRESS || autoConnectOnStartup.value) && address.value) connect(address.value)
})

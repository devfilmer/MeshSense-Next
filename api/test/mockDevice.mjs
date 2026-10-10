// Mock Meshtastic device speaking the HTTP client API (firmware 2.8 protobufs), for running MeshSense Next without a radio.
//
//   node test/mockDevice.mjs                      (env: MOCK_PORT=4403 NODES=250 PPS=10 LEGACY=0)
//   ADDRESS=127.0.0.1:4403 npx vite-node -c test/vite.stub.config.mjs src/index.ts
//
// The second command starts the API against the mock with Bluetooth stubbed out, so the native addon is not needed.
// LEGACY=1 limits traffic to messages a 2.5-era client understands.
import http from 'http'

const lib = await import(process.env.LIB ?? '../meshtastic-js/dist/index.js')
const { Protobuf, create, toBinary, fromBinary } = lib
const { Mesh, Portnums, Telemetry, Channel, Config } = Protobuf
const PortNum = Portnums.PortNum

const port = Number(process.env.MOCK_PORT ?? 4403)
const nodeCount = Number(process.env.NODES ?? 250)
const pps = Number(process.env.PPS ?? 10)
const myNodeNum = 0x0badc0de

let queue = []
let fromRadioId = 1
let sent = 0

// Deterministic pseudo random
let seed = 12345
const rand = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff)
const pick = (list) => list[Math.floor(rand() * list.length)]

const nodeNums = [myNodeNum]
for (let i = 1; i < nodeCount; i++) nodeNums.push(0x10000000 + Math.floor(rand() * 0xe0000000))

const enqueue = (payloadVariant) => queue.push(toBinary(Mesh.FromRadioSchema, create(Mesh.FromRadioSchema, { id: fromRadioId++, payloadVariant })))

function user(num, i) {
  return create(Mesh.UserSchema, {
    id: '!' + num.toString(16).padStart(8, '0'),
    longName: `Mock Node ${i}`,
    shortName: 'M' + i.toString(36).toUpperCase().padStart(3, '0').slice(-3),
    hwModel: 43,
    role: i % 13,
    publicKey: new Uint8Array(32).fill(i % 256),
    isUnmessagable: i % 17 == 0
  })
}

function position(i) {
  return create(Mesh.PositionSchema, {
    latitudeI: Math.round((39.5 + (rand() - 0.5) * 0.8) * 1e7),
    longitudeI: Math.round((-90.3 + (rand() - 0.5) * 0.8) * 1e7),
    altitude: 150 + (i % 50),
    time: Math.floor(Date.now() / 1000)
  })
}

function sendConfig(nonce) {
  enqueue({ case: 'myInfo', value: create(Mesh.MyNodeInfoSchema, { myNodeNum, rebootCount: 7, minAppVersion: 30200, pioEnv: 'mock-device', nodedbCount: nodeCount }) })
  enqueue({ case: 'metadata', value: create(Mesh.DeviceMetadataSchema, { firmwareVersion: '2.8.0.47db0e3', hasWifi: true, hasBluetooth: true, hasPKC: true, hasXeddsa: true, role: 0, hwModel: 43 }) })
  nodeNums.forEach((num, i) => {
    enqueue({
      case: 'nodeInfo',
      value: create(Mesh.NodeInfoSchema, {
        num,
        user: user(num, i),
        position: i % 5 == 4 ? undefined : position(i),
        snr: Math.round((rand() * 20 - 10) * 4) / 4,
        lastHeard: Math.floor(Date.now() / 1000) - Math.floor(rand() * 3000),
        hopsAway: i == 0 ? 0 : i % 4,
        isFavorite: i % 40 == 1,
        hasXeddsaSigned: i % 3 == 0,
        isKeyManuallyVerified: i % 30 == 0,
        deviceMetrics: create(Telemetry.DeviceMetricsSchema, { batteryLevel: 20 + (i % 80), voltage: 3.6 + (i % 6) / 10, channelUtilization: i % 30, airUtilTx: 1.5 })
      })
    })
  })
  for (let index = 0; index < 8; index++) {
    enqueue({
      case: 'channel',
      value: create(Channel.ChannelSchema, { index, role: index == 0 ? 1 : index == 1 ? 2 : 0, settings: create(Channel.ChannelSettingsSchema, { name: index == 0 ? 'LongTurbo' : index == 1 ? 'Private' : '', psk: new Uint8Array([1, 2, 3, 4]) }) })
    })
  }
  enqueue({ case: 'config', value: create(Config.ConfigSchema, { payloadVariant: { case: 'lora', value: create(Config.Config_LoRaConfigSchema, { usePreset: true, modemPreset: Config.Config_LoRaConfig_ModemPreset.TINY_FAST, region: 1, hopLimit: 3 }) } }) })
  enqueue({ case: 'config', value: create(Config.ConfigSchema, { payloadVariant: { case: 'position', value: create(Config.Config_PositionConfigSchema, { gpsMode: 1, fixedPosition: false }) } }) })
  if (!legacy) enqueue({ case: 'regionPresets', value: create(Mesh.LoRaRegionPresetMapSchema, { groups: [create(Mesh.LoRaPresetGroupSchema, { presets: [0, 14, 15], defaultPreset: 14 })] }) })
  if (!legacy) enqueue({ case: 'lockdownStatus', value: create(Mesh.LockdownStatusSchema, { state: Mesh.LockdownStatus_State.UNLOCKED }) })
  enqueue({ case: 'configCompleteId', value: nonce })
  console.log(`[mock] queued config for ${nodeCount} nodes`)
  if (!legacy) replayHistory()
}

/** Firmware 2.8 replays each stored node's last position and telemetry as packets stamped with its last_heard */
function replayHistory() {
  let replayed = 0
  nodeNums.forEach((num, i) => {
    if (i == 0) return
    let lastHeard = Math.floor(Date.now() / 1000) - 600 - Math.floor(rand() * 86400)
    let hopsAway = i % 4
    let packet = { from: num, to: 0xffffffff, channel: 0, rxTime: lastHeard, rxSnr: 3.5, hopStart: 3, hopLimit: 3 - hopsAway, priority: 10, transportMechanism: 1 }
    if (i % 5 != 4) {
      enqueue({ case: 'packet', value: create(Mesh.MeshPacketSchema, { ...packet, id: (num * 7 + 1) >>> 0, payloadVariant: { case: 'decoded', value: create(Mesh.DataSchema, { portnum: PortNum.POSITION_APP, payload: toBinary(Mesh.PositionSchema, position(i)) }) } }) })
      replayed++
    }
    enqueue({ case: 'packet', value: create(Mesh.MeshPacketSchema, { ...packet, id: (num * 7 + 2) >>> 0, payloadVariant: { case: 'decoded', value: create(Mesh.DataSchema, { portnum: PortNum.TELEMETRY_APP, payload: toBinary(Telemetry.TelemetrySchema, create(Telemetry.TelemetrySchema, { time: lastHeard, variant: { case: 'deviceMetrics', value: create(Telemetry.DeviceMetricsSchema, { batteryLevel: 20 + (i % 80), voltage: 3.7, channelUtilization: i % 30, airUtilTx: 1 }) } })) }) } }) })
    replayed++
  })
  console.log(`[mock] queued ${replayed} replayed history packets`)
}

const text = (s) => new TextEncoder().encode(s)

/** Field 1 (string) of meshtastic.MeshBeacon */
function beacon(message) {
  let bytes = text(message)
  return new Uint8Array([0x0a, bytes.length, ...bytes])
}

const legacy = process.env.LEGACY == '1'
let generators = [
  () => [PortNum.POSITION_APP, toBinary(Mesh.PositionSchema, position(1))],
  () => [PortNum.POSITION_APP, toBinary(Mesh.PositionSchema, position(2))],
  () => [PortNum.TELEMETRY_APP, toBinary(Telemetry.TelemetrySchema, create(Telemetry.TelemetrySchema, { time: 1, variant: { case: 'deviceMetrics', value: create(Telemetry.DeviceMetricsSchema, { batteryLevel: 50 + Math.floor(rand() * 50), voltage: 3.9, channelUtilization: rand() * 30, airUtilTx: 2 }) } }))],
  () => [PortNum.TELEMETRY_APP, toBinary(Telemetry.TelemetrySchema, create(Telemetry.TelemetrySchema, { time: 1, variant: { case: 'deviceMetrics', value: create(Telemetry.DeviceMetricsSchema, { batteryLevel: 80, voltage: 4.1, channelUtilization: rand() * 30, airUtilTx: 2 }) } }))],
  () => [PortNum.TELEMETRY_APP, toBinary(Telemetry.TelemetrySchema, create(Telemetry.TelemetrySchema, { time: 1, variant: { case: 'environmentMetrics', value: create(Telemetry.EnvironmentMetricsSchema, { temperature: 21.4, relativeHumidity: 48, barometricPressure: 1012, lightningStrikeCount1h: 3, lightningDistanceKm: 12 }) } }))],
  () => [PortNum.TELEMETRY_APP, toBinary(Telemetry.TelemetrySchema, create(Telemetry.TelemetrySchema, { time: 1, variant: { case: 'localStats', value: create(Telemetry.LocalStatsSchema, { numOnlineNodes: 42, numTotalNodes: nodeCount, channelUtilization: 12.5, airUtilTx: 1.2, noiseFloor: -112 }) } }))],
  () => [PortNum.NODEINFO_APP, toBinary(Mesh.UserSchema, user(pick(nodeNums), Math.floor(rand() * nodeCount)))],
  () => [PortNum.TEXT_MESSAGE_APP, text('Hello mesh ' + sent)],
  () => [PortNum.NODE_STATUS_APP, toBinary(Mesh.StatusMessageSchema, create(Mesh.StatusMessageSchema, { status: 'On the trail, back at 6' }))],
  () => [PortNum.MESH_BEACON_APP, beacon('Join the county mesh')],
  () => [PortNum.ALERT_APP, text('Severe weather alert')],
  () => [PortNum.LORA_OTA_APP, new Uint8Array([1, 2, 3, 4, 5])],
  () => [PortNum.ROUTING_APP, toBinary(Mesh.RoutingSchema, create(Mesh.RoutingSchema, { variant: { case: 'errorReason', value: 0 } }))]
]

// Legacy mode keeps to messages a 2.5-era client understands, for like-for-like comparisons
if (legacy) generators = [0, 1, 2, 3, 4, 6, 7, 12].map((i) => generators[i])

function sendPacket() {
  let from = nodeNums[1 + Math.floor(rand() * (nodeNums.length - 1))]
  let hopStart = 3
  let hops = Math.floor(rand() * 4)
  let packet = { from, to: 0xffffffff, channel: 0, id: Math.floor(rand() * 0xffffffff), rxTime: Math.floor(Date.now() / 1000), rxSnr: Math.round((rand() * 20 - 10) * 4) / 4, rxRssi: -60 - Math.floor(rand() * 60), hopStart, hopLimit: hopStart - hops, relayNode: hops ? pick(nodeNums) & 0xff : 0, transportMechanism: 1 }
  if (sent % 15 == 14) {
    packet.payloadVariant = { case: 'encrypted', value: new Uint8Array(40).fill(7) }
  } else {
    let [portnum, payload] = generators[sent % generators.length]()
    packet.xeddsaSigned = sent % 2 == 0
    packet.payloadVariant = { case: 'decoded', value: create(Mesh.DataSchema, { portnum, payload }) }
  }
  enqueue({ case: 'packet', value: create(Mesh.MeshPacketSchema, packet) })
  if (sent == 20 && !legacy) enqueue({ case: 'clientNotification', value: create(Mesh.ClientNotificationSchema, { time: Math.floor(Date.now() / 1000), level: 30, message: 'Duty cycle limit exceeded, cannot send for 12 minutes' }) })
  sent++
}

let traffic
http
  .createServer((req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*')
    if (req.url.startsWith('/api/v1/fromradio')) {
      let frame = queue.shift()
      res.setHeader('Content-Type', 'application/x-protobuf')
      return res.end(frame ? Buffer.from(frame) : undefined)
    }
    if (req.url.startsWith('/api/v1/toradio')) {
      let chunks = []
      req.on('data', (chunk) => chunks.push(chunk))
      req.on('end', () => {
        try {
          let toRadio = fromBinary(Mesh.ToRadioSchema, new Uint8Array(Buffer.concat(chunks)))
          if (toRadio.payloadVariant.case == 'wantConfigId') {
            queue = []
            sendConfig(toRadio.payloadVariant.value)
            clearInterval(traffic)
            if (pps > 0) traffic = setInterval(sendPacket, 1000 / pps)
          } else console.log('[mock] toRadio', toRadio.payloadVariant.case, toRadio.payloadVariant.value?.decoded?.portnum ?? '')
        } catch (e) {
          console.log('[mock] bad toRadio', String(e))
        }
        res.end()
      })
      return
    }
    res.end('ok')
  })
  .listen(port, '127.0.0.1', () => console.log(`[mock] device listening on ${port} | nodes ${nodeCount} | ${pps} packets/s`))

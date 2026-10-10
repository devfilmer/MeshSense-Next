import { broadcastId, nodes, packets, type NodeInfo } from 'api/src/vars'
import { tick } from 'svelte'
import { get, writable } from 'svelte/store'
import { enableAudioAlerts } from '../Settings.svelte'
import axios from 'axios'
import { events, send } from './wsc'

export let blockUserKey = writable(false)
export const userKey = writable(localStorage.getItem('userKey') || '')

/** Whether the server has granted this client privileged access (local connection or valid access key) */
export const hasAccess = writable(false)

let failedUserKeyAttempts = 0
let awaitingKeyResult = false

function sendUserKey() {
  let key = get(userKey)
  awaitingKeyResult = key != ''
  send('auth', { key }, false)
}

events.on('connect', sendUserKey)

events.on('authState', ({ authorized }) => {
  hasAccess.set(authorized)
  if (!awaitingKeyResult) return
  awaitingKeyResult = false

  if (authorized) {
    failedUserKeyAttempts = 0
  } else {
    failedUserKeyAttempts += 1
    blockUserKey.set(true)
    setTimeout(() => {
      blockUserKey.set(false)
    }, Math.min(1000 * failedUserKeyAttempts, 10000))
  }
})

userKey.subscribe((value) => {
  axios.defaults.headers['authorization'] = `Bearer ` + value
  localStorage.setItem('userKey', value)
  sendUserKey()
})

export function unixSecondsTimeAgo(seconds) {
  return seconds ? timeAgo(Date.now() / 1000 - seconds) : ''
}

export function timeAgo(seconds) {
  const intervals = [
    { value: 31536000, unit: 'y' },
    { value: 86400, unit: 'd' },
    { value: 3600, unit: 'h' },
    { value: 60, unit: 'm' }
  ]

  for (const interval of intervals) {
    const quotient = Math.floor(seconds / interval.value)
    if (quotient >= 1) {
      return `${quotient}${interval.unit}`
    }
  }

  return `now`
}

export function isScrollAtEnd(element: HTMLElement) {
  return element.scrollTop + element.clientHeight >= element.scrollHeight - 1
}

export function scrollToBottom(element: HTMLElement, force?, notifyUnseen: (recordsUnseen: boolean) => void = undefined) {
  if (!element) return
  let atEnd = isScrollAtEnd(element)
  tick().then(() => {
    if (atEnd || force) {
      element.scrollTop = element.scrollHeight
      if (notifyUnseen) notifyUnseen(false)
    } else {
      if (notifyUnseen) notifyUnseen(true)
    }
  })
}

export function getCoordinates(node: NodeInfo | number) {
  if (typeof node == 'number') node = getNodeById(node)
  if (!node?.position?.longitudeI) return [node?.approximatePosition?.longitude, node?.approximatePosition?.latitude]
  return [node?.position?.longitudeI / 10000000, node?.position?.latitudeI / 10000000]
}

let nodeIndex: Map<number, NodeInfo>
let relayIndex: Map<number, NodeInfo[]>
nodes.subscribe(() => {
  nodeIndex = undefined
  relayIndex = undefined
})

/** Lookup by node number, rebuilt on first use after the node list changes */
function findNode(num: number) {
  if (!nodeIndex) {
    nodeIndex = new Map()
    for (let node of nodes.value ?? []) nodeIndex.set(node.num, node)
  }
  return nodeIndex.get(num)
}

export function getNodeById(num: number) {
  return findNode(num) || ({ num } as NodeInfo)
}

export let audioNewMessage = new Audio(`${import.meta.env.VITE_PATH || ''}/audioNewMessage.mp3`)

packets.on('upsert', (e) => {
  if (get(enableAudioAlerts) && e[0].message?.show) audioNewMessage.play()
})

export function getNodeNameById(id: number) {
  if (id == broadcastId) return 'all'
  if (id == undefined) return 'unknown'
  let node = findNode(id)
  return node ? getNodeName(node) : `!${id?.toString(16)?.padStart(8, '0')}`
}

/** Packets identify the relaying node by the last byte of its number only, so a name is given when it is unambiguous */
export function getRelayName(relayNode: number) {
  if (!relayNode) return ''
  if (!relayIndex) {
    relayIndex = new Map()
    for (let node of nodes.value ?? []) {
      let key = node.num & 0xff
      relayIndex.has(key) ? relayIndex.get(key).push(node) : relayIndex.set(key, [node])
    }
  }
  let candidates = relayIndex.get(relayNode & 0xff) ?? []
  let direct = candidates.filter((node) => node.hopsAway == 0)
  if (direct.length == 1) return getNodeName(direct[0])
  if (candidates.length == 1) return getNodeName(candidates[0])
  return `!…${(relayNode & 0xff).toString(16).padStart(2, '0')}`
}

/** `MeshPacket.transportMechanism` values worth labelling */
const transportLabels = { 5: 'MQTT', 6: 'UDP', 7: 'API', 8: 'UDP' }

export function getTransportLabel(packet: { viaMqtt?: boolean; transportMechanism?: number }) {
  return packet.viaMqtt ? 'MQTT' : (transportLabels[packet.transportMechanism] ?? '')
}

/** Fields shown for each telemetry type as `[field, unit, decimals]` */
const telemetryFields: Record<string, [string, string, number?][]> = {
  environmentMetrics: [
    ['temperature', '°C', 1],
    ['relativeHumidity', '%'],
    ['barometricPressure', ' hPa'],
    ['iaq', ' IAQ'],
    ['lux', ' lx'],
    ['windSpeed', ' m/s', 1],
    ['rainfall1h', ' mm/h', 1],
    ['radiation', ' µR/h', 1],
    ['soilMoisture', '% soil'],
    ['lightningStrikeCount1h', ' strikes/h'],
    ['lightningDistanceKm', ' km']
  ],
  powerMetrics: [
    ['ch1Voltage', 'V', 2],
    ['ch1Current', 'mA'],
    ['ch2Voltage', 'V', 2],
    ['ch2Current', 'mA'],
    ['ch3Voltage', 'V', 2],
    ['ch3Current', 'mA']
  ],
  airQualityMetrics: [
    ['pm10Standard', ' PM1'],
    ['pm25Standard', ' PM2.5'],
    ['pm100Standard', ' PM10'],
    ['co2', ' ppm CO₂']
  ],
  localStats: [
    ['numOnlineNodes', ' online'],
    ['numTotalNodes', ' nodes'],
    ['channelUtilization', '% ch', 1],
    ['airUtilTx', '% tx', 1],
    ['noiseFloor', ' dBm noise']
  ],
  healthMetrics: [
    ['heartBpm', ' bpm'],
    ['spO2', '% SpO₂'],
    ['temperature', '°C', 1]
  ],
  hostMetrics: [
    ['load1', ' load'],
    ['freememBytes', ' B free']
  ],
  trafficManagementStats: [
    ['packetsInspected', ' inspected'],
    ['rateLimitDrops', ' rate limited'],
    ['positionDedupDrops', ' deduplicated'],
    ['hopExhaustedPackets', ' hop exhausted']
  ]
}

/** One-line summary of a telemetry payload, limited to the values that are present */
export function summarizeTelemetry(variant: { case?: string; value?: Record<string, any> }) {
  let parts = []
  for (let [field, unit, decimals] of telemetryFields[variant?.case] ?? []) {
    let value = variant.value?.[field]
    if (value == undefined || value === 0) continue
    parts.push(Number(value).toFixed(decimals ?? 0) + unit)
    if (parts.length == 5) break
  }
  return parts.join('  ')
}

export function getNodeName(node: NodeInfo) {
  return node?.user?.shortName || node?.user?.id || '!' + node?.num?.toString(16)?.padStart(8, '0')
}

export function setPosition(latitude: number, longitude: number) {
  let latitudeI = Math.round(latitude * 10000000)
  let longitudeI = Math.round(longitude * 10000000)
  let position = { latitudeI, longitudeI }
  console.log('Updating position', position)
  axios.post('/position', position, { timeout: 3000 })
}

export function testPacket() {
  packets.push({
    $typeName: 'meshtastic.MeshPacket',
    from: 3045257252,
    to: 4294967295,
    channel: 0,
    payloadVariant: {
      case: 'decoded',
      value: {
        $typeName: 'meshtastic.Data',
        portnum: 67,
        payload: {
          '0': 13,
          '1': 155,
          '2': 219,
          '3': 24,
          '4': 104,
          '5': 18,
          '6': 21,
          '7': 8,
          '8': 101,
          '9': 21,
          '10': 111,
          '11': 18,
          '12': 131,
          '13': 186,
          '14': 29,
          '15': 34,
          '16': 34,
          '17': 234,
          '18': 64,
          '19': 37,
          '20': 121,
          '21': 86,
          '22': 204,
          '23': 63,
          '24': 40,
          '25': 207,
          '26': 196,
          '27': 24
        },
        wantResponse: false,
        dest: 0,
        source: 0,
        requestId: 0,
        replyId: 0,
        emoji: 0,
        bitfield: 0
      }
    },
    id: 2729267930,
    rxTime: 1746459550,
    rxSnr: -1.5,
    hopLimit: 6,
    wantAck: false,
    priority: 0,
    rxRssi: -101,
    delayed: 0,
    viaMqtt: false,
    hopStart: 7,
    publicKey: {},
    pkiEncrypted: false,
    data: {
      $typeName: 'meshtastic.Telemetry',
      time: 1746459547,
      variant: {
        case: 'environmentMetrics',
        value: {
          $typeName: 'meshtastic.EnvironmentMetrics',
          temperature: 20.223
        }
      }
    }
  })

  nodes.upsert({
    num: 3045257252,
    environmentMetrics: {
      temperature: 15.008466720581055,
      relativeHumidity: 53.141929626464844,
      barometricPressure: 1004.330810546875,
      gasResistance: 624.9585571289062,
      iaq: 133
    }
  })
}

export let displayFahrenheit = writable(localStorage.getItem('displayFahrenheit') == 'true')
displayFahrenheit.subscribe((value) => localStorage.setItem('displayFahrenheit', String(value)))

export function formatTemp(tempC: number, displayFahrenheit?: boolean) {
  if (displayFahrenheit) return Math.round((tempC * 9) / 5 + 32) + '  °F'
  return Math.round(tempC) + '  °C'
}

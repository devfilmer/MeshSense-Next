import 'dotenv/config'
import express, { type Express } from 'express'
import { WebSocketHTTPServer } from './wss'
import { State } from './state'
// import https from 'https'
// import pem from 'pem'
// import { store } from './persistence'
import { createProxyMiddleware } from 'http-proxy-middleware'
import { staticDirectory } from './paths'
import getPort from 'get-port'
import { IncomingMessage, Server, ServerResponse } from 'http'
import WebSocket from 'ws'
import { isAccessKeyValid, isAuthorized, isLocalRequest } from './auth'
import { accessKey } from '../vars'

// async function createCertificate(options: pem.CertificateCreationOptions, originalKeys?: any): Promise<pem.CertificateCreationResult> {
//   return new Promise((success, fail) => {
//     if (originalKeys) {
//       pem.checkCertificate(originalKeys?.certificate || {}, (error, valid) => {
//         if (error || !valid) {
//           console.log('Creating updated Self-Signed Certificate')
//           pem.createCertificate(options, (error, keys) => {
//             if (error) return fail(error)
//             success(keys)
//           })
//         }
//         console.log('Current Certificate is valid')
//         return success(originalKeys)
//       })
//     } else {
//       console.log('Creating new Self-Signed Certificate')
//       pem.createCertificate(options, (error, keys) => {
//         if (error) return fail(error)
//         success(keys)
//       })
//     }
//   })
// }

// let originalKeys = store['keys']

/** Create Self Signed Certificate */
// let keys = await createCertificate({ days: 365 * 5, selfSigned: true }, originalKeys)
// store['keys'] = keys

// HTTPS
// let httpsServer = https.createServer({ key: keys.serviceKey, cert: keys.certificate }, app)
// export let server = httpsServer.listen(Number(process.env.PORT) || 5920)

process.on('unhandledRejection', (reason, promise) => {
  console.error(String(reason))
})

export let version = new State('version', '')
export let headless = new State('headless', '')
export let updateChannel = new State('updateChannel', undefined, { persist: true })
export let updateStatus = new State('updateStatus', {})

export let app: Express = express()
app.use(express.json({ limit: '500mb' }))

export let server: Server<typeof IncomingMessage, typeof ServerResponse>
export let wss: WebSocketHTTPServer

/** State methods a client may invoke */
const stateActions = ['set', 'add', 'assign', 'push', 'unshift', 'update', 'upsert', 'delete', 'shift']
const stateFlushIntervalMs = 50
let pendingStateEvents: { json: string; publicJson?: string; skip?: WebSocket }[] = []
let stateFlushTimer: NodeJS.Timeout
let authFailures: Record<string, { count: number; blockedUntil: number }> = {}

function redactor(keys: string[]) {
  return (key: string, value: any) => (keys.includes(key) ? undefined : value)
}

/** `true` if a client without access is connected, requiring redacted copies of state events */
function hasPublicClients() {
  for (let socket of wss.clients) if (!socket['authorized']) return true
  return false
}

/** Current state as JSON, omitting private and redacted data unless `authorized` */
function getStateJson(authorized: boolean) {
  let entries = []
  for (let state of Object.values(State.states)) {
    if (!authorized && state.flags.private) continue
    let json = JSON.stringify(state.value, !authorized && state.flags.redact ? redactor(state.flags.redact) : undefined)
    if (json != undefined) entries.push(`${JSON.stringify(state.name)}:${json}`)
  }
  return `{${entries.join(',')}}`
}

function flushStateEvents() {
  clearTimeout(stateFlushTimer)
  stateFlushTimer = undefined
  if (pendingStateEvents.length == 0) return
  let events = pendingStateEvents
  pendingStateEvents = []

  for (let socket of wss.clients) {
    if (socket.readyState !== WebSocket.OPEN || !socket['initialized']) continue
    let items = []
    for (let event of events) {
      if (event.skip === socket) continue
      let json = socket['authorized'] ? event.json : event.publicJson
      if (json) items.push(json)
    }
    if (items.length) socket.send(`{"event":"stateBatch","data":[${items.join(',')}]}`)
  }
}

/** Send the complete state. Pending events are delivered first so they are not applied on top of it */
function sendInitState(socket: WebSocket) {
  flushStateEvents()
  socket.send(`{"event":"initState","data":${getStateJson(socket['authorized'])}}`)
  socket['initialized'] = true
}

function sendAuthState(socket: WebSocket) {
  wss.send('authState', { authorized: socket['authorized'], local: socket['local'] }, { to: socket })
}

function updateAuthorization(socket: WebSocket) {
  let authorized = socket['local'] || isAccessKeyValid(socket['userKey'])
  let changed = authorized != socket['authorized']
  if (changed) flushStateEvents()
  socket['authorized'] = authorized
  sendAuthState(socket)
  if (changed) sendInitState(socket)
}

async function initSever() {
  /** Begin Listening for connections */
  server = app.listen(Number(process.env.PORT) || (await getPort({ port: 5920 })))
  // Exit when the port cannot be bound, so a service manager (systemd Restart=always) retries.
  // Without this the process stays alive with no HTTP or WebSocket server, and BLE keeps running.
  server.on('error', (err) => {
    console.error('[system] Unable to listen on the configured port', err)
    process.exit(1)
  })
  wss = new WebSocketHTTPServer(server, { path: '/ws' })

  /** Queue state changes and deliver them to clients as a single `stateBatch` message per interval */
  State.subscribe(({ state, action, args }) => {
    let event = { name: state.name, action, args }
    // Serialized immediately as `args` reference live objects that may change before the flush
    let json = JSON.stringify(event)
    let publicJson: string
    if (!state.flags.private && hasPublicClients()) publicJson = state.flags.redact ? JSON.stringify(event, redactor(state.flags.redact)) : json
    pendingStateEvents.push({ json, publicJson, skip: state.flags.socket })
    stateFlushTimer ??= setTimeout(flushStateEvents, stateFlushIntervalMs)
  })

  wss.msg.on('state', ({ name, action, args }, socket) => {
    let state = State.states[name]
    if (!socket['authorized'] || !state || !stateActions.includes(action)) return
    state.flags.socket = socket
    try {
      state.call(action, args)
    } finally {
      delete state.flags.socket
    }
  })

  wss.msg.on('auth', ({ key }, socket) => {
    // Incorrect keys are throttled per remote address
    let failures = authFailures[socket['address']]
    if (failures?.blockedUntil > Date.now()) return sendAuthState(socket)
    socket['userKey'] = key
    updateAuthorization(socket)
    if (socket['authorized']) delete authFailures[socket['address']]
    else if (key) {
      let count = (failures?.count ?? 0) + 1
      authFailures[socket['address']] = { count, blockedUntil: Date.now() + Math.min(1000 * count, 10000) }
    }
  })

  wss.on('connection', (socket, request) => {
    socket['address'] = request.socket.remoteAddress
    socket['local'] = isLocalRequest(request)
    socket['authorized'] = socket['local']
    sendAuthState(socket)
    sendInitState(socket)
  })

  /** Re-evaluate connected clients when the access key changes */
  accessKey.subscribe(() => {
    for (let socket of wss.clients) updateAuthorization(socket)
  })

  // Enable CORS (https://stackoverflow.com/a/18311469)
  app.use(function (req, res, next) {
    // Website you wish to allow to connect
    res.setHeader('Access-Control-Allow-Origin', '*')

    // Request methods you wish to allow
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, PUT, PATCH, DELETE')

    // Request headers you wish to allow
    res.setHeader('Access-Control-Allow-Headers', 'X-Requested-With,content-type')

    // Set to true if you need the website to include cookies in the requests sent
    // to the API (e.g. in case you use sessions)
    res.setHeader('Access-Control-Allow-Credentials', 1)

    // Pass to next layer of middleware
    next()
  })

  app.get('/state', (req, res) => res.type('json').send(getStateJson(isAuthorized(req))))

  // Electron Hook if present
  let parentPort = process['parentPort']

  parentPort?.on('message', (e: any) => {
    console.log('[electron to api]', e)
    if (e.data.event == 'version') {
      version.set(e.data.body)
    } else if (e.data.event == 'headless') {
      headless.set(e.data.body)
    } else if (e.data.event == 'updateChannel') {
      if (e.data.body) updateChannel.set(e.data.body)
    } else if (['update-available', 'download-progress', 'update-downloaded'].includes(e.data.event)) {
      updateStatus.set(e.data)
    }
    // wss?.send(e.data.event, e.data.body)
  })

  updateChannel.subscribe((v) => {
    parentPort?.postMessage({ event: 'setUpdateChannel', body: v })
  })

  app.get('/installUpdate', (req, res) => {
    parentPort?.postMessage({ event: 'installUpdate' })
    res.sendStatus(200)
  })

  app.get('/checkUpdate', (req, res) => {
    parentPort?.postMessage({ event: 'checkUpdate' })
    res.sendStatus(200)
  })
}

export async function createRoutes(callback: (app: Express) => void) {
  await initSever()
  await callback(app)
  finalize()
}

/** Enable user interface and error-handling (Should be after routes!) */
export function finalize() {
  app.use((err, _req, res, _next) => {
    console.error('Error', err)
    wss.send('error', String(err))
    return res.status(500).json(String(err))
  })

  'DEV_UI_URL' in process.env ? enableDevProxy() : app.use(express.static(staticDirectory))
  console.log('Server listening', server.address())
}

export default { app, server, wss, finalize }

/** When in development, proxy UI route instead of serving static files */
function enableDevProxy() {
  let wsProxy = createProxyMiddleware({
    target: process.env.DEV_UI_URL,
    changeOrigin: true,
    ws: true
  })
  server.on('upgrade', wsProxy.upgrade)
  app.use('/', wsProxy)
}

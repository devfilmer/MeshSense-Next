// Access-control checks against a running API (it sets, then clears, the access key).
// Usage: node test/securityTest.mjs <port> <this machine's LAN address>
import WebSocket from 'ws'
const [port, lanIp] = process.argv.slice(2)
const testKey = 'test-key-' + Math.random().toString(36).slice(2, 8)
const local = `127.0.0.1:${port}`
const remote = `${lanIp}:${port}`
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const results = []
const check = (name, pass, detail = '') => results.push(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? '  (' + detail + ')' : ''}`)

function open(host) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(`ws://${host}/ws`)
    socket.messages = []
    socket.on('message', (data) => socket.messages.push(JSON.parse(data)))
    socket.on('open', () => resolve(socket))
    socket.on('error', reject)
  })
}
const send = (socket, event, data) => socket.send(JSON.stringify({ event, data }))
const last = (socket, event) => socket.messages.filter((m) => m.event == event).at(-1)?.data
const state = async (host, headers = {}) => (await fetch(`http://${host}/state`, { headers })).json()

// Local client sets an access key
const localSocket = await open(local)
await sleep(300)
check('local socket is authorized', last(localSocket, 'authState')?.authorized === true)
send(localSocket, 'state', { name: 'accessKey', action: 'set', args: [testKey] })
await sleep(300)

// Remote REST without key
for (const [method, path] of [['POST', '/disconnect'], ['POST', '/connect'], ['POST', '/position'], ['POST', '/deleteNodes'], ['GET', '/deviceConfig'], ['GET', '/consoleLog']]) {
  const response = await fetch(`http://${remote}${path}`, { method, headers: { 'content-type': 'application/json' }, body: method == 'POST' ? '{}' : undefined })
  check(`remote ${method} ${path} without key is refused`, response.status == 403, `status ${response.status}`)
}
const spoofed = await fetch(`http://${remote}/deviceConfig`, { headers: { host: 'localhost' } })
check('remote /deviceConfig with spoofed Host header is refused', spoofed.status == 403, `status ${spoofed.status}`)
const withKey = await fetch(`http://${remote}/deviceConfig`, { headers: { authorization: `Bearer ${testKey}` } })
check('remote /deviceConfig with key is allowed', withKey.status == 200, `status ${withKey.status}`)

// Remote state snapshot
let snapshot = await state(remote)
check('remote /state omits accessKey', !('accessKey' in snapshot))
check('remote /state omits channel PSKs', snapshot.channels.every((c) => c.settings.psk == undefined))
snapshot = await state(remote, { authorization: `Bearer ${testKey}` })
check('device is connected (channels present)', snapshot.channels.length > 0, `${snapshot.channels.length} channels, status ${snapshot.connectionStatus}`)
check('remote /state with key includes accessKey and PSKs', snapshot.accessKey == testKey && snapshot.channels[0]?.settings.psk != undefined)

// Remote websocket without key
const remoteSocket = await open(remote)
await sleep(300)
check('remote socket starts unauthorized', last(remoteSocket, 'authState')?.authorized === false)
const init = last(remoteSocket, 'initState')
check('remote initState omits accessKey and PSKs', !('accessKey' in init) && init.channels.every((c) => c.settings.psk == undefined))
const before = (await state(local)).packetLimit
send(remoteSocket, 'state', { name: 'packetLimit', action: 'set', args: [5] })
send(remoteSocket, 'state', { name: 'accessKey', action: 'set', args: ['hijacked'] })
await sleep(300)
snapshot = await state(local)
check('remote state write without key is ignored', snapshot.packetLimit == before && snapshot.accessKey == testKey)
await sleep(1500)
const batches = remoteSocket.messages.filter((m) => m.event == 'stateBatch')
check('remote socket receives batched state events', batches.length > 0 && remoteSocket.messages.every((m) => m.event != 'state'), `${batches.length} batches, ${batches.reduce((n, b) => n + b.data.length, 0)} events`)
check('batched events never carry accessKey or PSKs', !JSON.stringify(batches).includes(testKey) && !JSON.stringify(batches).includes('"psk"'))

// Wrong then right key
send(remoteSocket, 'auth', { key: 'wrong' })
await sleep(300)
check('wrong key is rejected', last(remoteSocket, 'authState')?.authorized === false)
send(remoteSocket, 'auth', { key: testKey })
await sleep(300)
check('correct key is throttled after a failure', last(remoteSocket, 'authState')?.authorized === false)
await sleep(1200)
send(remoteSocket, 'auth', { key: testKey })
await sleep(300)
check('correct key is accepted after the delay', last(remoteSocket, 'authState')?.authorized === true)
check('authorized initState includes PSKs', last(remoteSocket, 'initState')?.channels[0].settings.psk != undefined)
send(remoteSocket, 'state', { name: 'packetLimit', action: 'set', args: [before] })
send(remoteSocket, 'state', { name: 'packetLimit', action: 'constructor', args: [] })
await sleep(300)
check('authorized state write is accepted', (await state(local)).packetLimit == before)

// Key removed again; the remote socket must lose access
send(localSocket, 'state', { name: 'accessKey', action: 'set', args: [''] })
await sleep(300)
check('remote socket loses access when the key changes', last(remoteSocket, 'authState')?.authorized === false)

console.log(results.join('\n'))
localSocket.close()
remoteSocket.close()
process.exit(results.some((r) => r.startsWith('FAIL')) ? 1 : 0)

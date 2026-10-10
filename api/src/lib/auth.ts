import { IncomingMessage } from 'http'
import { accessKey } from '../vars'

function isLoopback(address = '') {
  address = address.replace(/^::ffff:/, '')
  return address == '127.0.0.1' || address == '::1'
}

/** `true` when the request originates from this machine and was not relayed by a proxy for a remote client */
export function isLocalRequest(req: IncomingMessage) {
  if (!isLoopback(req.socket.remoteAddress)) return false
  let forwardedFor = req.headers['x-forwarded-for']
  if (forwardedFor) return isLoopback(String(forwardedFor).split(',')[0].trim())
  return true
}

export function isAccessKeyValid(key: any) {
  return !!accessKey.value && typeof key == 'string' && key === accessKey.value
}

/** Local requests are always authorized, remote requests must supply the access key as a bearer token */
export function isAuthorized(req: IncomingMessage) {
  return isLocalRequest(req) || isAccessKeyValid(req.headers['authorization']?.split(' ')[1])
}

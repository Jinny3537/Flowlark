import crypto from 'node:crypto'
import { err } from '../core/errors.js'

const pending = new Map()
export function wechatConfig(env = process.env) {
  const appid = env.FLOWLARK_WECHAT_APP_ID, secret = env.FLOWLARK_WECHAT_APP_SECRET
  try {
    const callback = new URL(env.FLOWLARK_WECHAT_CALLBACK_URL)
    if (!appid || !secret || callback.protocol !== 'https:' || callback.pathname !== '/api/team/wechat/callback' || callback.search || callback.hash || callback.username || callback.password) return null
    return { appid, secret, callback: callback.href }
  } catch { return null }
}
export function loginReturnPath(value) {
  return typeof value === 'string' && value.startsWith('/') && !value.startsWith('//') && value.length <= 1500 && !/[\\\x00-\x20\x7f]/.test(value) ? new URL(`https://flowlark.invalid/#${value}`).hash.slice(1) : '/actions'
}
export function beginWechat(root, config, now = Date.now(), returnTo = '/actions') {
  for (const [key, value] of pending) if (value.expires <= now) pending.delete(key)
  if (pending.size >= 1000) throw err.bad('WECHAT_BUSY', '登录请求较多，请稍后重试')
  const state = crypto.randomBytes(24).toString('hex')
  pending.set(state, { root, expires: now + 300000, returnTo: loginReturnPath(returnTo) })
  const url = new URL('https://open.weixin.qq.com/connect/qrconnect')
  url.search = new URLSearchParams({ appid: config.appid, redirect_uri: config.callback, response_type: 'code', scope: 'snsapi_login', state }).toString()
  url.hash = 'wechat_redirect'
  return { state, url: url.href }
}
export function consumeWechatState(root, state, cookie, now = Date.now()) {
  const item = pending.get(state)
  if (!item || item.root !== root || state !== cookie || item.expires <= now) throw err.forbidden('WECHAT_STATE_INVALID', '登录已过期，请重新扫码')
  pending.delete(state)
  return item.returnTo
}
export async function exchangeWechat(config, code, fetcher = fetch) {
  if (!code || code.length > 512) throw err.bad('WECHAT_CANCELLED', '微信授权未完成，请重试')
  async function request(path, params) {
    const response = await fetcher(`https://api.weixin.qq.com${path}?${new URLSearchParams(params)}`, { signal: AbortSignal.timeout(10000) })
    if (!response.ok) throw new Error('wechat unavailable')
    const data = await response.json()
    if (data.errcode) throw new Error('wechat rejected')
    return data
  }
  try {
    const token = await request('/sns/oauth2/access_token', { appid: config.appid, secret: config.secret, code, grant_type: 'authorization_code' })
    if (!token.openid || !token.access_token) throw new Error('missing token')
    const profile = await request('/sns/userinfo', { access_token: token.access_token, openid: token.openid, lang: 'zh_CN' })
    if (profile.openid !== token.openid) throw new Error('identity mismatch')
    return { provider: 'wechat', key: crypto.createHash('sha256').update(`${config.appid}:${token.openid}`).digest('hex'), name: String(profile.nickname || '微信用户').slice(0, 80) }
  } catch { throw err.bad('WECHAT_LOGIN_FAILED', '微信登录失败，请重新扫码或使用游客访问') }
}

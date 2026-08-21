import os from 'node:os'

/**
 * 局域网访问的判定与地址发现。
 *
 * 核心安全模型：**读开放给局域网，写只留给本机**。
 *
 * 理由是这个产品原本就没有账号体系 —— 之前是本地单机工具，无所谓。
 * 一旦开到局域网，「没有鉴权」立刻从无所谓变成同网段任何人都能删版本、改基线。
 * 加账号体系是另一个量级的复杂度，而真实需求其实只是「让研发能打开看」，
 * 所以按来源区分读写，成本最低而且没有密码可泄漏。
 */

const LOCAL_ADDRS = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1', 'localhost'])

/**
 * 判断请求是否来自本机。
 * IPv4-mapped IPv6（::ffff:127.0.0.1）必须一并识别，
 * 否则在双栈机器上本机请求会被误判成外部来源。
 */
export function isLocalRequest(req) {
  const addr = req.socket && req.socket.remoteAddress
  if (!addr) return false
  if (LOCAL_ADDRS.has(addr)) return true
  // 127.0.0.0/8 整段都是回环
  const v4 = addr.startsWith('::ffff:') ? addr.slice(7) : addr
  return /^127\./.test(v4)
}

const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])

export function isWrite(method) {
  return WRITE_METHODS.has(String(method).toUpperCase())
}

/**
 * 是否放行这次写操作。抽成纯函数是为了能穷举测试 ——
 * 沙箱里造不出真正的非回环来源，但这段判断逻辑必须是对的。
 */
export function allowWrite({ lan, readonlyFromLan, isLocal }) {
  if (!lan) return true                 // 只监听回环，本来就进不来外部请求
  if (!readonlyFromLan) return true     // 用户显式关掉了保护
  return isLocal
}

export function shouldBlockWrite({ lan, readonlyFromLan, isLocal, method }) {
  return isWrite(method) && !allowWrite({ lan, readonlyFromLan, isLocal })
}

/** 列出本机的局域网地址，用于告诉用户「同事该访问哪个地址」 */
export function lanAddresses() {
  const out = []
  const ifaces = os.networkInterfaces()
  for (const [name, addrs] of Object.entries(ifaces)) {
    for (const a of addrs || []) {
      if (a.family !== 'IPv4' && a.family !== 4) continue
      if (a.internal) continue
      out.push({ iface: name, address: a.address })
    }
  }
  // 常见家用/办公网段排前面，虚拟网卡（Docker、VPN）通常不是同事能连的那个
  const score = (ip) =>
    /^192\.168\./.test(ip) ? 0 : /^10\./.test(ip) ? 1 : /^172\.(1[6-9]|2\d|3[01])\./.test(ip) ? 2 : 3
  return out.sort((a, b) => score(a.address) - score(b.address))
}

export function primaryLanAddress() {
  const list = lanAddresses()
  return list.length ? list[0].address : null
}

/** 监听地址：开了局域网就绑 0.0.0.0，否则只绑回环 */
export function bindHost(lanEnabled) {
  return lanEnabled ? '0.0.0.0' : '127.0.0.1'
}

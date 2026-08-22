import { describe, test } from 'node:test'
import {
  extractTitle,
  importUrl,
  inspectHtml,
  isPrivateAddress,
  validateImportUrl
} from '../src/core/importer.js'

const publicResolver = async () => [{ address: '93.184.216.34', family: 4 }]

describe('HTML 导入', () => {
  test('提取并解码标题，同时识别外部依赖', (t) => {
    const html = '<!doctype html><html><head><title>订单 &amp; 营销</title><script src="https://cdn.example/a.js"></script></head></html>'
    t.assert.strictEqual(extractTitle(html), '订单 & 营销')
    const result = inspectHtml(html)
    t.assert.strictEqual(result.title, '订单 & 营销')
    t.assert.strictEqual(result.externalRefs.length, 1)
  })

  test('拒绝危险协议、地址凭据和非完整 HTML', (t) => {
    t.assert.throws(() => validateImportUrl('file:///etc/passwd'), (e) => e.code === 'IMPORT_URL_INVALID')
    t.assert.throws(() => validateImportUrl('https://user:pass@example.com/x'), (e) => e.code === 'IMPORT_URL_CREDENTIALS')
    t.assert.throws(() => inspectHtml('<div>fragment</div>'), (e) => e.code === 'IMPORT_NOT_HTML')
  })

  test('识别常见内网、回环、保留和 IPv6 地址', (t) => {
    for (const address of ['127.0.0.1', '10.1.2.3', '172.16.0.1', '192.168.1.1', '169.254.1.1', '::1', 'fd00::1', 'fe80::1']) {
      t.assert.strictEqual(isPrivateAddress(address), true, address)
    }
    t.assert.strictEqual(isPrivateAddress('8.8.8.8'), false)
  })

  test('每次跳转重新解析，跳到私网时拒绝', async (t) => {
    let calls = 0
    const resolver = async (host) => host === 'public.example'
      ? [{ address: '93.184.216.34', family: 4 }]
      : [{ address: '127.0.0.1', family: 4 }]
    const fetcher = async () => {
      calls++
      return new Response(null, { status: 302, headers: { Location: 'http://internal.example/prototype' } })
    }
    await t.assert.rejects(() => importUrl('https://public.example/prototype', { resolver, fetcher }),
      (e) => e.code === 'IMPORT_PRIVATE_ADDRESS')
    t.assert.strictEqual(calls, 1)
  })

  test('下载 HTML 并返回标题和最终地址', async (t) => {
    const fetcher = async () => new Response('<!doctype html><html><title>支付台</title></html>', {
      status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' }
    })
    const result = await importUrl('https://example.com/prototype', { resolver: publicResolver, fetcher })
    t.assert.strictEqual(result.title, '支付台')
    t.assert.strictEqual(result.sourceUrl, 'https://example.com/prototype')
    t.assert.ok(result.size > 0)
  })

  test('拒绝非 HTML 与超过大小上限的响应', async (t) => {
    await t.assert.rejects(() => importUrl('https://example.com/a', {
      resolver: publicResolver,
      fetcher: async () => new Response('{}', { headers: { 'Content-Type': 'application/json' } })
    }), (e) => e.code === 'IMPORT_CONTENT_TYPE')
    await t.assert.rejects(() => importUrl('https://example.com/a', {
      resolver: publicResolver,
      maxBytes: 8,
      fetcher: async () => new Response('<!doctype html><html></html>', { headers: { 'Content-Type': 'text/html' } })
    }), (e) => e.code === 'IMPORT_TOO_LARGE')
  })
})

// Run: node fixtures/prototype-edits-browser.mjs, then open the printed URL in Chrome.
// Uses real editor serialization and HTML replacement API in a disposable repository.
import http from 'node:http'
import fs from 'node:fs'
import { newHub, cleanup } from '../test/helpers.js'
import { startServer, editablePreviewHtml } from '../src/server/index.js'
const { root, hub } = newHub()
hub.createProject({ name: 'Editor regression', code: 'editor' })
const fixture = `<!DOCTYPE html><html><head><title>Dynamic prototype</title></head><body><div id="main"></div><script>
window.clicks = 0;
window.render = function(other = false) {
  document.getElementById('main').innerHTML = '<h1 id="heading">' + (other ? 'Other step' : 'Application') + '</h1><p>Remove these words</p><section><label>Remove component</label><input placeholder="Component input"></section><button>Keep interaction</button><input placeholder="Retained input">';
  document.querySelector('button').addEventListener('click', () => { window.clicks++; });
}; render();
</script></body></html>`
hub.addVersion('editor', { versionNo: 'v1', title: 'fixture', html: fixture })
const app = await startServer(root, { port: 0, previewPort: 0, wecomMcp: { available: false, diagnostics: () => ({}), close: async () => {} } })
const harness = http.createServer()
const handler = async (req, res) => {
  if (req.url === '/run.js') {
    res.setHeader('Content-Type', 'text/javascript')
    return res.end('(' + browserTests.toString() + ')()')
  }
  if (req.url.split('?')[0] === '/editor') { res.setHeader('Content-Type', 'text/html; charset=utf-8'); return res.end(editablePreviewHtml(fs.readFileSync(`${root}/projects/editor/versions/v1.html`))) }
  if (req.url.split('?')[0] === '/saved') { res.setHeader('Content-Type', 'text/html; charset=utf-8'); return res.end(fs.readFileSync(`${root}/projects/editor/versions/v1.html`)) }
  if (req.url === '/save' && req.method === 'POST') {
    const chunks = []; for await (const chunk of req) chunks.push(chunk)
    const result = await fetch(`http://127.0.0.1:${app.port}/api/versions/editor/v1/html`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ html: Buffer.concat(chunks).toString() }) })
    res.writeHead(result.status, { 'Content-Type': 'application/json' }); return res.end(await result.text())
  }
  res.setHeader('Content-Type', 'text/html; charset=utf-8')
  res.end('<!DOCTYPE html><html><body><h1>在线编辑持久化回归</h1><pre id="result">Running…</pre><iframe id="frame"></iframe><script src="/run.js"></script></body></html>')
}
harness.on('request', (req, res) => handler(req, res).catch(error => { res.writeHead(500); res.end(String(error)) }))
harness.listen(0, '127.0.0.1', () => console.log(`Regression: http://127.0.0.1:${harness.address().port}\nWorkbench: http://127.0.0.1:${app.port}/#/projects/editor/versions/v1/edit`))
process.on('exit', () => cleanup(root))

async function browserTests() {
  const result = document.getElementById('result')
  const frame = document.getElementById('frame')
  const lines = []
  const assert = (ok, message) => { if (!ok) throw new Error(message); lines.push('PASS ' + message); result.textContent = lines.join('\n') }
  const tick = () => new Promise(resolve => setTimeout(resolve, 30))
  const load = url => new Promise(resolve => { frame.onload = () => resolve(); frame.src = url + '?t=' + Date.now() })
  const edit = (selector, mutate) => {
    const w = frame.contentWindow, d = w.document, target = d.querySelector(selector)
    const range = d.createRange(); range.selectNodeContents(target)
    w.getSelection().removeAllRanges(); w.getSelection().addRange(range)
    target.dispatchEvent(new w.InputEvent('beforeinput', { bubbles: true, inputType: 'deleteContentBackward' }))
    mutate(target)
    target.dispatchEvent(new w.InputEvent('input', { bubbles: true, inputType: 'deleteContentBackward' }))
  }
  const serialize = () => new Promise((resolve, reject) => {
    const id = crypto.randomUUID()
    const timer = setTimeout(() => { window.removeEventListener('message', listener); reject(new Error('serialize timeout')) }, 3000)
    const listener = event => { if (event.source === frame.contentWindow && event.data.type === 'flowlark:edit-html' && event.data.id === id) { clearTimeout(timer); window.removeEventListener('message', listener); resolve(event.data.html) } }
    window.addEventListener('message', listener)
    frame.contentWindow.postMessage({ type: 'flowlark:get-edit-html', id }, '*')
  })
  try {
    await load('/editor'); await tick()
    edit('p', node => { node.textContent = '' })
    edit('#main', node => node.querySelector('section').remove())
    edit('h1', node => { node.style.fontWeight = '900' })
    const saved = await serialize()
    const parsed = new DOMParser().parseFromString(saved, 'text/html')
    assert(!parsed.querySelector('#flowlark-edit-bridge,#flowlark-edit-style,[data-flowlark-edit-target]'), '保存清理编辑器标记')
    assert(saved.startsWith('<!DOCTYPE html>\n'), '保存使用真实换行')
    assert(parsed.querySelectorAll('#flowlark-saved-edits').length === 1, '保存一个持久化运行脚本')
    assert((await fetch('/save', { method: 'POST', body: saved })).ok, '真实替换 API 保存成功')
    await load('/saved'); await tick()
    let w = frame.contentWindow, d = w.document
    assert(d.querySelector('p').textContent === '' && !d.querySelector('section'), '刷新后文字和组件保持删除')
    assert(d.querySelector('h1').style.fontWeight === '900', '刷新后格式保持')
    w.render(true); await tick()
    assert(d.querySelector('section') && d.querySelector('p').textContent === 'Remove these words', '其他步骤同名组件未被误删')
    w.render();
    const input = d.querySelector('[placeholder="Retained input"]'), button = d.querySelector('button')
    input.value = 'Live input value'
    await tick()
    assert(!d.querySelector('section') && d.querySelector('p').textContent === '', '切回步骤后仍保持删除')
    button.click()
    assert(w.clicks === 1 && button === d.querySelector('button'), '未修改组件的节点和事件监听保持')
    assert(input === d.querySelector('[placeholder="Retained input"]') && input.value === 'Live input value', '未修改输入框的值保持')
    await load('/editor'); await tick()
    edit('p', node => { node.textContent = '</script>)(second edit' })
    const second = await serialize()
    assert((await fetch('/save', { method: 'POST', body: second })).ok, '第二次编辑保存成功')
    await load('/saved'); await tick()
    d = frame.contentWindow.document
    assert(d.querySelector('p').textContent === '</script>)(second edit' && !d.querySelector('section'), '再次编辑保存后新旧修改均生效')
    result.textContent = 'ALL PASSED (' + lines.length + ')\n' + lines.join('\n')
  } catch (error) { result.textContent = 'FAILED\n' + lines.join('\n') + '\n' + error.stack }
}

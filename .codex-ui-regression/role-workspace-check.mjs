import { chromium } from '/Users/beluga/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs';
import assert from 'node:assert/strict';
const browser = await chromium.launch({ headless: true, executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' });
try {
for (const role of ['product', 'developer', 'tester', 'guest']) {
 for (const width of [1440, 375]) {
  const page = await browser.newPage({ viewport: { width, height: 900 } });
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  const session = { host: role === 'product', role, enabled: true, kinds: [], id: 'test' };
  await page.route('**/api/**', route => {
    const path = new URL(route.request().url()).pathname;
    let data = [];
    if (path === '/api/team/session') data = session;
    if (path === '/api/health') data = { team: session, canWrite: session.host, repoName: '界面验证', version: '0.7.0' };
    if (path === '/api/projects') data = [{ slug: 'demo', name: '订单管理', code: 'DEMO', updatedAt: '2026-09-10', latestVersion: { no: 'v2', title: '订单审核' } }];
    if (path === '/api/requirements') data = [{ code: 'REQ-001', title: '订单审批', project: '订单管理', owner: '张三', versions: [], updatedAt: '2026-09-10' }];
    return route.fulfill({ json: data });
  });
  await page.goto('http://127.0.0.1:5173/#/');
  await page.getByRole('heading', { name: role === 'developer' ? '快速定位需求' : role === 'tester' ? '快速查看原型' : role === 'guest' ? '浏览项目与原型' : '今天从这里继续', exact: true }).waitFor();
  assert.match(page.url(), /#\/actions$/);
  if (role !== 'product') {
    const search = page.getByRole('textbox', { name: role === 'developer' ? '搜索需求' : '搜索原型' });
    await search.fill('not-found'); await page.getByText('没有匹配结果，请尝试其他关键词').waitFor();
    await page.getByRole('button', { name: '清除搜索' }).click();
    await search.fill(role === 'developer' ? 'req-001' : '订单');
    const link = page.getByRole('link', { name: role === 'developer' ? '查看需求' : '查看原型', exact: true });
    await link.waitFor();
    assert.equal(await link.getAttribute('href'), role === 'developer' ? '#/requirements/REQ-001' : '#/projects/demo/versions/v2');
  }
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  assert.deepEqual(errors, []);
  await page.screenshot({ path: `.codex-ui-regression/screenshots/role-${role}-${width}.png`, fullPage: true });
  await page.close();
 }
}
console.log('PASS: four roles, desktop/mobile, home route, search, empty result, deep links, no overflow or runtime errors');
} finally { await browser.close(); }

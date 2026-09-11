import { chromium } from '/Users/beluga/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
const base = 'http://127.0.0.1:5173';
const browser = await chromium.launch({ headless: true, executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const errors = [];
page.on('pageerror', error => errors.push(error.message));
const cfg = await (await page.request.get(`${base}/api/config`)).json();
const health = await (await page.request.get(`${base}/api/health`)).json();
const writes = [];
let fail = false;
let updateFail = false;
await page.route('**/api/**', async route => {
  const request = route.request();
  const url = new URL(request.url());
  const json = value => route.fulfill({ json: value });
  if (url.pathname === '/api/config') return json(cfg);
  if (url.pathname === '/api/health') return json({ ...health, dateStyle: cfg.items.find(item => item.key === 'ui.dateStyle').value, defaultTags: cfg.items.find(item => item.key === 'ui.defaultTags').value });
  if (url.pathname.startsWith('/api/update/software')) return updateFail ? route.fulfill({ status: 500, json: { message: '模拟离线' } }) : json({ tracked: true, upstream: 'origin/main', dirty: false, available: false, checkedAt: new Date().toISOString() });
  if (request.method() !== 'GET') {
    writes.push(url.pathname);
    if (request.method() === 'PUT' && url.pathname.startsWith('/api/config/')) {
      if (fail) return route.fulfill({ status: 500, json: { message: '模拟保存失败' } });
      const item = cfg.items.find(item => item.key === decodeURIComponent(url.pathname.split('/').pop()));
      item.value = request.postDataJSON().value; item.isDefault = JSON.stringify(item.value) === JSON.stringify(item.default);
      return json({ value: item.value, needsRestart: item.key.startsWith('server.'), problems: [], sideEffects: [] });
    }
    throw new Error(`Unexpected mutation: ${request.method()} ${url.pathname}`);
  }
  return route.continue();
});
const goto = async path => { console.log('CHECK',path); await page.goto(`${base}/#${path}`); await page.locator('.fl-settings-current').waitFor(); };
await goto('/settings');
assert.equal(await page.locator('.fl-settings-nav [role=menuitem]').count(), 6);
const save = () => page.getByRole('button', { name: '保存设置', exact: true }).filter({ visible: true });
assert.equal(await save().isDisabled(), true);
await page.getByRole('combobox', { name: '时间显示', exact: true }).click();
await page.getByText('完整时间（2026-09-08 14:30）', { exact: true }).click();
assert.equal(writes.length, 0);
await page.locator('.fl-settings-nav').getByRole('menuitem', { name: /工作区与同步/ }).click();
await page.locator('.fl-settings-nav').getByRole('menuitem', { name: /通用/ }).click();
assert.equal(await save().isEnabled(), true);
fail = true;
await save().click();
await page.getByText('模拟保存失败', { exact: false }).waitFor();
assert.equal(await save().isEnabled(), true);
fail = false;
await save().click();
await page.getByText('已保存，配置已生效', { exact: true }).filter({ visible:true }).waitFor();
assert.equal(cfg.items.find(item => item.key === 'ui.dateStyle').value, 'absolute');
assert.equal(writes.length, 2);
assert.equal(await save().isDisabled(), true);
const mappings = [['gitRemote','workspace','gitRemote'], ['git','workspace','git'], ['lan','team','team'], ['mcp','integrations','mcp'], ['ui','general','ui'], ['softwareUpdate','maintenance','softwareUpdate'], ['trash','maintenance','trash'], ['oplog','maintenance','oplog'], ['server','maintenance','server']];
for (const [old, section, tab] of mappings) {
  await goto(`/settings/${old}?q=preserve`);
  await page.waitForURL(url => url.hash.includes(`/settings/${section}?`) && url.hash.includes(`tab=${tab}`));
  assert.ok(page.url().includes('q=preserve'));
}
await goto('/settings/integrations?tab=feedback');
await page.getByRole('combobox', { name:'反馈目标', exact:true }).click();
await page.getByText('GitLab', {exact:true}).click();
await page.getByRole('textbox', {name:'Issue 项目标识', exact:true}).waitFor();
assert.equal(await page.getByRole('textbox', {name:'Issue 组织/用户',exact:true}).count(), 0);
await page.getByRole('textbox', {name:'Issue 项目标识',exact:true}).fill('group/project');
await save().click();
await page.getByText('已保存，配置已生效', {exact:true}).filter({ visible:true }).waitFor();
assert.equal(cfg.items.find(item => item.key === 'integrations.issueProject').value, 'group/project');
assert.ok(writes.at(-1).endsWith('integrations.issueProvider'));
await goto('/settings/maintenance?tab=softwareUpdate');
await page.getByText('尚未检测远端更新', {exact:true}).first().waitFor();
updateFail = true;
await page.getByRole('button',{name:'检测更新',exact:true}).click();
await page.getByText('检测更新失败', {exact:true}).first().waitFor();
assert.equal(await page.getByText('当前已是最新版本', {exact:true}).count(),0);
assert.equal(await page.getByRole('button',{name:'拉取并更新',exact:true}).isDisabled(),true);
await fs.mkdir('.codex-ui-regression/screenshots', {recursive:true});
const screenshots = [];
for (const viewport of [{width:1440,height:1000}, {width:390,height:844}]) {
  await page.setViewportSize(viewport);
  for (const path of ['/settings/general','/settings/workspace?tab=git','/settings/integrations?tab=feedback','/settings/maintenance?tab=oplog']) {
    await goto(path);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
    assert.equal(overflow,false,`overflow: ${path} at ${viewport.width}`);
    const file = `.codex-ui-regression/screenshots/settings-${viewport.width}-${path.split('/').pop().replace('?tab=','-')}.png`;
    await page.screenshot({path:file,fullPage:true}); screenshots.push(file);
  }
}
await page.setViewportSize({width:1440,height:1000});
await goto('/settings/general');
const commonTag = page.getByRole('combobox', {name:'常用标签',exact:true});
await commonTag.fill('设置中心推荐标签');
await commonTag.press('Enter');
await save().click();
await page.getByText('已保存，配置已生效', {exact:true}).filter({visible:true}).waitFor();
const timeCheck = await page.evaluate(async () => {
  const format = await import('/src/utils/format.ts');
  const value = new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString();
  format.setDateStyle('absolute');
  const absolute = format.fmtTime(value);
  format.setDateStyle('relative');
  const relative = format.fmtTime(value);
  const audit = format.fmtAbsolute(value);
  format.setDateStyle('absolute');
  return {absolute,relative,audit};
});
assert.match(timeCheck.absolute, /\d{4}-\d{2}-\d{2} \d{2}:\d{2}/);
assert.match(timeCheck.relative, /小时前/);
assert.equal(timeCheck.audit, timeCheck.absolute);
const projects = await (await page.request.get(`${base}/api/projects`)).json();
let versionRoute;
for (const project of projects) {
  const versions = await (await page.request.get(`${base}/api/projects/${encodeURIComponent(project.slug)}/versions?includeDraft=true&includeVoid=false`)).json();
  if (versions.length) { versionRoute = `/projects/${encodeURIComponent(project.slug)}/versions/${encodeURIComponent(versions[0].versionNo)}`; break; }
}
assert.ok(versionRoute, 'A local version is required to verify tag suggestions');
await page.setViewportSize({width:2560,height:1200});
await page.goto(`${base}/#${versionRoute}`);
await page.getByText(/更新于 \d{4}-\d{2}-\d{2}/).waitFor();
await page.getByRole('tab',{name:'版本信息',exact:true}).click();
await page.getByRole('combobox',{name:'版本标签',exact:true}).click();
await page.locator('.ant-select-item-option-content').filter({hasText:'设置中心推荐标签'}).waitFor();
assert.deepEqual(errors, []);

await fs.writeFile('.codex-ui-regression/settings-upgrade-report.json', JSON.stringify({passed:true, checks:['six navigation groups','legacy deep links and query preservation','draft retained across settings tabs','no blur writes','save failure and retry','platform dependent fields','provider activated last','failed update never latest','desktop/mobile overflow','time preference and absolute audit dates','common tags appear in version editor'],writesStubbed:true,errors,screenshots},null,2));
console.log('Settings UI checks passed; all configuration writes stubbed.');
await browser.close();

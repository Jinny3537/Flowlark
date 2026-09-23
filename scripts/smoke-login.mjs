import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : 'playwright');
const output = process.env.LOGIN_SMOKE_OUTPUT || fs.mkdtempSync(path.join(os.tmpdir(), 'flowlark-login-evidence-'));
fs.mkdirSync(output, { recursive: true });
for (const key of ['FLOWLARK_WECHAT_APP_ID', 'FLOWLARK_WECHAT_APP_SECRET', 'FLOWLARK_WECHAT_CALLBACK_URL']) delete process.env[key];
import assert from 'node:assert/strict';
import { newHub, cleanup } from '../test/helpers.js';
import { startServer } from '../src/server/index.js';
import * as team from '../src/core/team.js';
const { root } = newHub();
team.setTeamEnabled(root, true);
const server = await startServer(root, { port: 0, previewPort: 0 });
const browser = await chromium.launch({ headless: true, ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}) });
try {
 for (const width of [1440, 375]) {
  const context = await browser.newContext({ viewport: { width, height: 900 }, extraHTTPHeaders: { 'x-forwarded-for': '192.0.2.10' } });
  const page = await context.newPage();
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.goto(`http://127.0.0.1:${server.port}/#/projects`);
  await page.getByText('微信登录暂未开通', { exact: true }).waitFor();
  assert.equal(await page.getByRole('button', { name: '微信扫码登录' }).isDisabled(), true);
  await page.screenshot({ path: path.join(output, `login-${width}.png`), fullPage: true });
  await page.getByRole('button', { name: '以游客身份继续' }).click();
  await page.getByRole('radio', { name: '研发 · 反馈开发进度' }).check();
  await page.getByRole('button', { name: '确认角色并进入' }).click();
  if (width < 1200) await page.getByRole('button', { name: '查看运行状态', exact: true }).click();
  await page.getByLabel('当前角色：研发', { exact: true }).waitFor();
  await page.reload();
  if (width < 1200) await page.getByRole('button', { name: '查看运行状态', exact: true }).click();
  await page.getByLabel('当前角色：研发', { exact: true }).waitFor();
  await page.getByRole('button', { name: '切换访问方式' }).click();
  await page.getByText('微信登录暂未开通', { exact: true }).waitFor();
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  assert.deepEqual(errors, []);
  await context.close();
 }
 const login = team.loginVisitor(root, { provider: 'wechat', key: 'ui-test-account', name: '微信测试用户' }, '192.0.2.10');
 const signedIn = await browser.newContext({ extraHTTPHeaders: { 'x-forwarded-for': '192.0.2.10' } });
 await signedIn.addCookies([{ name: 'flowlark_visitor', value: login.token, domain: '127.0.0.1', path: '/api' }]);
 const accountPage = await signedIn.newPage();
 await accountPage.goto(`http://127.0.0.1:${server.port}/#/projects`);
 await accountPage.getByText('微信测试用户，微信登录成功', { exact: true }).waitFor();
 await accountPage.getByRole('radio', { name: '测试 · 提交问题与验收结果' }).check();
 await accountPage.getByRole('button', { name: '确认角色并进入' }).click();
 await accountPage.getByLabel('当前角色：测试', { exact: true }).waitFor();
 assert.equal(team.visitor(root, login.token).role, 'tester');
 await accountPage.getByRole('button', { name: '退出登录', exact: true }).click();
 await accountPage.getByText('微信登录暂未开通', { exact: true }).waitFor();
 assert.equal(team.visitor(root, login.token), null);
 await signedIn.close();
 // Exercise the browser redirect/cookie flow with only the external WeChat endpoints simulated.
 const actualFetch = globalThis.fetch;
 const envKeys = ['FLOWLARK_WECHAT_APP_ID', 'FLOWLARK_WECHAT_APP_SECRET', 'FLOWLARK_WECHAT_CALLBACK_URL'];
 const savedEnv = Object.fromEntries(envKeys.map(key => [key, process.env[key]]));
 try {
  process.env.FLOWLARK_WECHAT_APP_ID = 'browser-test-app';
  process.env.FLOWLARK_WECHAT_APP_SECRET = 'browser-test-secret';
  process.env.FLOWLARK_WECHAT_CALLBACK_URL = `https://127.0.0.1:${server.port}/api/team/wechat/callback`;
  globalThis.fetch = async (input, options) => {
   if (String(input).startsWith('https://api.weixin.qq.com/')) return new Response(JSON.stringify(String(input).includes('/access_token?') ? { openid: 'browser-oauth-account', access_token: 'test-private-token' } : { openid: 'browser-oauth-account', nickname: '扫码账号' }));
   return actualFetch(input, options);
  };
  const oauth = await browser.newContext({ extraHTTPHeaders: { 'x-forwarded-for': '192.0.2.10', 'x-forwarded-proto': 'https' } });
  const oauthPage = await oauth.newPage();
  await oauthPage.route('https://open.weixin.qq.com/connect/qrconnect**', async route => {
   const state = new URL(route.request().url()).searchParams.get('state');
   const callback = `http://127.0.0.1:${server.port}/api/team/wechat/callback?state=${state}`;
   await route.fulfill({ contentType: 'text/html; charset=utf-8', body: `<html><body><a href="${callback}">取消授权</a><a href="${callback}&code=valid">确认授权</a></body></html>` });
  });
  await oauthPage.goto(`http://127.0.0.1:${server.port}/#/projects`);
  await oauthPage.getByRole('button', { name: '微信扫码登录' }).click();
  await oauthPage.getByRole('link', { name: '取消授权' }).click();
  await oauthPage.getByText('微信登录未完成或已过期，请重新登录，也可以游客访问。', { exact: true }).waitFor();
  assert.match(oauthPage.url(), /#\/projects$/);
  await oauthPage.getByRole('button', { name: '微信扫码登录' }).click();
  await oauthPage.getByRole('link', { name: '确认授权' }).click();
  await oauthPage.getByText('扫码账号，微信登录成功', { exact: true }).waitFor();
  assert.match(oauthPage.url(), /#\/projects$/);
  await oauthPage.getByRole('radio', { name: '研发 · 反馈开发进度' }).check();
  await oauthPage.getByRole('button', { name: '确认角色并进入' }).click();
  await oauthPage.getByLabel('当前角色：研发', { exact: true }).waitFor();
  await oauthPage.reload();
  await oauthPage.getByLabel('当前角色：研发', { exact: true }).waitFor();
  team.setTeamEnabled(root, false);
  await oauthPage.reload();
  await oauthPage.getByRole('button', { name: '退出登录', exact: true }).click();
  await oauthPage.getByRole('button', { name: '退出登录', exact: true }).waitFor({ state: 'detached' });
  await oauth.close();
 } finally {
  globalThis.fetch = actualFetch;
  for (const key of envKeys) { if (savedEnv[key] === undefined) delete process.env[key]; else process.env[key] = savedEnv[key]; }
 }
 console.log('PASS desktop/mobile: login entry, unavailable provider, guest role selection, reload persistence, logout, authenticated role selection, OAuth cancel/retry/callback/deep link/cookies, read-only logout, no overflow or runtime errors');
} finally { await browser.close(); await server.close(); cleanup(root); }

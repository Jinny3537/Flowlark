import { chromium } from '/Users/beluga/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs'
import fs from 'node:fs/promises'
import path from 'node:path'

const baseUrl = process.env.BASE_URL || 'http://127.0.0.1:5173'
const outDir = path.resolve('.codex-ui-regression/screenshots')
const chrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const report = []

await fs.mkdir(outDir, { recursive: true })

const browser = await chromium.launch({ headless: true, executablePath: chrome })

async function inspect(name, route, viewport) {
  const context = await browser.newContext({ viewport })
  const page = await context.newPage()
  const consoleErrors = []
  const pageErrors = []
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text())
  })
  page.on('pageerror', (error) => pageErrors.push(error.message))

  await page.goto(`${baseUrl}/#${route}`, { waitUntil: 'domcontentloaded', timeout: 20000 })
  await page.locator('.fl-page, .fl-not-found').first().waitFor({ state: 'visible' })
  await page.locator('.ant-skeleton').first().waitFor({ state: 'hidden', timeout: 12000 }).catch(() => {})
  if (route.includes('/versions/')) {
    await page.frameLocator('iframe').locator('.phone-shell').waitFor({ state: 'visible', timeout: 15000 })
  }
  if (route === '/projects/1') {
    await page.getByTestId('version-browser').waitFor({ state: 'visible', timeout: 15000 })
    const versionRows = page.locator('[data-version-no]')
    if (await versionRows.count() > 1) {
      const secondVersionNo = await versionRows.nth(1).getAttribute('data-version-no')
      await versionRows.nth(1).click()
      await page.getByTestId('desktop-version-summary').getByText(secondVersionNo || '').first().waitFor()
    }
    await page.getByPlaceholder('搜索版本、标题、标签或需求').fill('__no_matching_version__')
    await page.getByText('没有匹配的版本').waitFor()
    await page.getByRole('button', { name: '清除筛选' }).click()
    await versionRows.first().waitFor({ state: 'visible' })
  }

  const metrics = await page.evaluate(() => {
    const root = document.documentElement
    const clippedButtons = [...document.querySelectorAll('button')].filter((button) =>
      button.clientWidth > 0 && button.scrollWidth > button.clientWidth + 2)
      .map((button) => button.textContent?.trim()).filter(Boolean)
    return {
      clientWidth: root.clientWidth,
      scrollWidth: root.scrollWidth,
      heading: document.querySelector('h1')?.textContent?.trim() || '',
      selectedNav: document.querySelector('.ant-menu-item-selected')?.textContent?.trim() || '',
      clippedButtons,
    }
  })

  const screenshot = path.join(outDir, `personal-workspace-${name}.png`)
  await page.screenshot({ path: screenshot, fullPage: true })
  report.push({
    name,
    route,
    viewport,
    screenshot,
    horizontalOverflow: metrics.scrollWidth > metrics.clientWidth + 1,
    ...metrics,
    consoleErrors,
    pageErrors,
  })
  await context.close()
}

await inspect('desktop-actions', '/actions', { width: 1440, height: 900 })
await inspect('ultrawide-actions', '/actions', { width: 2560, height: 1192 })
await inspect('desktop-projects', '/projects', { width: 1440, height: 900 })
await inspect('desktop-versions', '/projects/1', { width: 1440, height: 900 })
await inspect('desktop-requirements', '/requirements', { width: 1440, height: 900 })
await inspect('desktop-workbench', '/projects/1/versions/v5', { width: 1440, height: 900 })

const mobileContext = await browser.newContext({ viewport: { width: 390, height: 844 } })
const mobilePage = await mobileContext.newPage()
const mobileErrors = []
mobilePage.on('pageerror', (error) => mobileErrors.push(error.message))
await mobilePage.goto(`${baseUrl}/#/actions`, { waitUntil: 'networkidle', timeout: 20000 })
await mobilePage.locator('.ant-skeleton').first().waitFor({ state: 'hidden', timeout: 12000 }).catch(() => {})
await mobilePage.getByRole('button', { name: '打开导航' }).click()
const mobileDrawer = mobilePage.locator('.ant-drawer-section[role="dialog"]')
await mobileDrawer.waitFor({ state: 'visible' })
await mobilePage.waitForTimeout(450)
const drawerScreenshot = path.join(outDir, 'personal-workspace-mobile-drawer.png')
await mobilePage.screenshot({ path: drawerScreenshot, fullPage: true })
await mobilePage.getByRole('menuitem', { name: '项目' }).click()
await mobilePage.waitForURL(/#\/projects$/)
await mobileDrawer.waitFor({ state: 'hidden' })
await mobilePage.locator('.fl-card-grid').waitFor({ state: 'visible' })
const mobileMetrics = await mobilePage.evaluate(() => ({
  clientWidth: document.documentElement.clientWidth,
  scrollWidth: document.documentElement.scrollWidth,
  desktopSidebarVisible: Boolean(document.querySelector('.fl-app-sider')),
  menuButtonVisible: Boolean(document.querySelector('[aria-label="打开导航"]')),
  selectedNav: document.querySelector('.ant-menu-item-selected')?.textContent?.trim() || '',
}))
const mobileScreenshot = path.join(outDir, 'personal-workspace-mobile-projects.png')
await mobilePage.screenshot({ path: mobileScreenshot, fullPage: true })
report.push({
  name: 'mobile-navigation',
  route: '/projects',
  viewport: { width: 390, height: 844 },
  screenshot: mobileScreenshot,
  drawerScreenshot,
  horizontalOverflow: mobileMetrics.scrollWidth > mobileMetrics.clientWidth + 1,
  ...mobileMetrics,
  pageErrors: mobileErrors,
})
await mobileContext.close()

await browser.close()

const failures = report.filter((item) =>
  item.horizontalOverflow ||
  item.pageErrors.length ||
  item.consoleErrors?.some((error) => !error.includes('Failed to load resource')) ||
  item.clippedButtons?.length ||
  item.desktopSidebarVisible === true ||
  item.menuButtonVisible === false
)

await fs.writeFile(
  path.resolve('.codex-ui-regression/personal-workspace-report.json'),
  JSON.stringify(report, null, 2),
)

console.log(JSON.stringify({ checked: report.length, failures: failures.length, failureItems: failures }, null, 2))
if (failures.length) process.exitCode = 1

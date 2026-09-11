import { chromium } from 'playwright'
import fs from 'node:fs/promises'
import path from 'node:path'

const baseUrl = process.env.BASE_URL || 'http://127.0.0.1:5173'
const outDir = path.resolve('.codex-ui-regression')
const screenshotDir = path.join(outDir, 'screenshots')

const routes = [
  ['actions', '/actions'],
  ['projects', '/projects'],
  ['requirements', '/requirements'],
  ['milestones', '/milestones'],
  ['deliveries', '/deliveries'],
  ['watch', '/watch'],
  ['trash', '/trash'],
  ['settings', '/settings']
]

const viewports = [
  ['desktop', { width: 1280, height: 900 }],
  ['mobile', { width: 390, height: 844 }]
]

function sanitizeMessage(message) {
  return String(message).replace(/\s+/g, ' ').slice(0, 500)
}

await fs.mkdir(screenshotDir, { recursive: true })

const browser = await chromium.launch({ headless: true })
const report = []

for (const [viewportName, viewport] of viewports) {
  const context = await browser.newContext({ viewport })

  for (const [name, route] of routes) {
    const page = await context.newPage()
    const consoleErrors = []
    const pageErrors = []

    page.on('console', (message) => {
      if (['error', 'warning'].includes(message.type())) {
        consoleErrors.push(`${message.type()}: ${sanitizeMessage(message.text())}`)
      }
    })
    page.on('pageerror', (error) => {
      pageErrors.push(sanitizeMessage(error.stack || error.message || error))
    })

    const url = new URL(`/#${route}`, baseUrl).toString()
    let status = null
    let title = ''
    let overflow = null
    let bodyText = ''

    try {
      const response = await page.goto(url, { waitUntil: 'networkidle', timeout: 20000 })
      status = response?.status() ?? null
      await page.waitForTimeout(500)
      title = await page.title()
      bodyText = sanitizeMessage(await page.locator('body').innerText({ timeout: 5000 }).catch(() => ''))
      overflow = await page.evaluate(() => ({
        clientWidth: document.documentElement.clientWidth,
        scrollWidth: document.documentElement.scrollWidth,
        clientHeight: document.documentElement.clientHeight,
        scrollHeight: document.documentElement.scrollHeight
      }))
      await page.screenshot({
        path: path.join(screenshotDir, `${viewportName}-${name}.png`),
        fullPage: true
      })
    } catch (error) {
      pageErrors.push(sanitizeMessage(error.stack || error.message || error))
    }

    report.push({
      viewport: viewportName,
      route,
      status,
      title,
      bodyText,
      horizontalOverflow: overflow ? overflow.scrollWidth > overflow.clientWidth + 1 : null,
      overflow,
      consoleErrors,
      pageErrors
    })

    await page.close()
  }

  await context.close()
}

await browser.close()
await fs.writeFile(path.join(outDir, 'ui-regression-report.json'), JSON.stringify(report, null, 2))

const failures = report.filter((item) =>
  item.status && item.status >= 400 ||
  item.horizontalOverflow ||
  item.pageErrors.length ||
  item.consoleErrors.some((entry) => !entry.includes('Failed to load resource'))
)

console.log(JSON.stringify({
  checked: report.length,
  failures: failures.length,
  report: path.join(outDir, 'ui-regression-report.json'),
  screenshots: screenshotDir,
  failureItems: failures.map((item) => ({
    viewport: item.viewport,
    route: item.route,
    status: item.status,
    horizontalOverflow: item.horizontalOverflow,
    consoleErrors: item.consoleErrors,
    pageErrors: item.pageErrors
  }))
}, null, 2))

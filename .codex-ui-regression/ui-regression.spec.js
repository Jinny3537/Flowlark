import { test, expect } from '@playwright/test'
import fs from 'node:fs/promises'
import path from 'node:path'

const baseUrl = process.env.BASE_URL || 'http://127.0.0.1:5173'
const outDir = path.resolve('.codex-ui-regression')
const screenshotDir = path.join(outDir, 'screenshots')
const results = []
const runtimeStates = new WeakMap()

const routes = [
  ['actions', '/actions'],
  ['projects', '/projects'],
  ['requirements', '/requirements'],
  ['milestones', '/milestones'],
  ['deliveries', '/deliveries'],
  ['watch', '/watch'],
  ['trash', '/trash'],
  ['search', '/search'],
  ['settings', '/settings'],
  ['settings-oplog', '/settings/oplog'],
  ['settings-mcp', '/settings/mcp'],
  ['settings-update', '/settings/softwareUpdate'],
  ['project-timeline', '/projects/1'],
  ['workbench', '/projects/1/versions/v5']
]

const viewports = [
  ['desktop', { width: 1280, height: 900 }],
  ['wide', { width: 1920, height: 1080 }],
  ['mobile', { width: 390, height: 844 }]
]

test.use({
  launchOptions: {
    executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
  }
})

function clean(value) {
  return String(value || '').replace(/\s+/g, ' ').slice(0, 600)
}

const writableHealth = {
  ok: true,
  repo: '/tmp/flowlark-ui-fixture',
  repoName: 'UI 回归夹具',
  version: '0.7.0',
  previewPort: 7789,
  maxFileBytes: 128,
  canWrite: true,
  readonlyReason: null,
  lan: false,
  rules: { requireChangelog: false, lockBaseline: false }
}

const readyGitStatus = {
  tracked: true,
  clean: true,
  files: [],
  foreignFiles: [],
  conflicts: [],
  branch: 'main',
  hasRemote: true,
  ahead: 0,
  behind: 0,
  permission: { mode: 'writable' }
}

const baseMcpInfo = {
  file: 'mcp.json',
  exists: true,
  problems: [],
  config: {
    servers: [],
    capabilities: {
      requirements: {
        enabled: false,
        server: '',
        label: '需求',
        category: 'product',
        description: '搜索、导入和回写外部需求',
        project: '',
        tools: {
          test: 'requirements.test',
          search: 'requirements.search',
          get: 'requirements.get',
          comment: 'requirements.comment'
        }
      },
      milestones: {
        enabled: false,
        server: '',
        label: '迭代',
        category: 'delivery',
        description: '拉取和回写任务平台迭代计划',
        project: '',
        tools: {
          test: 'milestones.test',
          list: 'milestones.list',
          get: 'milestones.get',
          upsert: 'milestones.upsert'
        }
      }
    }
  }
}

function apiPath(route) {
  const url = new URL(route.request().url())
  return `${url.pathname}${url.search}`
}

async function protectWrites(page, unexpectedWrites) {
  await page.route('**/api/**', async (route) => {
    if (['GET', 'HEAD', 'OPTIONS'].includes(route.request().method())) {
      await route.fallback()
      return
    }
    unexpectedWrites.push(`${route.request().method()} ${apiPath(route)}`)
    await route.fulfill({
      status: 599,
      contentType: 'application/json',
      body: JSON.stringify({ message: `未声明的写请求：${apiPath(route)}` })
    })
  })
}

async function mockRuntime(page, options = {}) {
  const state = {
    health: options.health || writableHealth,
    git: options.git || readyGitStatus,
    notifications: options.notifications || []
  }
  runtimeStates.set(page, state)
  await page.route(/\/api\/health$/, (route) => route.fulfill({ json: state.health }))
  await page.route(/\/api\/git\/status(?:\?.*)?$/, (route) => route.fulfill({ json: state.git }))
  await page.route(/\/api\/notifications$/, (route) => route.fulfill({ json: state.notifications }))
}

async function mockSettingsReads(page, options = {}) {
  await page.route(/\/api\/config$/, (route) => route.fulfill({ json: options.config || { items: [], problems: [] } }))
  await page.route(/\/api\/lan$/, (route) => route.fulfill({ json: { enabled: false, addresses: [], port: 7788 } }))
  await page.route(/\/api\/git\/remote$/, (route) => route.fulfill({ json: options.remote || null }))
  await page.route(/\/api\/workspaces$/, (route) => route.fulfill({ json: options.workspaces || { items: [] } }))
}

async function mockReadonlyHealth(page) {
  const state = runtimeStates.get(page)
  if (!state) throw new Error('mockRuntime must be installed before switching health')
  state.health = { ...writableHealth, canWrite: false, readonlyReason: 'lan' }
  await page.reload({ waitUntil: 'networkidle' })
}

async function openApp(page, route) {
  await page.goto(new URL(`/#${route}`, baseUrl).toString(), { waitUntil: 'networkidle' })
}

function quickCreateButton(page) {
  return page.locator('.fl-header-actions .ant-btn-primary').first()
}

async function chooseOption(page, label, option) {
  const escapedLabel = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const input = page.getByRole('combobox', { name: new RegExp(`(?:\\*\\s*)?${escapedLabel}$`) })
  await input.click()
  const listId = await input.getAttribute('aria-controls')
  const dropdown = listId
    ? page.locator(`#${listId}`).locator('xpath=ancestor::div[contains(@class, "ant-select-dropdown")]')
    : page.locator('.ant-select-dropdown:visible').last()
  await dropdown.locator('.ant-select-item-option')
    .filter({ hasText: option })
    .last()
    .click()
}

async function confirmButton(page, name) {
  const spacedName = new RegExp([...name].map((character) => character.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('\\s*'))
  await page.locator('.ant-popover:visible, .ant-modal-confirm:visible')
    .last()
    .getByRole('button', { name: spacedName })
    .evaluate((element) => element.click())
}

test.beforeAll(async () => {
  await fs.mkdir(screenshotDir, { recursive: true })
})

for (const [viewportName, viewport] of viewports) {
  test.describe(viewportName, () => {
    test.use({ viewport })

    for (const [name, route] of routes) {
      test(`${viewportName} ${route}`, async ({ page }) => {
        const consoleMessages = []
        const pageErrors = []

        page.on('console', (message) => {
          if (['error', 'warning'].includes(message.type())) {
            consoleMessages.push(`${message.type()}: ${clean(message.text())}`)
          }
        })
        page.on('pageerror', (error) => {
          pageErrors.push(clean(error.stack || error.message || error))
        })

        const response = await page.goto(new URL(`/#${route}`, baseUrl).toString(), { waitUntil: 'networkidle' })
        await page.waitForTimeout(500)

        const metrics = await page.evaluate(() => ({
          clientWidth: document.documentElement.clientWidth,
          scrollWidth: document.documentElement.scrollWidth,
          bodyText: document.body.innerText.replace(/\s+/g, ' ').slice(0, 600)
        }))
        const emptyAlerts = await page.locator('.ant-alert:visible').evaluateAll((alerts) => alerts
          .map((alert, index) => ({ index, text: alert.innerText.replace(/\s+/g, ' ').trim() }))
          .filter((alert) => !alert.text))

        if (route === '/projects/1') {
          await expect(page.getByTestId('version-browser')).toBeVisible({ timeout: 15000 })
          const browserBox = await page.getByTestId('version-browser').boundingBox()
          const availableWidth = viewport.width >= 1024 ? viewport.width - 240 : viewport.width
          expect(browserBox?.width || 0).toBeLessThanOrEqual(availableWidth)
          if (viewport.width >= 900) {
            await expect(page.getByTestId('desktop-version-summary')).toBeVisible()
            await expect(page.getByTestId('desktop-version-summary').locator('.ant-skeleton')).toHaveCount(0, { timeout: 10000 })
            const columns = await page.getByTestId('version-browser').evaluate((element) =>
              getComputedStyle(element).gridTemplateColumns)
            expect(columns).not.toBe('none')
          }
        }

        if (route === '/projects/1/versions/v5') {
          const preview = page.locator('iframe').first()
          await expect(preview).toBeVisible()
          const previewSrc = await preview.getAttribute('src')
          expect(new URL(previewSrc).port).not.toBe(new URL(baseUrl).port)
          expect(await preview.getAttribute('sandbox')).toBe('allow-scripts allow-forms allow-popups allow-modals')
        }

        const screenshot = path.join(screenshotDir, `${viewportName}-${name}.png`)
        await page.screenshot({ path: screenshot, fullPage: true })

        const item = {
          viewport: viewportName,
          route,
          status: response?.status() ?? null,
          horizontalOverflow: metrics.scrollWidth > metrics.clientWidth + 1,
          clientWidth: metrics.clientWidth,
          scrollWidth: metrics.scrollWidth,
          consoleMessages,
          pageErrors,
          emptyAlerts,
          bodyText: metrics.bodyText,
          screenshot
        }
        results.push(item)

        expect(item.status).toBeLessThan(400)
        expect(item.horizontalOverflow).toBe(false)
        expect(pageErrors).toEqual([])
        expect(emptyAlerts).toEqual([])
        expect(consoleMessages.filter((entry) =>
          !entry.includes('Failed to load resource') &&
          !entry.includes('cdn.tailwindcss.com should not be used in production') &&
          !entry.includes('columns.render` return cell props is deprecated') &&
          !entry.includes('[antd: List] The `List` component is deprecated') &&
          !entry.includes('[antd: Card] `bodyStyle` is deprecated') &&
          !entry.includes('[antd: Drawer] `width` is deprecated') &&
          !entry.includes('[antd: Modal] `maskClosable` is deprecated') &&
          !entry.includes('[antd: Alert] `message` is deprecated') &&
          !entry.includes('[antd: Table] `index` parameter of `rowKey` function is deprecated') &&
          !entry.includes('Instance created by `useForm` is not connected to any Form element') &&
          !entry.includes('[antd: Divider] `orientation` is used for direction')
        )).toEqual([])
      })
    }

    test(`${viewportName} timeline browsing`, async ({ page }) => {
      await page.goto(new URL('/#/projects/1', baseUrl).toString(), { waitUntil: 'networkidle' })
      await expect(page.getByTestId('version-browser')).toBeVisible()
      const rows = page.locator('[data-version-no]')
      if (await rows.count() < 2) test.skip(true, 'Fixture has fewer than two versions')

      const secondVersionNo = await rows.nth(1).getAttribute('data-version-no')
      await rows.nth(1).click()
      if (viewport.width < 900) {
        await expect(page.getByTestId('mobile-version-summary')).toBeVisible()
        await expect(page.getByTestId('mobile-version-summary')).toContainText(secondVersionNo || '')
        await page.keyboard.press('Escape')
      } else {
        await expect(page.getByTestId('desktop-version-summary')).toContainText(secondVersionNo || '')
      }

      await page.getByPlaceholder('搜索版本、标题、标签或需求').fill('__no_matching_version__')
      await expect(page.getByText('没有匹配的版本')).toBeVisible()
      await page.getByRole('button', { name: '清除筛选' }).click()
      await expect(rows.first()).toBeVisible()
    })
  })
}

for (const [viewportName, viewport] of viewports) {
  test.describe(`${viewportName} restored workflows`, () => {
    test.use({ viewport })

    test('shell exposes runtime, shortcut, notifications, readonly and update states', async ({ page }) => {
      const unexpectedWrites = []
      const calls = []
      let notifications = [{
        id: 'notify-1',
        status: 'pending',
        event: { event: 'snapshot.created', project: 'orders', version: 'v2' }
      }]
      let flushFails = true
      await protectWrites(page, unexpectedWrites)
      await mockRuntime(page, {
        health: {
          ...writableHealth,
          canWrite: false,
          readonlyReason: 'git',
          lan: true,
          updateManifestUrl: 'https://updates.example.test/manifest.json'
        }
      })
      await page.route(/\/api\/notifications$/, (route) => route.fulfill({ json: notifications }))
      await page.route(/\/api\/update\/check$/, (route) => {
        calls.push('update-check')
        return route.fulfill({ json: { available: true, manifest: { version: '0.8.0' } } })
      })
      await page.route(/\/api\/notifications\/flush$/, (route) => {
        calls.push('notification-retry')
        if (flushFails) return route.fulfill({ status: 503, json: { message: '通知通道暂不可用' } })
        notifications = []
        return route.fulfill({ json: [{ ok: true }] })
      })

      await openApp(page, '/actions')
      await expect(page.getByLabel('运行状态')).toContainText('已连接')
      await expect(page.getByLabel('运行状态')).toContainText('Git 只读')
      await expect(page.getByLabel('运行状态')).toContainText('局域网已开放')
      await expect(page.getByLabel('运行状态')).toContainText('v0.7.0')
      await expect(page.getByLabel('运行状态')).toContainText('可更新至 0.8.0')
      await expect(quickCreateButton(page)).toBeDisabled()
      expect(calls).toContain('update-check')

      await page.keyboard.press('Control+k')
      await expect(page).toHaveURL(/#\/search$/)
      await openApp(page, '/actions')

      await page.getByRole('button', { name: '待办与通知' }).click()
      await expect(page.getByText('snapshot.created')).toBeVisible()
      await expect(page.getByText(/orders v2/)).toBeVisible()
      await page.getByRole('button', { name: '立即重试' }).click()
      await expect(page.getByText('通知通道暂不可用')).toBeVisible()

      flushFails = false
      await page.getByRole('button', { name: '立即重试' }).click()
      await expect(page.getByText('通知队列已处理')).toBeVisible()
      expect(calls.filter((item) => item === 'notification-retry')).toHaveLength(2)
      expect(unexpectedWrites).toEqual([])
    })

    test('Git assistant covers diagnostic stages, recovery, sync and failure outcomes', async ({ page }) => {
      const unexpectedWrites = []
      const calls = []
      let doctor = { stage: 'no-git', checks: [{ level: 'error', title: 'Git 未安装' }] }
      let status = { ...readyGitStatus }
      let conflicts = []
      let initFails = true
      let identityFails = true
      let suggestionFails = true
      let syncFails = true
      let abortFails = true
      await page.addInitScript(() => {
        Object.defineProperty(navigator, 'clipboard', { configurable: true, value: undefined })
      })
      await protectWrites(page, unexpectedWrites)
      await mockRuntime(page)
      await page.route(/\/api\/git\/doctor$/, (route) => route.fulfill({ json: doctor }))
      await page.route(/\/api\/git\/status(?:\?.*)?$/, (route) => route.fulfill({ json: status }))
      await page.route(/\/api\/git\/conflicts$/, (route) => route.fulfill({ json: conflicts }))
      await page.route(/\/api\/git\/init$/, (route) => {
        calls.push('git-init')
        if (initFails) return route.fulfill({ status: 422, json: { message: '初始化失败夹具' } })
        doctor = { stage: 'ready', identity: { complete: false, name: '', email: '' }, checks: [] }
        return route.fulfill({ json: { needIdentity: true } })
      })
      await page.route(/\/api\/git\/identity$/, (route) => {
        calls.push('git-identity')
        if (identityFails) return route.fulfill({ status: 422, json: { message: '身份保存失败夹具' } })
        doctor = { stage: 'ready', identity: { complete: true, name: 'UI Tester', email: 'ui@example.test' }, checks: [] }
        status = {
          ...readyGitStatus,
          clean: false,
          files: [{ path: '.flowlark/projects/orders/project.json', label: '项目变更' }]
        }
        return route.fulfill({ json: { ok: true } })
      })
      await page.route(/\/api\/git\/suggest-message$/, (route) => {
        calls.push('git-suggest')
        if (suggestionFails) return route.fulfill({ status: 500, json: { message: '无法生成说明夹具' } })
        return route.fulfill({ json: { message: 'test: 保存 UI 回归' } })
      })
      await page.route(/\/api\/git\/brief\?intent=(?:commit|conflict)$/, (route) => {
        calls.push('git-brief')
        return route.fulfill({ json: { text: '仓库处境说明（不含原型内容）' } })
      })
      await page.route(/\/api\/git\/sync$/, (route) => {
        calls.push('git-sync')
        if (syncFails) return route.fulfill({ status: 409, json: { message: '同步失败夹具' } })
        return route.fulfill({ json: { message: '已同步夹具', steps: [{ name: 'commit', ok: true, detail: 'done' }] } })
      })
      await page.route(/\/api\/git\/permission\/refresh$/, (route) => {
        calls.push('git-permission')
        status = { ...status, permission: { mode: 'readonly' } }
        return route.fulfill({ json: { mode: 'readonly' } })
      })
      await page.route(/\/api\/git\/resolve\/orders$/, (route) => {
        calls.push('git-resolve')
        conflicts = conflicts.filter((item) => item.assisted !== true)
        return route.fulfill({ json: { ok: true } })
      })
      await page.route(/\/api\/git\/resolved$/, (route) => {
        calls.push('git-mark-resolved')
        conflicts = []
        return route.fulfill({ json: { ok: true } })
      })
      await page.route(/\/api\/git\/continue$/, (route) => {
        calls.push('git-continue')
        doctor = { stage: 'ready', identity: { complete: true }, checks: [] }
        return route.fulfill({ json: { message: '同步已继续完成', conflicts: [] } })
      })
      await page.route(/\/api\/git\/abort$/, (route) => {
        calls.push('git-abort')
        if (abortFails) return route.fulfill({ status: 500, json: { message: '中止失败夹具' } })
        doctor = { stage: 'ready', identity: { complete: true }, checks: [] }
        conflicts = []
        return route.fulfill({ json: { ok: true } })
      })

      await openApp(page, '/actions')
      await page.getByRole('button', { name: 'Git 状态' }).click()
      await expect(page.getByText('系统里没有找到 Git')).toBeVisible()
      await page.keyboard.press('Escape')

      doctor = { stage: 'no-repo', checks: [{ level: 'warn', title: '尚未初始化' }] }
      await page.getByRole('button', { name: 'Git 状态' }).click()
      await expect(page.getByText('这个仓库还没纳入 Git')).toBeVisible()
      await page.getByLabel('你的名字').fill('UI Tester')
      await page.getByLabel('你的邮箱').fill('ui@example.test')
      await page.getByRole('button', { name: '纳入 Git 管理' }).click()
      await expect(page.getByText('初始化失败夹具')).toBeVisible()
      await expect(page.getByLabel('你的名字')).toHaveValue('UI Tester')
      initFails = false
      await page.getByRole('button', { name: '纳入 Git 管理' }).click()
      await expect(page.getByText('还没有配置提交身份')).toBeVisible()

      await page.getByLabel('你的名字').fill('UI Tester')
      await page.getByLabel('你的邮箱').fill('ui@example.test')
      await page.getByRole('button', { name: '保存身份' }).click()
      await expect(page.getByText('身份保存失败夹具')).toBeVisible()
      await expect(page.getByLabel('你的邮箱')).toHaveValue('ui@example.test')
      identityFails = false
      await page.getByRole('button', { name: '保存身份' }).click()
      await expect(page.getByText('.flowlark/projects/orders/project.json')).toBeVisible()

      await page.getByRole('button', { name: '帮我写一条' }).click()
      await expect(page.getByText('无法生成说明夹具')).toBeVisible()
      suggestionFails = false
      await page.getByRole('button', { name: '帮我写一条' }).click()
      await expect(page.getByPlaceholder('提交说明（留空则自动生成）')).toHaveValue('test: 保存 UI 回归')
      await page.getByRole('button', { name: '复制给 AI 助理' }).click()
      await expect(page.getByLabel('Git 助理说明')).toHaveValue('仓库处境说明（不含原型内容）')
      await expect(page.getByText('浏览器不允许复制，请手动选中下面的文本')).toBeVisible()

      await page.getByRole('button', { name: '提交并同步' }).click()
      await expect(page.getByText('同步失败夹具')).toBeVisible()
      await expect(page.getByPlaceholder('提交说明（留空则自动生成）')).toHaveValue('test: 保存 UI 回归')
      syncFails = false
      await page.getByRole('button', { name: '提交并同步' }).click()
      await expect(page.getByLabel('Git 操作步骤')).toContainText('commit')
      await page.getByRole('button', { name: '刷新探测' }).click()
      await expect(page.getByText('当前 Git 身份是只读')).toBeVisible()
      await page.keyboard.press('Escape')

      status = { ...readyGitStatus, permission: { mode: 'writable' } }
      doctor = { stage: 'conflicted', identity: { complete: true }, checks: [] }
      conflicts = [
        { path: '.flowlark/projects/orders/baseline.json', project: 'orders', assisted: true, choices: { mine: 'v1', others: 'v2' } },
        { path: '.flowlark/projects/orders/project.json', kind: 'content', assisted: false }
      ]
      await page.getByRole('button', { name: 'Git 状态' }).click()
      await expect(page.getByText('2 个文件需要处理')).toBeVisible()
      await page.getByRole('button', { name: /保留.*v1.*你这边/ }).click()
      await page.getByRole('button', { name: '我改好了' }).click()
      await expect(page.getByRole('button', { name: '继续完成同步' })).toBeEnabled()
      await page.getByRole('button', { name: '继续完成同步' }).click()
      expect(calls).toEqual(expect.arrayContaining(['git-resolve', 'git-mark-resolved', 'git-continue']))
      await page.keyboard.press('Escape')

      doctor = { stage: 'conflicted', identity: { complete: true }, checks: [] }
      conflicts = []
      await page.getByRole('button', { name: 'Git 状态' }).click()
      await page.getByRole('button', { name: '放弃这次同步' }).click()
      await confirmButton(page, '放弃')
      await expect(page.getByText('中止失败夹具')).toBeVisible()
      abortFails = false
      await page.getByRole('button', { name: '放弃这次同步' }).click()
      await confirmButton(page, '放弃')
      await expect.poll(() => calls.filter((item) => item === 'git-abort').length).toBe(2)

      expect(calls).toEqual(expect.arrayContaining([
        'git-init', 'git-identity', 'git-suggest', 'git-brief', 'git-sync', 'git-permission'
      ]))
      expect(unexpectedWrites).toEqual([])
    })

    test('version import validates every source and preserves failed drafts from both entries', async ({ page }) => {
      const unexpectedWrites = []
      const calls = []
      const createdPayloads = []
      const projects = [{ slug: 'orders', name: '订单中心' }]
      const version = {
        versionNo: 'v1',
        title: '首版',
        createdAt: '2026-08-25T00:00:00Z',
        createdBy: 'UI Tester',
        display: { key: 'DRAFT', label: '编辑中', color: 'gold' },
        changes: [], requirements: [], externalRefs: []
      }
      let inspectFails = false
      let urlFails = false
      let createFails = true
      let impactRound = 0
      await protectWrites(page, unexpectedWrites)
      await mockRuntime(page, { health: { ...writableHealth, maxFileBytes: 128 } })
      await page.route(/\/api\/projects$/, (route) => route.fulfill({ json: projects }))
      await page.route(/\/api\/projects\/orders$/, (route) => route.fulfill({ json: projects[0] }))
      await page.route(/\/api\/projects\/orders\/versions\?.*$/, (route) => route.fulfill({ json: [version] }))
      await page.route(/\/api\/versions\/orders\/v1$/, (route) => route.fulfill({ json: version }))
      await page.route(/\/api\/read\/orders$/, (route) => route.fulfill({ json: { versionNo: 'v1' } }))
      await page.route(/\/api\/import\/html$/, async (route) => {
        calls.push('inspect-html')
        const body = route.request().postDataJSON()
        if (inspectFails || String(body.html).includes('invalid-html')) {
          return route.fulfill({ status: 422, json: { message: 'HTML 校验失败夹具' } })
        }
        return route.fulfill({ json: { title: '导入标题', externalRefs: ['https://cdn.example.test/app.css'] } })
      })
      await page.route(/\/api\/import\/url$/, async (route) => {
        calls.push('import-url')
        if (urlFails) return route.fulfill({ status: 422, json: { message: 'URL 导入失败夹具' } })
        return route.fulfill({ json: {
          html: '<!doctype html><html><body>url</body></html>',
          title: 'URL 原型',
          sourceUrl: 'https://public.example.test/v3.html',
          externalRefs: ['https://public.example.test/app.js']
        } })
      })
      await page.route(/\/api\/impact$/, (route) => {
        calls.push('impact')
        impactRound += 1
        return route.fulfill({ json: impactRound === 1 ? [{
          location: '订单列表', source: { project: 'orders', versionNo: 'v0' }, requirements: ['REQ-1']
        }] : [] })
      })
      await page.route(/\/api\/projects\/orders\/versions$/, async (route) => {
        const body = route.request().postDataJSON()
        calls.push(`create-version:${body.versionNo}`)
        createdPayloads.push(body)
        if (createFails) return route.fulfill({ status: 409, json: { message: '版本保存失败夹具' } })
        return route.fulfill({ json: { ...version, ...body } })
      })

      await openApp(page, '/actions')
      await quickCreateButton(page).click()
      await page.getByText('导入原型', { exact: true }).click()
      await expect(page.getByRole('dialog', { name: '新建版本' })).toBeVisible()
      await chooseOption(page, '项目', '订单中心 · orders')
      const fileInput = page.locator('input[type="file"]')
      await fileInput.setInputFiles({ name: 'prototype.txt', mimeType: 'text/plain', buffer: Buffer.from('<html></html>') })
      await expect(page.locator('.fl-new-version-source-alert').filter({ hasText: '仅支持 .html 或 .htm 文件' })).toBeVisible()
      await fileInput.setInputFiles({ name: 'oversized.html', mimeType: 'text/html', buffer: Buffer.alloc(129, 'x') })
      await expect(page.locator('.fl-new-version-source-alert').filter({ hasText: '文件超过' })).toBeVisible()
      await fileInput.setInputFiles({
        name: 'v2.html',
        mimeType: 'text/html',
        buffer: Buffer.from('<!doctype html><html><body>file</body></html>')
      })
      await expect(page.locator('.ant-modal:visible').getByText('检测到 1 个外部依赖')).toBeVisible()
      await page.getByRole('button', { name: '查看清单' }).click()
      await expect(page.getByText('https://cdn.example.test/app.css')).toBeVisible()
      await page.getByRole('button', { name: '添加一条变更' }).click()
      await page.getByLabel('第 1 条变更位置').fill('订单列表')
      await page.getByLabel('第 1 条变更内容').fill('调整列')
      await page.getByRole('button', { name: '添加关联需求' }).click()
      await page.getByLabel('第 1 条需求编号').fill('REQ-1')
      await page.getByLabel('第 1 条需求标题').fill('订单需求')
      await page.getByRole('button', { name: '检查影响面' }).click()
      await expect(page.getByText('发现 1 条历史关联')).toBeVisible()
      await page.getByLabel('第 1 条变更内容').fill('调整列二次')
      await page.getByRole('button', { name: '检查影响面' }).click()
      await expect(page.getByText('未发现历史关联')).toBeVisible()
      await page.getByRole('button', { name: '创建版本' }).click()
      await expect(page.getByText('版本保存失败夹具')).toBeVisible()
      await expect(page.getByLabel('版本号')).toHaveValue('v2')
      await expect(page.getByLabel('第 1 条变更内容')).toHaveValue('调整列二次')
      await expect(page.getByLabel('第 1 条需求编号')).toHaveValue('REQ-1')
      createFails = false
      await page.getByRole('button', { name: '创建版本' }).click()
      await expect(page).toHaveURL(/#\/projects\/orders\/versions\/v2$/)
      expect(calls).toContain('create-version:v2')

      await openApp(page, '/projects/orders')
      await page.getByRole('button', { name: '新建版本' }).click()
      await page.locator('.ant-modal:visible .ant-segmented-item-label[title="粘贴源码"]').click()
      await page.getByLabel('HTML 源码').fill('invalid-html')
      await page.getByLabel('HTML 源码').blur()
      await expect(page.locator('.fl-new-version-source-alert').filter({ hasText: 'HTML 校验失败夹具' })).toBeVisible()
      await expect(page.getByLabel('HTML 源码')).toHaveValue('invalid-html')
      await page.getByLabel('HTML 源码').fill('<!doctype html><html><body>paste</body></html>')
      await page.getByLabel('HTML 源码').blur()
      await expect(page.locator('.ant-modal:visible').getByText('检测到 1 个外部依赖')).toBeVisible()
      await page.getByRole('button', { name: '添加一条变更' }).click()
      await page.locator('.ant-modal:visible').getByLabel('第 1 条变更位置').fill('支付页')
      await page.locator('.ant-modal:visible').getByLabel('第 1 条变更内容').fill('增加状态')
      await page.getByRole('button', { name: '添加关联需求' }).click()
      await page.locator('.ant-modal:visible').getByLabel('第 1 条需求编号').fill('REQ-2')
      await page.getByRole('button', { name: '检查影响面' }).click()
      await expect(page.locator('.ant-modal:visible').getByText('未发现历史关联')).toBeVisible()
      await page.locator('.ant-modal:visible').getByPlaceholder('v1.0').fill('v3')
      await page.locator('.ant-modal:visible').getByPlaceholder('一句话说明本版主题').fill('粘贴原型')
      await page.getByRole('button', { name: '创建版本' }).click()
      await expect.poll(() => calls).toContain('create-version:v3')

      await page.getByRole('button', { name: '新建版本' }).click()
      await page.locator('.ant-modal:visible .ant-segmented-item-label[title="URL"]').click()
      await page.getByRole('button', { name: '读取' }).click()
      await expect(page.locator('.fl-new-version-source-alert').filter({ hasText: '请输入公开 URL' })).toBeVisible()
      urlFails = true
      await page.getByLabel('公开 URL').fill('https://public.example.test/fail.html')
      await page.getByRole('button', { name: '读取' }).click()
      await expect(page.locator('.fl-new-version-source-alert').filter({ hasText: 'URL 导入失败夹具' })).toBeVisible()
      await expect(page.getByLabel('公开 URL')).toHaveValue('https://public.example.test/fail.html')
      urlFails = false
      await page.getByLabel('公开 URL').fill('https://public.example.test/v3.html')
      await page.getByRole('button', { name: '读取' }).click()
      await expect(page.getByText('原型已读取')).toBeVisible()
      await expect(page.getByLabel('公开 URL')).toHaveValue('https://public.example.test/v3.html')

      const shellPayload = createdPayloads.find((item) => item.versionNo === 'v2')
      const projectPayload = createdPayloads.find((item) => item.versionNo === 'v3')
      expect(shellPayload.changes).toEqual([{ type: 'MODIFY', location: '订单列表', content: '调整列二次', requirement: '' }])
      expect(shellPayload.requirements).toEqual([{ code: 'REQ-1', title: '订单需求', url: '' }])
      expect(projectPayload.changes).toEqual([{ type: 'MODIFY', location: '支付页', content: '增加状态', requirement: '' }])
      expect(projectPayload.requirements).toEqual([{ code: 'REQ-2', title: '', url: '' }])
      expect(calls).toEqual(expect.arrayContaining(['inspect-html', 'import-url', 'impact']))
      expect(unexpectedWrites).toEqual([])
    })

    test('search covers structured, cross-workspace and saved-view flows', async ({ page }) => {
      const unexpectedWrites = []
      const calls = []
      const views = [
        { id: 'existing-local', name: '现有本地视图', scope: 'versions', query: '订单', filters: { workspaceScope: 'current', scope: 'versions', project: 'orders' } },
        { id: 'existing-cross', name: '现有跨工作区视图', scope: 'all', query: '支付', filters: { workspaceScope: 'all', scope: 'all' } }
      ]
      await protectWrites(page, unexpectedWrites)
      await mockRuntime(page)
      await page.route(/\/api\/projects$/, (route) => route.fulfill({ json: [{ slug: 'orders', name: '订单中心' }] }))
      await page.route(/\/api\/requirements$/, (route) => route.fulfill({ json: [{ code: 'REQ-1', title: '订单需求' }] }))
      await page.route(/\/api\/milestones$/, (route) => route.fulfill({ json: [{ name: 'S1', title: '迭代一' }] }))
      await page.route(/\/api\/views$/, (route) => route.fulfill({ json: views }))
      await page.route(/\/api\/search\?.*$/, (route) => {
        calls.push(`local-search:${apiPath(route)}`)
        return route.fulfill({ json: { total: 1, results: [{
          objectType: 'version', project: 'orders', projectName: '订单中心', versionNo: 'v2',
          versionTitle: '订单搜索命中', field: 'change', snippet: { text: '调整订单列表' }
        }] } })
      })
      await page.route(/\/api\/workspace-search\?.*$/, (route) => {
        calls.push(`workspace-search:${apiPath(route)}`)
        return route.fulfill({ json: [{
          workspace: '/tmp/foreign-workspace', workspaceName: '支付工作区',
          objectType: 'requirement', requirementCode: 'PAY-1', requirementTitle: '支付需求',
          title: '支付需求', field: 'requirement', snippet: { text: '跨工作区命中' }
        }] })
      })
      await page.route(/\/api\/views\/[^/]+$/, async (route) => {
        const id = decodeURIComponent(new URL(route.request().url()).pathname.split('/').at(-1))
        const body = route.request().postDataJSON()
        calls.push(`save-view:${id}:${body.filters.workspaceScope}`)
        views.push({ id, ...body })
        return route.fulfill({ json: { id, ...body } })
      })

      await openApp(page, '/search')
      await chooseOption(page, '对象范围', '版本')
      await chooseOption(page, '项目筛选', '订单中心 · orders')
      await chooseOption(page, '需求筛选', 'REQ-1 · 订单需求')
      await chooseOption(page, '迭代筛选', 'S1 · 迭代一')
      await chooseOption(page, '搜索字段', '需求与规格')
      await page.getByLabel('搜索关键词').fill('订单')
      await page.getByRole('region', { name: '搜索条件' }).getByRole('button', { name: /搜索/ }).click()
      await expect(page.getByRole('button', { name: '订单搜索命中' })).toBeVisible()
      const localCall = calls.find((item) => item.startsWith('local-search:'))
      expect(localCall).toContain('project=orders')
      expect(localCall).toContain('requirement=REQ-1')
      expect(localCall).toContain('milestone=S1')
      expect(localCall).toContain('scope=versions')
      expect(localCall).toContain('field=requirement%2Cchange%2Cspec')

      await page.getByRole('button', { name: '保存视图' }).click()
      await page.getByLabel('视图标识').fill('saved-local')
      await page.getByLabel('名称').fill('保存的本地视图')
      await page.getByRole('dialog').getByRole('button', { name: /确 定|确定/ }).click()
      await expect.poll(() => calls).toContain('save-view:saved-local:current')
      await chooseOption(page, '已存视图', '保存的本地视图')
      await expect.poll(() => calls.filter((item) => item.startsWith('local-search:')).length).toBeGreaterThan(1)

      await chooseOption(page, '搜索工作区范围', '跨工作区')
      await expect(page.getByText('跨工作区结果按关键词检索，并保留工作区来源。')).toBeVisible()
      await expect(page.getByLabel('对象范围')).toBeDisabled()
      await page.getByLabel('搜索关键词').fill('支付')
      await page.getByRole('region', { name: '搜索条件' }).getByRole('button', { name: /搜索/ }).click()
      await expect(page.getByRole('button', { name: '支付需求' })).toBeVisible()
      await expect(page.getByText(/支付工作区 · 支付工作区/)).toBeVisible()
      await page.getByRole('button', { name: '支付需求' }).click()
      await expect(page.getByText(/结果位于工作区：支付工作区/)).toBeVisible()
      await expect(page).toHaveURL(/#\/search/)

      await page.getByRole('button', { name: '保存视图' }).click()
      await page.getByLabel('视图标识').fill('saved-cross')
      await page.getByLabel('名称').fill('保存的跨工作区视图')
      await page.getByRole('dialog').getByRole('button', { name: /确 定|确定/ }).click()
      await expect.poll(() => calls).toContain('save-view:saved-cross:all')
      await chooseOption(page, '已存视图', '保存的跨工作区视图')
      await expect.poll(() => calls.filter((item) => item.startsWith('workspace-search:')).length).toBeGreaterThan(1)
      expect(unexpectedWrites).toEqual([])
    })

    test('requirements preserve drafts and expose external, edit, export and linked-version actions', async ({ page }) => {
      const unexpectedWrites = []
      const calls = []
      const items = [{
        code: 'REQ-1', title: '订单需求', description: '旧说明', owner: 'PM', project: 'orders', module: '列表',
        derivedStatus: 'designing', versions: [{ project: 'orders', versionNo: 'v1', title: '首版', isBaseline: true }]
      }]
      let createFails = true
      let editFails = true
      let tokenFails = true
      await protectWrites(page, unexpectedWrites)
      await mockRuntime(page)
      await page.route(/\/api\/requirements$/, async (route) => {
        if (route.request().method() === 'GET') return route.fulfill({ json: items })
        calls.push('requirement-create')
        if (createFails) return route.fulfill({ status: 409, json: { message: '需求创建失败夹具' } })
        const created = { ...route.request().postDataJSON(), derivedStatus: 'not_started', versions: [] }
        items.push(created)
        return route.fulfill({ json: created })
      })
      await page.route(/\/api\/integrations\/requirements\/mcp\/token$/, (route) => {
        calls.push('requirement-token')
        if (tokenFails) return route.fulfill({ status: 500, json: { message: 'Token 保存失败夹具' } })
        return route.fulfill({ json: { ok: true } })
      })
      await page.route(/\/api\/integrations\/requirements\/mcp\/search$/, (route) => {
        calls.push('requirement-external-search')
        return route.fulfill({ json: [{ code: 'EXT-9', title: '外部需求', project: 'EXT', module: '支付', status: 'open', owner: 'Owner' }] })
      })
      await page.route(/\/api\/integrations\/requirements\/mcp\/import$/, (route) => {
        calls.push('requirement-import')
        return route.fulfill({ json: { code: 'EXT-9', title: '外部需求', description: '', owner: 'Owner', versions: [], derivedStatus: 'not_started' } })
      })
      await page.route(/\/api\/requirements\/sync$/, (route) => {
        calls.push('requirement-sync')
        return route.fulfill({ json: { total: 3, updated: 2, failed: [{ code: 'EXT-10', error: 'fixture' }], items } })
      })
      await page.route(/\/api\/requirements\/REQ-1$/, async (route) => {
        if (route.request().method() === 'GET') return route.fulfill({ json: items[0] })
        calls.push('requirement-edit')
        if (editFails) return route.fulfill({ status: 422, json: { message: '需求编辑失败夹具' } })
        Object.assign(items[0], route.request().postDataJSON())
        return route.fulfill({ json: items[0] })
      })
      await page.route(/\/api\/requirements\/EXT-9$/, (route) => route.fulfill({ json: {
        code: 'EXT-9', title: '外部需求', description: '', owner: 'Owner', versions: [], derivedStatus: 'not_started'
      } }))
      await page.route(/\/api\/requirements\/REQ-2$/, (route) => route.fulfill({ json: {
        code: 'REQ-2', title: '本地新需求', description: '', owner: '', versions: [], derivedStatus: 'not_started'
      } }))
      await page.route(/\/api\/export\/requirement\/REQ-1$/, (route) => {
        calls.push('requirement-export')
        return route.fulfill({ json: { outputDir: '/tmp/req-export' } })
      })

      await openApp(page, '/requirements')
      await page.getByRole('button', { name: '新建需求' }).click()
      await page.getByLabel('需求编号').fill('REQ-2')
      await page.getByLabel('标题').fill('本地新需求')
      await page.getByRole('dialog').getByRole('button', { name: /确 定|确定/ }).click()
      await expect(page.getByText('需求创建失败夹具')).toBeVisible()
      await expect(page.getByLabel('需求编号')).toHaveValue('REQ-2')
      createFails = false
      await page.getByRole('dialog').getByRole('button', { name: /确 定|确定/ }).click()
      await expect(page).toHaveURL(/#\/requirements\/REQ-2$/)

      await openApp(page, '/requirements')
      await page.getByRole('button', { name: '从需求池导入' }).click()
      const token = page.getByPlaceholder('留空则使用环境变量或已保存密钥')
      await token.fill('fixture-token-never-sent')
      await page.getByRole('button', { name: '保存 Token' }).click()
      await expect(page.getByText('Token 保存失败夹具')).toBeVisible()
      await expect(token).toHaveValue('fixture-token-never-sent')
      tokenFails = false
      await page.getByRole('button', { name: '保存 Token' }).click()
      await expect(token).toHaveValue('')
      await page.getByLabel('搜索需求池').fill('外部')
      await page.getByRole('dialog', { name: '从需求池导入' }).getByRole('button', { name: /搜\s*索/ }).click()
      await expect(page.getByText(/EXT-9.*外部需求/)).toBeVisible()
      await page.getByRole('dialog', { name: '从需求池导入' }).getByRole('button', { name: /导\s*入/ }).click()
      await expect(page).toHaveURL(/#\/requirements\/EXT-9$/)

      await openApp(page, '/requirements')
      await page.getByRole('button', { name: '同步需求池' }).click()
      await expect(page.getByText(/已同步 2\/3 条，失败 1 条/)).toBeVisible()
      await openApp(page, '/requirements/REQ-1')
      await page.getByRole('button', { name: '编辑' }).click()
      await page.getByRole('dialog').getByLabel('标题').fill('更新标题')
      await page.getByRole('dialog').getByRole('button', { name: /确 定|确定/ }).click()
      await expect(page.getByText('需求编辑失败夹具')).toBeVisible()
      await expect(page.getByRole('dialog').getByLabel('标题')).toHaveValue('更新标题')
      editFails = false
      await page.getByRole('dialog').getByRole('button', { name: /确 定|确定/ }).click()
      await expect(page.getByRole('heading', { name: '更新标题' })).toBeVisible()
      await page.getByRole('button', { name: '导出需求包' }).click()
      await expect.poll(() => calls).toContain('requirement-export')
      await page.getByRole('button', { name: /orders \/ v1/ }).click()
      await expect(page).toHaveURL(/#\/projects\/orders\/versions\/v1$/)

      await mockReadonlyHealth(page)
      await openApp(page, '/requirements/REQ-1')
      await expect(page.getByRole('button', { name: '编辑' })).toBeDisabled()
      await expect(page.getByRole('button', { name: '导出需求包' })).toBeDisabled()
      expect(calls).toEqual(expect.arrayContaining([
        'requirement-create', 'requirement-token', 'requirement-external-search',
        'requirement-import', 'requirement-sync', 'requirement-edit', 'requirement-export'
      ]))
      expect(unexpectedWrites).toEqual([])
    })

    test('milestone list and detail writes cover synchronization, retained failures and readonly guards', async ({ page }) => {
      const unexpectedWrites = []
      const calls = []
      const milestones = [{ name: 'S0', title: '已有迭代', startAt: '2026-08-01', endAt: '2026-08-15', ready: true, warnings: [], items: [] }]
      let milestone = {
        name: 'S1', title: '迭代一', startAt: '2026-08-16', endAt: '2026-08-31', ready: false,
        warnings: [], items: [{ requirement: 'REQ-1', project: 'orders', version: 'v1', versionTitle: '首版', currentBaseline: 'v1' }]
      }
      let createFails = true
      let syncAllRound = 0
      let detailSyncFails = true
      let updateFails = true
      await protectWrites(page, unexpectedWrites)
      await mockRuntime(page)
      await page.route(/\/api\/milestones$/, async (route) => {
        if (route.request().method() === 'GET') return route.fulfill({ json: milestones })
        calls.push('milestone-create')
        if (createFails) return route.fulfill({ status: 422, json: { message: '迭代创建失败夹具' } })
        const created = { ...route.request().postDataJSON(), warnings: [], ready: false }
        milestones.push(created)
        return route.fulfill({ json: created })
      })
      await page.route(/\/api\/milestones\/sync$/, (route) => {
        calls.push('milestone-sync-all')
        syncAllRound += 1
        return route.fulfill({ json: syncAllRound === 1
          ? { created: 1, updated: 1, failed: [], items: milestones }
          : { created: 0, updated: 1, failed: [{ name: 'S-X', error: 'fixture' }], items: milestones } })
      })
      await page.route(/\/api\/milestones\/S(?:1|2)\/sync$/, (route) => {
        const syncName = new URL(route.request().url()).pathname.split('/')[3]
        calls.push(`milestone-sync:${syncName}`)
        if (detailSyncFails && apiPath(route).includes('/S1/')) {
          return route.fulfill({ status: 500, json: { message: '迭代同步失败夹具' } })
        }
        return route.fulfill({ json: {
          ...milestone,
          name: syncName,
          external: { status: 'synced', syncedAt: '2026-08-25T00:00:00Z' }
        } })
      })
      await page.route(/\/api\/milestones\/S1$/, async (route) => {
        if (route.request().method() === 'GET') return route.fulfill({ json: milestone })
        calls.push('milestone-update')
        if (updateFails) return route.fulfill({ status: 422, json: { message: '迭代范围保存失败夹具' } })
        milestone = { ...milestone, ...route.request().postDataJSON() }
        return route.fulfill({ json: milestone })
      })
      await page.route(/\/api\/requirements$/, (route) => route.fulfill({ json: [{ code: 'REQ-2', title: '新增需求' }] }))
      await page.route(/\/api\/projects$/, (route) => route.fulfill({ json: [{ slug: 'orders', name: '订单中心' }] }))
      await page.route(/\/api\/projects\/orders\/versions\?.*$/, (route) => route.fulfill({ json: [{ versionNo: 'v2', title: '二版' }] }))
      await page.route(/\/api\/export\/milestone\/S1$/, (route) => {
        calls.push('milestone-export')
        return route.fulfill({ json: { outputDir: '/tmp/milestone-export' } })
      })

      await openApp(page, '/milestones')
      await page.getByRole('button', { name: '新建迭代' }).click()
      await page.getByLabel('迭代标识').fill('S1')
      await page.getByLabel('标题').fill('迭代一')
      await page.getByRole('dialog').getByRole('button', { name: /确 定|确定/ }).click()
      await expect(page.getByText('迭代创建失败夹具')).toBeVisible()
      await expect(page.getByLabel('迭代标识')).toHaveValue('S1')
      createFails = false
      await page.getByRole('dialog').getByRole('button', { name: /确 定|确定/ }).click()
      await expect(page).toHaveURL(/#\/milestones\/S1$/)

      await openApp(page, '/milestones')
      await page.getByRole('button', { name: '新建迭代' }).click()
      const secondMilestoneDialog = page.getByRole('dialog', { name: '新建迭代' })
      await secondMilestoneDialog.getByPlaceholder('2026-S12').fill('S2')
      await secondMilestoneDialog.getByText('创建后同步到任务平台').click()
      await secondMilestoneDialog.getByRole('button', { name: /确 定|确定/ }).click()
      await expect(page).toHaveURL(/#\/milestones\/S2$/)
      await openApp(page, '/milestones')
      await page.getByRole('button', { name: '同步全部' }).click()
      await expect(page.getByText(/同步完成：新建 1 个，更新 1 个，失败 0 个/)).toBeVisible()
      await page.getByRole('button', { name: '同步全部' }).click()
      await expect(page.getByText(/同步完成：新建 0 个，更新 1 个，失败 1 个/)).toBeVisible()

      await openApp(page, '/milestones/S1')
      await page.getByRole('button', { name: '添加版本' }).click()
      await chooseOption(page, '需求', 'REQ-2 · 新增需求')
      await chooseOption(page, '项目', '订单中心')
      await chooseOption(page, '版本', 'v2 · 二版')
      await page.getByRole('dialog').getByRole('button', { name: /确 定|确定/ }).click()
      await expect(page.getByText('迭代范围保存失败夹具')).toBeVisible()
      await expect(page.getByRole('dialog', { name: '添加需求版本' })).toContainText('REQ-2 · 新增需求')
      updateFails = false
      await page.getByRole('dialog').getByRole('button', { name: /确 定|确定/ }).click()
      await expect.poll(() => milestone.items.length).toBe(2)
      await page.getByRole('button', { name: '移除' }).first().click()
      await confirmButton(page, '移除')
      await expect.poll(() => milestone.items.length).toBe(1)

      await page.getByRole('button', { name: '同步到任务平台' }).click()
      await expect(page.getByText('迭代同步失败夹具')).toBeVisible()
      detailSyncFails = false
      await page.getByRole('button', { name: '同步到任务平台' }).click()
      await expect(page.getByText('已同步到任务平台')).toBeVisible()
      await page.getByRole('button', { name: '导出迭代包' }).click()
      await expect.poll(() => calls).toContain('milestone-export')

      await mockReadonlyHealth(page)
      await openApp(page, '/milestones/S1')
      await expect(page.getByRole('button', { name: '添加版本' })).toBeDisabled()
      await expect(page.getByRole('button', { name: '同步到任务平台' })).toBeDisabled()
      await expect(page.getByRole('button', { name: '导出迭代包' })).toBeDisabled()
      await expect(page.getByRole('button', { name: '移除' }).first()).toBeDisabled()
      expect(calls).toEqual(expect.arrayContaining([
        'milestone-create', 'milestone-sync-all', 'milestone-sync:S2',
        'milestone-update', 'milestone-sync:S1', 'milestone-export'
      ]))
      expect(unexpectedWrites).toEqual([])
    })

    test('delivery, watch inbox and trash actions retain failures and honor readonly guards', async ({ page }) => {
      const unexpectedWrites = []
      const calls = []
      let notifications = [{
        id: 'n1', status: 'pending', attempts: 1, lastError: '平台拒绝',
        createdAt: '2026-08-25T00:00:00Z', updatedAt: '2026-08-25T00:00:00Z',
        event: { event: 'snapshot.created', project: 'orders', snapshot: 'D0' }
      }]
      let snapshotFails = true
      let notificationTestFails = true
      let webhookFails = true
      let watchRetryFails = true
      let trashRestoreFails = true
      let trashItems = [{ project: 'orders', versionNo: 'v1', deletedAt: '2026-08-25T00:00:00Z', deletedBy: 'tester', dir: '/tmp/trash/orders-v1' }]
      const watchItems = [
        { id: 'archived-1', title: '已归档原型', filename: 'archived.html', project: 'orders', versionNo: 'v2', suggestedVersionNo: 'v2', status: 'archived', collectedAt: '2026-08-25T00:00:00Z' },
        { id: 'failed-1', title: '失败原型', filename: 'failed.html', project: 'orders', suggestedVersionNo: 'v3', status: 'failed', error: '解析失败', collectedAt: '2026-08-25T00:00:00Z' }
      ]
      await protectWrites(page, unexpectedWrites)
      await mockRuntime(page)
      await page.route(/\/api\/notifications$/, (route) => route.fulfill({ json: notifications }))
      await page.route(/\/api\/snapshots$/, async (route) => {
        if (route.request().method() === 'GET') return route.fulfill({ json: [] })
        calls.push('snapshot-create')
        if (snapshotFails) return route.fulfill({ status: 409, json: { message: '快照创建失败夹具' } })
        return route.fulfill({ json: { name: route.request().postDataJSON().name } })
      })
      await page.route(/\/api\/milestones$/, (route) => route.fulfill({ json: [{ name: 'S1', title: '迭代一' }] }))
      await page.route(/\/api\/notifications\/test$/, (route) => {
        calls.push('notification-test')
        if (notificationTestFails) return route.fulfill({ status: 502, json: { message: '测试通知失败夹具' } })
        return route.fulfill({ json: { ok: true } })
      })
      await page.route(/\/api\/notifications\/wecom\/webhook$/, (route) => {
        calls.push('notification-save')
        if (webhookFails) return route.fulfill({ status: 422, json: { message: 'Webhook 保存失败夹具' } })
        return route.fulfill({ json: { ok: true } })
      })
      await page.route(/\/api\/notifications\/flush$/, (route) => {
        calls.push('notification-flush')
        return route.fulfill({ json: [{ id: 'n1', ok: false, error: '平台拒绝' }] })
      })
      await page.route(/\/api\/watch\/inbox$/, (route) => route.fulfill({ json: watchItems }))
      await page.route(/\/api\/watch\/inbox\/failed-1\/retry$/, (route) => {
        calls.push('watch-retry')
        if (watchRetryFails) return route.fulfill({ status: 422, json: { message: '重新归档失败夹具' } })
        watchItems[1] = { ...watchItems[1], status: 'archived', versionNo: 'v3', error: '' }
        return route.fulfill({ json: watchItems[1] })
      })
      await page.route(/\/api\/trash$/, (route) => route.fulfill({ json: trashItems }))
      await page.route(/\/api\/versions\/orders\/v1\/restore$/, (route) => {
        calls.push('trash-restore')
        if (trashRestoreFails) return route.fulfill({ status: 409, json: { message: '恢复失败夹具' } })
        trashItems = []
        return route.fulfill({ json: { project: 'orders', versionNo: 'v1', status: 'DRAFT' } })
      })

      await openApp(page, '/deliveries')
      await page.getByRole('button', { name: '创建快照' }).click()
      await page.getByLabel('快照标识').fill('D1')
      await page.getByLabel('标题').fill('评审快照')
      await chooseOption(page, '来源迭代', 'S1 · 迭代一')
      await page.getByRole('dialog').getByRole('button', { name: /确 定|确定/ }).click()
      await expect(page.getByRole('dialog', { name: '创建不可变交付快照' }).getByText('快照创建失败夹具')).toBeVisible()
      await expect(page.getByLabel('快照标识')).toHaveValue('D1')
      snapshotFails = false
      await page.getByRole('dialog').getByRole('button', { name: /确 定|确定/ }).click()
      await expect(page).toHaveURL(/#\/deliveries\/D1$/)

      await openApp(page, '/deliveries')
      await page.getByRole('button', { name: '通知设置' }).click()
      const webhook = page.getByLabel('Webhook')
      await webhook.fill('https://hooks.example.test/demo')
      await page.getByRole('button', { name: '发送测试' }).click()
      await expect(page.getByRole('dialog', { name: '通知设置' }).getByText('测试通知失败夹具')).toBeVisible()
      await expect(webhook).toHaveValue('https://hooks.example.test/demo')
      notificationTestFails = false
      await page.getByRole('button', { name: '发送测试' }).click()
      await expect(page.getByText('测试通知已发送')).toBeVisible()
      await page.getByRole('button', { name: '保存 Webhook' }).click()
      await expect(page.getByRole('dialog', { name: '通知设置' }).getByText('Webhook 保存失败夹具')).toBeVisible()
      await expect(webhook).toHaveValue('https://hooks.example.test/demo')
      webhookFails = false
      await page.getByRole('button', { name: '保存 Webhook' }).click()
      await expect(webhook).toHaveValue('')
      await page.keyboard.press('Escape')
      await page.getByRole('button', { name: '1 条待重试' }).click()
      await expect(page.getByText(/仍有 1 条失败：平台拒绝/)).toBeVisible()

      await openApp(page, '/watch')
      await expect(page.getByText('失败原因：解析失败')).toBeVisible()
      await page.getByRole('button', { name: '打开版本' }).click()
      await expect(page).toHaveURL(/#\/projects\/orders\/versions\/v2$/)
      await openApp(page, '/watch')
      await page.getByRole('button', { name: /重\s*试/ }).click()
      await expect(page.getByText('重新归档失败夹具')).toBeVisible()
      await expect(page.getByText('失败原因：解析失败')).toBeVisible()
      watchRetryFails = false
      await page.getByRole('button', { name: /重\s*试/ }).click()
      await expect.poll(() => calls).toContain('watch-retry')
      await expect(page.getByRole('button', { name: '打开版本' })).toHaveCount(2)

      await openApp(page, '/trash')
      await page.getByRole('button', { name: /恢\s*复/ }).click()
      await expect(page.getByText('恢复后状态重置为编辑中，不会自动变回基线。')).toBeVisible()
      await confirmButton(page, '恢复')
      await expect(page.getByText('恢复失败夹具')).toBeVisible()
      await expect(page.getByText('orders / v1')).toBeVisible()
      trashRestoreFails = false
      await page.reload({ waitUntil: 'networkidle' })
      await page.getByRole('button', { name: /恢\s*复/ }).click()
      await confirmButton(page, '恢复')
      await expect(page.getByText('回收站是空的')).toBeVisible()

      await mockReadonlyHealth(page)
      notifications = [{ ...notifications[0], status: 'pending' }]
      watchItems[1] = { ...watchItems[1], status: 'failed', error: '解析失败' }
      trashItems = [{ project: 'orders', versionNo: 'v1', deletedAt: '2026-08-25T00:00:00Z' }]
      await openApp(page, '/deliveries')
      await expect(page.getByRole('button', { name: '创建快照' })).toBeDisabled()
      await expect(page.getByRole('button', { name: '1 条待重试' })).toBeDisabled()
      await page.getByRole('button', { name: '通知设置' }).click()
      await expect(page.getByRole('button', { name: '发送测试' })).toBeDisabled()
      await expect(page.getByRole('button', { name: '保存 Webhook' })).toBeDisabled()
      await page.keyboard.press('Escape')
      await openApp(page, '/watch')
      await expect(page.getByRole('button', { name: /重\s*试/ })).toBeDisabled()
      await openApp(page, '/trash')
      await expect(page.getByRole('button', { name: /恢\s*复/ })).toBeDisabled()

      expect(calls).toEqual(expect.arrayContaining([
        'snapshot-create', 'notification-test', 'notification-save',
        'notification-flush', 'watch-retry', 'trash-restore'
      ]))
      expect(unexpectedWrites).toEqual([])
    })

    test('workspace registration, clone, removal and indexing are safely mocked', async ({ page }) => {
      const unexpectedWrites = []
      const calls = []
      const workspaces = {
        lastWorkspace: '/tmp/existing',
        items: [{ path: '/tmp/existing', name: 'Existing', mode: 'normal', missing: false }]
      }
      let registerFails = true
      let removeFails = true
      await protectWrites(page, unexpectedWrites)
      await mockRuntime(page)
      await mockSettingsReads(page, { workspaces })
      await page.route(/\/api\/workspaces$/, (route) => route.fulfill({ json: workspaces }))
      await page.route(/\/api\/workspaces\/register$/, (route) => {
        calls.push(`workspace-register:${JSON.stringify(route.request().postDataJSON())}`)
        if (registerFails) return route.fulfill({ status: 409, json: { message: '注册失败夹具' } })
        workspaces.items.push({ ...route.request().postDataJSON(), missing: false })
        return route.fulfill({ json: { ok: true } })
      })
      await page.route(/\/api\/workspaces\/clone$/, (route) => {
        calls.push(`workspace-clone:${JSON.stringify(route.request().postDataJSON())}`)
        workspaces.items.push({ ...route.request().postDataJSON(), missing: false })
        return route.fulfill({ json: { ok: true } })
      })
      await page.route(/\/api\/workspaces\?path=.*$/, (route) => {
        calls.push('workspace-remove')
        if (removeFails) return route.fulfill({ status: 409, json: { message: '移除失败夹具' } })
        workspaces.items = workspaces.items.filter((item) => item.path !== '/tmp/existing')
        return route.fulfill({ json: { path: '/tmp/existing' } })
      })
      await page.route(/\/api\/workspace-index$/, (route) => {
        calls.push('workspace-index')
        return route.fulfill({ json: { builtAt: '2026-08-25T00:00:00Z', records: [{ id: 1 }, { id: 2 }, { id: 3 }] } })
      })

      await openApp(page, '/settings')
      await page.getByLabel('本机目录').fill('/tmp/new-existing')
      await page.getByLabel('显示名称').fill('New Existing')
      await page.getByRole('button', { name: '注册工作区' }).click()
      await expect(page.getByText('注册失败夹具')).toBeVisible()
      await expect(page.getByLabel('本机目录')).toHaveValue('/tmp/new-existing')
      registerFails = false
      await page.getByRole('button', { name: '注册工作区' }).click()
      await expect.poll(() => calls.some((item) => item.includes('workspace-register'))).toBe(true)

      await page.getByRole('tab', { name: '从 Git clone' }).click()
      await page.getByLabel('Git 地址').fill('https://example.test/repo.git')
      await page.getByLabel('本机目录').fill('/tmp/cloned')
      await page.getByLabel('显示名称').fill('Cloned')
      await page.getByText('只读镜像').click()
      await page.getByRole('button', { name: 'Clone 并注册' }).click()
      const cloneCall = calls.find((item) => item.startsWith('workspace-clone:'))
      expect(cloneCall).toContain('"mode":"mirror"')
      expect(cloneCall).toContain('"mirror":true')

      await page.getByRole('button', { name: '重建索引' }).click()
      await expect(page.getByText(/索引已重建，共 3 条记录/)).toBeVisible()
      await page.getByRole('button', { name: '移除' }).first().click()
      await expect(page.locator('.ant-modal-confirm:visible')).toContainText('/tmp/existing')
      await confirmButton(page, '移除')
      await expect(page.getByText('移除失败夹具')).toBeVisible()
      removeFails = false
      await page.reload({ waitUntil: 'networkidle' })
      await page.locator('.ant-list-item').filter({ hasText: '/tmp/existing' }).getByRole('button', { name: '移除' }).click()
      await confirmButton(page, '移除')
      await expect.poll(() => calls.filter((item) => item === 'workspace-remove').length).toBe(2)

      await mockReadonlyHealth(page)
      await openApp(page, '/settings')
      await expect(page.getByRole('button', { name: '重建索引' })).toBeDisabled()
      await expect(page.getByLabel('本机目录')).toBeDisabled()
      await expect(page.getByRole('button', { name: '移除' }).first()).toBeDisabled()
      expect(calls).toEqual(expect.arrayContaining(['workspace-index', 'workspace-remove']))
      expect(unexpectedWrites).toEqual([])
    })

    test('software update guards and operation-log retry, empty and pagination states are visible', async ({ page }) => {
      const unexpectedWrites = []
      const calls = []
      let updateStatus = {
        tracked: true,
        path: '/tmp/flowlark',
        currentVersion: '0.7.0',
        latestVersion: '0.8.0',
        available: true,
        upstream: 'origin/main',
        behind: 1,
        dirty: true,
        checkedAt: '2026-08-25T00:00:00Z'
      }
      let updateFetchFails = false
      let pullFails = true
      let oplogFails = true
      let logs = []
      await protectWrites(page, unexpectedWrites)
      await mockRuntime(page)
      await mockSettingsReads(page)
      await page.route(/\/api\/update\/software(?:\?.*)?$/, (route) => {
        calls.push(`update-status:${apiPath(route)}`)
        if (updateFetchFails && apiPath(route).includes('fetch=1')) {
          return route.fulfill({ status: 502, json: { message: '远端检测失败夹具' } })
        }
        return route.fulfill({ json: updateStatus })
      })
      await page.route(/\/api\/update\/software\/pull$/, (route) => {
        calls.push('software-pull')
        if (pullFails) return route.fulfill({ status: 409, json: { message: '软件拉取失败夹具' } })
        updateStatus = { ...updateStatus, available: false, behind: 0 }
        return route.fulfill({ json: { updated: true, restartNeeded: true, message: '软件已更新，请重启 Flowlark' } })
      })
      await page.route(/\/api\/oplog\?limit=300$/, (route) => {
        calls.push('oplog-load')
        if (oplogFails) return route.fulfill({ status: 500, json: { message: '日志加载失败夹具' } })
        return route.fulfill({ json: logs })
      })

      await openApp(page, '/settings/softwareUpdate')
      await expect(page.getByText('软件目录存在本地改动')).toBeVisible()
      await expect(page.getByText(/请先提交或清理软件目录里的本地改动/)).toBeVisible()
      await expect(page.getByRole('button', { name: '拉取并更新' })).toBeDisabled()

      updateStatus = { ...updateStatus, dirty: false }
      updateFetchFails = true
      await page.getByRole('button', { name: '检测更新' }).click()
      await expect(page.getByText('远端检测失败夹具')).toBeVisible()
      updateFetchFails = false
      await page.getByRole('button', { name: '检测更新' }).click()
      await expect(page.getByRole('button', { name: '拉取并更新' })).toBeEnabled()
      await page.getByRole('button', { name: '拉取并更新' }).click()
      await expect(page.locator('.ant-modal-confirm:visible')).toContainText('拉取并更新 Flowlark？')
      await page.locator('.ant-modal-confirm:visible').getByRole('button', { name: /取\s*消/ })
        .evaluate((element) => element.click())
      await expect(page.locator('.ant-modal-confirm:visible')).toHaveCount(0)
      expect(calls).not.toContain('software-pull')
      await page.getByRole('button', { name: '拉取并更新' }).click()
      await confirmButton(page, '拉取并更新')
      await expect(page.getByText('软件拉取失败夹具')).toBeVisible()
      pullFails = false
      await page.reload({ waitUntil: 'networkidle' })
      await page.getByRole('button', { name: '拉取并更新' }).click()
      await confirmButton(page, '拉取并更新')
      await expect(page.getByText('软件已更新，请重启 Flowlark')).toBeVisible()
      await expect(page.locator('#main-content').getByRole('button', { name: '拉取并更新' })).toBeDisabled()

      await openApp(page, '/settings/oplog')
      await expect(page.getByText('日志加载失败夹具')).toBeVisible()
      oplogFails = false
      await page.getByRole('button', { name: /重\s*试/ }).click()
      await expect(page.locator('.ant-empty-description').filter({ hasText: '暂无数据' })).toBeVisible()

      logs = Array.from({ length: 25 }, (_, index) => ({
        at: `2026-08-25T00:${String(index).padStart(2, '0')}:00Z`,
        by: 'tester',
        project: 'orders',
        action: index === 24 ? 'CUSTOM_FIXTURE' : 'VERSION_ADD',
        detail: `日志详情 ${index + 1}`
      }))
      await page.reload({ waitUntil: 'networkidle' })
      await expect(page.getByText('新增版本').first()).toBeVisible()
      await expect(page.locator('.ant-table-tbody .ant-table-row')).toHaveCount(20)
      await page.locator('.ant-pagination-item-2').click()
      await expect(page.getByText('日志详情 25')).toBeVisible()
      await expect(page.getByText('CUSTOM_FIXTURE')).toBeVisible()

      await mockReadonlyHealth(page)
      updateStatus = { ...updateStatus, available: true }
      await openApp(page, '/settings/softwareUpdate')
      await expect(page.getByRole('button', { name: '拉取并更新' })).toBeDisabled()
      expect(calls).toEqual(expect.arrayContaining(['software-pull', 'oplog-load']))
      expect(unexpectedWrites).toEqual([])
    })

    test('MCP CRUD, destructive confirmations and secret APIs never reach a real keychain', async ({ page }) => {
      const unexpectedWrites = []
      const calls = []
      let info = structuredClone(baseMcpInfo)
      info.config.servers = [{
        id: 'existing-mcp', name: '现有 MCP', type: 'http', enabled: true,
        url: 'https://existing.example.test/mcp', timeoutMs: 10000, headers: {}
      }]
      info.config.capabilities.tickets = {
        enabled: true, server: 'existing-mcp', label: '工单', category: 'extension',
        description: '工单扩展', project: '', tools: { test: 'tickets.test' }
      }
      let loadFails = true
      let serverSaveFails = true
      let secretSaveFails = true
      let capabilitySaveFails = true
      let extensionSaveFails = true
      let serverRemoveFails = true
      await protectWrites(page, unexpectedWrites)
      await mockRuntime(page)
      await mockSettingsReads(page)
      await page.route(/\/api\/mcp(?:\/.*)?$/, async (route) => {
        const url = new URL(route.request().url())
        const method = route.request().method()
        const pathName = url.pathname
        if (method === 'GET' && pathName === '/api/mcp') {
          calls.push('mcp-load')
          if (loadFails) return route.fulfill({ status: 500, json: { message: 'MCP 加载失败夹具' } })
          return route.fulfill({ json: info })
        }

        const secretMatch = pathName.match(/^\/api\/mcp\/servers\/([^/]+)\/secret$/)
        if (secretMatch) {
          if (method === 'PUT') {
            calls.push(`mcp-secret-save:${secretMatch[1]}:${route.request().postDataJSON().value}`)
            if (secretSaveFails) return route.fulfill({ status: 409, json: { message: '密钥保存失败夹具' } })
            return route.fulfill({ json: { ok: true } })
          }
          if (method === 'DELETE') {
            calls.push(`mcp-secret-delete:${secretMatch[1]}`)
            return route.fulfill({ json: { ok: true } })
          }
        }

        const serverMatch = pathName.match(/^\/api\/mcp\/servers\/([^/]+)$/)
        if (serverMatch) {
          if (method === 'PUT') {
            calls.push(`mcp-server-save:${serverMatch[1]}`)
            if (serverSaveFails) return route.fulfill({ status: 409, json: { message: '服务保存失败夹具' } })
            const next = { id: serverMatch[1], ...route.request().postDataJSON() }
            info = structuredClone(info)
            info.config.servers = [...info.config.servers.filter((item) => item.id !== next.id), next]
            return route.fulfill({ json: info })
          }
          if (method === 'DELETE') {
            calls.push(`mcp-server-delete:${serverMatch[1]}`)
            if (serverRemoveFails) return route.fulfill({ status: 409, json: { message: '服务删除失败夹具' } })
            info = structuredClone(info)
            info.config.servers = info.config.servers.filter((item) => item.id !== serverMatch[1])
            return route.fulfill({ json: info })
          }
        }

        const capabilityMatch = pathName.match(/^\/api\/mcp\/capabilities\/([^/]+)(?:\/(test))?$/)
        if (capabilityMatch) {
          const name = capabilityMatch[1]
          if (method === 'POST' && capabilityMatch[2] === 'test') {
            calls.push(`mcp-capability-test:${name}`)
            return route.fulfill({ json: { identity: 'MCP User' } })
          }
          if (method === 'PUT') {
            calls.push(`mcp-capability-save:${name}`)
            if (name === 'requirements' && capabilitySaveFails) {
              return route.fulfill({ status: 422, json: { message: '需求能力保存失败夹具' } })
            }
            if (name === 'tickets' && extensionSaveFails) {
              return route.fulfill({ status: 422, json: { message: '扩展能力保存失败夹具' } })
            }
            info = structuredClone(info)
            info.config.capabilities[name] = route.request().postDataJSON()
            return route.fulfill({ json: info })
          }
          if (method === 'DELETE') {
            calls.push(`mcp-capability-delete:${name}`)
            info = structuredClone(info)
            delete info.config.capabilities[name]
            return route.fulfill({ json: info })
          }
        }

        return route.fulfill({ status: 599, json: { message: `MCP mock 未覆盖：${method} ${pathName}` } })
      })

      await openApp(page, '/settings/mcp')
      await expect(page.getByText('MCP 加载失败夹具')).toBeVisible()
      loadFails = false
      await page.getByRole('button', { name: /重\s*试/ }).click()
      await expect(page.getByRole('heading', { name: 'MCP 中心' })).toBeVisible()

      await page.getByRole('button', { name: '新增服务' }).click()
      await page.getByLabel('服务标识').fill('new-mcp')
      await page.getByLabel('显示名称').fill('新 MCP')
      await page.getByLabel('MCP URL').fill('https://new.example.test/mcp')
      await page.getByRole('button', { name: '保存服务' }).click()
      await expect(page.getByText('服务保存失败夹具')).toBeVisible()
      await expect(page.getByLabel('服务标识')).toHaveValue('new-mcp')
      serverSaveFails = false
      await page.getByRole('button', { name: '保存服务' }).click()
      await expect.poll(() => calls).toContain('mcp-server-save:new-mcp')

      const secretInput = page.getByPlaceholder('只保存在本机，不写入仓库')
      await expect(secretInput).toHaveAttribute('type', 'password')
      await secretInput.fill('fixture-secret-never-sent')
      await page.getByRole('button', { name: '保存密钥' }).click()
      await expect(page.getByText('密钥保存失败夹具')).toBeVisible()
      await expect(secretInput).toHaveValue('fixture-secret-never-sent')
      secretSaveFails = false
      await page.getByRole('button', { name: '保存密钥' }).click()
      await expect(secretInput).toHaveValue('')
      await secretInput.fill('discard-after-confirm')
      await page.getByRole('button', { name: '删除本机密钥' }).click()
      await expect(page.locator('.ant-modal-confirm:visible')).toContainText('删除本机 MCP 密钥？')
      await page.locator('.ant-modal-confirm:visible').getByRole('button', { name: /取\s*消/ })
        .evaluate((element) => element.click())
      await expect(page.locator('.ant-modal-confirm:visible')).toHaveCount(0)
      expect(calls.some((item) => item.startsWith('mcp-secret-delete'))).toBe(false)
      await page.getByRole('button', { name: '删除本机密钥' }).click()
      await confirmButton(page, '删除密钥')
      await expect.poll(() => calls).toContain('mcp-secret-delete:new-mcp')
      await expect(secretInput).toHaveValue('')

      await chooseOption(page, '需求绑定服务', '新 MCP · new-mcp')
      await page.getByText('启用需求 MCP 能力').click()
      await page.getByRole('button', { name: '保存需求能力' }).click()
      await expect(page.getByText('需求能力保存失败夹具')).toBeVisible()
      capabilitySaveFails = false
      await page.getByRole('button', { name: '保存需求能力' }).click()
      await page.getByRole('button', { name: '测试需求能力' }).click()
      await expect(page.locator('#main-content').getByText('连接成功：MCP User')).toBeVisible()

      const extensionRow = page.locator('.ant-list-item').filter({ hasText: 'tickets' })
      await extensionRow.getByRole('button', { name: '编辑' }).click()
      await page.getByLabel('扩展能力说明').fill('更新后的工单扩展')
      await page.getByRole('button', { name: '保存扩展能力' }).click()
      await expect(page.getByText('扩展能力保存失败夹具')).toBeVisible()
      await expect(page.getByLabel('扩展能力说明')).toHaveValue('更新后的工单扩展')
      extensionSaveFails = false
      await page.getByRole('button', { name: '保存扩展能力' }).click()
      await page.getByRole('button', { name: '删除 工单' }).click()
      await expect(page.locator('.ant-modal-confirm:visible')).toContainText('删除扩展 MCP 能力？')
      await page.locator('.ant-modal-confirm:visible').getByRole('button', { name: /取\s*消/ })
        .evaluate((element) => element.click())
      await expect(page.locator('.ant-modal-confirm:visible')).toHaveCount(0)
      expect(calls).not.toContain('mcp-capability-delete:tickets')
      await page.getByRole('button', { name: '删除 工单' }).click()
      await confirmButton(page, '删除')
      await expect.poll(() => calls).toContain('mcp-capability-delete:tickets')
      await expect(page.getByRole('button', { name: '删除 工单' })).toHaveCount(0)

      const existingRow = page.locator('.fl-mcp-grid').first().locator('.ant-list-item').filter({ hasText: 'existing-mcp' })
      await existingRow.getByRole('button', { name: '删除' }).click()
      await expect(page.locator('.ant-modal-confirm:visible')).toContainText('删除 MCP 服务？')
      await confirmButton(page, '删除')
      await expect(page.getByText('服务删除失败夹具')).toBeVisible()
      serverRemoveFails = false
      await page.reload({ waitUntil: 'networkidle' })
      await page.locator('.fl-mcp-grid').first().locator('.ant-list-item').filter({ hasText: 'existing-mcp' }).getByRole('button', { name: '删除' }).click()
      await confirmButton(page, '删除')
      await expect.poll(() => calls).toContain('mcp-server-delete:existing-mcp')

      await mockReadonlyHealth(page)
      await openApp(page, '/settings/mcp')
      await expect(page.getByRole('button', { name: '新增服务' })).toBeDisabled()
      await expect(page.getByRole('button', { name: '保存服务' })).toBeDisabled()
      await expect(page.getByRole('button', { name: '保存需求能力' })).toBeDisabled()
      await expect(page.getByRole('button', { name: '测试需求能力' })).toBeDisabled()

      expect(calls).toEqual(expect.arrayContaining([
        'mcp-load', 'mcp-server-save:new-mcp',
        'mcp-secret-save:new-mcp:fixture-secret-never-sent', 'mcp-secret-delete:new-mcp',
        'mcp-capability-save:requirements', 'mcp-capability-test:requirements',
        'mcp-capability-save:tickets', 'mcp-capability-delete:tickets', 'mcp-server-delete:existing-mcp'
      ]))
      expect(unexpectedWrites).toEqual([])
    })
  })
}

test.describe('large version history', () => {
  test.use({ viewport: { width: 1440, height: 900 } })

  test('browses and filters 60 versions', async ({ page }) => {
    const syntheticVersions = Array.from({ length: 60 }, (_, index) => {
      const number = 60 - index
      const versionNo = `v${number}`
      return {
        versionNo,
        title: number === 48 ? '唯一命中的历史版本' : `订单中心版本 ${number}`,
        createdBy: number % 2 ? 'Jinny3537' : 'protohub',
        createdAt: new Date(Date.UTC(2026, 7, number)).toISOString(),
        baselineAt: versionNo === 'v1' ? '2026-08-24T08:00:00.000Z' : null,
        display: number % 5 === 0
          ? { key: 'DRAFT', label: '编辑中', color: 'gold' }
          : { key: 'HISTORY', label: '历史版本', color: 'default' },
        isBaseline: versionNo === 'v1',
        isNew: false,
        isLastRead: false,
        tags: number % 3 === 0 ? ['批量操作'] : [],
        requirements: [{ code: `REQ-${number}`, title: `需求 ${number}` }],
        requirementCount: 1,
        changes: [{ location: '订单列表', content: `版本 ${number} 的变更` }],
        changeCount: 1,
        externalRefs: []
      }
    })

    await page.route('**/api/projects/1/versions**', (route) =>
      route.fulfill({ json: syntheticVersions }))
    await page.route(/\/api\/versions\/1\/v\d+$/, (route) => {
      const versionNo = new URL(route.request().url()).pathname.split('/').at(-1)
      const version = syntheticVersions.find((item) => item.versionNo === versionNo)
      return route.fulfill({ json: { ...version, spec: '', attachments: [], hasOffline: false } })
    })

    await page.goto(new URL('/#/projects/1', baseUrl).toString(), { waitUntil: 'networkidle' })
    const rows = page.locator('[data-version-no]')
    await expect(rows).toHaveCount(60)

    const listMetrics = await page.locator('[role="listbox"]').evaluate((element) => ({
      clientHeight: element.clientHeight,
      scrollHeight: element.scrollHeight
    }))
    expect(listMetrics.scrollHeight).toBeGreaterThan(listMetrics.clientHeight)

    await page.getByPlaceholder('搜索版本、标题、标签或需求').fill('唯一命中')
    await expect(rows).toHaveCount(1)
    await expect(rows.first()).toContainText('v48')
  })
})

test.afterAll(async () => {
  await fs.writeFile(path.join(outDir, 'ui-regression-report.json'), JSON.stringify(results, null, 2))
})

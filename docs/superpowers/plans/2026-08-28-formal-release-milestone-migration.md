# Formal Release Milestone Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move single-version formal release from the project version page into active milestone scope, with server-enforced milestone status and membership checks.

**Architecture:** Add milestone-scoped service and HTTP entry points that validate `active` status and `project + version` membership before invoking the existing baseline, Git, and WeCom mail pipeline. Reuse the current release dialog in `MilestoneDetail`, derive row-level release status from the existing mail queue, and remove the legacy project-version entry points.

**Tech Stack:** Node.js 20, native `node:test`, Flowlark's native HTTP router, React 19, TypeScript, Ant Design 6, Vite 5.

---

## File map

- Modify `src/core/service.js`: add milestone release guards and milestone-scoped public methods; make the raw single-version executor private.
- Modify `test/release-mail.test.js`: migrate service tests to milestone scope and cover state, membership, revalidation, idempotency, Git failure, and mail retry.
- Modify `src/server/routes.js`: add milestone-scoped formal-release routes and remove legacy version-scoped routes.
- Modify `test/release-mail-api.test.js`: exercise the new URLs, public response filtering, queue status, and old-route removal.
- Modify `web/src/services/api.ts`: expose only milestone-scoped formal-release client methods.
- Modify `web/src/pages/milestoneModel.js`: derive stable row actions and the latest mail state.
- Modify `web/src/pages/milestoneModel.test.js`: unit-test row actions and release-state selection.
- Modify `web/src/components/FormalReleaseDialog.tsx`: accept a milestone identifier and call the milestone APIs.
- Modify `web/src/pages/MilestoneDetail.tsx`: load release tasks, open the dialog from active iteration rows, and refresh statuses.
- Modify `web/src/pages/ProjectVersions.tsx`: remove the old formal-release entry and component state.
- Modify `README.md`: document the new location and active-only rule.
- Modify `CHANGELOG.md`: record the migration in Unreleased.

## Workspace constraints

The worktree already contains unrelated user edits in `web/src/components/AppShell.tsx`, `web/src/pages/NotFound.tsx`, `.codex-ui-regression/`, `test-results/`, and another untracked plan. Do not stage, reformat, delete, or commit those paths. Every task below stages only the files listed for that task.

### Task 1: Enforce milestone state and scope in the service

**Files:**
- Modify: `test/release-mail.test.js:114-242`
- Modify: `src/core/service.js:494-523, 771-997`

- [ ] **Step 1: Put existing release fixtures inside an active milestone**

In `releaseFixture`, create the referenced requirement, create an active iteration after `v2`, and return it:

```js
  hub.createRequirement({ code: 'REQ-2', title: '筛选优化' })
  hub.addVersion(project.slug, {
    versionNo: 'v2', title: '筛选升级', html: '<html>v2</html>',
    changes: [{ type: 'MODIFY', location: '列表', content: '保留筛选条件' }],
    requirements: ['REQ-2']
  })
  const milestone = hub.createMilestone({
    name: 'S1',
    title: '迭代一',
    status: 'active',
    items: [{ requirement: 'REQ-2', project: project.slug, version: 'v2' }]
  })
```

Change the fixture return to:

```js
  return { root, hub, project, milestone, calls, wecomMcp }
```

- [ ] **Step 2: Write failing service tests for state, membership, and revalidation**

Add these tests after `releaseFixture`:

```js
test('迭代发版要求进行中状态且版本在范围内', async (t) => {
  const { hub, project, milestone } = releaseFixture(t)
  const blockedStatuses = ['planning', 'reviewing', 'frozen', 'delivered', 'archived', 'canceled']

  for (const status of blockedStatuses) {
    const blocked = hub.createMilestone({
      name: `S-${status}`,
      title: status,
      status,
      items: [{ requirement: 'REQ-2', project: project.slug, version: 'v2' }]
    })
    await assert.rejects(
      () => hub.preflightMilestoneFormalRelease(blocked.name, project.slug, 'v2'),
      (error) => error.code === 'MILESTONE_FORMAL_RELEASE_STATUS_INVALID' && error.status === 409
    )
  }

  await assert.rejects(
    () => hub.preflightMilestoneFormalRelease(milestone.name, project.slug, 'v1'),
    (error) => error.code === 'MILESTONE_FORMAL_RELEASE_OUT_OF_SCOPE' && error.status === 409
  )
  await assert.rejects(
    () => hub.formalReleaseMilestoneVersion(milestone.name, project.slug, 'v1'),
    (error) => error.code === 'MILESTONE_FORMAL_RELEASE_OUT_OF_SCOPE' && error.status === 409
  )
})

test('正式执行会重新校验迭代状态', async (t) => {
  const { hub, project, milestone } = releaseFixture(t)
  const preflight = await hub.preflightMilestoneFormalRelease(milestone.name, project.slug, 'v2')
  assert.equal(preflight.ready, true)

  hub.transitionMilestone(milestone.name, { target: 'delivered' })

  await assert.rejects(
    () => hub.formalReleaseMilestoneVersion(milestone.name, project.slug, 'v2', {
      releasedAt: preflight.releasedAt
    }),
    (error) => error.code === 'MILESTONE_FORMAL_RELEASE_STATUS_INVALID'
  )
  assert.equal(hub.getBaseline(project.slug).versionNo, 'v1')
  assert.equal(hub.listReleaseMails().length, 0)
})
```

- [ ] **Step 3: Migrate existing service tests to the new method signatures**

In every existing test below line 160, destructure `milestone` from the fixture and use these exact call shapes:

```js
await hub.preflightMilestoneFormalRelease(milestone.name, project.slug, 'v2', input)
await hub.formalReleaseMilestoneVersion(milestone.name, project.slug, 'v2', input)
```

Apply that replacement to:

```text
正式发版严格按基线、Git、邮件顺序且重复请求不重复发送
Git 失败不发送邮件，续跑不重复设置基线
邮件失败保留 pending，重试只调用邮件
同名收件人必须明确选择且公共预检不暴露 userid
```

Keep `retryReleaseMail` unchanged because retry operates on an existing mail task.

- [ ] **Step 4: Run the service tests and verify the new contract fails**

Run:

```bash
node --test test/release-mail.test.js
```

Expected: FAIL because `preflightMilestoneFormalRelease` and `formalReleaseMilestoneVersion` do not exist yet.

- [ ] **Step 5: Add the milestone target guard and public milestone methods**

Add this private guard in the iteration section of `Hub`, immediately after `getMilestone`:

```js
  #assertMilestoneFormalReleaseTarget(name, slug, versionNo) {
    const item = milestones.readMilestone(this.root, name)
    if (item.status !== 'active') {
      throw err.conflict(
        'MILESTONE_FORMAL_RELEASE_STATUS_INVALID',
        `迭代「${item.name}」只有在进行中状态才能正式发版`
      )
    }
    const included = item.items.some((entry) =>
      entry.project === slug && entry.version === versionNo)
    if (!included) {
      throw err.conflict(
        'MILESTONE_FORMAL_RELEASE_OUT_OF_SCOPE',
        `${slug}/${versionNo} 不在迭代「${item.name}」的版本范围内`,
        '先核对迭代版本范围'
      )
    }
    return item
  }

  async preflightMilestoneFormalRelease(name, slug, versionNo, input = {}) {
    this.#assertMilestoneFormalReleaseTarget(name, slug, versionNo)
    return publicFormalReleasePreflight(await this.#prepareFormalRelease(slug, versionNo, input))
  }

  async formalReleaseMilestoneVersion(name, slug, versionNo, input = {}) {
    this.#assertWritable('正式发版')
    this.#assertMilestoneFormalReleaseTarget(name, slug, versionNo)
    return this.#formalRelease(slug, versionNo, input)
  }
```

- [ ] **Step 6: Extract the raw executor while preserving temporary legacy wrappers**

Keep `preflightFormalRelease` temporarily so the existing HTTP route remains functional until Task 4. Replace the current public executor with a thin compatibility wrapper plus a private executor:

```js
  async preflightFormalRelease(slug, versionNo, input = {}) {
    return publicFormalReleasePreflight(await this.#prepareFormalRelease(slug, versionNo, input))
  }

  async formalRelease(slug, versionNo, input = {}) {
    this.#assertWritable('正式发版')
    return this.#formalRelease(slug, versionNo, input)
  }

  async #formalRelease(slug, versionNo, input = {}) {
    const earlyBaseline = store.readBaseline(this.root, slug)
    const earlyVersion = store.readVersion(this.root, slug, versionNo)
    if (earlyBaseline === versionNo && earlyVersion.baselineAt) {
      const existing = releaseMail.listReleaseMails(this.root)
        .find((item) => item.project === slug && item.version === versionNo && item.baselineAt === earlyVersion.baselineAt)
      if (existing?.status === 'sent') {
        return {
          status: 'complete',
          released: true,
          duplicate: true,
          baseline: { project: slug, version: versionNo, baselineAt: earlyVersion.baselineAt },
          git: { ok: true, skipped: true },
          mail: releaseMail.publicReleaseMail(existing)
        }
      }
      if (existing) return this.#sendReleaseMailTask(existing, { git: { ok: true, skipped: true } })
    }

    const prepared = await this.#prepareFormalRelease(slug, versionNo, input)
    if (!prepared.ready) {
      throw err.bad(
        'FORMAL_RELEASE_BLOCKED',
        prepared.blockers[0]?.message || '正式发版预检未通过',
        prepared.blockers.map((item) => item.message).join('；')
      )
    }

    const currentBaseline = store.readBaseline(this.root, slug)
    const baseline = currentBaseline !== versionNo
      ? this.setBaseline(slug, versionNo)
      : this.getVersion(slug, versionNo)
    const baselineAt = baseline.baselineAt
    const existing = releaseMail.listReleaseMails(this.root)
      .find((item) => item.project === slug && item.version === versionNo && item.baselineAt === baselineAt)
    if (existing?.status === 'sent') {
      return {
        status: 'complete',
        released: true,
        duplicate: true,
        baseline: { project: slug, version: versionNo, baselineAt },
        git: { ok: true, skipped: true },
        mail: releaseMail.publicReleaseMail(existing)
      }
    }
    if (existing) return this.#sendReleaseMailTask(existing, { git: { ok: true, skipped: true } })

    let gitResult
    try {
      gitResult = await Promise.resolve(this.gitSyncOverride
        ? this.gitSyncOverride({ message: `release: ${slug}/${versionNo}`, push: true })
        : this.gitSync({ message: `release: ${slug}/${versionNo}`, push: true }))
    } catch (error) {
      return {
        status: 'git_failed',
        released: false,
        baseline: { project: slug, version: versionNo, baselineAt },
        git: { ok: false, error: error.message, hint: error.hint || null },
        mail: null
      }
    }

    const task = releaseMail.enqueueReleaseMail(this.root, {
      project: slug,
      version: versionNo,
      baselineAt,
      subject: prepared.subject,
      markdown: prepared.markdown,
      to: prepared.internalTo,
      cc: prepared.internalCc
    })
    return this.#sendReleaseMailTask(task, { git: { ok: true, result: gitResult } })
  }
```

- [ ] **Step 7: Run the service tests and verify they pass**

Run:

```bash
node --test test/release-mail.test.js
```

Expected: all tests in `test/release-mail.test.js` PASS, including state, membership, revalidation, duplicate, Git failure, ambiguity, and retry cases.

- [ ] **Step 8: Commit the service boundary**

```bash
git add src/core/service.js test/release-mail.test.js
git commit -m "feat: scope formal release to active milestones"
```

### Task 2: Introduce milestone HTTP and web-client entry points

**Files:**
- Modify: `test/release-mail-api.test.js:6-73`
- Modify: `src/server/routes.js:114-155, 314-322`
- Modify: `web/src/services/api.ts:120-126, 161-176`

- [ ] **Step 1: Change the API fixture to create an active milestone**

After creating `v2` in `test/release-mail-api.test.js`, add:

```js
  hub.createRequirement({ code: 'REQ-2', title: '筛选优化' })
  const milestone = hub.createMilestone({
    name: 'S1',
    title: '迭代一',
    status: 'active',
    items: [{ requirement: 'REQ-2', project: project.slug, version: 'v2' }]
  })
```

- [ ] **Step 2: Point the API test at milestone routes**

Replace the preflight and release requests with:

```js
  const milestonePath = `/api/milestones/${encodeURIComponent(milestone.name)}`
    + `/versions/${encodeURIComponent(project.slug)}/${encodeURIComponent('v2')}`

  const preflight = await request(`${milestonePath}/formal-release/preflight`)
  assert.equal(preflight.status, 200)
  assert.equal(preflight.body.ready, true)
  assert.doesNotMatch(JSON.stringify(preflight.body), /wo-secret|userid|email/)

  const released = await request(`${milestonePath}/formal-release`, {
    releasedAt: preflight.body.releasedAt
  })
  assert.equal(released.status, 200)
  assert.equal(released.body.status, 'complete')
  assert.equal(sendCount, 1)
  assert.doesNotMatch(JSON.stringify(released.body), /wo-secret|userid|email/)
```

- [ ] **Step 3: Run the API test and verify route migration fails**

Run:

```bash
node --test test/release-mail-api.test.js
```

Expected: FAIL because the new milestone route returns 404 before it is registered.

- [ ] **Step 4: Register the new milestone routes alongside the legacy routes**

Add these routes within the iteration section of `src/server/routes.js`, before the milestone `PUT` and `DELETE` routes:

```js
  r.post('/api/milestones/:name/versions/:slug/:no/formal-release/preflight', async (req, res, p) => {
    const body = await readJson(req, maxBody)
    sendJson(res, 200, await hub.preflightMilestoneFormalRelease(p.name, p.slug, p.no, body))
  })
  r.post('/api/milestones/:name/versions/:slug/:no/formal-release', async (req, res, p) => {
    const body = await readJson(req, maxBody)
    sendJson(res, 200, await hub.formalReleaseMilestoneVersion(p.name, p.slug, p.no, body))
  })
```

Keep the two legacy version handlers until Task 4 so the currently shipped project-version UI remains usable between commits.

- [ ] **Step 5: Add milestone methods to the web API client**

Add these methods beside the milestone methods in `web/src/services/api.ts`:

```ts
  preflightMilestoneFormalRelease: (name: string, slug: string, no: string, body: unknown) =>
    post<any>(`/api/milestones/${enc(name)}/versions/${enc(slug)}/${enc(no)}/formal-release/preflight`, body),
  formalReleaseMilestoneVersion: (name: string, slug: string, no: string, body: unknown) =>
    post<any>(`/api/milestones/${enc(name)}/versions/${enc(slug)}/${enc(no)}/formal-release`, body),
```

Keep `preflightFormalRelease` and `formalRelease` until Task 4 because `FormalReleaseDialog` still calls them in this intermediate commit.

- [ ] **Step 6: Run the API test and verify it passes**

Run:

```bash
node --test test/release-mail-api.test.js
```

Expected: PASS; the new routes return 200 and public payloads contain no internal WeCom IDs.

- [ ] **Step 7: Commit the route migration**

```bash
git add src/server/routes.js test/release-mail-api.test.js web/src/services/api.ts
git commit -m "feat: add milestone formal release API"
```

### Task 3: Add deterministic milestone release-row models

**Files:**
- Modify: `web/src/pages/milestoneModel.test.js:1-19`
- Modify: `web/src/pages/milestoneModel.js:1-11`

- [ ] **Step 1: Write failing tests for release state and row actions**

Extend the import in `milestoneModel.test.js`:

```js
import {
  milestoneItemAction,
  milestoneItems,
  milestoneReleaseState,
  withoutMilestoneItem
} from './milestoneModel.js'
```

Append these tests:

```js
test('maps milestone lifecycle to one row action', () => {
  assert.equal(milestoneItemAction('planning'), 'remove')
  assert.equal(milestoneItemAction('reviewing'), 'remove')
  assert.equal(milestoneItemAction('active'), 'release')
  for (const status of ['frozen', 'delivered', 'archived', 'canceled']) {
    assert.equal(milestoneItemAction(status), null)
  }
})

test('shows the newest matching formal release mail state', () => {
  const entry = { project: 'orders', version: 'v2' }
  assert.deepEqual(milestoneReleaseState(entry, []), {
    key: 'none', label: '未发版', color: 'default'
  })

  const mails = [
    { project: 'orders', version: 'v2', status: 'sent', updatedAt: '2026-08-28T09:00:00Z' },
    { project: 'other', version: 'v2', status: 'sent', updatedAt: '2026-08-28T12:00:00Z' },
    { project: 'orders', version: 'v2', status: 'pending', updatedAt: '2026-08-28T10:00:00Z' }
  ]
  assert.deepEqual(milestoneReleaseState(entry, mails), {
    key: 'pending', label: '邮件待重试', color: 'warning'
  })

  mails.unshift({
    project: 'orders', version: 'v2', status: 'sent', updatedAt: '2026-08-28T11:00:00Z'
  })
  assert.deepEqual(milestoneReleaseState(entry, mails), {
    key: 'sent', label: '已发版', color: 'success'
  })
})

test('keeps API order when matching mail timestamps tie', () => {
  const at = '2026-08-28T10:00:00Z'
  const state = milestoneReleaseState(
    { project: 'orders', version: 'v2' },
    [
      { project: 'orders', version: 'v2', status: 'pending', updatedAt: at },
      { project: 'orders', version: 'v2', status: 'sent', updatedAt: at }
    ]
  )
  assert.equal(state.key, 'pending')
})
```

- [ ] **Step 2: Run the model test and verify it fails**

Run:

```bash
node --test web/src/pages/milestoneModel.test.js
```

Expected: FAIL because `milestoneItemAction` and `milestoneReleaseState` are not exported.

- [ ] **Step 3: Implement the pure row models**

Append this code to `milestoneModel.js`:

```js
export function milestoneItemAction(status) {
  if (status === 'planning' || status === 'reviewing') return 'remove'
  if (status === 'active') return 'release'
  return null
}

export function milestoneReleaseState(entry, mails = []) {
  let latest = null
  let latestAt = ''
  for (const mail of mails) {
    if (mail.project !== entry.project || mail.version !== entry.version) continue
    const at = String(mail.updatedAt || mail.createdAt || '')
    if (!latest || at > latestAt) {
      latest = mail
      latestAt = at
    }
  }
  if (!latest) return { key: 'none', label: '未发版', color: 'default' }
  if (latest.status === 'sent') return { key: 'sent', label: '已发版', color: 'success' }
  return { key: 'pending', label: '邮件待重试', color: 'warning' }
}
```

- [ ] **Step 4: Run the model test and verify it passes**

Run:

```bash
node --test web/src/pages/milestoneModel.test.js
```

Expected: all milestone model tests PASS.

- [ ] **Step 5: Commit the row models**

```bash
git add web/src/pages/milestoneModel.js web/src/pages/milestoneModel.test.js
git commit -m "feat: model milestone release row state"
```

### Task 4: Move the release dialog into active milestone rows

**Files:**
- Modify: `src/core/service.js:921-997`
- Modify: `src/server/routes.js:314-322`
- Modify: `test/release-mail-api.test.js:68-73`
- Modify: `web/src/services/api.ts:120-126`
- Modify: `web/src/components/FormalReleaseDialog.tsx:30-145`
- Modify: `web/src/pages/MilestoneDetail.tsx:1-331`
- Modify: `web/src/pages/ProjectVersions.tsx:15-43, 90-106, 619-633, 1048-1062`

- [ ] **Step 1: Add milestone context to the shared dialog**

Add `milestone` to the dialog props and destructuring:

```ts
type FormalReleaseDialogProps = {
  open: boolean;
  milestone: string;
  slug: string;
  project: any;
  version: any;
  onClose: () => void;
  onChanged: () => void | Promise<void>;
};
```

```ts
export function FormalReleaseDialog({
  open,
  milestone,
  slug,
  project,
  version,
  onClose,
  onChanged,
}: FormalReleaseDialogProps) {
```

Change the preflight guard and request to:

```ts
    if (!milestone || !slug || !versionNo) return;
    const next = await api.preflightMilestoneFormalRelease(
      milestone,
      slug,
      versionNo,
      preflightPayload({
        to: nextTo,
        cc: nextCc,
        selections: nextSelections,
        releasedAt,
      }),
    );
```

Include `milestone` in the `runPreflight` dependency array and in the initialization effect dependency array. Change execution to:

```ts
      const next = await api.formalReleaseMilestoneVersion(
        milestone,
        slug,
        versionNo,
        preflightPayload({
          to,
          cc,
          selections,
          releasedAt: preflight.releasedAt,
        }),
      );
```

- [ ] **Step 2: Add milestone release state and target loading to `MilestoneDetail`**

Add imports:

```tsx
import { DeleteOutlined, EditOutlined, ExportOutlined, PlusOutlined, SendOutlined } from '@ant-design/icons';
import { FormalReleaseDialog } from '@/components/FormalReleaseDialog';
import {
  milestoneItemAction,
  milestoneItems,
  milestoneReleaseState,
  withoutMilestoneItem,
} from './milestoneModel.js';
```

Add component state beside the existing loading state:

```tsx
  const [releaseMails, setReleaseMails] = useState<any[]>([]);
  const [releaseTarget, setReleaseTarget] = useState<any>(null);
  const [releaseLoading, setReleaseLoading] = useState('');
```

Extend `load` so the same refresh retrieves mail state:

```tsx
      const [
        nextItem,
        nextRequirements,
        nextProjects,
        nextPreflight,
        nextJournal,
        nextExecution,
        nextReleaseMails,
      ] = await Promise.all([
        api.getMilestone(name),
        api.listRequirements(),
        api.listProjects(),
        api.milestonePreflight(name),
        api.milestoneSyncJournal(name),
        api.milestoneExecutionSummary(name).catch(() => null),
        api.listReleaseMails(),
      ]);
      setItem(nextItem);
      setRequirements(nextRequirements);
      setProjects(nextProjects);
      setPreflight(nextPreflight);
      setJournal(nextJournal);
      setExecution(nextExecution);
      setReleaseMails(nextReleaseMails);
```

Add the target loader before `exportPackage`:

```tsx
  const openFormalRelease = useCallback(async (entry: any) => {
    const key = `${entry.project}:${entry.version}`;
    setReleaseLoading(key);
    try {
      const [project, version] = await Promise.all([
        api.getProject(entry.project),
        api.getVersion(entry.project, entry.version),
      ]);
      setReleaseTarget({ slug: entry.project, project, version });
    } catch (nextError) {
      message.error(errorText(nextError, '无法读取发版项目或版本'));
    } finally {
      setReleaseLoading('');
    }
  }, [message]);
```

- [ ] **Step 3: Render release state and lifecycle-specific row actions**

Insert this column after the baseline column:

```tsx
                {
                  title: '发版状态',
                  width: 130,
                  render: (_, entry: any) => {
                    const state = milestoneReleaseState(entry, releaseMails);
                    return <Tag color={state.color}>{state.label}</Tag>;
                  },
                },
```

Replace the current action column with:

```tsx
                {
                  title: '操作',
                  width: 140,
                  render: (_, entry: any) => {
                    const action = milestoneItemAction(item?.status);
                    if (action === 'release') {
                      const key = `${entry.project}:${entry.version}`;
                      return (
                        <Button
                          type="link"
                          icon={<SendOutlined />}
                          loading={releaseLoading === key}
                          disabled={!writable || Boolean(releaseLoading)}
                          onClick={() => void openFormalRelease(entry)}
                        >
                          正式发版
                        </Button>
                      );
                    }
                    if (action === 'remove') {
                      const key = `${entry.requirement}:${entry.project}:${entry.version}`;
                      return (
                        <Popconfirm
                          title="从迭代范围移除该版本？"
                          okText="移除"
                          cancelText="取消"
                          okButtonProps={{ danger: true }}
                          onConfirm={() => removeItem(entry)}
                        >
                          <Button
                            type="text"
                            danger
                            icon={<DeleteOutlined />}
                            loading={removing === key}
                            disabled={!editable || Boolean(removing)}
                          >
                            移除
                          </Button>
                        </Popconfirm>
                      );
                    }
                    return <span aria-label="无可用操作">—</span>;
                  },
                },
```

Change the table scroll width to:

```tsx
scroll={{ x: 900 }}
```

- [ ] **Step 4: Mount the dialog in `MilestoneDetail`**

Add this component before the edit-plan modal:

```tsx
      <FormalReleaseDialog
        open={Boolean(releaseTarget)}
        milestone={name}
        slug={releaseTarget?.slug || ''}
        project={releaseTarget?.project}
        version={releaseTarget?.version}
        onClose={() => setReleaseTarget(null)}
        onChanged={load}
      />
```

This callback refreshes milestone details and the mail queue only; do not call `transitionMilestone` from the dialog or from `onChanged`.

- [ ] **Step 5: Remove formal release from `ProjectVersions`**

Remove:

```tsx
SendOutlined
import { FormalReleaseDialog } from '@/components/FormalReleaseDialog';
const [formalReleaseVersion, setFormalReleaseVersion] = useState<any>(null);
```

Remove the entire button block whose label is `正式发版`, and remove the `<FormalReleaseDialog ... />` instance at the bottom of the page. Keep the existing baseline button and `setBaseline` flow unchanged.

- [ ] **Step 6: Remove every legacy service, route, and client entry point**

Delete the temporary public wrappers from `src/core/service.js`:

```js
async preflightFormalRelease(slug, versionNo, input = {})
async formalRelease(slug, versionNo, input = {})
```

Keep `#prepareFormalRelease`, `#formalRelease`, `#sendReleaseMailTask`, `listReleaseMails`, and `retryReleaseMail`.

Delete both legacy handlers from `src/server/routes.js`:

```text
POST /api/versions/:slug/:no/formal-release/preflight
POST /api/versions/:slug/:no/formal-release
```

Delete `preflightFormalRelease` and `formalRelease` from the version-method section of `web/src/services/api.ts`; keep the milestone methods added in Task 2.

Append this assertion to `test/release-mail-api.test.js` after the queue assertions:

```js
  const legacy = await request(`/api/versions/${project.slug}/v2/formal-release/preflight`)
  assert.equal(legacy.status, 404)
```

- [ ] **Step 7: Verify the old page and old HTTP route no longer own release UI**

Run:

```bash
rg -n "FormalReleaseDialog|formalReleaseVersion|正式发版" web/src/pages/ProjectVersions.tsx
```

Expected: no matches; `rg` exits with status 1.

- [ ] **Step 8: Run the migrated API test, focused frontend tests, and build**

Run:

```bash
node --test test/release-mail-api.test.js
node --test web/src/pages/milestoneModel.test.js web/src/components/formalReleaseModel.test.js
npm run build:web
```

Expected: the API test and both model test files PASS; the Vite production build exits 0 with no TypeScript errors.

- [ ] **Step 9: Commit the vertical migration and legacy removal**

```bash
git add src/core/service.js src/server/routes.js test/release-mail-api.test.js web/src/services/api.ts web/src/components/FormalReleaseDialog.tsx web/src/pages/MilestoneDetail.tsx web/src/pages/ProjectVersions.tsx
git commit -m "feat: move formal release into milestone scope"
```

### Task 5: Update user-facing documentation

**Files:**
- Modify: `README.md:203-228`
- Modify: `CHANGELOG.md:7-15`

- [ ] **Step 1: Update the README location and lifecycle rule**

Replace the first paragraph under `### 正式发版邮件（企业微信 MCP）` with:

```md
迭代详情页仅在迭代进入“进行中”后，为版本范围中的单个项目版本提供“正式发版”。该操作把三个原本分散的动作收敛为一个可恢复流程：
```

After the flow diagram, add:

```md
发版完成只刷新该版本的基线和邮件状态，不会自动把迭代流转为“已交付”；迭代结束仍通过现有生命周期操作处理未完成事项并校验远端状态。
```

- [ ] **Step 2: Add the Unreleased changelog entry**

Under `## [Unreleased]` → `### 新增`, append:

```md
- 正式发版入口迁移至进行中的迭代版本范围；服务端同时校验迭代状态与版本归属，发版后不自动结束迭代。
```

- [ ] **Step 3: Verify documentation no longer names the project version page as the release owner**

Run:

```bash
rg -n "项目版本页的.正式发版|迭代详情页仅在迭代进入" README.md CHANGELOG.md
```

Expected: one match for the new iteration wording and no match for the old project-version wording.

- [ ] **Step 4: Commit the documentation update**

```bash
git add README.md CHANGELOG.md
git commit -m "docs: document milestone-scoped formal release"
```

### Task 6: Run complete regression verification

**Files:**
- Verify only; no planned file modifications.

- [ ] **Step 1: Run the formal-release and milestone-focused tests**

Run:

```bash
node --test test/release-mail.test.js test/release-mail-api.test.js test/milestone-lifecycle.test.js test/milestones.test.js web/src/pages/milestoneModel.test.js web/src/components/formalReleaseModel.test.js
```

Expected: all listed test files PASS with exit status 0.

- [ ] **Step 2: Build the React application**

Run:

```bash
npm run build:web
```

Expected: Vite production build completes with exit status 0.

- [ ] **Step 3: Run the complete repository test suite**

Run:

```bash
npm test
```

Expected: all repository tests PASS; any existing explicitly skipped test remains skipped and does not fail the run.

- [ ] **Step 4: Check formatting and the final scoped diff**

Run:

```bash
git diff --check
git status --short
```

Expected: `git diff --check` prints nothing. `git status --short` shows no uncommitted files from this feature; only the pre-existing unrelated user edits and artifacts listed under Workspace constraints may remain.

- [ ] **Step 5: Confirm the migration boundaries**

Run:

```bash
rg -n "preflightFormalRelease|formalRelease:" src web test
rg -n "preflightMilestoneFormalRelease|formalReleaseMilestoneVersion" src web test
```

Expected: the first command finds no legacy public service, route, or web-client entry points. The second command finds the milestone service methods, milestone routes, web API client methods, dialog calls, and their tests.

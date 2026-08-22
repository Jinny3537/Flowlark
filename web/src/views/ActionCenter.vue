<template>
  <div class="page-pad action-page">
    <div class="page-head action-head">
      <div>
        <h2 class="page-title">个人工作台</h2>
        <div class="text-secondary">聚合你今天最该处理的版本、评审、交付和同步状态</div>
      </div>
      <div class="page-actions">
        <a-button @click="load" :loading="loading">
          <template #icon><ReloadOutlined /></template>刷新
        </a-button>
        <a-button type="primary" @click="$router.push('/projects')">
          <template #icon><FolderOpenOutlined /></template>进入项目
        </a-button>
      </div>
    </div>

    <a-alert v-if="!app.canWrite" type="info" show-icon class="action-alert"
             message="当前是只读模式"
             description="你仍然可以查看项目、评审材料和交付状态；新建、同步、回滚等写操作会被禁用。" />

    <a-spin :spinning="loading">
      <section class="workspace-hero">
        <div class="focus-panel">
          <div class="panel-kicker">当前焦点</div>
          <template v-if="activeProject">
            <div class="focus-title">{{ activeProject.name }}</div>
            <div class="focus-meta mono">{{ activeProject.slug }}</div>
            <div class="focus-summary">
              <div>
                <div class="metric-value" :class="activeProject.baselineVersionNo ? 'is-primary' : 'is-muted'">
                  {{ activeProject.baselineVersionNo || '—' }}
                </div>
                <div class="metric-label">{{ activeProject.baselineVersionNo ? '当前基线' : '待定基线' }}</div>
              </div>
              <div>
                <div class="metric-value">{{ activeVersions.length }}</div>
                <div class="metric-label">版本数</div>
              </div>
              <div>
                <div class="metric-value">{{ activeOpenReviews }}</div>
                <div class="metric-label">待评审</div>
              </div>
            </div>
            <a-space wrap class="focus-actions">
              <a-button type="primary" :disabled="!selectedVersion" @click="goWorkbench">
                <template #icon><EyeOutlined /></template>打开当前版本
              </a-button>
              <a-button :disabled="!selectedProject" @click="goProject">
                <template #icon><ProjectOutlined /></template>项目时间线
              </a-button>
              <a-button :disabled="!app.canWrite || !selectedProject" @click="newVersionOpen = true">
                <template #icon><FileAddOutlined /></template>导入新版本
              </a-button>
            </a-space>
          </template>
          <a-empty v-else description="还没有可聚焦的项目">
            <a-button type="primary" :disabled="!app.canWrite" @click="newProjectOpen = true">新建项目</a-button>
          </a-empty>
        </div>

        <div class="metric-panel">
          <div v-for="metric in metrics" :key="metric.key" class="metric-tile">
            <component :is="metric.icon" />
            <div>
              <div class="metric-value">{{ metric.value }}</div>
              <div class="metric-label">{{ metric.label }}</div>
            </div>
          </div>
        </div>
      </section>

      <section class="workspace-grid">
        <div class="work-panel attention-panel">
          <div class="panel-head">
            <div>
              <div class="section-label">优先处理</div>
              <h3>个人待办队列</h3>
            </div>
            <a-tag :color="attentionItems.length ? 'gold' : 'green'">
              {{ attentionItems.length ? `${attentionItems.length} 项` : '已清空' }}
            </a-tag>
          </div>
          <a-empty v-if="attentionItems.length === 0" description="暂无需要立即处理的事项" />
          <div v-else class="attention-list">
            <article v-for="taskItem in attentionItems" :key="taskItem.key" class="attention-item">
              <div class="attention-icon" :class="`tone-${taskItem.tone}`"><component :is="taskItem.icon" /></div>
              <div class="attention-copy">
                <div class="attention-title">{{ taskItem.title }}</div>
                <div class="attention-desc">{{ taskItem.desc }}</div>
              </div>
              <a-button size="small"
                        :type="taskItem.primary ? 'primary' : 'default'"
                        :danger="taskItem.danger"
                        :disabled="taskItem.disabled"
                        :loading="busyKey === taskItem.key"
                        @click="runTask(taskItem)">
                {{ taskItem.action }}
              </a-button>
            </article>
          </div>
        </div>

        <div class="work-panel">
          <div class="panel-head">
            <div>
              <div class="section-label">项目脉搏</div>
              <h3>最近项目</h3>
            </div>
            <a-button type="link" @click="$router.push('/projects')">全部项目</a-button>
          </div>
          <a-empty v-if="recentProjects.length === 0" description="暂无项目" />
          <div v-else class="project-list">
            <button v-for="project in recentProjects" :key="project.slug" type="button"
                    class="project-row" :class="{ active: project.slug === selectedProject }"
                    @click="selectProject(project.slug)">
              <span class="project-mark mono">{{ project.slug.slice(0, 2).toUpperCase() }}</span>
              <span class="project-row-copy">
                <strong>{{ project.name }}</strong>
                <span>{{ project.baselineVersionNo ? `基线 ${project.baselineVersionNo}` : '待设置基线' }} · {{ project.versionCount }} 个版本</span>
              </span>
              <span class="text-tertiary">{{ fmtTime(project.updatedAt) }}</span>
            </button>
          </div>
        </div>
      </section>

      <section class="work-panel version-panel">
        <div class="panel-head">
          <div>
            <div class="section-label">版本推进</div>
            <h3>当前项目版本</h3>
          </div>
          <a-form layout="inline" class="context-form">
            <a-form-item label="项目">
              <a-select v-model:value="selectedProject" class="context-select" placeholder="选择项目" @change="loadVersions">
                <a-select-option v-for="p in projects" :key="p.slug" :value="p.slug">{{ p.name }} · {{ p.slug }}</a-select-option>
              </a-select>
            </a-form-item>
            <a-form-item label="版本">
              <a-select v-model:value="selectedVersion" class="version-select" placeholder="选择版本">
                <a-select-option v-for="v in activeVersions" :key="v.versionNo" :value="v.versionNo">
                  {{ v.versionNo }} · {{ v.title }}
                </a-select-option>
              </a-select>
            </a-form-item>
          </a-form>
        </div>
        <a-empty v-if="!selectedProject || activeVersions.length === 0" description="当前项目还没有版本" />
        <div v-else class="version-strip">
          <article v-for="version in activeVersions.slice(0, 6)" :key="version.versionNo"
                   class="version-card" :class="{ active: version.versionNo === selectedVersion }"
                   @click="selectedVersion = version.versionNo">
            <div class="version-card-head">
              <strong class="mono">{{ version.versionNo }}</strong>
              <a-tag :color="reviewMeta(version.reviewStatus).color">{{ reviewMeta(version.reviewStatus).label }}</a-tag>
            </div>
            <div class="version-title">{{ version.title || '未命名版本' }}</div>
            <div class="version-meta">
              <span>{{ version.changes?.length || 0 }} 条变更</span>
              <span>{{ version.requirements?.length || 0 }} 个需求</span>
              <span>{{ fmtTime(version.createdAt) }}</span>
            </div>
            <a-space wrap class="version-actions">
              <a-button size="small" type="primary" @click.stop="goVersion(version.versionNo)">打开</a-button>
              <a-button size="small" :disabled="!app.canWrite" @click.stop="markVersionRead(version.versionNo)">标记已读</a-button>
            </a-space>
          </article>
        </div>
      </section>

      <section class="quick-section">
        <div class="section-label">常用动作</div>
        <div class="quick-grid">
          <article v-for="item in quickActions" :key="item.key" class="quick-item">
            <div class="action-icon"><component :is="item.icon" /></div>
            <div class="action-copy">
              <h3>{{ item.title }}</h3>
              <p>{{ item.desc }}</p>
            </div>
            <a-button :type="item.primary ? 'primary' : 'default'"
                      :danger="item.danger"
                      :disabled="disabled(item)"
                      :loading="busyKey === item.key"
                      @click="run(item)">
              {{ item.action }}
            </a-button>
          </article>
        </div>
      </section>
    </a-spin>

    <NewVersionModal v-model:open="newVersionOpen" :slug="selectedProject" @created="afterVersionCreated" />
    <GitPanel v-model:open="gitOpen" @changed="load" />
    <a-modal v-model:open="newProjectOpen" title="新建项目" :confirm-loading="projectSaving" @ok="createProject">
      <a-form layout="vertical">
        <a-form-item label="项目名称" required>
          <a-input v-model:value="projectForm.name" placeholder="例如：订单中心重构" :maxlength="60" />
        </a-form-item>
        <a-form-item label="项目标识" required help="同时是磁盘上的目录名，小写字母、数字、连字符">
          <a-input v-model:value="projectForm.code" class="mono" placeholder="order-center" :maxlength="40" />
        </a-form-item>
        <a-form-item label="描述">
          <a-textarea v-model:value="projectForm.description" :rows="3" :maxlength="500" show-count />
        </a-form-item>
      </a-form>
    </a-modal>
    <a-modal v-model:open="settingsOpen"
             title="设置"
             width="860px"
             :footer="null"
             destroy-on-close>
      <SettingsView embedded />
    </a-modal>
  </div>
</template>

<script setup>
import { computed, markRaw, onMounted, reactive, ref } from 'vue'
import { useRouter } from 'vue-router'
import { message, Modal } from 'ant-design-vue'
import {
  AppstoreOutlined, BarChartOutlined, BranchesOutlined, CloudDownloadOutlined, CodeOutlined,
  ColumnWidthOutlined, DeleteOutlined, ExportOutlined, EyeOutlined, FileAddOutlined,
  FolderAddOutlined, FolderOpenOutlined, InboxOutlined,
  ProfileOutlined, ProjectOutlined, ReadOutlined, ReloadOutlined, SearchOutlined,
  SendOutlined, SettingOutlined, ShareAltOutlined, SyncOutlined, UndoOutlined,
  WarningOutlined
} from '@ant-design/icons-vue'
import NewVersionModal from '../components/NewVersionModal.vue'
import GitPanel from '../components/GitPanel.vue'
import SettingsView from './Settings.vue'
import { api } from '../api'
import { useAppStore } from '../store'
import { fmtTime } from '../utils'

const app = useAppStore()
const router = useRouter()

const projects = ref([])
const versionMap = ref({})
const requirements = ref([])
const milestones = ref([])
const notifications = ref([])
const gitStatus = ref({ tracked: false, clean: true, files: [], conflicts: [] })
const selectedProject = ref(null)
const selectedVersion = ref(null)
const loading = ref(false)
const busyKey = ref('')
const newVersionOpen = ref(false)
const newProjectOpen = ref(false)
const projectSaving = ref(false)
const gitOpen = ref(false)
const settingsOpen = ref(false)
const projectForm = reactive({ name: '', code: '', description: '' })

const activeProject = computed(() => projects.value.find((p) => p.slug === selectedProject.value) || projects.value[0] || null)
const activeVersions = computed(() => versionMap.value[selectedProject.value] || [])
const activeVersion = computed(() => activeVersions.value.find((v) => v.versionNo === selectedVersion.value) || activeVersions.value[0] || null)
const activeOpenReviews = computed(() => activeVersions.value.filter((v) => v.reviewStatus !== 'confirmed' && v.status !== 'void').length)
const recentProjects = computed(() => [...projects.value].sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt))).slice(0, 6))
const pendingNotifications = computed(() => notifications.value.filter((item) => item.status === 'pending'))
const reviewVersions = computed(() => projects.value.flatMap((project) =>
  (versionMap.value[project.slug] || [])
    .filter((version) => version.reviewStatus !== 'confirmed' && version.status !== 'void')
    .slice(0, 2)
    .map((version) => ({ project, version }))
))

const metrics = computed(() => [
  metric('projects', ProjectOutlined, projects.value.length, '项目'),
  metric('reviews', ReadOutlined, reviewVersions.value.length, '待评审版本'),
  metric('requirements', ProfileOutlined, requirements.value.length, '需求'),
  metric('git', BranchesOutlined, gitStatus.value.conflicts?.length || gitStatus.value.files?.length || 0, 'Git 待处理')
])

const attentionItems = computed(() => {
  const items = []
  if (!app.canWrite) {
    items.push(task('readonly', EyeOutlined, '当前处于只读模式', '写入类动作已禁用，可继续查看评审和交付材料。', '查看设置', () => { settingsOpen.value = true }, { tone: 'warning' }))
  }
  if (gitStatus.value.conflicts?.length) {
    items.push(task('git-conflict', WarningOutlined, 'Git 同步存在冲突', `${gitStatus.value.conflicts.length} 个冲突需要先处理。`, '打开 Git', () => { gitOpen.value = true }, { tone: 'danger', danger: true, primary: true }))
  } else if (gitStatus.value.tracked && (!gitStatus.value.clean || gitStatus.value.ahead || gitStatus.value.behind)) {
    const count = gitStatus.value.files?.length || 0
    items.push(task('git-sync', BranchesOutlined, '本地与远端需要同步', count ? `${count} 处 Flowlark 数据变更待提交或同步。` : '远端状态有更新，建议同步一次。', '同步', gitSync, { write: true, tone: 'warning', primary: true }))
  }
  for (const project of projects.value.filter((p) => !p.baselineVersionNo).slice(0, 2)) {
    items.push(task(`baseline-${project.slug}`, ProjectOutlined, `${project.name} 尚未设置基线`, '研发默认依据还没有确定，建议从版本时间线选择确认版本。', '打开项目', () => router.push(`/projects/${project.slug}`), { tone: 'warning' }))
  }
  for (const row of reviewVersions.value.slice(0, 4)) {
    items.push(task(`review-${row.project.slug}-${row.version.versionNo}`, ReadOutlined, `${row.project.name} · ${row.version.versionNo} 待评审`, row.version.title || '打开版本工作台补充规格、变更和审阅状态。', '打开', () => goVersion(row.version.versionNo, row.project.slug), { tone: row.version.reviewStatus === 'questions' ? 'danger' : 'normal', primary: row.version.reviewStatus === 'questions' }))
  }
  for (const notice of pendingNotifications.value.slice(0, 2)) {
    items.push(task(`notice-${notice.id}`, SendOutlined, '交付通知待发送', notice.event?.event || '通知队列里仍有待重试项目。', '打开交付', () => router.push('/deliveries'), { tone: 'normal' }))
  }
  return items.slice(0, 8)
})

const quickActions = computed(() => [
  item('new-project', FolderAddOutlined, '新建项目', '创建项目目录、元信息和时间线入口。', '打开表单', () => { newProjectOpen.value = true }, { write: true, primary: true }),
  item('add-version', FileAddOutlined, '导入原型', '从文件、HTML 源码或公开 URL 新建版本。', '导入', () => { newVersionOpen.value = true }, { write: true, needsProject: true, primary: true }),
  item('baseline', ProjectOutlined, '设为基线', '把选中版本设为研发默认开发依据。', '设为基线', setBaseline, { write: true, needsProject: true, needsVersion: true }),
  item('read', ReadOutlined, '标记已读', '记录你已经看到选中版本，累计变更会从这里计算。', '标记', markRead, { needsProject: true, needsVersion: true }),
  item('diff', BarChartOutlined, '累计变更', '按区间聚合变更并标出反复修改区域。', '打开', () => goCompare(), { needsProject: true }),
  item('compare', ColumnWidthOutlined, '并排对比', '在浏览器中并排查看两个版本。', '对比', () => goCompare(), { needsProject: true }),
  item('offline', CloudDownloadOutlined, '生成离线版', '抓取外链资源，生成自包含 HTML 派生产物。', '生成', buildOffline, { needsProject: true, needsVersion: true }),
  item('download', ExportOutlined, '下载 HTML', '下载选中版本的原型文件。', '下载', downloadHtml, { needsProject: true, needsVersion: true }),
  item('requirements', ProfileOutlined, '需求池', '创建需求、查看状态和关联版本。', '打开', () => router.push('/requirements'), { primary: true }),
  item('milestones', AppstoreOutlined, '迭代', '创建迭代、添加需求和检查范围。', '打开', () => router.push('/milestones'), { primary: true }),
  item('deliveries', SendOutlined, '交付快照', '冻结评审材料、导出静态包并追踪通知。', '打开', () => router.push('/deliveries'), { primary: true }),
  item('git', BranchesOutlined, 'Git 助手', '初始化、身份、同步、冲突、远端权限都在这里处理。', '打开', () => { gitOpen.value = true }, { primary: true }),
  item('sync', SyncOutlined, '提交并同步', '提交 Flowlark 自有数据，并按远端状态拉取或推送。', '同步', gitSync, { write: true, primary: true }),
  item('search', SearchOutlined, '全库搜索', '搜索标题、变更、规格书、需求号和附件。', '搜索', () => router.push('/search')),
  item('watch', InboxOutlined, '草稿箱', '查看自动收集的 HTML 草稿并重试失败项。', '打开', () => router.push('/watch')),
  item('trash', DeleteOutlined, '回收站', '查看、恢复被删除的版本。', '打开', () => router.push('/trash'), { danger: true }),
  item('rollback', UndoOutlined, '回滚基线', '把当前基线退回上一版已确认版本。', '回滚', rollback, { write: true, needsProject: true, danger: true }),
  item('settings', SettingOutlined, '设置', '配置端口、规则、远端、局域网、通知和集成。', '打开', () => { settingsOpen.value = true }),
  item('lan', ShareAltOutlined, '局域网分享', '查看共享地址并切换只读保护。', '管理', () => { settingsOpen.value = true }),
  item('workspace', AppstoreOutlined, '工作区', '注册、克隆、镜像和索引 Flowlark 工作区。', '设置', () => { settingsOpen.value = true }),
  item('mirror', ReloadOutlined, '镜像刷新', '把只读镜像快进到远端最新版本。', '刷新', refreshMirror),
  item('status', CodeOutlined, '运行状态', '查看当前仓库、服务、权限和 Git 状态。', '刷新', load)
])

function icon(raw) {
  return markRaw(raw)
}

function metric(key, iconComp, value, label) {
  return { key, icon: icon(iconComp), value, label }
}

function item(key, iconComp, title, desc, action, run, options = {}) {
  return { key, icon: icon(iconComp), title, desc, action, run, ...options }
}

function task(key, iconComp, title, desc, action, run, options = {}) {
  return { key, icon: icon(iconComp), title, desc, action, run, tone: 'normal', ...options }
}

function disabled(action) {
  if (busyKey.value) return true
  if (action.write && !app.canWrite) return true
  if (action.needsProject && !selectedProject.value) return true
  if (action.needsVersion && !selectedVersion.value) return true
  return false
}

function reviewMeta(status) {
  if (status === 'confirmed') return { label: '已确认', color: 'green' }
  if (status === 'questions') return { label: '有疑问', color: 'red' }
  return { label: '待评审', color: 'gold' }
}

async function run(action) {
  busyKey.value = action.key
  try {
    await action.run()
  } finally {
    busyKey.value = ''
  }
}

async function runTask(action) {
  if (action.write && !app.canWrite) return
  await run(action)
}

async function load() {
  loading.value = true
  try {
    const [ps, reqs, mss, notes, git] = await Promise.all([
      api.listProjects(),
      api.listRequirements().catch(() => []),
      api.listMilestones().catch(() => []),
      api.listNotifications().catch(() => []),
      api.gitStatus({ fast: true, cache: true }).catch(() => ({ tracked: false, clean: true, files: [], conflicts: [] }))
    ])
    projects.value = ps
    requirements.value = reqs
    milestones.value = mss
    notifications.value = notes
    gitStatus.value = git
    if (!selectedProject.value && ps[0]) selectedProject.value = ps[0].slug
    const entries = await Promise.all(ps.map(async (project) => [
      project.slug,
      await api.listVersions(project.slug, { includeDraft: true, includeVoid: true }).catch(() => [])
    ]))
    versionMap.value = Object.fromEntries(entries)
    ensureSelectedVersion()
    await app.load()
  } finally {
    loading.value = false
  }
}

async function loadVersions() {
  if (!selectedProject.value) {
    selectedVersion.value = null
    return
  }
  versionMap.value = {
    ...versionMap.value,
    [selectedProject.value]: await api.listVersions(selectedProject.value, { includeDraft: true, includeVoid: true })
  }
  ensureSelectedVersion()
}

function ensureSelectedVersion() {
  const list = activeVersions.value
  if (!list.some((v) => v.versionNo === selectedVersion.value)) {
    selectedVersion.value = list[0] ? list[0].versionNo : null
  }
}

async function selectProject(slug) {
  selectedProject.value = slug
  await loadVersions()
}

async function createProject() {
  if (!projectForm.name.trim()) return message.warning('请填写项目名称')
  projectSaving.value = true
  try {
    const project = await api.createProject({ ...projectForm })
    message.success(`项目 ${project.name} 已创建`)
    newProjectOpen.value = false
    Object.assign(projectForm, { name: '', code: '', description: '' })
    await load()
    selectedProject.value = project.slug
    await loadVersions()
  } finally {
    projectSaving.value = false
  }
}

function goProject() {
  router.push(`/projects/${selectedProject.value}`)
}

function goWorkbench() {
  if (!selectedVersion.value && activeVersion.value) selectedVersion.value = activeVersion.value.versionNo
  router.push(`/projects/${selectedProject.value}/versions/${selectedVersion.value}`)
}

function goVersion(versionNo, projectSlug = selectedProject.value) {
  selectedProject.value = projectSlug
  selectedVersion.value = versionNo
  router.push(`/projects/${projectSlug}/versions/${versionNo}`)
}

function goCompare() {
  router.push(`/projects/${selectedProject.value}/compare`)
}

async function setBaseline() {
  const versionNo = selectedVersion.value
  await api.setBaseline(selectedProject.value, versionNo)
  message.success(`当前基线：${versionNo}`)
  await load()
}

async function rollback() {
  return new Promise((resolve) => {
    Modal.confirm({
      title: '回滚当前基线？',
      content: '回滚后项目默认基线会退回上一版已确认版本。',
      okText: '回滚',
      okType: 'danger',
      async onOk() {
        const v = await api.rollback(selectedProject.value)
        message.success(`已回滚到 ${v.versionNo}`)
        await load()
        resolve()
      },
      onCancel: resolve
    })
  })
}

async function markRead() {
  await markVersionRead(selectedVersion.value)
}

async function markVersionRead(versionNo) {
  await api.markRead(selectedProject.value, versionNo)
  message.success(`已标记看到 ${versionNo}`)
}

async function buildOffline() {
  await api.buildOffline(selectedProject.value, selectedVersion.value)
  message.success('离线版已生成')
  await loadVersions()
}

function downloadHtml() {
  window.open(api.downloadUrl(selectedProject.value, selectedVersion.value), '_blank')
}

async function gitSync() {
  const result = await api.gitSync()
  if (result.conflicted) message.warning('同步产生冲突，请打开 Git 助手处理')
  else message.success('已同步')
  await load()
}

async function refreshMirror() {
  await api.refreshMirror()
  message.success('镜像已刷新')
}

async function afterVersionCreated(version) {
  await loadVersions()
  selectedVersion.value = version.versionNo
}

onMounted(load)
</script>

<style scoped>
.action-page {
  max-width: 1440px;
}
.action-head {
  align-items: flex-start;
}
.action-alert {
  margin-bottom: var(--fl-s-4);
}
.workspace-hero {
  display: grid;
  grid-template-columns: minmax(0, 1.55fr) minmax(320px, .9fr);
  gap: var(--fl-s-4);
  margin-bottom: var(--fl-s-4);
}
.focus-panel,
.work-panel,
.metric-panel {
  background: var(--fl-surface);
  border: 1px solid var(--fl-line);
  border-radius: var(--fl-r-3);
  box-shadow: var(--fl-shadow-1);
}
.focus-panel {
  min-height: 236px;
  padding: var(--fl-s-5);
}
.panel-kicker {
  margin-bottom: var(--fl-s-2);
  color: var(--fl-primary-deep);
  font-size: var(--fl-fs-2);
  font-weight: 700;
}
.focus-title {
  color: var(--fl-ink);
  font-size: var(--fl-fs-6);
  font-weight: 760;
  line-height: 1.25;
}
.focus-meta {
  margin-top: var(--fl-s-1);
  color: var(--fl-text-2);
}
.focus-summary {
  display: flex;
  flex-wrap: wrap;
  gap: var(--fl-s-6);
  margin-top: var(--fl-s-5);
}
.focus-actions {
  margin-top: var(--fl-s-5);
}
.metric-panel {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 1px;
  overflow: hidden;
  background: var(--fl-line);
}
.metric-tile {
  min-height: 116px;
  display: flex;
  align-items: center;
  gap: var(--fl-s-3);
  padding: var(--fl-s-4);
  background: var(--fl-surface);
}
.metric-tile svg {
  color: var(--fl-primary-deep);
  font-size: 22px;
}
.workspace-grid {
  display: grid;
  grid-template-columns: minmax(0, 1.1fr) minmax(320px, .9fr);
  gap: var(--fl-s-4);
  margin-bottom: var(--fl-s-4);
}
.work-panel {
  padding: var(--fl-s-4);
}
.panel-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--fl-s-3);
  margin-bottom: var(--fl-s-4);
}
.panel-head h3 {
  margin: 0;
  color: var(--fl-ink);
  font-size: var(--fl-fs-4);
  line-height: 1.35;
}
.attention-list,
.project-list {
  display: flex;
  flex-direction: column;
  gap: var(--fl-s-2);
}
.attention-item {
  min-height: 68px;
  display: grid;
  grid-template-columns: 36px minmax(0, 1fr) auto;
  align-items: center;
  gap: var(--fl-s-3);
  padding: var(--fl-s-3);
  border: 1px solid var(--fl-line);
  border-radius: var(--fl-r-3);
  background: var(--fl-surface-2);
}
.attention-icon,
.action-icon {
  width: 36px;
  height: 36px;
  display: grid;
  place-items: center;
  border-radius: var(--fl-r-2);
  background: var(--fl-primary-bg);
  color: var(--fl-primary-deep);
  font-size: 17px;
}
.attention-icon.tone-warning {
  background: #FFF7E6;
  color: var(--fl-warning);
}
.attention-icon.tone-danger {
  background: #FEF3F2;
  color: var(--fl-danger);
}
.attention-copy {
  min-width: 0;
}
.attention-title {
  color: var(--fl-ink);
  font-weight: 700;
  line-height: 1.35;
}
.attention-desc {
  color: var(--fl-text-2);
  font-size: var(--fl-fs-2);
  line-height: 1.5;
}
.project-row {
  width: 100%;
  display: grid;
  grid-template-columns: 34px minmax(0, 1fr) auto;
  align-items: center;
  gap: var(--fl-s-3);
  padding: var(--fl-s-3);
  border: 1px solid var(--fl-line);
  border-radius: var(--fl-r-3);
  background: var(--fl-surface);
  color: var(--fl-text);
  text-align: left;
  cursor: pointer;
}
.project-row:hover,
.project-row.active {
  border-color: var(--fl-primary-border);
  background: #F6FEFC;
}
.project-mark {
  width: 34px;
  height: 34px;
  display: grid;
  place-items: center;
  border-radius: var(--fl-r-2);
  background: var(--fl-surface-3);
  color: var(--fl-primary-deep);
  font-size: var(--fl-fs-2);
  font-weight: 750;
}
.project-row-copy {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.project-row-copy strong {
  overflow: hidden;
  color: var(--fl-ink);
  text-overflow: ellipsis;
  white-space: nowrap;
}
.project-row-copy span {
  color: var(--fl-text-2);
  font-size: var(--fl-fs-2);
}
.version-panel {
  margin-bottom: var(--fl-s-5);
}
.context-form {
  justify-content: flex-end;
}
.context-select {
  width: 240px;
}
.version-select {
  width: 200px;
}
.version-strip {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
  gap: var(--fl-s-3);
}
.version-card {
  min-height: 160px;
  display: flex;
  flex-direction: column;
  gap: var(--fl-s-2);
  padding: var(--fl-s-4);
  border: 1px solid var(--fl-line);
  border-radius: var(--fl-r-3);
  background: var(--fl-surface-2);
  cursor: pointer;
}
.version-card:hover,
.version-card.active {
  border-color: var(--fl-primary-border);
  box-shadow: var(--fl-shadow-2);
}
.version-card-head,
.version-meta {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--fl-s-2);
}
.version-title {
  min-height: 38px;
  color: var(--fl-ink);
  font-weight: 650;
  line-height: 1.45;
}
.version-meta {
  flex-wrap: wrap;
  justify-content: flex-start;
  color: var(--fl-text-2);
  font-size: var(--fl-fs-2);
}
.version-actions {
  margin-top: auto;
}
.quick-section {
  margin-bottom: var(--fl-s-4);
}
.quick-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(250px, 1fr));
  gap: var(--fl-s-3);
}
.quick-item {
  min-height: 138px;
  display: grid;
  grid-template-columns: 36px 1fr;
  grid-template-rows: 1fr auto;
  gap: var(--fl-s-3);
  padding: var(--fl-s-4);
  background: var(--fl-surface);
  border: 1px solid var(--fl-line);
  border-radius: var(--fl-r-3);
  box-shadow: var(--fl-shadow-1);
}
.quick-item:hover {
  border-color: var(--fl-line-strong);
  box-shadow: var(--fl-shadow-2);
}
.action-copy {
  min-width: 0;
}
.action-copy h3 {
  margin: 0 0 var(--fl-s-1);
  color: var(--fl-ink);
  font-size: var(--fl-fs-4);
  line-height: 1.35;
}
.action-copy p {
  min-height: 38px;
  margin: 0;
  color: var(--fl-text-2);
  font-size: var(--fl-fs-2);
  line-height: 1.6;
}
.quick-item .ant-btn {
  grid-column: 1 / -1;
  justify-self: stretch;
}
@media (max-width: 1024px) {
  .workspace-hero,
  .workspace-grid {
    grid-template-columns: 1fr;
  }
}
@media (max-width: 768px) {
  .action-head,
  .panel-head {
    flex-direction: column;
  }
  .metric-panel {
    grid-template-columns: 1fr;
  }
  .attention-item,
  .project-row {
    grid-template-columns: 36px minmax(0, 1fr);
  }
  .attention-item .ant-btn,
  .project-row > .text-tertiary {
    grid-column: 2;
    justify-self: start;
  }
  .context-form {
    width: 100%;
    display: grid;
    grid-template-columns: 1fr;
  }
  .context-form :deep(.ant-form-item) {
    margin-right: 0;
  }
  .context-select,
  .version-select {
    width: 100%;
  }
}
</style>

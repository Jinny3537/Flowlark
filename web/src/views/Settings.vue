<template>
  <div :class="['settings-panel', { 'page-pad': !embedded, 'settings-panel-embedded': embedded }]">
    <h2 v-if="!embedded" style="margin:0 0 4px;font-size:20px">设置</h2>
    <div class="text-secondary" :style="{ marginBottom: embedded ? '16px' : '20px' }">
      配置存在仓库根目录的 <span class="mono">flowlark.json</span> 里，随 Git 一起提交，团队共用同一份。
    </div>

    <a-alert v-for="p in problems" :key="p" type="warning" show-icon :message="p" style="margin-bottom:12px" />

    <a-alert v-if="!app.canWrite" type="info" show-icon style="margin-bottom:16px"
             message="只读模式" description="这是别人共享出来的视图，设置项不可修改。" />

    <a-spin :spinning="loading">
      <div class="settings-layout">
        <aside class="settings-nav" aria-label="设置分区">
          <button v-for="section in sections" :key="section.key" class="settings-nav-item"
                  :class="{ 'settings-nav-item-active': activeSection === section.key }"
                  type="button" @click="selectSection(section.key)">
            <component :is="section.icon" />
            <span>{{ section.label }}</span>
            <a-badge :count="section.modified" :number-style="{ backgroundColor: '#0E9384' }" />
          </button>
        </aside>

        <div class="settings-content">
          <div class="settings-current">
            <component :is="activeMeta.icon" />
            <div>
              <div class="settings-current-title">{{ activeMeta.label }}</div>
              <div class="text-secondary" style="font-size:12px">{{ activeMeta.description }}</div>
            </div>
          </div>

          <section v-if="activeSection === 'workspace'" class="settings-section">
            <a-card>
              <template #title>
                <span class="card-title"><AppstoreOutlined />工作区</span>
              </template>
              <template #extra>
                <a-space>
                  <a-tooltip title="重建本机跨工作区搜索索引">
                    <a-button size="small" :loading="indexing" @click="rebuildWorkspaceIndex">
                      <template #icon><SyncOutlined /></template>重建索引
                    </a-button>
                  </a-tooltip>
                  <a-button size="small" :loading="workspaceLoading" @click="loadWorkspaces">
                    <template #icon><ReloadOutlined /></template>刷新
                  </a-button>
                </a-space>
              </template>

              <div class="text-secondary" style="font-size:13px;margin-bottom:12px">
                这里管理本机可打开的 Flowlark 仓库。注册表只保存在本机，用于切换、镜像和跨工作区搜索。
              </div>

              <div class="current-workspace-card">
                <div class="current-workspace-main">
                  <AppstoreOutlined />
                  <div>
                    <div class="current-workspace-title">当前工作区</div>
                    <div class="mono current-workspace-path">{{ app.repo || '尚未加载工作区' }}</div>
                  </div>
                </div>
                <a-button size="small" :disabled="!app.repo" @click="copy(app.repo)">
                  <template #icon><CopyOutlined /></template>
                  复制路径
                </a-button>
              </div>

              <a-tabs v-model:activeKey="workspaceMode" class="settings-tabs">
                <a-tab-pane key="existing" tab="已有仓库" />
                <a-tab-pane key="clone" tab="从 Git clone" />
              </a-tabs>

              <a-form layout="vertical" class="workspace-form">
                <a-form-item v-if="workspaceMode === 'clone'" label="Git 地址" required>
                  <a-input v-model:value="workspaceForm.url" placeholder="git@host:team/prototypes.git" />
                </a-form-item>
                <a-form-item label="本机目录" required>
                  <a-input v-model:value="workspaceForm.path" placeholder="/Users/name/Prototypes" />
                </a-form-item>
                <div class="workspace-form-grid">
                  <a-form-item label="显示名称">
                    <a-input v-model:value="workspaceForm.name" />
                  </a-form-item>
                  <a-form-item label="模式">
                    <a-checkbox v-model:checked="workspaceForm.mirror">只读镜像</a-checkbox>
                  </a-form-item>
                </div>
                <a-button type="primary" :loading="workspaceSaving" @click="saveWorkspace">
                  {{ workspaceMode === 'clone' ? 'Clone 并注册' : '注册工作区' }}
                </a-button>
              </a-form>

              <a-divider style="margin:18px 0" />

              <a-list :data-source="workspaces.items" :loading="workspaceLoading" bordered>
                <template #renderItem="{ item }">
                  <a-list-item>
                    <template #actions>
                      <a-button type="text" danger size="small" @click="removeWorkspace(item.path)">移除</a-button>
                    </template>
                    <a-list-item-meta :title="item.name" :description="item.path" />
                    <a-tag :color="item.missing ? 'red' : item.mode === 'mirror' ? 'gold' : 'green'">
                      {{ item.missing ? '路径缺失' : item.mode === 'mirror' ? '只读镜像' : '可用' }}
                    </a-tag>
                  </a-list-item>
                </template>
              </a-list>
            </a-card>
          </section>

          <!-- 局域网分享单独提到最上面：它是最需要「看一眼就知道怎么用」的功能 -->
          <section v-else-if="activeSection === 'lan'" class="settings-section">
            <a-card>
              <template #title>
                <span class="card-title"><ShareAltOutlined />局域网分享</span>
              </template>
              <template #extra>
                <a-switch :checked="lanOn" :disabled="!app.canWrite" :loading="lanBusy"
                          @change="toggleLan" checked-children="开" un-checked-children="关" />
              </template>

              <template v-if="lanOn">
                <div v-if="lanInfo && lanInfo.addresses.length">
                  <div class="text-secondary" style="font-size:13px;margin-bottom:10px">
                    把下面的地址发给同事，他们在同一网段就能直接打开看原型：
                  </div>
                  <div v-for="a in lanInfo.addresses" :key="a.address" class="lan-addr">
                    <span class="mono">http://{{ a.address }}:{{ lanInfo.port }}</span>
                    <span class="text-secondary" style="font-size:12px">{{ a.iface }}</span>
                    <a-tooltip title="复制地址">
                      <a-button size="small" type="text" @click="copy(`http://${a.address}:${lanInfo.port}`)">
                        <CopyOutlined />
                      </a-button>
                    </a-tooltip>
                  </div>
                </div>
                <a-empty v-else description="没有检测到局域网地址，可能没连网络" :image="simpleImage" />

                <a-divider style="margin:16px 0" />

                <div class="inline-setting">
                  <a-switch :checked="readonlyOn" :disabled="!app.canWrite"
                            @change="(v) => save('server.readonlyFromLan', v)" />
                  <div style="flex:1">
                    <div style="font-weight:500">局域网只读</div>
                    <div class="text-secondary" style="font-size:12.5px;line-height:1.8">
                      开启时局域网来的请求只能查看，写操作仅限运行 Flowlark 的这台机器。
                      <span v-if="!readonlyOn" style="color:#ff4d4f">
                        当前已关闭，同网段任何人都能删版本、改基线。
                      </span>
                    </div>
                  </div>
                </div>
              </template>

              <template v-else>
                <div class="text-secondary" style="font-size:13px;line-height:1.9">
                  当前只监听 127.0.0.1，别人访问不到。<br>
                  开启后同网段的同事可以直接打开工作台看原型，默认只读。
                </div>
              </template>

              <a-alert v-if="restartNeeded" type="warning" show-icon style="margin-top:14px"
                       message="改动需要重启服务才生效"
                       description="请关闭当前 Flowlark 窗口后重新启动应用，新的端口和网络配置才会生效。" />
            </a-card>
          </section>

          <section v-else-if="activeSection === 'gitRemote'" class="settings-section">
            <a-card>
              <template #title>
                <span class="card-title"><BranchesOutlined />Git 远端</span>
              </template>
              <div class="text-secondary" style="font-size:13px;margin-bottom:12px">
                配置后，Git 面板和功能台的同步按钮就能把原型、规格书、附件推给团队。
              </div>
              <a-input-group compact>
                <a-input v-model:value="remoteUrl" class="remote-input"
                         placeholder="git@github.com:team/prototypes.git" :disabled="!app.canWrite" />
                <a-button type="primary" :disabled="!app.canWrite || !remoteUrl.trim()" @click="saveRemote">
                  保存
                </a-button>
                <a-button danger :disabled="!app.canWrite || !currentRemote" @click="clearRemote">移除</a-button>
              </a-input-group>
              <div v-if="currentRemote" class="text-secondary" style="font-size:12px;margin-top:8px">
                当前：<span class="mono">{{ currentRemote.url }}</span>
              </div>
            </a-card>
          </section>

          <section v-else-if="activeSection === 'oplog'" class="settings-section">
            <a-card>
              <template #title>
                <span class="card-title"><HistoryOutlined />操作日志</span>
              </template>
              <OpLog embedded />
            </a-card>
          </section>

          <section v-for="g in visibleGroups" :key="g.key" class="settings-section">
            <a-card>
              <template #title>
                <span class="card-title"><component :is="groupIcon(g.key)" />{{ g.label }}</span>
              </template>
              <div v-for="item in g.items" :key="item.key" class="cfg-row">
                <div style="flex:1;min-width:0">
                  <div style="font-weight:500">
                    {{ item.label }}
                    <a-tag v-if="item.danger" color="red" style="margin-left:6px">高风险</a-tag>
                    <a-tag v-if="!item.isDefault" color="blue" style="margin-left:6px">已修改</a-tag>
                  </div>
                  <div v-if="item.note" class="text-secondary" style="font-size:12.5px;line-height:1.8">
                    {{ item.note }}
                  </div>
                  <div class="mono text-secondary" style="font-size:11px;margin-top:2px">{{ item.key }}</div>
                </div>

                <div class="cfg-control">
                  <a-switch v-if="item.type === 'bool'" :checked="item.value" :disabled="!app.canWrite"
                            @change="(v) => confirmSave(item, v)" />

                  <a-select v-else-if="item.enum" :value="item.value" style="width:150px" :disabled="!app.canWrite"
                            @change="(v) => save(item.key, v)">
                    <a-select-option v-for="o in item.enum" :key="o" :value="o">{{ o }}</a-select-option>
                  </a-select>

                  <a-input-number v-else-if="item.type === 'port' || item.type === 'int'"
                                  :value="item.value" style="width:130px" :disabled="!app.canWrite"
                                  :min="numberMin(item)" :max="numberMax(item)"
                                  @change="(v) => save(item.key, v)" />

                  <a-input v-else-if="item.type === 'bytes'" :value="bytesText(item.value)" style="width:130px"
                           :disabled="!app.canWrite" placeholder="10MB"
                           @blur="(e) => save(item.key, e.target.value)" />

                  <a-select v-else-if="item.type === 'list'" :value="item.value" mode="tags" style="width:230px"
                            :disabled="!app.canWrite" placeholder="回车添加"
                            @change="(v) => save(item.key, v.join(','))" />

                  <a-input v-else :value="item.value" style="width:230px" :disabled="!app.canWrite"
                           :placeholder="String(item.default || '')"
                           @blur="(e) => save(item.key, e.target.value)" />

                  <a-tooltip title="恢复默认值">
                    <a-button v-if="!item.isDefault && app.canWrite" type="text" size="small"
                              @click="reset(item.key)"><UndoOutlined /></a-button>
                  </a-tooltip>
                </div>
              </div>
            </a-card>
          </section>
        </div>
      </div>

      <div class="text-secondary" style="font-size:12px;margin-bottom:24px">
        仓库配置会写入根目录的 <span class="mono">flowlark.json</span>；工作区注册表只保存在本机。
      </div>
    </a-spin>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { Modal, message, Empty } from 'ant-design-vue'
import {
  ApiOutlined, AppstoreOutlined, BranchesOutlined, CheckCircleOutlined, CopyOutlined, DesktopOutlined,
  ExperimentOutlined, HistoryOutlined, ReloadOutlined, ShareAltOutlined, SlidersOutlined, SyncOutlined, UndoOutlined
} from '@ant-design/icons-vue'
import { api } from '../api'
import { useAppStore } from '../store'
import OpLog from './OpLog.vue'

const props = defineProps({
  embedded: { type: Boolean, default: false }
})

const app = useAppStore()
const route = useRoute()
const router = useRouter()
const simpleImage = Empty.PRESENTED_IMAGE_SIMPLE

const items = ref([])
const problems = ref([])
const loading = ref(false)
const restartNeeded = ref(false)
const lanInfo = ref(null)
const lanBusy = ref(false)
const currentRemote = ref(null)
const remoteUrl = ref('')
const activeSection = ref('workspace')
const workspaceLoading = ref(false)
const workspaceSaving = ref(false)
const indexing = ref(false)
const workspaces = ref({ items: [] })
const workspaceMode = ref('existing')
const workspaceForm = ref({ url: '', path: '', name: '', mirror: false })

const GROUP_LABELS = {
  server: '服务与网络',
  git: 'Git 与身份',
  rules: '业务规则',
  integrations: '反馈与集成',
  ui: '外观与默认值'
}
const GROUP_ICONS = {
  server: SlidersOutlined,
  git: BranchesOutlined,
  rules: CheckCircleOutlined,
  integrations: ApiOutlined,
  ui: DesktopOutlined
}
const SECTION_DESCRIPTIONS = {
  workspace: '注册、克隆、镜像和索引本机 Flowlark 工作区。',
  lan: '给同网段成员开放查看入口，并控制局域网写入权限。',
  gitRemote: '设置团队同步用的 Git origin 地址。',
  oplog: '查看随仓库提交的 append-only 操作记录。',
  server: '管理工作台端口、预览端口和上传体积限制。',
  git: '配置默认分支、提交身份和自动提交策略。',
  rules: '控制基线、变更日志和离线归档相关的业务约束。',
  integrations: '配置反馈流向、通知平台、更新清单和镜像刷新。',
  ui: '设置需求链接模板、常用标签和时间显示方式。'
}

const byKey = (k) => items.value.find((i) => i.key === k)
const lanOn = computed(() => { const i = byKey('server.lan'); return i ? i.value : false })
const readonlyOn = computed(() => { const i = byKey('server.readonlyFromLan'); return i ? i.value : true })

// 局域网两项已经在上面的卡片里单独呈现了，分组列表里不重复
const HOISTED = new Set(['server.lan', 'server.readonlyFromLan', 'git.remote'])

const groups = computed(() =>
  Object.entries(GROUP_LABELS)
    .map(([key, label]) => ({
      key,
      label,
      items: items.value.filter((i) => i.group === key && !HOISTED.has(i.key))
    }))
    .filter((g) => g.items.length)
)

const sections = computed(() => [
  {
    key: 'workspace',
    label: '工作区',
    icon: AppstoreOutlined,
    description: SECTION_DESCRIPTIONS.workspace,
    modified: 0
  },
  {
    key: 'lan',
    label: '局域网分享',
    icon: ShareAltOutlined,
    description: SECTION_DESCRIPTIONS.lan,
    modified: modifiedCount(['server.lan', 'server.readonlyFromLan'])
  },
  {
    key: 'gitRemote',
    label: 'Git 远端',
    icon: BranchesOutlined,
    description: SECTION_DESCRIPTIONS.gitRemote,
    modified: modifiedCount(['git.remote'])
  },
  {
    key: 'oplog',
    label: '操作日志',
    icon: HistoryOutlined,
    description: SECTION_DESCRIPTIONS.oplog,
    modified: 0
  },
  ...groups.value.map((g) => ({
    key: g.key,
    label: g.label,
    icon: groupIcon(g.key),
    description: SECTION_DESCRIPTIONS[g.key] || '',
    modified: g.items.filter((item) => !item.isDefault).length
  }))
])

const activeMeta = computed(() =>
  sections.value.find((section) => section.key === activeSection.value) || sections.value[0]
)

const visibleGroups = computed(() => groups.value.filter((g) => g.key === activeSection.value))

async function load() {
  loading.value = true
  try {
    const [cfg, lan, remote] = await Promise.all([
      api.getConfig(),
      api.lan().catch(() => null),
      api.getRemote().catch(() => null)
    ])
    items.value = cfg.items
    problems.value = cfg.problems
    lanInfo.value = lan
    currentRemote.value = remote
    remoteUrl.value = remote ? remote.url : ''
    await loadWorkspaces()
  } finally {
    loading.value = false
  }
}

function bytesText(n) {
  if (n >= 1024 ** 3) return `${(n / 1024 ** 3).toFixed(1)}GB`
  if (n >= 1024 ** 2) return `${Math.round(n / 1024 ** 2)}MB`
  if (n >= 1024) return `${Math.round(n / 1024)}KB`
  return `${n}B`
}

function groupIcon(key) {
  return GROUP_ICONS[key] || ExperimentOutlined
}

function modifiedCount(keys) {
  return keys.map(byKey).filter((item) => item && !item.isDefault).length
}

function numberMin(item) {
  return item.min ?? 1
}

function numberMax(item) {
  if (item.max != null) return item.max
  return item.type === 'port' ? 65535 : undefined
}

function selectSection(key) {
  activeSection.value = key
  if (!props.embedded && route.params.section !== key) {
    router.replace(key === 'workspace' ? '/settings' : `/settings/${key}`)
  }
}

async function save(key, value) {
  try {
    const r = await api.setConfig(key, value)
    if (r.needsRestart) restartNeeded.value = true
    for (const p of r.problems || []) message.warning(p)
    for (const s of r.sideEffects || []) message.info(s)
    await load()
    await app.load()
  } catch {
    await load() // 失败时回到服务端的真实状态，不留下假的界面值
  }
}

/** 高风险开关关掉之前先说清楚后果，而不是让人事后才发现规则失效了 */
function confirmSave(item, value) {
  if (item.danger && value === false) {
    return Modal.confirm({
      title: `确定关闭「${item.label}」？`,
      content: item.note,
      okText: '确定关闭',
      okType: 'danger',
      onOk: () => save(item.key, value)
    })
  }
  save(item.key, value)
}

async function toggleLan(value) {
  lanBusy.value = true
  try {
    await save('server.lan', value)
    lanInfo.value = await api.lan()
  } finally {
    lanBusy.value = false
  }
}

async function reset(key) {
  await api.resetConfig(key)
  await load()
}

async function saveRemote() {
  await api.setRemote(remoteUrl.value.trim())
  message.success('远端已保存')
  await load()
}

async function clearRemote() {
  await api.removeRemote()
  message.success('远端已移除')
  await load()
}

async function loadWorkspaces() {
  workspaceLoading.value = true
  try {
    workspaces.value = await api.listWorkspaces()
  } finally {
    workspaceLoading.value = false
  }
}

async function saveWorkspace() {
  if (!workspaceForm.value.path) return message.warning('请填写本机目录')
  if (workspaceMode.value === 'clone' && !workspaceForm.value.url) return message.warning('请填写 Git 地址')
  workspaceSaving.value = true
  try {
    const body = {
      path: workspaceForm.value.path,
      name: workspaceForm.value.name,
      mode: workspaceForm.value.mirror ? 'mirror' : 'normal'
    }
    if (workspaceMode.value === 'clone') await api.cloneWorkspace({ ...body, url: workspaceForm.value.url })
    else await api.registerWorkspace(body)
    message.success('工作区已保存')
    workspaceForm.value = { url: '', path: '', name: '', mirror: false }
    await loadWorkspaces()
  } finally {
    workspaceSaving.value = false
  }
}

function removeWorkspace(path) {
  Modal.confirm({
    title: '移除工作区？',
    content: path,
    okText: '移除',
    okType: 'danger',
    onOk: async () => {
      await api.removeWorkspace(path)
      message.success('工作区已移除')
      await loadWorkspaces()
    }
  })
}

async function rebuildWorkspaceIndex() {
  indexing.value = true
  try {
    const result = await api.buildWorkspaceIndex()
    message.success(`索引已重建，共 ${result.records.length} 条记录`)
  } finally {
    indexing.value = false
  }
}

function copy(text) {
  navigator.clipboard.writeText(text)
    .then(() => message.success('已复制'))
    .catch(() => message.error('复制失败，请手动选中'))
}

function syncSectionFromRoute() {
  if (props.embedded) return
  const section = typeof route.params.section === 'string' ? route.params.section : 'workspace'
  if (sections.value.some((item) => item.key === section)) activeSection.value = section
}

onMounted(async () => {
  await load()
  syncSectionFromRoute()
})

watch(() => route.params.section, syncSectionFromRoute)
</script>

<style>
.settings-panel-embedded {
  padding: 0 2px 2px;
}
.settings-layout {
  display: grid;
  grid-template-columns: 172px minmax(0, 1fr);
  align-items: start;
  gap: var(--fl-s-4);
}
.settings-nav {
  position: sticky;
  top: 0;
  display: flex;
  flex-direction: column;
  gap: var(--fl-s-1);
  padding: var(--fl-s-2);
  background: var(--fl-surface-2);
  border: 1px solid var(--fl-line);
  border-radius: var(--fl-r-3);
}
.settings-nav-item {
  width: 100%;
  min-height: 34px;
  display: grid;
  grid-template-columns: 18px minmax(0, 1fr) auto;
  align-items: center;
  gap: var(--fl-s-2);
  border: 0;
  border-radius: var(--fl-r-2);
  background: transparent;
  color: var(--fl-text-2);
  cursor: pointer;
  font-size: var(--fl-fs-3);
  text-align: left;
}
.settings-nav-item:hover {
  background: var(--fl-surface-3);
  color: var(--fl-ink);
}
.settings-nav-item-active {
  background: #EEF8F5;
  color: var(--fl-ink);
  box-shadow: inset 3px 0 0 var(--fl-primary), inset 0 0 0 1px rgba(14,147,132,.12);
}
.settings-nav-item svg,
.card-title svg,
.settings-current svg {
  width: 16px;
  height: 16px;
}
.settings-content {
  min-width: 0;
}
.settings-current {
  min-height: 54px;
  display: flex;
  align-items: center;
  gap: var(--fl-s-3);
  padding: 0 var(--fl-s-4);
  margin-bottom: var(--fl-s-3);
  border: 1px solid var(--fl-line);
  border-radius: var(--fl-r-3);
  background: var(--fl-surface);
  box-shadow: var(--fl-shadow-1);
}
.settings-current svg {
  color: var(--fl-primary-deep);
}
.settings-current-title {
  font-size: var(--fl-fs-4);
  font-weight: 650;
  color: var(--fl-ink);
}
.settings-section {
  margin-bottom: var(--fl-s-4);
}
.card-title {
  display: inline-flex;
  align-items: center;
  gap: var(--fl-s-2);
  color: var(--fl-ink);
}
.inline-setting {
  display: flex;
  align-items: flex-start;
  gap: var(--fl-s-3);
}
.remote-input {
  width: calc(100% - 160px);
}
.cfg-row {
  display: flex; align-items: flex-start; gap: 20px;
  padding: 14px 0; border-bottom: 1px solid #fafafa;
}
.cfg-row:last-child { border-bottom: none; }
.cfg-control { display: flex; align-items: center; gap: 6px; flex-shrink: 0; }
.settings-tabs {
  margin-bottom: var(--fl-s-3);
}
.workspace-form {
  max-width: 640px;
}
.current-workspace-card {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--fl-s-3);
  padding: var(--fl-s-3);
  margin-bottom: var(--fl-s-3);
  border: 1px solid var(--fl-line);
  border-radius: var(--fl-r-3);
  background: var(--fl-surface-2);
}
.current-workspace-main {
  display: flex;
  align-items: center;
  gap: var(--fl-s-3);
  min-width: 0;
}
.current-workspace-main svg {
  color: var(--fl-primary-deep);
  flex: 0 0 auto;
}
.current-workspace-title {
  font-weight: 650;
  color: var(--fl-ink);
}
.current-workspace-path {
  max-width: 430px;
  margin-top: 2px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--fl-text-2);
  font-size: var(--fl-fs-2);
}
.workspace-form-grid {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 150px;
  gap: var(--fl-s-3);
}
.lan-addr {
  display: flex; align-items: center; gap: 10px; padding: 8px 12px;
  background: #fafafa; border-radius: 6px; margin-bottom: 8px;
}
@media (max-width: 760px) {
  .settings-layout {
    display: block;
  }
  .settings-nav {
    position: static;
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    margin-bottom: var(--fl-s-3);
  }
  .settings-nav-item-active {
    box-shadow: inset 0 0 0 1px rgba(14,147,132,.28);
  }
  .cfg-row {
    display: block;
  }
  .cfg-control {
    margin-top: var(--fl-s-3);
    justify-content: flex-start;
    flex-wrap: wrap;
  }
  .remote-input {
    width: 100%;
  }
  .workspace-form-grid {
    display: block;
  }
  .current-workspace-card {
    align-items: flex-start;
    flex-direction: column;
  }
  .current-workspace-path {
    max-width: min(100%, 420px);
    white-space: normal;
    word-break: break-all;
  }
}
</style>

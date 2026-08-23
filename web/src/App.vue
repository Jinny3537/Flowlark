<template>
  <a-config-provider>
    <a-layout class="app-shell">
      <a-layout-header class="app-header">
        <div class="header-left">
          <button class="app-brand" type="button" @click="$router.push('/projects')" aria-label="回到项目列表">
            <span class="brand-emblem" aria-hidden="true">
              <BrandMark :size="28" />
            </span>
            <span class="brand-copy">
              <span class="brand-name">Flowlark</span>
              <span class="slogan">Where prototypes flow</span>
            </span>
          </button>
        </div>

        <div class="spacer"></div>

        <button class="search-trigger" type="button" @click="searchOpen = true">
          <IconSearch />
          <span>搜索</span>
          <kbd>{{ isMac ? '⌘' : 'Ctrl' }}K</kbd>
        </button>

        <a-dropdown :trigger="['click']">
          <a-button type="primary" class="quick-create-button" :disabled="!app.canWrite">
            <template #icon><IconPlus /></template>
            <span>快速创建</span>
          </a-button>
          <template #content>
            <a-doption value="version" @click="onQuickCreate({ key: 'version' })">
                <IconFile />
                导入原型
            </a-doption>
            <a-doption value="requirement" @click="onQuickCreate({ key: 'requirement' })">
                <IconUserGroup />
                新建需求
            </a-doption>
            <a-doption value="milestone" @click="onQuickCreate({ key: 'milestone' })">
                <IconCalendar />
                新建迭代
            </a-doption>
            <a-doption value="delivery" @click="onQuickCreate({ key: 'delivery' })">
                <IconSend />
                创建交付快照
            </a-doption>
          </template>
        </a-dropdown>

        <a-popover trigger="click" placement="bottomRight" overlay-class-name="notification-popover">
          <template #content>
            <div class="notification-panel">
              <div class="notification-head">
                <strong>待办与通知</strong>
                <a-button type="link" size="small" @click="$router.push('/actions')">打开工作台</a-button>
              </div>
              <a-empty v-if="!pendingNotifications.length" description="暂无待重试通知" />
              <a-list v-else size="small" :data="pendingNotifications.slice(0, 4)">
                <template #renderItem="{ item }">
                  <a-list-item>
                    <a-list-item-meta>
                      <template #title>{{ item.event?.event || '交付通知' }}</template>
                      <template #description>{{ item.event?.project || '未知项目' }} {{ item.event?.version || item.event?.snapshot || '' }}</template>
                    </a-list-item-meta>
                    <a-tag color="gold">待重试</a-tag>
                  </a-list-item>
                </template>
              </a-list>
              <div class="notification-actions">
                <a-button size="small" @click="$router.push('/deliveries')">查看交付</a-button>
                <a-button size="small" type="primary" :loading="flushingNotifications" :disabled="!pendingNotifications.length" @click="flushNotifications">
                  立即重试
                </a-button>
              </div>
            </div>
          </template>
          <a-badge :count="pendingNotifications.length" :offset="[-3, 4]" :number-style="{ backgroundColor: 'var(--fl-draft)' }">
            <a-button type="text" class="icon-text-button">
              <template #icon><IconNotification /></template>
              <span>待办</span>
            </a-button>
          </a-badge>
          <span class="sr-only" role="status" aria-atomic="true">
            {{ pendingNotifications.length }} 条交付通知待重试
          </span>
        </a-popover>

        <a-tooltip :title="gitTooltip">
          <a-badge :count="gitBadge" :offset="[-4, 4]" :number-style="gitBadgeStyle">
            <a-button type="text" class="icon-text-button" @click="gitOpen = true">
              <template #icon><IconBranch /></template>
              {{ git.branch || 'Git' }}
            </a-button>
          </a-badge>
        </a-tooltip>

        <!-- 只读时必须显式告诉用户，否则会以为是功能坏了 -->
        <a-tooltip v-if="!app.canWrite"
                   :title="readonlyTooltip">
          <a-tag color="orange"><IconEye /> {{ readonlyLabel }}</a-tag>
        </a-tooltip>
        <a-tag v-else-if="app.lan" color="cyan" class="lan-status">局域网已开放</a-tag>
        <a-tag v-if="app.connected" color="green">运行中</a-tag>
        <a-tag v-else color="red">服务已停止</a-tag>
        <a-tag v-if="updateAvailable" color="cyan" class="update-status">可更新至 {{ updateAvailable.version }}</a-tag>
        <a-button type="text" class="header-settings-button" aria-label="打开设置" @click="settingsOpen = true">
          <template #icon><IconSettings /></template>
        </a-button>
      </a-layout-header>

      <a-layout>
        <a-layout-sider :width="188" theme="light" class="app-sidebar">
          <a-menu :selected-keys="activeKey ? [activeKey] : []" class="app-menu" @menu-item-click="(key) => $router.push('/' + key)">
            <a-menu-item key="actions"><template #icon><IconApps /></template>个人工作台</a-menu-item>
            <a-menu-item key="projects"><template #icon><IconFolder /></template>项目</a-menu-item>
            <a-menu-item key="requirements"><template #icon><IconFile /></template>需求</a-menu-item>
            <a-menu-item key="milestones"><template #icon><IconCalendar /></template>迭代</a-menu-item>
            <a-menu-item key="deliveries"><template #icon><IconSend /></template>交付</a-menu-item>
            <a-menu-item key="watch"><template #icon><IconArchive /></template>草稿箱</a-menu-item>
            <a-menu-item key="trash"><template #icon><IconDelete /></template>回收站</a-menu-item>
          </a-menu>

          <div class="app-sidebar-footer">
            <a-button class="app-settings-button" block @click="settingsOpen = true">
              <template #icon><IconSettings /></template>
              设置
            </a-button>
          </div>
        </a-layout-sider>

        <a-layout-content class="app-content">
          <router-view />
        </a-layout-content>
      </a-layout>
    </a-layout>

    <SearchPalette v-model:open="searchOpen" />
    <GitPanel v-model:open="gitOpen" @changed="loadGit" />
    <a-modal v-model:visible="settingsOpen"
             title="设置"
             :width="860"
             :footer="false"
             modal-class="settings-modal"
             unmount-on-close>
      <SettingsView embedded />
    </a-modal>
  </a-config-provider>
</template>

<script setup>
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { notify } from './ui/feedback'
import {
  IconApps,
  IconArchive,
  IconBranch,
  IconCalendar,
  IconDelete,
  IconEye,
  IconFile,
  IconFolder,
  IconNotification,
  IconPlus,
  IconSearch,
  IconSend,
  IconSettings,
  IconUserGroup
} from '@arco-design/web-vue/es/icon/index.js'
import SearchPalette from './components/SearchPalette.vue'
import GitPanel from './components/GitPanel.vue'
import BrandMark from './components/BrandMark.vue'
import SettingsView from './views/Settings.vue'
import { useAppStore } from './store'
import { api } from './api'

const app = useAppStore()
const route = useRoute()
const router = useRouter()

const searchOpen = ref(false)
const gitOpen = ref(false)
const settingsOpen = ref(false)
const git = ref({ tracked: false, clean: true, files: [], conflicts: [] })
const updateAvailable = ref(null)
const notifications = ref([])
const flushingNotifications = ref(false)

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform)

const activeKey = computed(() => {
  if (route.path.startsWith('/actions')) return 'actions'
  if (route.path.startsWith('/requirements')) return 'requirements'
  if (route.path.startsWith('/milestones')) return 'milestones'
  if (route.path.startsWith('/deliveries')) return 'deliveries'
  if (route.path.startsWith('/watch')) return 'watch'
  if (route.path.startsWith('/trash')) return 'trash'
  if (route.path.startsWith('/settings')) return ''
  return 'projects'
})

// 冲突比「有未提交改动」紧急得多，用红色角标区分
const gitBadge = computed(() => {
  if (!git.value.tracked) return 0
  if (git.value.conflicts.length) return git.value.conflicts.length
  return git.value.files.length
})
const gitBadgeStyle = computed(() => ({
  backgroundColor: git.value.conflicts.length ? 'var(--fl-danger)' : 'var(--fl-draft)'
}))
const gitTooltip = computed(() => {
  if (!git.value.tracked) return '未纳入 Git'
  if (git.value.conflicts.length) return `${git.value.conflicts.length} 个冲突待解决`
  const source = git.value.cached ? '缓存状态，后台会刷新' : (git.value.fast ? '快速状态，仅统计 Flowlark 文件' : '完整状态')
  if (!git.value.clean) return `${git.value.files.length} 处未提交改动（${source}）`
  return `工作区干净（${source}）`
})
const readonlyLabel = computed(() => app.readonlyReason === 'git' ? 'Git 只读' : '只读')
const readonlyTooltip = computed(() => app.readonlyReason === 'git'
  ? '当前 Git 身份没有远端写权限。Flowlark 已隐藏写操作，避免产生推不上去的本地改动。'
  : '这是别人共享出来的视图。写操作仅限运行 Flowlark 的那台机器。')
const pendingNotifications = computed(() => notifications.value.filter((item) => item.status === 'pending'))

async function loadGit() {
  try {
    git.value = await api.gitStatus({ fast: true })
  } catch {
    git.value = { tracked: false, clean: true, files: [], conflicts: [] }
  }
}

async function loadGitCached() {
  try {
    git.value = await api.gitStatus({ fast: true, cache: true })
  } catch {
    /* 没有缓存时静默走后台刷新 */
  }
}

async function checkUpdate() {
  if (!app.updateManifestUrl) return
  try {
    const result = await api.checkUpdate(app.version || '0.0.0', app.updateManifestUrl)
    updateAvailable.value = result.available ? result.manifest : null
  } catch { updateAvailable.value = null }
}

async function loadNotifications() {
  try {
    notifications.value = await api.listNotifications()
  } catch {
    notifications.value = []
  }
}

async function flushNotifications() {
  flushingNotifications.value = true
  try {
    await api.flushNotifications()
    notify.success('通知队列已处理')
    await loadNotifications()
  } finally {
    flushingNotifications.value = false
  }
}

function onQuickCreate({ key }) {
  const targets = {
    version: '/actions',
    requirement: '/requirements',
    milestone: '/milestones',
    delivery: '/deliveries'
  }
  router.push(targets[key] || '/actions')
}

function scheduleGitLoad() {
  if ('requestIdleCallback' in window) {
    window.requestIdleCallback(loadGit, { timeout: 1200 })
  } else {
    window.setTimeout(loadGit, 200)
  }
}

function onKey(e) {
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
    e.preventDefault()
    searchOpen.value = true
  }
}

onMounted(async () => {
  await app.load()
  await loadGitCached()
  await loadNotifications()
  scheduleGitLoad()
  checkUpdate()
  window.addEventListener('keydown', onKey)
})
onBeforeUnmount(() => window.removeEventListener('keydown', onKey))
</script>

<style>
.header-left {
  display: flex;
  align-items: center;
  gap: var(--fl-s-3);
  min-width: 0;
}
.search-trigger {
  display: flex; align-items: center; gap: var(--fl-s-2); cursor: pointer;
  width: clamp(320px, 34vw, 520px);
  height: 32px; padding: 0 10px 0 12px; border: 1px solid var(--fl-line); border-radius: var(--fl-r-2);
  color: var(--fl-text-2); font-size: var(--fl-fs-3); background: var(--fl-surface-2);
  transition: all .2s var(--fl-ease);
  line-height: 1;
  box-sizing: border-box;
  font-family: inherit;
  white-space: nowrap;
}
.search-trigger .arco-icon,
.search-trigger span {
  display: inline-flex;
  align-items: center;
  line-height: 1;
}
.quick-create-button,
.icon-text-button,
.header-settings-button {
  display: inline-flex;
  align-items: center;
}
.quick-create-button {
  gap: var(--fl-s-1);
}
.icon-text-button {
  color: var(--fl-text-2);
}
.header-settings-button {
  width: 32px;
  justify-content: center;
  color: var(--fl-text-2);
}
.notification-panel {
  width: 320px;
}
.notification-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--fl-s-3);
  margin-bottom: var(--fl-s-2);
}
.notification-actions {
  display: flex;
  justify-content: flex-end;
  gap: var(--fl-s-2);
  margin-top: var(--fl-s-3);
}
.search-trigger:hover { border-color: var(--fl-line-strong); color: var(--fl-primary); background: var(--fl-surface); box-shadow: var(--fl-shadow-1); }
.search-trigger kbd {
  margin-left: auto;
  display: inline-flex;
  align-items: center;
  height: 18px;
  line-height: 1;
  font-family: inherit; font-size: var(--fl-fs-1); background: var(--fl-surface); border: 1px solid var(--fl-line);
  border-radius: var(--fl-r-1); padding: 0 5px; color: var(--fl-text-3);
  box-sizing: border-box;
}
.app-menu {
  border: 0;
  background: transparent;
  color: var(--fl-text-2);
  padding-top: var(--fl-s-3);
}
.app-menu .arco-menu-item {
  position: relative;
  border-radius: var(--fl-r-2);
  margin-inline: var(--fl-s-2);
  width: calc(100% - 16px);
  color: var(--fl-text-2);
  transition: background-color .18s var(--fl-ease), color .18s var(--fl-ease);
}
.app-menu .arco-menu-item:hover {
  color: var(--fl-primary-deep);
  background: var(--fl-surface-3);
}
.app-menu .arco-menu-item-selected {
  background: #F3FAF8;
  color: var(--fl-ink);
  font-weight: 650;
  box-shadow: inset 0 0 0 1px rgba(14,147,132,.12);
}
.app-menu .arco-menu-item-selected:hover {
  background: #EDF8F5;
  color: var(--fl-ink);
}
.app-menu .arco-menu-item-selected::after { display: none; }
.app-menu .arco-menu-item .arco-icon { color: var(--fl-text-3); }
.app-menu .arco-menu-item-selected .arco-icon { color: var(--fl-primary); }
.app-sidebar-footer {
  position: absolute;
  bottom: var(--fl-s-4);
  left: var(--fl-s-3);
  right: var(--fl-s-3);
}
.app-settings-button {
  justify-content: flex-start;
  color: var(--fl-text-2);
  border-color: var(--fl-line);
  background: var(--fl-surface);
  box-shadow: var(--fl-shadow-1);
}
.app-settings-button:hover {
  color: var(--fl-primary-deep);
  border-color: var(--fl-line-strong);
  background: #F6FAF9;
}
.settings-modal .arco-modal-body {
  max-height: min(72vh, 760px);
  overflow-y: auto;
  padding: 0;
}

@media (max-width: 1100px) {
  .search-trigger {
    width: clamp(240px, 28vw, 340px);
  }
}

@media (max-width: 900px) {
  .search-trigger {
    width: 220px;
  }
  .quick-create-button span,
  .icon-text-button span {
    display: none;
  }
}

@media (max-width: 768px) {
  .app-header .lan-status { display: none; }
  .app-header .update-status { display:none; }
  .search-trigger {
    width: 34px;
    justify-content: center;
    padding: 0;
  }
  .search-trigger span,
  .search-trigger kbd {
    display: none;
  }
}
</style>

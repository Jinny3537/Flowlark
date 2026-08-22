<template>
  <a-config-provider :locale="zhCN" :theme="theme">
    <a-layout class="app-shell">
      <a-layout-header class="app-header">
        <button class="app-brand" type="button" @click="$router.push('/projects')" aria-label="回到项目列表">
          <span class="brand-emblem" aria-hidden="true">
            <BrandMark :size="28" />
          </span>
          <span class="brand-copy">
            <span class="brand-name">Flowlark</span>
            <span class="slogan">Where prototypes flow</span>
          </span>
        </button>
        <a-divider type="vertical" />
        <a-tooltip :title="app.repo">
          <span class="repo-path text-secondary mono code-sm">{{ shortRepo }}</span>
        </a-tooltip>

        <div class="spacer"></div>

        <button class="search-trigger" type="button" @click="searchOpen = true">
          <SearchOutlined />
          <span>搜索</span>
          <kbd>{{ isMac ? '⌘' : 'Ctrl' }}K</kbd>
        </button>

        <a-tooltip :title="gitTooltip">
          <a-badge :count="gitBadge" :offset="[-4, 4]" :number-style="gitBadgeStyle">
            <a-button type="text" @click="gitOpen = true">
              <template #icon><BranchesOutlined /></template>
              {{ git.branch || 'Git' }}
            </a-button>
          </a-badge>
        </a-tooltip>

        <!-- 只读时必须显式告诉用户，否则会以为是功能坏了 -->
        <a-tooltip v-if="!app.canWrite"
                   :title="readonlyTooltip">
          <a-tag color="orange"><EyeOutlined /> {{ readonlyLabel }}</a-tag>
        </a-tooltip>
        <a-tag v-else-if="app.lan" color="cyan" class="lan-status">局域网已开放</a-tag>
        <a-tag v-if="app.connected" color="green">运行中</a-tag>
        <a-tag v-else color="red">服务已停止</a-tag>
        <a-tag v-if="updateAvailable" color="cyan" class="update-status">可更新至 {{ updateAvailable.version }}</a-tag>
      </a-layout-header>

      <a-layout>
        <a-layout-sider :width="188" theme="light" class="app-sidebar">
          <a-menu mode="inline" :selected-keys="activeKey ? [activeKey] : []" class="app-menu" @click="({ key }) => $router.push('/' + key)">
            <a-menu-item key="actions"><template #icon><ControlOutlined /></template>个人工作台</a-menu-item>
            <a-menu-item key="projects"><template #icon><FolderOutlined /></template>项目</a-menu-item>
            <a-menu-item key="requirements"><template #icon><ProfileOutlined /></template>需求</a-menu-item>
            <a-menu-item key="milestones"><template #icon><CalendarOutlined /></template>迭代</a-menu-item>
            <a-menu-item key="deliveries"><template #icon><SendOutlined /></template>交付</a-menu-item>
            <a-menu-item key="watch"><template #icon><InboxOutlined /></template>草稿箱</a-menu-item>
            <a-menu-item key="oplog"><template #icon><HistoryOutlined /></template>操作日志</a-menu-item>
            <a-menu-item key="trash"><template #icon><DeleteOutlined /></template>回收站</a-menu-item>
          </a-menu>

          <div class="app-sidebar-footer">
            <a-button class="app-settings-button workspace-button" block @click="$router.push('/setup')">
              <template #icon><AppstoreOutlined /></template>改稿台
            </a-button>
            <a-button class="app-settings-button" block @click="settingsOpen = true">
              <template #icon><SettingOutlined /></template>
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
    <a-modal v-model:open="settingsOpen"
             title="设置"
             width="860px"
             :footer="null"
             class="settings-modal"
             destroy-on-close>
      <SettingsView embedded />
    </a-modal>
  </a-config-provider>
</template>

<script setup>
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
import { useRoute } from 'vue-router'
import zhCN from 'ant-design-vue/es/locale/zh_CN'
import {
  FolderOutlined, HistoryOutlined, DeleteOutlined, InboxOutlined, ProfileOutlined, CalendarOutlined, SendOutlined, AppstoreOutlined,
  SearchOutlined, BranchesOutlined, SettingOutlined, EyeOutlined, ControlOutlined
} from '@ant-design/icons-vue'
import SearchPalette from './components/SearchPalette.vue'
import GitPanel from './components/GitPanel.vue'
import BrandMark from './components/BrandMark.vue'
import SettingsView from './views/Settings.vue'
import { antdTheme } from './brand'
import { useAppStore } from './store'

const theme = antdTheme
import { api } from './api'

const app = useAppStore()
const route = useRoute()

const searchOpen = ref(false)
const gitOpen = ref(false)
const settingsOpen = ref(false)
const git = ref({ tracked: false, clean: true, files: [], conflicts: [] })
const updateAvailable = ref(null)

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform)

const activeKey = computed(() => {
  if (route.path.startsWith('/oplog')) return 'oplog'
  if (route.path.startsWith('/actions')) return 'actions'
  if (route.path.startsWith('/requirements')) return 'requirements'
  if (route.path.startsWith('/milestones')) return 'milestones'
  if (route.path.startsWith('/deliveries')) return 'deliveries'
  if (route.path.startsWith('/watch')) return 'watch'
  if (route.path.startsWith('/trash')) return 'trash'
  if (route.path.startsWith('/settings')) return ''
  return 'projects'
})

const shortRepo = computed(() => {
  if (!app.repo) return ''
  const parts = app.repo.split(/[/\\]/).filter(Boolean)
  return (parts.length > 2 ? '…/' : '') + parts.slice(-2).join('/')
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
    const result = await api.checkUpdate('0.6.5', app.updateManifestUrl)
    updateAvailable.value = result.available ? result.manifest : null
  } catch { updateAvailable.value = null }
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
  scheduleGitLoad()
  checkUpdate()
  window.addEventListener('keydown', onKey)
})
onBeforeUnmount(() => window.removeEventListener('keydown', onKey))
</script>

<style>
.search-trigger {
  display: flex; align-items: center; gap: var(--fl-s-2); cursor: pointer;
  height: 32px; padding: 0 11px; border: 1px solid var(--fl-line); border-radius: var(--fl-r-2);
  color: var(--fl-text-2); font-size: var(--fl-fs-3); background: var(--fl-surface-2);
  transition: all .2s var(--fl-ease);
  line-height: 1;
  box-sizing: border-box;
  font-family: inherit;
  white-space: nowrap;
}
.search-trigger .anticon,
.search-trigger span {
  display: inline-flex;
  align-items: center;
  line-height: 1;
}
.repo-path {
  display: inline-block;
  max-width: 260px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  vertical-align: middle;
}
.search-trigger:hover { border-color: var(--fl-line-strong); color: var(--fl-primary); background: var(--fl-surface); box-shadow: var(--fl-shadow-1); }
.search-trigger kbd {
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
.app-menu .ant-menu-item {
  position: relative;
  border-radius: var(--fl-r-2);
  margin-inline: var(--fl-s-2);
  width: calc(100% - 16px);
  color: var(--fl-text-2);
  transition: background-color .18s var(--fl-ease), color .18s var(--fl-ease);
}
.app-menu .ant-menu-item:hover {
  color: var(--fl-primary-deep);
  background: var(--fl-surface-3);
}
.app-menu .ant-menu-item-selected {
  background: #F3FAF8;
  color: var(--fl-ink);
  font-weight: 650;
  box-shadow: inset 0 0 0 1px rgba(14,147,132,.12);
}
.app-menu .ant-menu-item-selected:hover {
  background: #EDF8F5;
  color: var(--fl-ink);
}
.app-menu .ant-menu-item-selected::after { display: none; }
.app-menu .ant-menu-item .anticon { color: var(--fl-text-3); }
.app-menu .ant-menu-item-selected .anticon { color: var(--fl-primary); }
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
.settings-modal .ant-modal-body {
  max-height: min(72vh, 760px);
  overflow-y: auto;
  padding: 0;
}

@media (max-width: 900px) {
  .repo-path { max-width: 160px; }
}

@media (max-width: 768px) {
  .app-header > .ant-divider,
  .app-header .repo-path,
  .app-header .lan-status { display: none; }
  .app-header .update-status { display:none; }
  .search-trigger span,
  .search-trigger kbd {
    display: none;
  }
}
.workspace-button { margin-bottom:var(--fl-s-2); }
</style>

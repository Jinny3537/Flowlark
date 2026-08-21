<template>
  <a-config-provider :locale="zhCN">
    <a-layout style="height:100%">
      <a-layout-header style="height:56px;line-height:56px;background:#fff;border-bottom:1px solid #f0f0f0;padding:0 24px;display:flex;align-items:center;gap:16px">
        <div style="display:flex;align-items:center;gap:10px;font-size:16px;font-weight:600;cursor:pointer"
             @click="$router.push('/projects')">
          <div style="width:28px;height:28px;border-radius:6px;background:#1677ff;color:#fff;display:flex;align-items:center;justify-content:center;font-weight:700">P</div>
          protohub
        </div>
        <a-divider type="vertical" />
        <a-tooltip :title="app.repo">
          <span class="text-secondary mono" style="font-size:12px">{{ shortRepo }}</span>
        </a-tooltip>

        <div style="flex:1"></div>

        <div class="search-trigger" @click="searchOpen = true">
          <SearchOutlined />
          <span>搜索</span>
          <kbd>{{ isMac ? '⌘' : 'Ctrl' }}K</kbd>
        </div>

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
                   title="这是别人共享出来的视图。写操作仅限运行 protohub 的那台机器。">
          <a-tag color="orange"><EyeOutlined /> 只读</a-tag>
        </a-tooltip>
        <a-tag v-else-if="app.lan" color="cyan">局域网已开放</a-tag>
        <a-tag v-if="app.connected" color="green">运行中</a-tag>
        <a-tag v-else color="red">服务已停止</a-tag>
      </a-layout-header>

      <a-layout>
        <a-layout-sider :width="188" theme="light" style="border-right:1px solid #f0f0f0">
          <a-menu mode="inline" :selected-keys="[activeKey]" style="border:0" @click="({ key }) => $router.push('/' + key)">
            <a-menu-item key="projects"><template #icon><FolderOutlined /></template>项目</a-menu-item>
            <a-menu-item key="oplog"><template #icon><HistoryOutlined /></template>操作日志</a-menu-item>
            <a-menu-item key="trash"><template #icon><DeleteOutlined /></template>回收站</a-menu-item>
            <a-menu-item key="settings"><template #icon><SettingOutlined /></template>设置</a-menu-item>
          </a-menu>

          <div style="position:absolute;bottom:16px;left:12px;right:12px">
            <div class="text-secondary" style="font-size:11px;line-height:1.8">
              数据是纯文本文件，直接进 Git。<br>
              CLI 能做的事这里都能做。
            </div>
          </div>
        </a-layout-sider>

        <a-layout-content style="overflow:hidden;display:flex;flex-direction:column">
          <router-view />
        </a-layout-content>
      </a-layout>
    </a-layout>

    <SearchPalette v-model:open="searchOpen" />
    <GitPanel v-model:open="gitOpen" @changed="loadGit" />
  </a-config-provider>
</template>

<script setup>
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
import { useRoute } from 'vue-router'
import zhCN from 'ant-design-vue/es/locale/zh_CN'
import {
  FolderOutlined, HistoryOutlined, DeleteOutlined,
  SearchOutlined, BranchesOutlined, SettingOutlined, EyeOutlined
} from '@ant-design/icons-vue'
import SearchPalette from './components/SearchPalette.vue'
import GitPanel from './components/GitPanel.vue'
import { useAppStore } from './store'
import { api } from './api'

const app = useAppStore()
const route = useRoute()

const searchOpen = ref(false)
const gitOpen = ref(false)
const git = ref({ tracked: false, clean: true, files: [], conflicts: [] })

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform)

const activeKey = computed(() => {
  if (route.path.startsWith('/oplog')) return 'oplog'
  if (route.path.startsWith('/trash')) return 'trash'
  if (route.path.startsWith('/settings')) return 'settings'
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
  backgroundColor: git.value.conflicts.length ? '#ff4d4f' : '#faad14'
}))
const gitTooltip = computed(() => {
  if (!git.value.tracked) return '未纳入 Git'
  if (git.value.conflicts.length) return `${git.value.conflicts.length} 个冲突待解决`
  if (!git.value.clean) return `${git.value.files.length} 处未提交改动`
  return '工作区干净'
})

async function loadGit() {
  try {
    git.value = await api.gitStatus()
  } catch {
    git.value = { tracked: false, clean: true, files: [], conflicts: [] }
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
  loadGit()
  window.addEventListener('keydown', onKey)
})
onBeforeUnmount(() => window.removeEventListener('keydown', onKey))
</script>

<style>
.search-trigger {
  display: flex; align-items: center; gap: 8px; cursor: pointer;
  height: 30px; padding: 0 10px; border: 1px solid #f0f0f0; border-radius: 6px;
  color: rgba(0,0,0,.45); font-size: 13px; background: #fafafa; transition: all .2s;
}
.search-trigger:hover { border-color: #91caff; color: #1677ff; background: #fff; }
.search-trigger kbd {
  font-family: inherit; font-size: 11px; background: #fff; border: 1px solid #e8e8e8;
  border-radius: 4px; padding: 1px 5px; color: rgba(0,0,0,.35);
}
</style>

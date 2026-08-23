<template>
  <div class="page-pad watch-page">
    <div class="page-title-row">
      <div><h2>草稿箱</h2><p class="text-secondary">自动收集的原型记录会在这里等待整理</p></div>
      <a-button :loading="loading" @click="load"><template #icon><IconRefresh /></template>刷新</a-button>
    </div>
    <a-alert type="info" show-icon class="stack-md" message="自动归档成功后可直接进入版本补充变更日志；失败项会保留原因并允许重试。" />
    <a-table :data="items" row-key="id" :loading="loading" :pagination="false" size="middle">
      <template #columns>
        <a-table-column title="原型">
          <template #cell="{ record }">
          <div class="watch-file"><strong>{{ record.title }}</strong><span class="mono text-secondary">{{ record.filename }}</span></div>
          </template>
        </a-table-column>
        <a-table-column title="项目" data-index="project" :width="140" />
        <a-table-column title="建议版本" data-index="suggestedVersionNo" :width="120" />
        <a-table-column title="状态" :width="220">
          <template #cell="{ record }">
            <a-tag :color="record.status === 'archived' ? 'green' : record.status === 'failed' ? 'red' : 'gold'">{{ statusLabel[record.status] || record.status }}</a-tag>
            <div v-if="record.error" class="error-text code-sm">{{ record.error }}</div>
          </template>
        </a-table-column>
        <a-table-column title="收集时间" :width="150">
          <template #cell="{ record }">{{ fmtTime(record.collectedAt) }}</template>
        </a-table-column>
        <a-table-column title="" :width="100" align="right">
          <template #cell="{ record }">
            <a-button v-if="record.status === 'archived'" size="small" @click="$router.push(`/projects/${record.project}/versions/${record.versionNo}`)">打开版本</a-button>
            <a-button v-else-if="record.status === 'failed'" size="small" :disabled="!app.canWrite" @click="retry(record)">重试</a-button>
          </template>
        </a-table-column>
      </template>
    </a-table>
  </div>
</template>

<script setup>
import { onMounted, ref } from 'vue'
import { notify } from '../ui/feedback'
import { IconRefresh } from '@arco-design/web-vue/es/icon/index.js'
import { api } from '../api'
import { useAppStore } from '../store'
import { fmtTime } from '../utils'

const app = useAppStore()
const items = ref([])
const loading = ref(false)
const statusLabel = { pending: '待归档', archived: '已归档', failed: '失败' }
async function load() {
  loading.value = true
  try { items.value = await api.watchInbox() } finally { loading.value = false }
}
async function retry(item) {
  try { await api.retryWatchItem(item.id); notify.success('已重新归档'); await load() } catch { /* api 已提示 */ }
}
onMounted(load)
</script>

<style scoped>
.watch-file { display:flex; flex-direction:column; gap:2px; min-width:0; }
.watch-file .mono { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.error-text { margin-top:4px; color:var(--fl-danger); }
</style>

<template>
  <div class="page-pad watch-page">
    <div class="page-title-row">
      <div><h2>草稿箱</h2><p class="text-secondary">由 flowlark watch 自动收集的原型记录</p></div>
      <a-button :loading="loading" @click="load"><template #icon><ReloadOutlined /></template>刷新</a-button>
    </div>
    <a-alert type="info" show-icon class="stack-md" message="自动归档成功后可直接进入版本补充变更日志；失败项会保留原因并允许重试。" />
    <a-table :data-source="items" :columns="columns" row-key="id" :loading="loading" :pagination="false" size="middle">
      <template #bodyCell="{ column, record }">
        <template v-if="column.key === 'file'">
          <div class="watch-file"><strong>{{ record.title }}</strong><span class="mono text-secondary">{{ record.filename }}</span></div>
        </template>
        <template v-else-if="column.key === 'status'">
          <a-tag :color="record.status === 'archived' ? 'green' : record.status === 'failed' ? 'red' : 'gold'">{{ statusLabel[record.status] || record.status }}</a-tag>
          <div v-if="record.error" class="error-text code-sm">{{ record.error }}</div>
        </template>
        <template v-else-if="column.key === 'action'">
          <a-button v-if="record.status === 'archived'" size="small" @click="$router.push(`/projects/${record.project}/versions/${record.versionNo}`)">打开版本</a-button>
          <a-button v-else-if="record.status === 'failed'" size="small" :disabled="!app.canWrite" @click="retry(record)">重试</a-button>
        </template>
      </template>
    </a-table>
  </div>
</template>

<script setup>
import { onMounted, ref } from 'vue'
import { message } from 'ant-design-vue'
import { ReloadOutlined } from '@ant-design/icons-vue'
import { api } from '../api'
import { useAppStore } from '../store'
import { fmtTime } from '../utils'

const app = useAppStore()
const items = ref([])
const loading = ref(false)
const statusLabel = { pending: '待归档', archived: '已归档', failed: '失败' }
const columns = [
  { title: '原型', key: 'file' },
  { title: '项目', dataIndex: 'project', width: 140 },
  { title: '建议版本', dataIndex: 'suggestedVersionNo', width: 120 },
  { title: '状态', key: 'status', width: 220 },
  { title: '收集时间', dataIndex: 'collectedAt', width: 150, customRender: ({ text }) => fmtTime(text) },
  { title: '', key: 'action', width: 100, align: 'right' }
]

async function load() {
  loading.value = true
  try { items.value = await api.watchInbox() } finally { loading.value = false }
}
async function retry(item) {
  try { await api.retryWatchItem(item.id); message.success('已重新归档'); await load() } catch { /* api 已提示 */ }
}
onMounted(load)
</script>

<style scoped>
.watch-page h2 { margin:0 0 var(--fl-s-1); font-size:var(--fl-fs-5); }
.page-title-row { display:flex; align-items:center; gap:var(--fl-s-3); margin-bottom:var(--fl-s-4); }
.page-title-row p { margin:0; }
.page-title-row > div:first-child { flex:1; }
.watch-file { display:flex; flex-direction:column; gap:2px; min-width:0; }
.watch-file .mono { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.error-text { margin-top:4px; color:var(--fl-danger); }
</style>

<template>
  <div class="page-pad entity-page">
    <div class="entity-header">
      <div>
        <h2>迭代</h2>
        <p class="text-secondary">新建本地迭代计划，并与任务平台同步交付周期</p>
      </div>
      <a-space wrap>
        <a-button :disabled="!app.canWrite" :loading="syncing" @click="syncFromPlatform">
          <template #icon><IconRefresh /></template>从任务平台同步
        </a-button>
        <a-button type="primary" :disabled="!app.canWrite" @click="open = true">
          <template #icon><IconPlus /></template>新建迭代
        </a-button>
      </a-space>
    </div>

    <a-table
      :data="items"
      row-key="name"
      :loading="loading"
      :custom-row="rowProps"
      :scroll="{ x: 760 }"
    >
      <template #columns>
        <a-table-column title="迭代">
          <template #cell="{ record }">
          <div>
            <strong>{{ record.title }}</strong>
            <div class="mono text-secondary">{{ record.name }}</div>
          </div>
          </template>
        </a-table-column>
        <a-table-column title="周期" :width="240">
          <template #cell="{ record }">{{ record.startAt || '-' }} -> {{ record.endAt || '-' }}</template>
        </a-table-column>
        <a-table-column title="版本数" :width="100">
          <template #cell="{ record }">{{ record.items.length }}</template>
        </a-table-column>
        <a-table-column title="任务平台" :width="170">
          <template #cell="{ record }">
            <a-tag :color="record.external ? 'green' : 'default'">{{ record.external ? '已关联任务平台' : '本地' }}</a-tag>
            <div v-if="record.external?.syncedAt" class="text-secondary sync-time">{{ fmtTime(record.external.syncedAt) }}</div>
          </template>
        </a-table-column>
        <a-table-column title="状态" :width="140">
          <template #cell="{ record }">
            <a-tag :color="record.ready ? 'green' : 'gold'">{{ record.ready ? '可交付' : `${record.warnings.length} 项风险` }}</a-tag>
          </template>
        </a-table-column>
      </template>
    </a-table>

    <a-modal v-model:visible="open" title="新建迭代" @ok="create" :confirm-loading="saving">
      <a-form layout="vertical">
        <a-form-item label="迭代标识" required>
          <a-input v-model="form.name" class="mono" placeholder="2026-S12" />
        </a-form-item>
        <a-form-item label="标题">
          <a-input v-model="form.title" />
        </a-form-item>
        <a-row :gutter="12">
          <a-col :span="12">
            <a-form-item label="开始日期">
              <a-input v-model="form.startAt" type="date" />
            </a-form-item>
          </a-col>
          <a-col :span="12">
            <a-form-item label="结束日期">
              <a-input v-model="form.endAt" type="date" />
            </a-form-item>
          </a-col>
        </a-row>
        <a-form-item>
          <a-checkbox v-model="form.syncExternal">创建后同步到任务平台</a-checkbox>
        </a-form-item>
      </a-form>
    </a-modal>
  </div>
</template>

<script setup>
import { onMounted, reactive, ref } from 'vue'
import { useRouter } from 'vue-router'
import { notify } from '../ui/feedback'
import { IconPlus, IconRefresh } from '@arco-design/web-vue/es/icon/index.js'
import { api } from '../api'
import { useAppStore } from '../store'
import { fmtTime } from '../utils'

const app = useAppStore()
const router = useRouter()
const items = ref([])
const loading = ref(false)
const saving = ref(false)
const syncing = ref(false)
const open = ref(false)
const form = reactive({ name: '', title: '', startAt: '', endAt: '', syncExternal: false })

const rowProps = (record) => ({ class: 'clickable-row', onClick: () => router.push(`/milestones/${encodeURIComponent(record.name)}`) })

async function load() {
  loading.value = true
  try {
    items.value = await api.listMilestones()
  } finally {
    loading.value = false
  }
}

async function create() {
  if (!form.name.trim()) return notify.warning('请填写迭代标识')
  saving.value = true
  try {
    let item = await api.createMilestone({ ...form, items: [] })
    if (form.syncExternal) item = await api.syncMilestone(item.name)
    open.value = false
    router.push(`/milestones/${encodeURIComponent(item.name)}`)
  } finally {
    saving.value = false
  }
}

async function syncFromPlatform() {
  syncing.value = true
  try {
    const result = await api.syncMilestones()
    items.value = result.items
    notify.success(`已同步 ${result.total} 个迭代：新建 ${result.created} 个，更新 ${result.updated} 个`)
  } finally {
    syncing.value = false
  }
}

onMounted(load)
</script>

<style scoped>
.entity-header {
  display: flex;
  align-items: center;
  gap: 16px;
  margin-bottom: 20px;
}

.entity-header > div {
  flex: 1;
}

.entity-header h2 {
  margin: 0 0 4px;
  font-size: var(--fl-fs-5);
}

.entity-header p {
  margin: 0;
}

.sync-time {
  margin-top: 2px;
  font-size: 12px;
}

:deep(.clickable-row) {
  cursor: pointer;
}

:deep(.clickable-row:hover td) {
  background: var(--fl-primary-bg) !important;
}

@media (max-width: 768px) {
  .entity-header {
    align-items: flex-start;
    flex-direction: column;
  }
}
</style>

<template>
  <div :class="{ 'page-pad': !embedded }">
    <h2 v-if="!embedded" style="margin:0 0 4px;font-size:20px">操作日志</h2>
    <div class="text-secondary" :style="{ marginBottom: embedded ? '12px' : '20px' }">
      记录在 <span class="mono">.flowlark/oplog.ndjson</span>，append-only，随 Git 一起提交。
      语义层面的动作（比如「设为基线」还是「回滚」）Git 自己推断不出来，所以单独记一份。
    </div>

    <a-table :data="logs" :loading="loading" row-key="at" size="middle"
             :scroll="{ x: 760 }"
             :pagination="{ pageSize: 20, showSizeChanger: false }">
      <a-table-column title="时间" data-index="at" :width="170">
        <template #default="{ text }">{{ fmtAbsolute(text) }}</template>
      </a-table-column>
      <a-table-column title="操作人" data-index="by" :width="120" />
      <a-table-column title="项目" data-index="project" :width="140">
        <template #default="{ text }"><span class="mono">{{ text || '—' }}</span></template>
      </a-table-column>
      <a-table-column title="动作" data-index="action" :width="150">
        <template #default="{ text }">
          <a-tag :color="COLOR[text] || 'default'">{{ LABEL[text] || text }}</a-tag>
        </template>
      </a-table-column>
      <a-table-column title="详情" data-index="detail" />
    </a-table>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { api } from '../api'
import { fmtAbsolute } from '../utils'

defineProps({
  embedded: { type: Boolean, default: false }
})

const logs = ref([])
const loading = ref(false)

const LABEL = {
  PROJECT_CREATE: '创建项目', PROJECT_UPDATE: '编辑项目',
  VERSION_ADD: '新增版本', VERSION_UPDATE: '编辑版本', VERSION_REPLACE_FILE: '替换文件',
  VERSION_VOID: '废弃', VERSION_REOPEN: '重新打开',
  VERSION_REMOVE: '删除', VERSION_RESTORE: '恢复',
  BASELINE_SET: '设为基线', BASELINE_ROLLBACK: '回滚基线',
  SPEC_UPDATE: '更新规格书', CHANGES_SET: '更新变更日志', REQS_SET: '更新关联需求'
}
const COLOR = {
  VERSION_ADD: 'green', VERSION_REMOVE: 'red', VERSION_VOID: 'red',
  BASELINE_SET: 'green', BASELINE_ROLLBACK: 'orange', VERSION_RESTORE: 'green'
}

onMounted(async () => {
  loading.value = true
  try {
    logs.value = await api.oplog(null, 300)
  } finally {
    loading.value = false
  }
})
</script>

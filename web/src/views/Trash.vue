<template>
  <div class="page-pad">
    <h2 style="margin:0 0 4px;font-size:20px">回收站</h2>
    <div class="text-secondary" style="margin-bottom:20px">
      删除的版本被移动到 <span class="mono">.flowlark/trash/</span>，文件完整保留。
      主目录里看到的永远是真实存在的版本，不需要靠标记位过滤。
    </div>

    <a-empty v-if="items.length === 0" description="回收站是空的" />

    <div v-for="t in items" :key="t.dir"
         style="display:flex;align-items:center;gap:12px;padding:14px 16px;background:#fff;border:1px solid #f0f0f0;border-radius:8px;margin-bottom:10px">
      <div class="mono" style="font-weight:600;min-width:80px">{{ t.versionNo }}</div>
      <div style="flex:1">
        <div class="mono text-secondary" style="font-size:12px">{{ t.project }}</div>
        <div class="text-secondary" style="font-size:12px">
          {{ fmtTime(t.deletedAt) }} · {{ t.deletedBy || '—' }} 删除
        </div>
      </div>
      <a-tooltip title="恢复后状态重置为「编辑中」，不会自动变回基线">
        <a-button size="small" @click="restore(t)">恢复</a-button>
      </a-tooltip>
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { notify } from '../ui/feedback'
import { api } from '../api'
import { fmtTime } from '../utils'

const items = ref([])

async function load() {
  items.value = await api.trash()
}

async function restore(t) {
  await api.restoreVersion(t.project, t.versionNo)
  notify.success(`${t.versionNo} 已恢复`)
  load()
}

onMounted(load)
</script>

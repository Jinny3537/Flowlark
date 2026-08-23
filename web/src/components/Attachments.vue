<template>
  <div>
    <div style="display:flex;align-items:center;margin-bottom:12px">
      <div class="text-secondary" style="font-size:12.5px">
        PRD、设计稿、评审纪要都可以挂在这里，随 Git 一起提交给团队
      </div>
      <div style="flex:1"></div>
      <a-upload v-if="app.canWrite" :before-upload="onPick" :show-upload-list="false" multiple>
        <a-button size="small" :loading="uploading">
          <template #icon><IconUpload /></template>上传附件
        </a-button>
      </a-upload>
    </div>

    <a-empty v-if="list.length === 0" description="还没有附件" />

    <div v-for="a in list" :key="a.name" class="att-row">
      <span class="att-icon">{{ iconFor(a) }}</span>
      <div style="flex:1;min-width:0">
        <div style="font-size:13.5px;word-break:break-all">
          {{ a.name }}
          <a-tag v-if="a.missing" color="red" style="margin-left:6px">文件缺失</a-tag>
        </div>
        <div class="text-secondary" style="font-size:12px">
          {{ fmtSize(a.size) }} · {{ a.addedBy || '—' }} · {{ fmtTime(a.addedAt) }}
        </div>
      </div>

      <a-space>
        <a-button size="small" :disabled="a.missing" @click="open(a)">打开</a-button>
        <a-button size="small" :disabled="a.missing" @click="download(a)">下载</a-button>
        <a-button v-if="app.canWrite" size="small" danger @click="remove(a)">删除</a-button>
      </a-space>
    </div>

    <div v-if="list.length" class="text-secondary" style="font-size:12px;margin-top:12px">
      存放位置：<span class="mono">projects/{{ slug }}/versions/{{ versionNo }}.files/</span>
    </div>
  </div>
</template>

<script setup>
import { computed, ref } from 'vue'
import { confirmDanger, notify } from '../ui/feedback'
import { IconUpload } from '@arco-design/web-vue/es/icon/index.js'
import { api } from '../api'
import { useAppStore } from '../store'
import { fmtSize, fmtTime } from '../utils'

const props = defineProps({
  slug: String,
  versionNo: String,
  attachments: { type: Array, default: () => [] }
})
const emit = defineEmits(['changed'])

const app = useAppStore()
const uploading = ref(false)
const list = computed(() => props.attachments)

const ICONS = {
  pdf: '📕', doc: '📘', docx: '📘', xls: '📗', xlsx: '📗', ppt: '📙', pptx: '📙',
  png: '🖼️', jpg: '🖼️', jpeg: '🖼️', gif: '🖼️', webp: '🖼️', svg: '🖼️',
  md: '📝', txt: '📝', zip: '🗜️'
}

function iconFor(a) {
  const ext = (a.name.split('.').pop() || '').toLowerCase()
  return ICONS[ext] || '📎'
}

/** 返回 false 阻止组件自行上传：我们要用自己的原始请求体接口 */
async function onPick(file) {
  if (file.size > app.maxFileBytes) {
    notify.error(`${file.name} 超过上限 ${fmtSize(app.maxFileBytes)}`)
    return false
  }
  uploading.value = true
  try {
    await api.addAttachment(props.slug, props.versionNo, file)
    notify.success(`已上传 ${file.name}`)
    emit('changed')
  } catch {
    /* api 层已提示 */
  } finally {
    uploading.value = false
  }
  return false
}

const open = (a) => window.open(api.attachmentUrl(props.slug, props.versionNo, a.name), '_blank')
const download = (a) => window.open(api.attachmentUrl(props.slug, props.versionNo, a.name, true), '_blank')

function remove(a) {
  confirmDanger({
    title: `删除附件 ${a.name}？`,
    content: '文件会从磁盘删除。已提交到 Git 的历史版本仍能找回。',
    okText: '删除',
    onOk: async () => {
      await api.removeAttachment(props.slug, props.versionNo, a.name)
      notify.success('已删除')
      emit('changed')
    }
  })
}
</script>

<style>
.att-row {
  display: flex; align-items: center; gap: 12px;
  padding: 10px 12px; border: 1px solid #f0f0f0; border-radius: 6px; margin-bottom: 8px;
}
.att-row:hover { background: #fafafa; }
.att-icon { font-size: 20px; flex-shrink: 0; }
</style>

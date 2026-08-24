<template>
  <a-modal :visible="open" :footer="false" :closable="false" :width="680"
           :body-style="{ padding: 0 }" @update:visible="close">
    <div style="padding:14px 16px;border-bottom:1px solid #f0f0f0;display:flex;align-items:center;gap:10px">
      <IconSearch style="color:rgba(0,0,0,.45)" />
      <input ref="inputRef" v-model="q" class="palette-input"
             placeholder="搜索版本标题、变更日志、规格书正文、需求号…"
             @keydown.down.prevent="move(1)" @keydown.up.prevent="move(-1)"
             @keydown.enter.prevent="go(active)" @keydown.esc="close(false)">
      <a-select v-model="field" size="small" style="width:120px" @change="run">
        <a-option value="">全部字段</a-option>
        <a-option value="title,versionNo">标题/版本号</a-option>
        <a-option value="change">变更日志</a-option>
        <a-option value="spec">规格书</a-option>
        <a-option value="requirement,tag">需求/标签</a-option>
      </a-select>
    </div>

    <div style="max-height:60vh;overflow-y:auto">
      <div v-if="loading" style="padding:40px;text-align:center"><a-spin /></div>

      <a-empty v-else-if="q && results.length === 0" style="padding:32px"
               :description="`没有找到「${q}」`" />

      <div v-else-if="!q" style="padding:24px 16px" class="text-secondary">
        <div style="font-size:13px;margin-bottom:10px">搜索范围覆盖：</div>
        <div style="font-size:12.5px;line-height:2">
          版本号与标题 · 变更日志（含里面写的需求号）· 规格书正文 · 关联需求 · 标签 · 项目名与描述
        </div>
        <div style="font-size:12px;margin-top:14px;color:rgba(0,0,0,.35)">
          ↑↓ 选择　Enter 打开　Esc 关闭
        </div>
        <a-button size="small" style="margin-top:14px" @click="openPanel">打开筛选面板</a-button>
      </div>

      <div v-for="(item, i) in results" :key="i"
           class="palette-item" :class="{ active: i === active }"
           @mouseenter="active = i" @click="go(i)">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:2px">
          <a-tag :color="item.versionStatus === 'BASELINE' ? 'green' : 'default'" style="margin:0">
            {{ item.fieldLabel }}
          </a-tag>
          <span class="mono" style="font-weight:600">{{ item.versionNo || item.project }}</span>
          <span class="text-secondary" style="font-size:12px">
            {{ item.projectName }}{{ item.versionTitle ? ' · ' + item.versionTitle : '' }}
          </span>
        </div>
        <div style="font-size:13px;color:rgba(0,0,0,.65)" v-html="renderSnippet(item.snippet)"></div>
      </div>
    </div>
  </a-modal>
</template>

<script setup>
import { ref, watch, nextTick } from 'vue'
import { useRouter } from 'vue-router'
import { IconSearch } from '@arco-design/web-vue/es/icon/index.js'
import { api } from '../api'

const props = defineProps({ open: Boolean })
const emit = defineEmits(['update:open'])
const router = useRouter()

const q = ref('')
const field = ref('')
const results = ref([])
const loading = ref(false)
const active = ref(0)
const inputRef = ref(null)

let timer = null
watch(q, () => {
  clearTimeout(timer)
  // 本地搜索很快，但连打字时每个字符都发一次请求没必要
  timer = setTimeout(run, 150)
})

watch(() => props.open, async (v) => {
  if (!v) return
  await nextTick()
  inputRef.value && inputRef.value.focus()
})

async function run() {
  if (!q.value.trim()) {
    results.value = []
    return
  }
  loading.value = true
  try {
    const r = await api.search(q.value.trim(), { field: field.value || null, limit: 40 })
    results.value = r.results
    active.value = 0
  } finally {
    loading.value = false
  }
}

function move(delta) {
  if (results.value.length === 0) return
  active.value = (active.value + delta + results.value.length) % results.value.length
}

function go(i) {
  const item = results.value[i]
  if (!item) return
  if (item.objectType === 'requirement') router.push(`/requirements/${encodeURIComponent(item.requirementCode)}`)
  else if (item.objectType === 'milestone') router.push(`/milestones/${encodeURIComponent(item.milestoneName)}`)
  else router.push(item.versionNo ? `/projects/${item.project}/versions/${item.versionNo}` : `/projects/${item.project}`)
  close(false)
}

function openPanel() {
  router.push('/search')
  close(false)
}

function close(v) {
  if (v === false || v === undefined) emit('update:open', false)
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]))
}

/** 片段是纯文本，转义后再插高亮标签 —— 不能直接把用户数据当 HTML 用 */
function renderSnippet(snip) {
  if (!snip) return ''
  const { text, matchStart, matchLength } = snip
  const before = escapeHtml(text.slice(0, matchStart))
  const hit = escapeHtml(text.slice(matchStart, matchStart + matchLength))
  const after = escapeHtml(text.slice(matchStart + matchLength))
  return `${before}<mark>${hit}</mark>${after}`
}
</script>

<style>
.palette-input {
  flex: 1; border: 0; outline: 0; font-size: 15px; background: transparent;
  font-family: inherit; color: rgba(0,0,0,.88);
}
.palette-item { padding: 10px 16px; cursor: pointer; border-bottom: 1px solid #fafafa; }
.palette-item.active { background: #E6F7F4; }
.palette-item mark { background: #ffe58f; padding: 0 1px; border-radius: 2px; }
</style>

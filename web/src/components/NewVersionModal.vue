<template>
  <a-modal :open="open" title="新建版本" width="760px" :confirm-loading="saving"
           @update:open="(value) => emit('update:open', value)" @ok="submit" ok-text="创建版本">
    <a-alert type="info" show-icon class="new-version-alert">
      <template #message>
        新版本创建后处于编辑中；可以从文件、HTML 源码或公开 URL 导入。
        <div class="stack-sm"><CliHint :command="cliCommand" /></div>
      </template>
    </a-alert>

    <a-form layout="vertical">
      <a-form-item label="原型来源" required>
        <a-segmented v-model:value="mode" :options="sourceOptions" block @change="resetSource" />
      </a-form-item>

      <a-form-item v-if="mode === 'file'" label="HTML 文件" required>
        <a-upload-dragger v-if="!file" :before-upload="onPick" :show-upload-list="false" accept=".html,.htm">
          <p class="upload-icon"><InboxOutlined /></p>
          <p>点击或拖拽 HTML 文件到此处</p>
          <p class="text-secondary code-sm">仅支持 .html / .htm，上限 {{ fmtSize(app.maxFileBytes) }}</p>
        </a-upload-dragger>
        <div v-else class="source-ready">
          <CheckCircleFilled />
          <div class="source-ready-copy"><strong>{{ file.name }}</strong><span>{{ sourceSummary }}</span></div>
          <a-button size="small" @click="resetSource">重选</a-button>
        </div>
      </a-form-item>

      <a-form-item v-else-if="mode === 'paste'" label="HTML 源码" required>
        <a-textarea v-model:value="pastedHtml" :rows="7" class="mono" placeholder="粘贴完整 HTML 源码" @blur="inspectPasted" />
        <div class="source-meta text-secondary">{{ sourceSummary }}</div>
      </a-form-item>

      <a-form-item v-else label="公开 URL" required>
        <a-input-group compact class="url-row">
          <a-input v-model:value="sourceUrl" placeholder="https://example.com/prototype" @press-enter="loadUrl" />
          <a-button :loading="importing" @click="loadUrl"><template #icon><CloudDownloadOutlined /></template>读取</a-button>
        </a-input-group>
        <div class="source-meta text-secondary">服务器会校验 DNS、重定向、响应类型和大小，私网地址会被拒绝。</div>
        <div v-if="html" class="source-ready compact"><CheckCircleFilled /><div class="source-ready-copy"><strong>原型已读取</strong><span>{{ sourceSummary }}</span></div></div>
      </a-form-item>

      <a-alert v-if="externalRefs.length" type="warning" show-icon class="source-warning">
        <template #message>
          检测到 {{ externalRefs.length }} 个外部依赖，断网时可能影响样式。
          <a @click="refsOpen = !refsOpen">{{ refsOpen ? '收起' : '查看清单' }}</a>
          <div v-if="refsOpen" class="ref-list"><div v-for="item in externalRefs.slice(0, 12)" :key="item" class="mono">{{ item }}</div></div>
        </template>
      </a-alert>

      <a-row :gutter="16">
        <a-col :span="8"><a-form-item label="版本号" required help="字母数字与 . _ + -，同项目内唯一"><a-input v-model:value="form.versionNo" class="mono" placeholder="v1.0" :maxlength="32" /></a-form-item></a-col>
        <a-col :span="16"><a-form-item label="版本标题" required><a-input v-model:value="form.title" placeholder="一句话说明本版主题" :maxlength="100" /></a-form-item></a-col>
      </a-row>
      <a-form-item label="变更日志" help="建版时可不填；设为基线时至少需要 1 条"><ChangeEditor v-model="form.changes" /></a-form-item>
      <a-form-item label="关联需求"><RequirementEditor v-model="form.requirements" /></a-form-item>
    </a-form>
  </a-modal>
</template>

<script setup>
import { computed, reactive, ref, watch } from 'vue'
import { message } from 'ant-design-vue'
import { CloudDownloadOutlined, InboxOutlined, CheckCircleFilled } from '@ant-design/icons-vue'
import ChangeEditor from './ChangeEditor.vue'
import RequirementEditor from './RequirementEditor.vue'
import CliHint from './CliHint.vue'
import { api } from '../api'
import { useAppStore } from '../store'
import { fmtSize, cliFor } from '../utils'

const props = defineProps({ open: Boolean, slug: String })
const emit = defineEmits(['update:open', 'created'])
const app = useAppStore()
const sourceOptions = [{ label: '文件', value: 'file' }, { label: '粘贴源码', value: 'paste' }, { label: 'URL', value: 'url' }]
const mode = ref('file')
const file = ref(null)
const pastedHtml = ref('')
const sourceUrl = ref('')
const html = ref('')
const externalRefs = ref([])
const refsOpen = ref(false)
const saving = ref(false)
const importing = ref(false)
const form = reactive({ versionNo: '', title: '', changes: [], requirements: [] })
const cliCommand = computed(() => cliFor('add', props.slug))
const sourceSummary = computed(() => html.value
  ? `${fmtSize(new Blob([html.value]).size)} · ${externalRefs.value.length ? `${externalRefs.value.length} 个外部依赖` : '无外部依赖'}`
  : '尚未读取 HTML')

watch(() => props.open, (value) => { if (value) resetAll() })

function resetAll() {
  mode.value = 'file'
  Object.assign(form, { versionNo: '', title: '', changes: [], requirements: [] })
  resetSource()
}

function resetSource() {
  file.value = null
  pastedHtml.value = ''
  sourceUrl.value = ''
  html.value = ''
  externalRefs.value = []
  refsOpen.value = false
}

function inferVersionNo(name) {
  const match = String(name || '').replace(/\.html?$/i, '').match(/v?\d+(?:\.\d+){0,3}/i)
  return match ? (/^v/i.test(match[0]) ? match[0].toLowerCase() : `v${match[0]}`) : ''
}

async function acceptHtml(value, name = '') {
  html.value = value
  const result = await api.inspectHtml(value)
  externalRefs.value = result.externalRefs || []
  if (!form.versionNo && name) form.versionNo = inferVersionNo(name)
  if (!form.title) form.title = result.title || String(name).replace(/\.html?$/i, '')
}

function onPick(picked) {
  if (picked.size > app.maxFileBytes) {
    message.error(`文件 ${fmtSize(picked.size)} 超过上限 ${fmtSize(app.maxFileBytes)}`)
    return false
  }
  const reader = new FileReader()
  reader.onload = async () => {
    try { file.value = picked; await acceptHtml(String(reader.result || ''), picked.name) }
    catch { file.value = null; html.value = '' }
  }
  reader.readAsText(picked)
  return false
}

async function inspectPasted() {
  if (!pastedHtml.value.trim()) return
  try { await acceptHtml(pastedHtml.value, '粘贴原型.html') } catch { html.value = '' }
}

async function loadUrl() {
  if (!sourceUrl.value.trim()) return message.warning('请输入公开 URL')
  importing.value = true
  try {
    const result = await api.importUrl(sourceUrl.value.trim())
    html.value = result.html
    externalRefs.value = result.externalRefs || []
    if (!form.title) form.title = result.title || '导入原型'
    if (!form.versionNo) form.versionNo = inferVersionNo(new URL(result.sourceUrl).pathname)
  } catch { html.value = '' }
  finally { importing.value = false }
}

async function submit() {
  if (mode.value === 'paste' && !html.value) await inspectPasted()
  if (!html.value) return message.warning('请先提供有效的原型 HTML')
  if (!form.versionNo.trim()) return message.warning('请填写版本号')
  if (!form.title.trim()) return message.warning('请填写版本标题')
  saving.value = true
  try {
    const version = await api.addVersion(props.slug, {
      versionNo: form.versionNo.trim(), title: form.title.trim(), html: html.value,
      changes: form.changes.filter((item) => item.content && item.content.trim()),
      requirements: form.requirements.filter((item) => item.code && item.code.trim())
    })
    message.success(`版本 ${version.versionNo} 已创建`)
    emit('update:open', false)
    emit('created', version)
  } catch { /* api 已提示 */ }
  finally { saving.value = false }
}
</script>

<style scoped>
.new-version-alert { margin:var(--fl-s-4) 0; }
.upload-icon { margin:8px 0; color:var(--fl-text-3); font-size:28px; }
.source-ready { display:flex; align-items:center; gap:var(--fl-s-3); padding:14px 16px; border:1px solid var(--fl-primary-border); border-radius:var(--fl-r-3); background:var(--fl-primary-bg); color:var(--fl-primary-deep); }
.source-ready.compact { margin-top:var(--fl-s-2); padding:9px 12px; }
.source-ready-copy { display:flex; flex:1; min-width:0; flex-direction:column; }
.source-ready-copy span { color:var(--fl-text-2); font-size:var(--fl-fs-2); }
.url-row { display:flex; }
.url-row .ant-input { flex:1; }
.source-meta { margin-top:var(--fl-s-2); font-size:var(--fl-fs-2); }
.source-warning { margin-bottom:var(--fl-s-4); }
.ref-list { max-height:100px; overflow:auto; margin-top:var(--fl-s-2); color:var(--fl-text-3); font-size:var(--fl-fs-1); word-break:break-all; }
</style>

<template>
  <div class="page-pad prototype-workbench-page">
    <div class="prototype-workbench-head">
      <div>
        <h2>原型修改工作台</h2>
        <p class="text-secondary">从当前基线生成新版，补齐变更日志、规格草稿和关联需求。</p>
      </div>
      <a-space>
        <a-button @click="$router.push('/settings')">
          <template #icon><SettingOutlined /></template>工作区设置
        </a-button>
        <a-button type="primary" :disabled="!app.canWrite" :loading="creating" @click="createVersion">
          <template #icon><SaveOutlined /></template>创建新版
        </a-button>
      </a-space>
    </div>

    <a-alert v-if="!app.canWrite" type="info" show-icon class="stack-md"
             message="当前是只读模式，可以预览和生成草稿，但不能创建新版本。" />

    <div class="workbench-grid">
      <section class="workbench-panel">
        <div class="panel-title"><BranchesOutlined /> 来源版本</div>
        <a-form layout="vertical">
          <a-form-item label="项目" required>
            <a-select v-model:value="selectedProject" show-search placeholder="选择项目" @change="loadVersions">
              <a-select-option v-for="project in projects" :key="project.slug" :value="project.slug">
                {{ project.name }} · {{ project.baselineVersionNo || '无基线' }}
              </a-select-option>
            </a-select>
          </a-form-item>
          <a-form-item label="基于版本" required>
            <a-select v-model:value="baseVersionNo" placeholder="默认选择当前基线" @change="loadBase">
              <a-select-option v-for="version in versions" :key="version.versionNo" :value="version.versionNo">
                {{ version.versionNo }} · {{ version.title }}
              </a-select-option>
            </a-select>
          </a-form-item>
          <a-row :gutter="12">
            <a-col :span="9">
              <a-form-item label="新版号" required>
                <a-input v-model:value="form.versionNo" class="mono" />
              </a-form-item>
            </a-col>
            <a-col :span="15">
              <a-form-item label="新版标题" required>
                <a-input v-model:value="form.title" :maxlength="100" />
              </a-form-item>
            </a-col>
          </a-row>
          <a-checkbox v-model:checked="inheritRequirements">沿用来源版本关联需求</a-checkbox>
          <a-checkbox v-model:checked="writeSpec" class="check-row">创建后写入规格草稿</a-checkbox>
          <a-checkbox v-model:checked="setAsBaseline" class="check-row">创建后直接设为基线</a-checkbox>
        </a-form>
      </section>

      <section class="workbench-panel">
        <div class="panel-title"><CloudUploadOutlined /> 新版原型</div>
        <a-segmented v-model:value="mode" :options="sourceOptions" block @change="resetSource" />
        <div class="source-box">
          <a-upload-dragger v-if="mode === 'file' && !file" :before-upload="onPick" :show-upload-list="false" accept=".html,.htm">
            <p class="upload-icon"><InboxOutlined /></p>
            <p>点击或拖拽 HTML 文件到此处</p>
            <p class="text-secondary code-sm">上限 {{ fmtSize(app.maxFileBytes) }}</p>
          </a-upload-dragger>
          <div v-else-if="mode === 'file'" class="source-ready">
            <CheckCircleFilled />
            <div><strong>{{ file.name }}</strong><span>{{ sourceSummary }}</span></div>
            <a-button size="small" @click="resetSource">重选</a-button>
          </div>

          <template v-else-if="mode === 'paste'">
            <a-textarea v-model:value="pastedHtml" :rows="8" class="mono" placeholder="粘贴完整 HTML 源码" @blur="inspectPasted" />
            <div class="source-meta text-secondary">{{ sourceSummary }}</div>
          </template>

          <template v-else>
            <a-input-group compact class="url-row">
              <a-input v-model:value="sourceUrl" placeholder="https://example.com/prototype" @press-enter="loadUrl" />
              <a-button :loading="importing" @click="loadUrl">
                <template #icon><CloudDownloadOutlined /></template>读取
              </a-button>
            </a-input-group>
            <div v-if="html" class="source-ready compact">
              <CheckCircleFilled />
              <div><strong>原型已读取</strong><span>{{ sourceSummary }}</span></div>
            </div>
          </template>
        </div>
        <a-alert v-if="externalRefs.length" type="warning" show-icon class="stack-sm"
                 :message="`检测到 ${externalRefs.length} 个外部依赖，必要时创建后生成离线版。`" />
        <a-button block :disabled="!canDraft" :loading="drafting" @click="generateDraft">
          <template #icon><RobotOutlined /></template>生成变更与规格草稿
        </a-button>
      </section>
    </div>

    <section class="workbench-panel full">
      <div class="panel-title"><EditOutlined /> 生成结果</div>
      <a-alert v-if="draft" class="stack-md" show-icon type="success"
               :message="`已生成 ${draft.changes.length} 条变更草稿，可信度：${draft.confidence}`" />
      <a-tabs>
        <a-tab-pane key="changes" tab="变更日志">
          <ChangeEditor v-model="form.changes" />
          <a-button v-if="form.changes.some(item => item.location)" size="small" class="stack-sm" :loading="impactLoading" @click="checkImpact">
            检查影响面
          </a-button>
          <a-alert v-if="impacts.length" type="warning" show-icon class="stack-sm">
            <template #message>
              <div v-for="(item, index) in impacts" :key="index" class="impact-row">
                <span>{{ item.location }}</span>
                <span class="mono">{{ item.source.project }}/{{ item.source.versionNo }}</span>
                <span>{{ item.requirements.join(', ') || '无需求号' }}</span>
              </div>
            </template>
          </a-alert>
        </a-tab-pane>
        <a-tab-pane key="requirements" tab="关联需求">
          <RequirementEditor v-model="form.requirements" />
        </a-tab-pane>
        <a-tab-pane key="spec" tab="规格草稿">
          <a-textarea v-model:value="specDraft" :rows="12" class="mono" placeholder="生成草稿后可在这里编辑" />
        </a-tab-pane>
      </a-tabs>
    </section>
  </div>
</template>

<script setup>
import { computed, onMounted, reactive, ref } from 'vue'
import { message } from 'ant-design-vue'
import {
  BranchesOutlined, CheckCircleFilled, CloudDownloadOutlined, CloudUploadOutlined,
  EditOutlined, InboxOutlined, RobotOutlined, SaveOutlined, SettingOutlined
} from '@ant-design/icons-vue'
import { useRouter } from 'vue-router'
import { api } from '../api'
import { useAppStore } from '../store'
import { fmtSize } from '../utils'
import ChangeEditor from '../components/ChangeEditor.vue'
import RequirementEditor from '../components/RequirementEditor.vue'

const app = useAppStore()
const router = useRouter()
const projects = ref([])
const versions = ref([])
const selectedProject = ref()
const baseVersionNo = ref()
const baseVersion = ref(null)
const mode = ref('file')
const file = ref(null)
const pastedHtml = ref('')
const sourceUrl = ref('')
const html = ref('')
const externalRefs = ref([])
const importing = ref(false)
const drafting = ref(false)
const creating = ref(false)
const impactLoading = ref(false)
const impacts = ref([])
const draft = ref(null)
const specDraft = ref('')
const inheritRequirements = ref(true)
const writeSpec = ref(true)
const setAsBaseline = ref(false)
const form = reactive({ versionNo: '', title: '', changes: [], requirements: [] })
const sourceOptions = [{ label: '文件', value: 'file' }, { label: '粘贴源码', value: 'paste' }, { label: 'URL', value: 'url' }]
const sourceSummary = computed(() => html.value ? `${fmtSize(new Blob([html.value]).size)} · ${externalRefs.value.length} 个外部依赖` : '尚未读取 HTML')
const canDraft = computed(() => selectedProject.value && baseVersionNo.value && html.value)

function inferVersionNo(name) {
  const match = String(name || '').replace(/\.html?$/i, '').match(/v?(\d+)(?:\.(\d+))?/i)
  if (!match) return ''
  const major = Number(match[1])
  const minor = Number(match[2] || 0) + 1
  return `v${major}.${minor}`
}

function resetSource() {
  file.value = null
  pastedHtml.value = ''
  sourceUrl.value = ''
  html.value = ''
  externalRefs.value = []
  draft.value = null
}

async function acceptHtml(value, name = '') {
  html.value = value
  const result = await api.inspectHtml(value)
  externalRefs.value = result.externalRefs || []
  if (!form.title) form.title = result.title || String(name).replace(/\.html?$/i, '')
}

function onPick(picked) {
  if (picked.size > app.maxFileBytes) {
    message.error(`文件 ${fmtSize(picked.size)} 超过上限 ${fmtSize(app.maxFileBytes)}`)
    return false
  }
  const reader = new FileReader()
  reader.onload = async () => {
    try { file.value = picked; await acceptHtml(String(reader.result || ''), picked.name) } catch { file.value = null; html.value = '' }
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
  } finally { importing.value = false }
}

function nextVersionNo(no) {
  const suggested = inferVersionNo(no) || `${no}-1`
  const used = new Set(versions.value.map((item) => item.versionNo))
  if (!used.has(suggested)) return suggested
  let i = 2
  while (used.has(`${suggested}-${i}`)) i += 1
  return `${suggested}-${i}`
}

async function loadVersions() {
  versions.value = selectedProject.value ? await api.listVersions(selectedProject.value, { includeDraft: true, includeVoid: false }) : []
  const project = projects.value.find((item) => item.slug === selectedProject.value)
  baseVersionNo.value = project?.baselineVersionNo || versions.value[0]?.versionNo
  await loadBase()
}

async function loadBase() {
  baseVersion.value = selectedProject.value && baseVersionNo.value ? await api.getVersion(selectedProject.value, baseVersionNo.value) : null
  form.versionNo = baseVersionNo.value ? nextVersionNo(baseVersionNo.value) : ''
  if (!form.title && baseVersion.value) form.title = `${baseVersion.value.title} 改稿`
  form.requirements = inheritRequirements.value && baseVersion.value ? [...baseVersion.value.requirements] : []
}

async function generateDraft() {
  if (mode.value === 'paste' && !html.value) await inspectPasted()
  if (!canDraft.value) return message.warning('请先选择来源版本并提供新版 HTML')
  drafting.value = true
  try {
    draft.value = await api.draftVersion({ project: selectedProject.value, baseVersionNo: baseVersionNo.value, html: html.value, title: form.title })
    form.changes = draft.value.changes || []
    specDraft.value = draft.value.spec || ''
    if (inheritRequirements.value && baseVersion.value) form.requirements = [...baseVersion.value.requirements]
  } finally { drafting.value = false }
}

async function checkImpact() {
  impactLoading.value = true
  try { impacts.value = await api.suggestImpact(form.changes) } finally { impactLoading.value = false }
}

async function createVersion() {
  if (mode.value === 'paste' && !html.value) await inspectPasted()
  if (!app.canWrite) return message.info('当前是只读模式，不能创建版本')
  if (!selectedProject.value || !baseVersionNo.value) return message.warning('请选择项目和来源版本')
  if (!html.value) return message.warning('请提供新版 HTML')
  if (!form.versionNo.trim() || !form.title.trim()) return message.warning('请填写新版号和标题')
  creating.value = true
  try {
    const version = await api.addVersion(selectedProject.value, {
      versionNo: form.versionNo.trim(),
      title: form.title.trim(),
      html: html.value,
      changes: form.changes.filter((item) => item.content && item.content.trim()),
      requirements: form.requirements.filter((item) => item.code && item.code.trim())
    })
    if (writeSpec.value && specDraft.value.trim()) await api.setSpec(selectedProject.value, version.versionNo, specDraft.value)
    if (setAsBaseline.value) await api.setBaseline(selectedProject.value, version.versionNo)
    message.success(`版本 ${version.versionNo} 已创建`)
    router.push(`/projects/${selectedProject.value}/versions/${version.versionNo}`)
  } finally { creating.value = false }
}

async function load() {
  projects.value = await api.listProjects()
  selectedProject.value = projects.value.find((item) => item.baselineVersionNo)?.slug || projects.value[0]?.slug
  if (selectedProject.value) await loadVersions()
}

onMounted(load)
</script>

<style scoped>
.prototype-workbench-page { max-width: 1180px; }
.prototype-workbench-head { display:flex; align-items:center; gap:var(--fl-s-4); margin-bottom:var(--fl-s-5); }
.prototype-workbench-head > div { flex:1; min-width:0; }
.prototype-workbench-head h2 { margin:0 0 4px; font-size:var(--fl-fs-5); }
.prototype-workbench-head p { margin:0; }
.workbench-grid { display:grid; grid-template-columns:minmax(320px, 0.9fr) minmax(360px, 1.1fr); gap:var(--fl-s-4); margin-bottom:var(--fl-s-4); }
.workbench-panel { border:1px solid var(--fl-border); border-radius:var(--fl-r-3); background:var(--fl-bg-1); padding:var(--fl-s-4); }
.workbench-panel.full { margin-bottom:var(--fl-s-6); }
.panel-title { display:flex; align-items:center; gap:8px; margin-bottom:var(--fl-s-4); font-weight:700; color:var(--fl-text-1); }
.check-row { display:block; margin:8px 0 0; }
.source-box { margin:var(--fl-s-4) 0; }
.upload-icon { margin:8px 0; color:var(--fl-text-3); font-size:28px; }
.source-ready { display:flex; align-items:center; gap:var(--fl-s-3); padding:14px 16px; border:1px solid var(--fl-primary-border); border-radius:var(--fl-r-3); background:var(--fl-primary-bg); color:var(--fl-primary-deep); }
.source-ready.compact { margin-top:var(--fl-s-3); padding:9px 12px; }
.source-ready div { flex:1; min-width:0; display:flex; flex-direction:column; }
.source-ready span { color:var(--fl-text-2); font-size:var(--fl-fs-2); }
.source-meta { margin-top:var(--fl-s-2); font-size:var(--fl-fs-2); }
.url-row { display:flex; }
.url-row .ant-input { flex:1; }
.stack-md { margin-bottom:var(--fl-s-4); }
.stack-sm { margin-top:var(--fl-s-3); }
.impact-row { display:grid; grid-template-columns:minmax(120px,1fr) auto auto; gap:var(--fl-s-3); margin-top:4px; font-size:var(--fl-fs-2); }
@media (max-width: 860px) {
  .prototype-workbench-head { display:block; }
  .prototype-workbench-head .ant-space { margin-top:var(--fl-s-3); }
  .workbench-grid { grid-template-columns:1fr; }
  .impact-row { grid-template-columns:1fr; }
}
</style>

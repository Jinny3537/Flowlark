<template>
  <div class="wb-page">
    <div class="wb-toolbar">
      <a-button type="text" @click="$router.push(`/projects/${slug}`)">
        <template #icon><LeftOutlined /></template>返回
      </a-button>
      <a-divider type="vertical" />
      <strong v-if="project">{{ project.name }}</strong>

      <a-select :value="versionNo" class="version-select" @change="(no) => $router.push(`/projects/${slug}/versions/${no}`)">
        <a-select-option v-for="v in siblings" :key="v.versionNo" :value="v.versionNo">
          {{ v.versionNo }} — {{ v.title }}
        </a-select-option>
      </a-select>

      <a-tag v-if="version" :color="version.display.color">{{ version.display.label }}</a-tag>
      <ReviewStatusControl v-if="version" :slug="slug" :version-no="versionNo" :status="version.reviewStatus"
                           :disabled="!app.canWrite" @changed="reloadVersion" />

      <div class="spacer"></div>

      <a-button size="small" @click="historyOpen = true">
        <template #icon><HistoryOutlined /></template>历史
      </a-button>
      <a-button size="small" @click="goCompare">并排对比</a-button>
      <a-button size="small" @click="copyLink"><template #icon><LinkOutlined /></template>直链</a-button>
      <a-button size="small" @click="openExternal">新窗口</a-button>
      <a-button size="small" @click="download">下载</a-button>
      <a-divider type="vertical" />
      <a-button v-if="version && !version.isBaseline && version.display.key !== 'VOID'"
                size="small" type="primary" :disabled="!app.canWrite" @click="blOpen = true">
        {{ version.display.key === 'HISTORY' ? '回滚为基线' : '设为当前基线' }}
      </a-button>
      <a-button v-else-if="version && version.isBaseline" size="small" disabled>✓ 当前基线</a-button>
    </div>

    <div class="wb-stage">
      <div v-if="loading" class="wb-loading"><a-spin size="large" /></div>

      <div class="wb" ref="wbRef">
        <div class="wb-left" :class="{ 'is-full': docsCollapsed }"
             :style="docsCollapsed ? null : { width: leftPct + '%' }">
          <div class="wb-subbar">
            <span class="text-secondary"><DesktopOutlined /> 原型预览</span>
            <span class="mono text-secondary" v-if="version">{{ version.file }} · {{ fmtSize(version.fileSize) }}</span>
            <div class="spacer"></div>
            <a-tooltip v-if="version && version.externalRefs.length"
                       title="用已内联 CDN 资源的离线版渲染，断网也不掉样式">
              <a-checkbox v-model:checked="useOffline" :disabled="!version.hasOffline" @change="onOfflineToggle">
                离线预览
              </a-checkbox>
            </a-tooltip>
            <a-tooltip title="原型由独立端口提供，与工作台不同源；里面的脚本读不到工作台的任何数据">
              <a-tag><LockOutlined /> 沙箱隔离</a-tag>
            </a-tooltip>
            <a-button size="small" :type="annotationMode ? 'primary' : 'default'" @click="toggleAnnotation">
              <template #icon><HighlightOutlined /></template>{{ annotationMode ? '退出标注' : '标注反馈' }}
            </a-button>
            <a-divider type="vertical" class="compact-divider" />
            <a-tooltip :title="docsCollapsed ? '恢复分屏' : '收起右侧文档，预览占满'">
              <a-button type="text" size="small" :aria-label="docsCollapsed ? '恢复分屏' : '全宽预览'"
                        @click="docsCollapsed = !docsCollapsed">
                <template #icon>
                  <ColumnWidthOutlined v-if="docsCollapsed" />
                  <FullscreenOutlined v-else />
                </template>
                {{ docsCollapsed ? '分屏' : '全宽' }}
              </a-button>
            </a-tooltip>
          </div>

          <div v-if="version && version.externalRefs.length" class="preview-alert">
            <a-alert :type="version.hasOffline ? 'info' : 'warning'" show-icon closable>
              <template #message>
                本原型依赖 <b>{{ version.externalRefs.length }} 个外部资源</b>。
                <template v-if="version.hasOffline">
                  已生成离线版，勾选右上角「离线预览」即可断网查看。
                </template>
                <template v-else>
                  断网或代理拦截时样式异常属正常现象。
                  <a-button size="small" type="link" :loading="buildingOffline"
                            :disabled="!app.canWrite" @click="buildOffline">
                    生成离线版
                  </a-button>
                </template>
                <a @click="refsOpen = !refsOpen">{{ refsOpen ? '收起' : '查看清单' }}</a>
                <div v-if="refsOpen" class="stack-sm">
                  <div v-for="r in version.externalRefs" :key="r" class="mono text-secondary ref-line">{{ r }}</div>
                </div>
              </template>
            </a-alert>
          </div>

          <div v-if="version" ref="previewCanvas" class="preview-canvas">
            <!-- 不给 allow-same-origin：脚本跑得起来，但读不到工作台任何东西 -->
            <iframe class="wb-frame" :src="previewSrc"
                    sandbox="allow-scripts allow-forms allow-popups allow-modals"
                    referrerpolicy="no-referrer"></iframe>
            <AnnotationOverlay :active="annotationMode" :anchor="selectedAnchor"
                               @select="selectAnnotation" @cancel="cancelAnnotation" />
          </div>
        </div>

        <a-tooltip title="拖动调整宽度，双击复位">
          <div v-show="!docsCollapsed" class="wb-split" :class="{ dragging }"
               @mousedown="startDrag" @dblclick="resetSplit"></div>
        </a-tooltip>

        <div v-show="!docsCollapsed" class="wb-right">
          <a-tabs v-model:activeKey="tab" class="wb-tabs" :tab-bar-style="{ padding: '0 16px' }">
            <a-tab-pane key="spec" tab="规格书" />
            <a-tab-pane key="changes" :tab="`变更日志 ${version ? version.changeCount : 0}`" />
            <a-tab-pane key="reqs" :tab="`关联需求 ${version ? version.requirementCount : 0}`" />
            <a-tab-pane key="files" :tab="`附件 ${version ? version.attachments.length : 0}`" />
            <a-tab-pane key="info" tab="版本信息" />
          </a-tabs>

          <div class="wb-panel-body">
            <template v-if="tab === 'spec'">
              <div class="panel-tools">
                <div class="text-secondary code-sm" v-if="version && version.specUpdatedAt">
                  最后编辑 {{ fmtTime(version.specUpdatedAt) }}
                </div>
                <div class="spacer"></div>
                <a-select v-if="specCommits.length" v-model:value="specRef" size="small"
                          class="history-select" placeholder="回看历史版本" allow-clear
                          @change="loadSpecAt">
                  <a-select-option v-for="cm in specCommits" :key="cm.hash" :value="cm.hash">
                    {{ cm.short }} · {{ fmtTime(cm.date) }}
                  </a-select-option>
                </a-select>
                <a-button v-if="!specEditing" size="small" :disabled="!app.canWrite" @click="startEditSpec">
                  <template #icon><EditOutlined /></template>编辑
                </a-button>
                <template v-else>
                  <a-button size="small" @click="specEditing = false">取消</a-button>
                  <a-button size="small" type="primary" :loading="saving" :disabled="!app.canWrite" @click="saveSpec">保存</a-button>
                </template>
              </div>

              <!-- 回看历史时明确标出「这不是当前内容」，否则很容易误读 -->
              <a-alert v-if="specRef && specAtContent !== null" type="warning" show-icon
                       class="panel-alert">
                <template #message>
                  正在查看 <span class="mono">{{ specRef.slice(0, 7) }}</span> 时的内容，非当前版本
                  <a class="link-gap" @click="specRef = null; specAtContent = null">回到当前</a>
                </template>
              </a-alert>

              <a-alert type="info" show-icon class="panel-alert">
                <template #message>
                  规格书是活文档，版本确认后仍可编辑；原型文件与变更日志则已锁定。
                </template>
              </a-alert>

              <a-textarea v-if="specEditing" v-model:value="specDraft" :rows="24" class="mono"
                          placeholder="用 Markdown 写清楚这一版的产品规则…" />
              <div v-else-if="specAtContent !== null" class="md" v-html="renderMarkdown(specAtContent)"></div>
              <div v-else-if="version && version.spec" class="md" v-html="specHtml"></div>
              <a-empty v-else description="本版本尚未编写规格书">
                <a-button type="primary" :disabled="!app.canWrite" @click="startEditSpec">开始编写</a-button>
              </a-empty>
            </template>

            <template v-else-if="tab === 'changes'">
              <div class="panel-tools">
                <span class="text-secondary no-wrap">对比起点</span>
                <a-select v-model:value="cumFrom" class="flex-select" allow-clear placeholder="仅看本版" @change="loadChanges">
                  <a-select-option v-for="v in olderSiblings" :key="v.versionNo" :value="v.versionNo">
                    {{ v.versionNo }} — {{ v.title }}
                  </a-select-option>
                </a-select>
                <a-button v-if="editable" size="small" @click="toggleChangeEdit">
                  {{ changesEditing ? '取消' : '编辑' }}
                </a-button>
              </div>

              <template v-if="changesEditing">
                <ChangeEditor v-model="changeDraft" />
                <a-button type="primary" block class="stack-md" :loading="saving" @click="saveChanges">
                  保存变更日志
                </a-button>
              </template>
              <template v-else>
                <div v-if="!editable && version" class="panel-alert">
                  <a-tag color="default">{{ version.display.label }}·已锁定</a-tag>
                  <span class="text-secondary code-sm">如需修改请新建版本</span>
                </div>
                <ChangeList :items="changeItems" :location-counts="changeLocCounts" :show-hot="!!cumFrom"
                            @open-req="openReqByCode" />
              </template>
            </template>

            <template v-else-if="tab === 'reqs'">
              <div class="panel-tools">
                <div class="spacer"></div>
                <a-button v-if="editable" size="small" @click="toggleReqEdit">
                  {{ reqsEditing ? '取消' : '编辑' }}
                </a-button>
              </div>

              <template v-if="reqsEditing">
                <RequirementEditor v-model="reqDraft" />
                <a-button type="primary" block class="stack-md" :loading="saving" @click="saveReqs">
                  保存关联需求
                </a-button>
              </template>
              <template v-else>
                <a-empty v-if="!version || version.requirements.length === 0" description="未关联需求" />
                <div v-for="(r, i) in (version ? version.requirements : [])" :key="i"
                     class="req-row">
                  <a-tag color="blue" class="mono">{{ r.code }}</a-tag>
                  <span class="req-title">{{ r.title || '—' }}</span>
                  <a-button size="small" :disabled="!app.requirementUrl(r.code, r.url)"
                            @click="openUrl(app.requirementUrl(r.code, r.url))">
                    <template #icon><ExportOutlined /></template>打开
                  </a-button>
                </div>
              </template>
            </template>

            <template v-else-if="tab === 'files'">
              <Attachments v-if="version" :slug="slug" :version-no="versionNo"
                           :attachments="version.attachments" @changed="reloadVersion" />
            </template>

            <template v-else>
              <a-descriptions :column="1" size="small" bordered v-if="version">
                <a-descriptions-item label="版本号"><span class="mono">{{ version.versionNo }}</span></a-descriptions-item>
                <a-descriptions-item label="标题">{{ version.title }}</a-descriptions-item>
                <a-descriptions-item label="状态">
                  <a-tag :color="version.display.color">{{ version.display.label }}</a-tag>
                </a-descriptions-item>
                <a-descriptions-item label="标签">
                  <!-- 标签不受基线锁定：它是事后追加的组织信息，和「这一版长什么样」无关 -->
                  <a-select v-model:value="tagDraft" mode="tags" size="small" class="full-width"
                            placeholder="加个标签，比如 已评审 / 已交付"
                            :options="tagOptions" :disabled="!app.canWrite" @change="saveTags" />
                </a-descriptions-item>
                <a-descriptions-item label="文件">
                  <span class="mono">{{ version.file }}</span>
                  <span class="text-secondary"> · {{ fmtSize(version.fileSize) }}</span>
                </a-descriptions-item>
                <a-descriptions-item label="磁盘路径">
                  <span class="mono code-sm">projects/{{ slug }}/versions/{{ version.file }}</span>
                </a-descriptions-item>
                <a-descriptions-item label="来源">
                  <span class="mono code-sm">{{ version.sourcePath || '—' }}</span>
                </a-descriptions-item>
                <a-descriptions-item label="外部依赖">
                  <span v-if="version.externalRefs.length" class="warning-text">{{ version.externalRefs.length }} 项</span>
                  <span v-else>无</span>
                </a-descriptions-item>
                <a-descriptions-item label="创建">{{ fmtAbsolute(version.createdAt) }} · {{ version.createdBy }}</a-descriptions-item>
                <a-descriptions-item label="首次成为基线">{{ fmtAbsolute(version.baselineAt) }}</a-descriptions-item>
                <a-descriptions-item label="预览直链">
                  <span class="mono code-sm break-all">{{ previewSrc }}</span>
                </a-descriptions-item>
              </a-descriptions>
            </template>
          </div>
        </div>
      </div>
    </div>

    <BaselineModal v-model:open="blOpen" :slug="slug" :target="version"
                   :current="currentBaselineNo" :total-versions="siblings.length" @done="reload" />
    <FeedbackDrawer v-model:open="feedbackOpen" :context="feedbackContext" :capture-rect="captureRect"
                    @submitted="annotationMode = false" />

    <a-drawer v-model:open="historyOpen" title="这一版的演进历史" placement="right" :width="520">
      <a-empty v-if="commits.length === 0" description="还没有 Git 提交记录">
        <div class="text-secondary code-sm">把仓库纳入 Git 并提交后，这里会显示每次改动</div>
      </a-empty>
      <a-timeline v-else>
        <a-timeline-item v-for="cm in commits" :key="cm.hash">
          <div class="history-subject">{{ cm.subject }}</div>
          <div class="text-secondary code-sm">
            <span class="mono">{{ cm.short }}</span> · {{ cm.author }} · {{ fmtTime(cm.date) }}
          </div>
          <div class="stack-sm">
            <a-tag v-for="k in cm.kinds" :key="k" color="cyan">{{ k }}</a-tag>
          </div>
        </a-timeline-item>
      </a-timeline>
    </a-drawer>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onBeforeUnmount, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { message } from 'ant-design-vue'
import {
  LeftOutlined, LinkOutlined, HistoryOutlined, DesktopOutlined, LockOutlined,
  ColumnWidthOutlined, FullscreenOutlined, EditOutlined, ExportOutlined, HighlightOutlined
} from '@ant-design/icons-vue'
import ChangeList from '../components/ChangeList.vue'
import ChangeEditor from '../components/ChangeEditor.vue'
import RequirementEditor from '../components/RequirementEditor.vue'
import BaselineModal from '../components/BaselineModal.vue'
import Attachments from '../components/Attachments.vue'
import AnnotationOverlay from '../components/AnnotationOverlay.vue'
import FeedbackDrawer from '../components/FeedbackDrawer.vue'
import ReviewStatusControl from '../components/ReviewStatusControl.vue'
import { api } from '../api'
import { useAppStore } from '../store'
import { fmtTime, fmtAbsolute, fmtSize, renderMarkdown } from '../utils'

const props = defineProps({ slug: String, versionNo: String })
const app = useAppStore()
const router = useRouter()
const route = useRoute()

const project = ref(null)
const version = ref(null)
const siblings = ref([])
const loading = ref(false)
const saving = ref(false)
const tab = ref('spec')
const refsOpen = ref(false)
const blOpen = ref(false)
const historyOpen = ref(false)
const commits = ref([])
const specCommits = ref([])
const specRef = ref(null)
const specAtContent = ref(null)
const useOffline = ref(false)
const buildingOffline = ref(false)
const tagDraft = ref([])
const allTags = ref([])
const annotationMode = ref(false)
const feedbackOpen = ref(false)
const selectedAnchor = ref(null)
const captureRect = ref(null)
const previewCanvas = ref(null)

// 原型是这个页面的主角，默认给它多一点。右侧文档区 min-width 340px 兜底可读性。
const DEFAULT_SPLIT = 68
const leftPct = ref(Number(localStorage.getItem('flowlark.split')) || DEFAULT_SPLIT)
const docsCollapsed = ref(localStorage.getItem('flowlark.docsCollapsed') === '1')
const dragging = ref(false)
const wbRef = ref(null)

const specEditing = ref(false)
const specDraft = ref('')
const cumFrom = ref(null)
const changeItems = ref([])
const changeLocCounts = ref({})
const changesEditing = ref(false)
const changeDraft = ref([])
const reqsEditing = ref(false)
const reqDraft = ref([])

const previewSrc = computed(() =>
  version.value ? app.previewUrl(props.slug, props.versionNo, { offline: useOffline.value }) : '')
const tagOptions = computed(() => allTags.value.map((t) => ({ value: t.tag, label: `${t.tag} (${t.count})` })))
const specHtml = computed(() => renderMarkdown(version.value && version.value.spec))
const currentBaselineNo = computed(() => {
  const b = siblings.value.find((v) => v.isBaseline)
  return b ? b.versionNo : null
})
/** R4：只有「编辑中」且当前请求可写时，才能改结构性内容 */
const editable = computed(() => app.canWrite && !!version.value && version.value.display.key === 'DRAFT')
const feedbackContext = computed(() => ({
  project: props.slug,
  version: props.versionNo,
  baseline: currentBaselineNo.value,
  requirements: (version.value && version.value.requirements || []).map((item) => item.code),
  changes: version.value && version.value.changes || [],
  anchor: selectedAnchor.value || { x: 0, y: 0, width: 1, height: 1 },
  url: annotationLink(selectedAnchor.value)
}))
const olderSiblings = computed(() => {
  const i = siblings.value.findIndex((v) => v.versionNo === props.versionNo)
  return i < 0 ? [] : siblings.value.slice(i + 1)
})

async function reload() {
  loading.value = true
  try {
    const [p, v, list] = await Promise.all([
      api.getProject(props.slug),
      api.getVersion(props.slug, props.versionNo),
      api.listVersions(props.slug, { includeDraft: true, includeVoid: true })
    ])
    project.value = p
    version.value = v
    siblings.value = list
    specDraft.value = v.spec || ''
    changeDraft.value = v.changes.map((c) => ({ ...c }))
    reqDraft.value = v.requirements.map((r) => ({ ...r }))
    tagDraft.value = [...(v.tags || [])]
    specEditing.value = false
    changesEditing.value = false
    reqsEditing.value = false
    specRef.value = null
    specAtContent.value = null
    // 有离线版就默认用它 —— 用户特意生成过，说明网络环境不可靠
    useOffline.value = !!v.hasOffline

    // Git 相关与标签是附加信息，失败不该拖垮主视图
    Promise.all([
      api.versionHistory(props.slug, props.versionNo).catch(() => []),
      api.specHistory(props.slug, props.versionNo).catch(() => []),
      api.allTags().catch(() => [])
    ]).then(([h, sh, tg]) => {
      commits.value = h
      specCommits.value = sh
      allTags.value = tg
    })
    // 默认对比起点取上一版：研发最常问的就是「比上版改了什么」
    cumFrom.value = olderSiblings.value.length ? olderSiblings.value[0].versionNo : null
    await loadChanges()
  } finally {
    loading.value = false
  }
}

/** 附件变动后只刷版本本身，不重载整页 —— 避免 iframe 闪一下 */
async function reloadVersion() {
  version.value = await api.getVersion(props.slug, props.versionNo)
}

async function loadChanges() {
  if (!cumFrom.value) {
    changeItems.value = version.value ? version.value.changes : []
    changeLocCounts.value = {}
    return
  }
  const r = await api.cumulative(props.slug, cumFrom.value, props.versionNo)
  changeItems.value = r.items
  changeLocCounts.value = r.locationCounts || {}
}

function copyLink() {
  navigator.clipboard.writeText(previewSrc.value)
    .then(() => message.success('预览直链已复制'))
    .catch(() => message.error('复制失败，可在「版本信息」里手动选中'))
}

function encodeAnchor(anchor) {
  if (!anchor) return ''
  const bytes = new TextEncoder().encode(JSON.stringify(anchor))
  let raw = ''
  for (const byte of bytes) raw += String.fromCharCode(byte)
  return btoa(raw).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '')
}

function decodeAnchor(value) {
  if (!value) return null
  try {
    const raw = atob(String(value).replaceAll('-', '+').replaceAll('_', '/'))
    return JSON.parse(new TextDecoder().decode(Uint8Array.from(raw, (char) => char.charCodeAt(0))))
  } catch { return null }
}

function annotationLink(anchor) {
  const resolved = router.resolve({
    name: 'workbench', params: { slug: props.slug, versionNo: props.versionNo },
    query: anchor ? { anchor: encodeAnchor(anchor) } : {}
  })
  return `${window.location.origin}${window.location.pathname}${resolved.href}`
}

function toggleAnnotation() {
  annotationMode.value = !annotationMode.value
  if (annotationMode.value) selectedAnchor.value = null
}

function selectAnnotation(anchor) {
  selectedAnchor.value = anchor
  annotationMode.value = false
  const rect = previewCanvas.value && previewCanvas.value.getBoundingClientRect()
  if (rect) captureRect.value = {
    left: rect.left + anchor.x * rect.width,
    top: rect.top + anchor.y * rect.height,
    width: anchor.width * rect.width,
    height: anchor.height * rect.height
  }
  feedbackOpen.value = true
}

function cancelAnnotation() {
  annotationMode.value = false
}
const openExternal = () => window.open(previewSrc.value, '_blank', 'noopener')
const openUrl = (url) => url && window.open(url, '_blank', 'noopener')
const download = () => window.open(api.downloadUrl(props.slug, props.versionNo), '_blank')

function openReqByCode(code) {
  const r = version.value && version.value.requirements.find((x) => x.code === code)
  if (r && r.url) openUrl(r.url)
  else message.info(`需求 ${code} 未登记链接`)
}

function goCompare() {
  const other = siblings.value.find((v) => v.versionNo !== props.versionNo)
  router.push(`/projects/${props.slug}/compare?a=${encodeURIComponent(props.versionNo)}` +
    (other ? `&b=${encodeURIComponent(other.versionNo)}` : ''))
}

async function buildOffline() {
  if (!app.canWrite) return message.info('当前是只读模式，不能生成离线版本')
  buildingOffline.value = true
  try {
    const r = await api.buildOffline(props.slug, props.versionNo)
    if (r.failed && r.failed.length) {
      message.warning(`已生成，但 ${r.failed.length} 个资源抓取失败`)
    } else {
      message.success(`离线版已生成，内联 ${r.inlined}/${r.total} 个资源`)
    }
    version.value = await api.getVersion(props.slug, props.versionNo)
    useOffline.value = true
  } finally {
    buildingOffline.value = false
  }
}

function onOfflineToggle() {
  // 切换只影响 iframe 的 src，previewSrc 是 computed，会自动重新加载
}

async function loadSpecAt(ref) {
  if (!ref) {
    specAtContent.value = null
    return
  }
  const r = await api.specAt(props.slug, props.versionNo, ref)
  specAtContent.value = r.spec
}

async function saveTags(tags) {
  if (!app.canWrite) return message.info('当前是只读模式，不能编辑标签')
  version.value = await api.setTags(props.slug, props.versionNo, tags)
  allTags.value = await api.allTags()
}

function startEditSpec() {
  if (!app.canWrite) return message.info('当前是只读模式，不能编辑规格书')
  specDraft.value = (version.value && version.value.spec) || ''
  specEditing.value = true
  specRef.value = null
  specAtContent.value = null
}

async function saveSpec() {
  if (!app.canWrite) return message.info('当前是只读模式，不能保存规格书')
  saving.value = true
  try {
    version.value = await api.setSpec(props.slug, props.versionNo, specDraft.value)
    specEditing.value = false
    message.success('规格书已保存')
  } finally {
    saving.value = false
  }
}

function toggleChangeEdit() {
  if (!app.canWrite) return message.info('当前是只读模式，不能编辑变更日志')
  changesEditing.value = !changesEditing.value
  if (changesEditing.value) changeDraft.value = version.value.changes.map((c) => ({ ...c }))
}

async function saveChanges() {
  if (!app.canWrite) return message.info('当前是只读模式，不能保存变更日志')
  saving.value = true
  try {
    version.value = await api.setChanges(props.slug, props.versionNo,
      changeDraft.value.filter((c) => c.content && c.content.trim()))
    changesEditing.value = false
    message.success('变更日志已保存')
    await loadChanges()
  } finally {
    saving.value = false
  }
}

function toggleReqEdit() {
  if (!app.canWrite) return message.info('当前是只读模式，不能编辑关联需求')
  reqsEditing.value = !reqsEditing.value
  if (reqsEditing.value) reqDraft.value = version.value.requirements.map((r) => ({ ...r }))
}

async function saveReqs() {
  if (!app.canWrite) return message.info('当前是只读模式，不能保存关联需求')
  saving.value = true
  try {
    version.value = await api.setRequirements(props.slug, props.versionNo,
      reqDraft.value.filter((r) => r.code && r.code.trim()))
    reqsEditing.value = false
    message.success('关联需求已保存')
  } finally {
    saving.value = false
  }
}

// ---- 分隔条拖拽 ----
function startDrag(e) {
  dragging.value = true
  e.preventDefault()
  window.addEventListener('mousemove', onDrag)
  window.addEventListener('mouseup', stopDrag)
}
function onDrag(e) {
  if (!dragging.value || !wbRef.value) return
  const r = wbRef.value.getBoundingClientRect()
  // 上限放到 88%：想把文档挤到最窄只留一条边的场景是合理的
  leftPct.value = Math.max(30, Math.min(88, ((e.clientX - r.left) / r.width) * 100))
}
function stopDrag() {
  dragging.value = false
  localStorage.setItem('flowlark.split', String(Math.round(leftPct.value)))
  window.removeEventListener('mousemove', onDrag)
  window.removeEventListener('mouseup', stopDrag)
}
function resetSplit() {
  leftPct.value = DEFAULT_SPLIT
  localStorage.setItem('flowlark.split', String(DEFAULT_SPLIT))
}

watch(docsCollapsed, (v) => localStorage.setItem('flowlark.docsCollapsed', v ? '1' : '0'))

onBeforeUnmount(stopDrag)

watch(() => [props.slug, props.versionNo], reload)
watch(() => route.query.anchor, (value) => { selectedAnchor.value = decodeAnchor(value) })
onMounted(() => {
  selectedAnchor.value = decodeAnchor(route.query.anchor)
  reload()
})
</script>

<style scoped>
.version-select { width: 280px; }
.compact-divider { margin: 0 2px; }
.preview-alert { padding: 10px 12px 0; }
.preview-canvas { position:relative; display:flex; flex:1; min-height:0; overflow:hidden; }
.ref-line {
  font-size: var(--fl-fs-1);
  word-break: break-all;
}
.wb-tabs { flex-shrink: 0; }
.panel-tools {
  display: flex; align-items: center; gap: var(--fl-s-2); margin-bottom: 14px;
}
.panel-alert { margin-bottom: var(--fl-s-3); }
.history-select { width: 190px; }
.flex-select { flex: 1; }
.full-width { width: 100%; }
.break-all { word-break: break-all; }
.no-wrap { white-space: nowrap; }
.history-subject { font-size: var(--fl-fs-3); color: var(--fl-text); }
@media (max-width: 900px) {
  .wb-toolbar { overflow-x:auto; padding-inline:var(--fl-s-2); gap:var(--fl-s-2); }
  .wb-toolbar > strong, .wb-toolbar > .ant-divider { display:none; }
  .version-select { width:180px; min-width:180px; }
  .wb-subbar { overflow-x:auto; scrollbar-width:none; }
  .wb-subbar::-webkit-scrollbar { display:none; }
  .wb-subbar > span { display:none; }
  .wb-subbar > .spacer { min-width:4px; }
}
</style>

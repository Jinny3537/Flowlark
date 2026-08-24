<template>
  <div class="compare-page">
    <div class="compare-toolbar">
      <a-button type="text" @click="$router.push(`/projects/${slug}`)">
        <template #icon><IconLeft /></template>返回
      </a-button>
      <a-divider type="vertical" />
      <div class="compare-title">
        <strong>{{ mode === 'system' ? '原型 / 业务系统对比' : '原型版本并排对比' }}</strong>
        <span class="text-secondary">{{ project ? project.name : '' }}</span>
      </div>

      <div class="spacer"></div>

      <a-segmented v-model="mode" size="small" :options="modeOptions" @change="onModeChange" />
      <a-tooltip title="同步两侧外层视图的横向位置；网页内部滚动由真实页面自己控制">
        <a-checkbox v-model="syncScroll">同步视口</a-checkbox>
      </a-tooltip>
      <a-button v-if="mode === 'versions'" size="small" @click="swap">
        <template #icon><IconSwap /></template>交换
      </a-button>
      <a-button size="small" @click="showChanges = !showChanges">
        <template #icon><IconList /></template>{{ showChanges ? '隐藏说明' : '显示说明' }}
      </a-button>
    </div>

    <div class="compare-summary">
      <div class="summary-item">
        <span>原型版本</span>
        <strong class="mono">{{ a || '-' }}</strong>
      </div>
      <div class="summary-item">
        <span>{{ mode === 'system' ? '原型变更' : '版本跨度' }}</span>
        <strong>{{ mode === 'system' ? (verA ? verA.changeCount : '-') : (cumulative ? cumulative.versionCount : '-') }}</strong>
      </div>
      <div class="summary-item">
        <span>{{ mode === 'system' ? '关联需求' : '累计变更' }}</span>
        <strong>{{ mode === 'system' ? (verA ? verA.requirementCount : '-') : (cumulative ? cumulative.itemCount : '-') }}</strong>
      </div>
      <div class="summary-item">
        <span>{{ mode === 'system' ? '业务系统' : '右侧版本' }}</span>
        <strong>{{ mode === 'system' ? (systemUrl ? '已填写' : '待填写') : (b || '-') }}</strong>
      </div>
      <a-alert v-if="mode === 'system'" type="info" show-icon class="summary-alert"
               message="左侧是本地归档原型，右侧按真实业务系统地址加载。若系统禁止嵌入，可用“新窗口”打开后对照。" />
      <a-alert v-else-if="sameVersion" type="warning" show-icon class="summary-alert"
               message="左右两侧选择了同一个版本，当前只是在核对同一份网页。" />
      <a-alert v-else type="info" show-icon class="summary-alert"
               message="这里加载的是两个归档原型版本的真实网页，用于核对视觉和交互差异。" />
    </div>

    <div class="compare-body" :class="{ 'with-changes': showChanges }">
      <div class="compare-stage">
        <section class="compare-pane">
          <div class="pane-bar">
            <div class="pane-label">
              <span>左侧版本</span>
              <a-tag v-if="verA" :color="verA.display.color">{{ verA.display.label }}</a-tag>
            </div>
            <a-select v-model="a" size="small" class="version-picker" @change="load">
              <a-option v-for="v in versions" :key="v.versionNo" :value="v.versionNo">
                {{ v.versionNo }} - {{ v.title }}
              </a-option>
            </a-select>
            <div class="spacer"></div>
            <a-tooltip title="新窗口打开">
              <a-button type="text" size="small" :disabled="!srcA" @click="openPreview(srcA)">
                <template #icon><IconExport /></template>
              </a-button>
            </a-tooltip>
            <a-tooltip title="下载 HTML">
              <a-button type="text" size="small" :disabled="!a" @click="download(a)">
                <template #icon><IconDownload /></template>
              </a-button>
            </a-tooltip>
          </div>
          <div class="pane-meta">
            <span v-if="verA" class="mono">{{ verA.versionNo }}</span>
            <span v-if="verA">{{ verA.title }}</span>
            <span v-if="verA" class="mono">{{ fmtSize(verA.fileSize) }}</span>
          </div>
          <div ref="scrollA" class="preview-scroll" @scroll="onScroll('a')">
            <iframe v-if="srcA" class="compare-frame" :style="frameStyle" :src="srcA"
                    sandbox="allow-scripts allow-forms allow-popups allow-modals"
                    referrerpolicy="no-referrer"></iframe>
            <a-empty v-else description="请选择左侧版本" />
          </div>
        </section>

        <div class="compare-divider"></div>

        <section class="compare-pane">
          <div class="pane-bar">
            <div class="pane-label">
              <span>{{ mode === 'system' ? '业务系统' : '右侧版本' }}</span>
              <a-tag v-if="mode === 'system' && systemUrl" color="cyan">真实页面</a-tag>
              <a-tag v-if="mode === 'versions' && verB" :color="verB.display.color">{{ verB.display.label }}</a-tag>
            </div>
            <a-input-search v-model="systemUrlInput"
                            v-if="mode === 'system'"
                            size="small"
                            class="system-url-input"
                            placeholder="https://example.com/app/page"
                            enter-button="加载"
                            @search="loadSystemUrl" />
            <a-select v-else v-model="b" size="small" class="version-picker" @change="load">
              <a-option v-for="v in versions" :key="v.versionNo" :value="v.versionNo">
                {{ v.versionNo }} - {{ v.title }}
              </a-option>
            </a-select>
            <div class="spacer"></div>
            <a-tooltip title="新窗口打开">
              <a-button type="text" size="small" :disabled="!rightSrc" @click="openPreview(rightSrc)">
                <template #icon><IconExport /></template>
              </a-button>
            </a-tooltip>
            <a-tooltip v-if="mode === 'versions'" title="下载 HTML">
              <a-button type="text" size="small" :disabled="!b" @click="download(b)">
                <template #icon><IconDownload /></template>
              </a-button>
            </a-tooltip>
          </div>
          <div class="pane-meta">
            <template v-if="mode === 'system'">
              <span v-if="systemUrl" class="mono break-all">{{ systemUrl }}</span>
              <span v-else>填写测试环境、预发环境或生产业务系统地址后开始对比</span>
            </template>
            <template v-else>
              <span v-if="verB" class="mono">{{ verB.versionNo }}</span>
              <span v-if="verB">{{ verB.title }}</span>
              <span v-if="verB" class="mono">{{ fmtSize(verB.fileSize) }}</span>
            </template>
          </div>
          <div ref="scrollB" class="preview-scroll" @scroll="onScroll('b')">
            <iframe v-if="mode === 'system' && systemUrl" class="compare-frame" :src="systemUrl"
                    referrerpolicy="no-referrer-when-downgrade"></iframe>
            <iframe v-else-if="mode === 'versions' && srcB" class="compare-frame" :style="frameStyle" :src="srcB"
                    sandbox="allow-scripts allow-forms allow-popups allow-modals"
                    referrerpolicy="no-referrer"></iframe>
            <a-empty v-else :description="mode === 'system' ? '请输入真实业务系统地址' : '请选择右侧版本'" />
          </div>
        </section>
      </div>

      <aside v-if="showChanges" class="compare-changes">
        <div class="changes-head">
          <div>
            <strong>{{ mode === 'system' ? '对比说明' : '累计变更' }}</strong>
            <div class="text-secondary code-sm">{{ sideNoteTitle }}</div>
          </div>
          <a-button size="small" :disabled="!a" @click="copyCompareLink">
            <template #icon><IconLink /></template>复制链接
          </a-button>
        </div>
        <template v-if="mode === 'system'">
          <a-alert type="warning" show-icon class="panel-alert"
                 message="业务系统按原地址直接嵌入，不加沙箱。若系统通过 X-Frame-Options 或 CSP 禁止嵌入，需要用新窗口对照。" />
          <template v-if="verA && verA.changes.length">
            <div class="section-label compact-label">原型变更清单</div>
            <ChangeList :items="verA.changes" />
          </template>
          <a-empty v-else description="当前原型版本没有变更清单" />
        </template>
        <template v-else>
          <a-empty v-if="!cumulative || !cumulative.items.length" description="没有可展示的累计变更" />
          <ChangeList v-else :items="cumulative.items" :location-counts="cumulative.locationCounts" show-hot />
        </template>
      </aside>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { notify } from '../ui/feedback'
import {
  IconLeft, IconSwap, IconList, IconExport, IconDownload, IconLink
} from '@arco-design/web-vue/es/icon/index.js'
import ChangeList from '../components/ChangeList.vue'
import { api } from '../api'
import { useAppStore } from '../store'
import { fmtSize } from '../utils'

const props = defineProps({ slug: String })
const route = useRoute()
const router = useRouter()
const app = useAppStore()

const project = ref(null)
const versions = ref([])
const verA = ref(null)
const verB = ref(null)
const a = ref(route.query.a || null)
const b = ref(route.query.b || null)
const systemUrlInput = ref(route.query.url || '')
const systemUrl = ref(normalizeSystemUrl(route.query.url || '', { silent: true }))
const mode = ref(route.query.mode === 'system' || (!route.query.mode && route.query.url) ? 'system' : 'versions')
const showChanges = ref(route.query.changes !== '0')
const syncScroll = ref(true)
const cumulative = ref(null)
const scrollA = ref(null)
const scrollB = ref(null)
const syncing = ref(false)

const modeOptions = [
  { label: '原型对比', value: 'versions' },
  { label: '业务系统', value: 'system' }
]
const srcA = computed(() => (a.value ? app.previewUrl(props.slug, a.value) : ''))
const srcB = computed(() => (b.value ? app.previewUrl(props.slug, b.value) : ''))
const rightSrc = computed(() => (mode.value === 'system' ? systemUrl.value : srcB.value))
const frameStyle = computed(() => ({ width: '100%', minWidth: '100%' }))
const sameVersion = computed(() => mode.value === 'versions' && !!a.value && a.value === b.value)
const sideNoteTitle = computed(() => {
  if (mode.value === 'system') return `原型 ${a.value || '-'} / 业务系统`
  const { older, newer } = orderedRange()
  return `${older || '-'} -> ${newer || '-'}`
})

async function init() {
  const [p, list] = await Promise.all([
    api.getProject(props.slug),
    api.listVersions(props.slug, { includeDraft: true, includeVoid: true })
  ])
  project.value = p
  versions.value = list
  if (!a.value) a.value = p.baselineVersionNo || (list[0] && list[0].versionNo)
  if (!b.value) b.value = (list.find((v) => v.versionNo !== a.value) || list[1] || list[0] || {}).versionNo
  await load()
}

async function load() {
  syncQuery()
  if (!a.value) {
    verA.value = null
    return
  }
  if (mode.value === 'versions' && b.value) {
    const [va, vb] = await Promise.all([
      api.getVersion(props.slug, a.value),
      api.getVersion(props.slug, b.value)
    ])
    verA.value = va
    verB.value = vb
    await loadCumulative()
    return
  }
  verA.value = await api.getVersion(props.slug, a.value)
  verB.value = null
  cumulative.value = null
}

async function loadCumulative() {
  const { older, newer } = orderedRange()
  if (!older || !newer || older === newer) {
    cumulative.value = { fromVersionNo: older, toVersionNo: newer, versionCount: 1, itemCount: 0, items: [], locationCounts: {} }
    return
  }
  try {
    cumulative.value = await api.cumulative(props.slug, older, newer)
  } catch {
    cumulative.value = null
  }
}

function orderedRange() {
  const ia = versions.value.findIndex((v) => v.versionNo === a.value)
  const ib = versions.value.findIndex((v) => v.versionNo === b.value)
  if (ia < 0 || ib < 0) return { older: a.value, newer: b.value }
  return ia > ib
    ? { older: a.value, newer: b.value }
    : { older: b.value, newer: a.value }
}

function syncQuery() {
  const query = {}
  query.mode = mode.value
  if (a.value) query.a = a.value
  if (mode.value === 'versions' && b.value) query.b = b.value
  if (mode.value === 'system' && systemUrl.value) query.url = systemUrl.value
  if (!showChanges.value) query.changes = '0'
  router.replace({ name: 'compare', params: { slug: props.slug }, query })
}

function onModeChange() {
  if (mode.value === 'versions' && !b.value) {
    b.value = (versions.value.find((v) => v.versionNo !== a.value) || versions.value[1] || versions.value[0] || {}).versionNo
  }
  load()
}

function swap() {
  if (mode.value !== 'versions') return
  const t = a.value
  a.value = b.value
  b.value = t
  load()
}

function openPreview(src) {
  if (src) window.open(src, '_blank', 'noopener')
}

function download(no) {
  if (no) window.open(api.downloadUrl(props.slug, no), '_blank', 'noopener')
}

function copyCompareLink() {
  syncQuery()
  const href = `${window.location.origin}${window.location.pathname}${router.currentRoute.value.href}`
  navigator.clipboard.writeText(href)
    .then(() => notify.success('对比链接已复制'))
    .catch(() => notify.error('复制失败，可直接复制浏览器地址栏'))
}

function normalizeSystemUrl(value, { silent = false } = {}) {
  const raw = String(value || '').trim()
  if (!raw) return ''
  const withProtocol = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `${window.location.protocol}//${raw}`
  try {
    const url = new URL(withProtocol)
    if (!['http:', 'https:'].includes(url.protocol)) {
      if (!silent) notify.error('业务系统地址只支持 http 或 https')
      return ''
    }
    return url.href
  } catch {
    if (!silent) notify.error('请输入合法的业务系统 URL')
    return ''
  }
}

function loadSystemUrl() {
  const next = normalizeSystemUrl(systemUrlInput.value)
  if (!next) return
  systemUrl.value = next
  systemUrlInput.value = next
  syncQuery()
}

function onScroll(source) {
  if (!syncScroll.value || syncing.value) return
  const from = source === 'a' ? scrollA.value : scrollB.value
  const to = source === 'a' ? scrollB.value : scrollA.value
  if (!from || !to) return
  syncing.value = true
  to.scrollLeft = from.scrollLeft
  window.requestAnimationFrame(() => { syncing.value = false })
}

watch(() => props.slug, init)
watch(showChanges, syncQuery)
onMounted(init)
</script>

<style scoped>
.compare-page {
  height: 100%;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: var(--fl-bg);
}
.compare-toolbar {
  min-height: 54px;
  flex-shrink: 0;
  background: rgba(255,255,255,.96);
  border-bottom: 1px solid var(--fl-line);
  display: flex;
  align-items: center;
  padding: 0 var(--fl-s-4);
  gap: var(--fl-s-3);
}
.compare-title {
  display: flex;
  flex-direction: column;
  line-height: 1.25;
  min-width: 0;
}
.compare-title strong {
  color: var(--fl-ink);
}
.compare-summary {
  min-height: 62px;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: var(--fl-s-4);
  padding: var(--fl-s-3) var(--fl-s-5);
  border-bottom: 1px solid var(--fl-line);
  background: var(--fl-surface-2);
}
.summary-item {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 84px;
}
.summary-item span {
  color: var(--fl-text-2);
  font-size: var(--fl-fs-2);
}
.summary-item strong {
  color: var(--fl-text);
  font-size: var(--fl-fs-4);
}
.summary-alert {
  flex: 1;
  min-width: 260px;
}
.compare-body {
  flex: 1;
  min-height: 0;
  display: grid;
  grid-template-columns: 1fr;
}
.compare-body.with-changes {
  grid-template-columns: minmax(0, 1fr) 360px;
}
.compare-stage {
  min-width: 0;
  min-height: 0;
  display: flex;
  overflow: hidden;
}
.compare-pane {
  flex: 1 1 0;
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
  background: var(--fl-surface);
}
.pane-bar {
  height: 46px;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: var(--fl-s-2);
  padding: 0 var(--fl-s-3);
  border-bottom: 1px solid var(--fl-line);
  background: var(--fl-surface);
}
.pane-label {
  display: flex;
  align-items: center;
  gap: var(--fl-s-2);
  min-width: 118px;
  color: var(--fl-text-2);
}
.version-picker {
  width: min(320px, 42vw);
}
.system-url-input {
  width: min(520px, 48vw);
}
.pane-meta {
  min-height: 34px;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: var(--fl-s-3);
  padding: 0 var(--fl-s-3);
  border-bottom: 1px solid var(--fl-line);
  color: var(--fl-text-2);
  font-size: var(--fl-fs-2);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.preview-scroll {
  flex: 1;
  min-height: 0;
  overflow: auto;
  background: #E8EEEC;
}
.compare-frame {
  width: 100%;
  min-width: 100%;
  height: 100%;
  border: 0;
  display: block;
  background: var(--fl-surface);
  box-shadow: inset 0 0 0 1px rgba(9,35,34,.05);
}
.compare-divider {
  width: 7px;
  flex-shrink: 0;
  background: #D4DEDB;
  position: relative;
}
.compare-divider::after {
  content: '';
  position: absolute;
  left: 2px;
  top: 50%;
  transform: translateY(-50%);
  width: 2px;
  height: 32px;
  background: var(--fl-text-3);
  border-radius: 2px;
}
.compare-changes {
  min-width: 0;
  min-height: 0;
  overflow-y: auto;
  border-left: 1px solid var(--fl-line);
  background: var(--fl-surface);
  padding: var(--fl-s-4);
}
.changes-head {
  display: flex;
  align-items: flex-start;
  gap: var(--fl-s-3);
  margin-bottom: var(--fl-s-3);
}
.code-sm {
  font-size: var(--fl-fs-2);
}
.panel-alert {
  margin-bottom: var(--fl-s-4);
}
.compact-label {
  margin-top: var(--fl-s-2);
}
.break-all {
  word-break: break-all;
}
@media (max-width: 1200px) {
  .compare-body.with-changes {
    grid-template-columns: 1fr;
    grid-template-rows: minmax(0, 1fr) 280px;
  }
  .compare-changes {
    border-left: 0;
    border-top: 1px solid var(--fl-line);
  }
}
@media (max-width: 900px) {
  .compare-toolbar,
  .compare-summary {
    align-items: flex-start;
    flex-wrap: wrap;
    height: auto;
    padding: var(--fl-s-3);
  }
  .compare-stage {
    flex-direction: column;
  }
  .compare-divider {
    width: auto;
    height: 7px;
  }
  .compare-divider::after {
    left: 50%;
    top: 2px;
    transform: translateX(-50%);
    width: 32px;
    height: 2px;
  }
  .version-picker {
    width: min(420px, 56vw);
  }
  .system-url-input {
    width: min(520px, 68vw);
  }
}
</style>

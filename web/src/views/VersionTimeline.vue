<template>
  <div class="page-pad">
    <a-breadcrumb style="margin-bottom:12px">
      <a-breadcrumb-item><a @click="$router.push('/projects')">项目</a></a-breadcrumb-item>
      <a-breadcrumb-item>{{ project ? project.name : '' }}</a-breadcrumb-item>
    </a-breadcrumb>

    <div style="display:flex;align-items:flex-start;margin-bottom:20px">
      <div>
        <h2 style="margin:0;font-size:20px">{{ project ? project.name : '' }}</h2>
        <div class="mono text-secondary">{{ slug }}</div>
      </div>
      <div style="margin-left:auto;display:flex;gap:8px;align-items:center">
        <a-checkbox v-model:checked="includeVoid" @change="load">显示已废弃</a-checkbox>
        <a-divider type="vertical" />
        <a-button :disabled="versions.length < 2" @click="goCompare()">
          <template #icon><ColumnWidthOutlined /></template>并排对比
        </a-button>
        <a-button :disabled="versions.length < 2" @click="cumOpen = true">
          <template #icon><BarChartOutlined /></template>累计变更
        </a-button>
        <a-button type="primary" @click="newOpen = true">
          <template #icon><PlusOutlined /></template>新建版本
        </a-button>
      </div>
    </div>

    <!-- 「自我上次看过之后有什么新东西」—— 研发进来第一眼想知道的 -->
    <a-alert v-if="newCount > 0" type="success" show-icon style="margin-bottom:16px">
      <template #message>
        自你上次看过 <b class="mono">{{ readState.versionNo }}</b> 之后，新增了
        <b>{{ newCount }}</b> 个版本
        <a style="margin-left:12px" @click="cumOpen = true">看看改了什么</a>
        <a style="margin-left:12px" @click="markReadLatest">标记为已读</a>
      </template>
    </a-alert>

    <div v-if="baseline" class="baseline-banner">
      <div style="flex:1">
        <div style="font-size:12px;color:#0958d9;font-weight:600;letter-spacing:.5px">
          ▎当前基线 · 研发按这版开发
        </div>
        <div class="mono" style="font-size:24px;font-weight:600;margin-top:2px">{{ baseline.versionNo }}</div>
        <div class="text-secondary" style="margin-top:2px">{{ baseline.title }}</div>
      </div>
      <div style="text-align:right">
        <div class="text-secondary" style="font-size:12px">
          {{ baseline.createdBy }} · {{ fmtAbsolute(baseline.baselineAt || baseline.createdAt) }}<br>
          {{ baseline.changeCount }} 条变更 · {{ baseline.requirementCount }} 条需求
        </div>
        <a-space style="margin-top:10px">
          <a-button v-if="canRollback" @click="doRollback">回滚上一版</a-button>
          <a-button type="primary" @click="openWb(baseline.versionNo)">打开工作台 →</a-button>
        </a-space>
      </div>
    </div>

    <a-alert v-else-if="!loading && versions.length > 0" type="warning" show-icon style="margin-bottom:20px"
             message="本项目还没有基线版本"
             description="研发不知道该按哪一版开发。选一个版本点「设为基线」。" />

    <div class="text-secondary" style="margin:0 0 12px 4px;font-size:13px">版本时间线</div>

    <a-spin :spinning="loading">
      <a-empty v-if="!loading && versions.length === 0" description="还没有版本">
        <a-button type="primary" @click="newOpen = true">上传第一版原型</a-button>
      </a-empty>

      <div v-for="v in versions" :key="v.versionNo" class="ver-row"
           :class="{ 'is-baseline': v.isBaseline, 'is-void': v.display.key === 'VOID' }"
           @click="openWb(v.versionNo)">
        <div class="ver-no mono">{{ v.versionNo }}</div>

        <div style="flex:1;min-width:0">
          <div style="font-weight:500;margin-bottom:4px">
            {{ v.title }}
            <a-tag v-if="v.isNew" color="green" style="margin-left:8px">新</a-tag>
            <a-tag v-else-if="v.isLastRead" style="margin-left:8px">上次看到这里</a-tag>
            <a-tag v-if="v.display.key === 'DRAFT'" color="gold" style="margin-left:8px">
              ⚠️ 草稿，勿据此开发
            </a-tag>
            <a-tag v-for="t in v.tags" :key="t" color="purple" style="margin-left:4px">{{ t }}</a-tag>
          </div>
          <div class="text-secondary" style="font-size:12px;display:flex;gap:12px;flex-wrap:wrap">
            <span>{{ v.createdBy }}</span>
            <span>{{ fmtTime(v.createdAt) }}</span>
            <span>📝 {{ v.changeCount }} 条变更</span>
            <span>🔗 {{ v.requirementCount }} 条需求</span>
            <span v-if="v.externalRefs.length" style="color:#faad14">⚡ {{ v.externalRefs.length }} 个外部依赖</span>
          </div>
        </div>

        <a-tag :color="v.display.color">{{ v.display.label }}</a-tag>

        <div style="display:flex;gap:4px" @click.stop>
          <a-button v-if="!v.isBaseline && v.display.key !== 'VOID'" size="small" @click="askBaseline(v)">
            {{ v.display.key === 'HISTORY' ? '回滚为基线' : '设为基线' }}
          </a-button>
          <a-dropdown :trigger="['click']">
            <a-button type="text" size="small"><MoreOutlined /></a-button>
            <template #overlay>
              <a-menu @click="({ key }) => onAction(key, v)">
                <a-menu-item key="open">打开工作台</a-menu-item>
                <a-menu-item key="compare">与基线并排对比</a-menu-item>
                <a-menu-item key="read">标记为已读</a-menu-item>
                <a-menu-item key="download">下载 HTML</a-menu-item>
                <a-menu-divider />
                <a-menu-item v-if="v.display.key === 'VOID'" key="reopen">恢复为编辑中</a-menu-item>
                <a-menu-item v-else key="void" :disabled="v.isBaseline">废弃</a-menu-item>
                <a-menu-item key="remove" danger :disabled="v.isBaseline">删除</a-menu-item>
              </a-menu>
            </template>
          </a-dropdown>
        </div>
      </div>
    </a-spin>

    <NewVersionModal v-model:open="newOpen" :slug="slug" @created="load" />
    <BaselineModal v-model:open="blOpen" :slug="slug" :target="blTarget"
                   :current="baseline ? baseline.versionNo : null"
                   :total-versions="versions.length" @done="load" />
    <CumulativeModal v-model:open="cumOpen" :slug="slug" :versions="versions"
                     :default-to="baseline ? baseline.versionNo : (versions[0] && versions[0].versionNo)" />
  </div>
</template>

<script setup>
import { ref, computed, onMounted, watch } from 'vue'
import { useRouter } from 'vue-router'
import { Modal, message } from 'ant-design-vue'
import { PlusOutlined, MoreOutlined, BarChartOutlined, ColumnWidthOutlined } from '@ant-design/icons-vue'
import NewVersionModal from '../components/NewVersionModal.vue'
import BaselineModal from '../components/BaselineModal.vue'
import CumulativeModal from '../components/CumulativeModal.vue'
import { api } from '../api'
import { fmtTime, fmtAbsolute } from '../utils'

const props = defineProps({ slug: String })
const router = useRouter()

const project = ref(null)
const versions = ref([])
const readState = ref(null)
const loading = ref(false)
const includeVoid = ref(false)
const newOpen = ref(false)
const cumOpen = ref(false)
const blOpen = ref(false)
const blTarget = ref(null)

const baseline = computed(() => versions.value.find((v) => v.isBaseline) || null)
const canRollback = computed(() =>
  versions.value.some((v) => !v.isBaseline && v.baselineAt && v.display.key !== 'VOID'))
const newCount = computed(() => versions.value.filter((v) => v.isNew).length)

async function load() {
  loading.value = true
  try {
    const [p, list, read] = await Promise.all([
      api.getProject(props.slug),
      api.listVersions(props.slug, { includeDraft: true, includeVoid: includeVoid.value }),
      api.getRead(props.slug)
    ])
    project.value = p
    versions.value = list
    readState.value = read && read.versionNo ? read : null
  } finally {
    loading.value = false
  }
}

function goCompare(a, b) {
  const q = new URLSearchParams()
  if (a) q.set('a', a)
  if (b) q.set('b', b)
  router.push(`/projects/${props.slug}/compare${q.toString() ? '?' + q : ''}`)
}

async function markReadLatest() {
  const latest = versions.value[0]
  if (!latest) return
  await api.markRead(props.slug, latest.versionNo)
  message.success(`已标记看到 ${latest.versionNo}`)
  load()
}

const openWb = (no) => router.push(`/projects/${props.slug}/versions/${no}`)

function askBaseline(v) {
  blTarget.value = v
  blOpen.value = true
}

async function doRollback() {
  const v = await api.rollback(props.slug)
  message.success(`已回滚到 ${v.versionNo}`)
  load()
}

function onAction(key, v) {
  if (key === 'open') return openWb(v.versionNo)
  if (key === 'download') return window.open(api.downloadUrl(props.slug, v.versionNo), '_blank')
  if (key === 'compare') {
    const other = baseline.value && baseline.value.versionNo !== v.versionNo
      ? baseline.value.versionNo
      : (versions.value.find((x) => x.versionNo !== v.versionNo) || {}).versionNo
    return goCompare(v.versionNo, other)
  }
  if (key === 'read') {
    return api.markRead(props.slug, v.versionNo).then(() => {
      message.success(`已标记看到 ${v.versionNo}`)
      load()
    })
  }

  if (key === 'reopen') {
    return api.reopenVersion(props.slug, v.versionNo).then(() => { message.success('已恢复为编辑中'); load() })
  }
  if (key === 'void') {
    return Modal.confirm({
      title: `废弃版本 ${v.versionNo}？`,
      content: '废弃后默认不在时间线显示，记录保留，可随时恢复。',
      okText: '废弃', okType: 'danger',
      onOk: async () => { await api.voidVersion(props.slug, v.versionNo); message.success('已废弃'); load() }
    })
  }
  if (key === 'remove') {
    return Modal.confirm({
      title: `删除版本 ${v.versionNo}？`,
      content: '文件会移入 .flowlark/trash，可在回收站恢复。',
      okText: '删除', okType: 'danger',
      onOk: async () => { await api.removeVersion(props.slug, v.versionNo); message.success('已移入回收站'); load() }
    })
  }
}

watch(() => props.slug, load)
onMounted(load)
</script>

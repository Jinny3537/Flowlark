<template>
  <div style="height:100%;display:flex;flex-direction:column;overflow:hidden">
    <div style="height:52px;flex-shrink:0;background:#fff;border-bottom:1px solid #f0f0f0;display:flex;align-items:center;padding:0 16px;gap:12px">
      <a-button type="text" @click="$router.push(`/projects/${slug}`)">
        <template #icon><LeftOutlined /></template>返回
      </a-button>
      <a-divider type="vertical" />
      <strong>并排对比</strong>
      <span class="text-secondary" style="font-size:12px">{{ project ? project.name : '' }}</span>

      <div style="flex:1"></div>

      <a-tooltip title="同步滚动两侧原型">
        <a-checkbox v-model:checked="syncScroll">同步滚动</a-checkbox>
      </a-tooltip>
      <a-button size="small" @click="swap">⇄ 交换</a-button>
      <a-button size="small" type="primary" @click="showChanges = !showChanges">
        {{ showChanges ? '隐藏' : '显示' }}变更清单
      </a-button>
    </div>

    <!-- 变更清单：并排看的是「长什么样」，变更日志答的是「为什么」，两者互补 -->
    <div v-if="showChanges && cumulative" style="flex-shrink:0;max-height:34%;overflow-y:auto;background:#fff;border-bottom:1px solid #f0f0f0;padding:16px 20px">
      <div class="text-secondary" style="font-size:13px;margin-bottom:12px">
        {{ cumulative.fromVersionNo }} → {{ cumulative.toVersionNo }}：
        跨 <b>{{ cumulative.versionCount }}</b> 个版本，共 <b>{{ cumulative.itemCount }}</b> 条变更
      </div>
      <ChangeList :items="cumulative.items" :location-counts="cumulative.locationCounts" show-hot />
    </div>

    <div class="wb" style="flex:1;min-height:0">
      <div class="wb-left" style="width:50%;flex:0 0 50%">
        <div class="cmp-bar">
          <a-select v-model:value="a" size="small" style="width:230px" @change="load">
            <a-select-option v-for="v in versions" :key="v.versionNo" :value="v.versionNo">
              {{ v.versionNo }} — {{ v.title }}
            </a-select-option>
          </a-select>
          <a-tag v-if="verA" :color="verA.display.color" style="margin-left:8px">{{ verA.display.label }}</a-tag>
          <div style="flex:1"></div>
          <span class="text-secondary mono" style="font-size:11px">{{ verA ? fmtSize(verA.fileSize) : '' }}</span>
        </div>
        <iframe ref="frameA" class="wb-frame" :src="srcA"
                sandbox="allow-scripts allow-forms allow-popups allow-modals"
                referrerpolicy="no-referrer"></iframe>
      </div>

      <div class="wb-split" style="cursor:default"></div>

      <div class="wb-left" style="flex:1 1 auto;width:auto">
        <div class="cmp-bar">
          <a-select v-model:value="b" size="small" style="width:230px" @change="load">
            <a-select-option v-for="v in versions" :key="v.versionNo" :value="v.versionNo">
              {{ v.versionNo }} — {{ v.title }}
            </a-select-option>
          </a-select>
          <a-tag v-if="verB" :color="verB.display.color" style="margin-left:8px">{{ verB.display.label }}</a-tag>
          <div style="flex:1"></div>
          <span class="text-secondary mono" style="font-size:11px">{{ verB ? fmtSize(verB.fileSize) : '' }}</span>
        </div>
        <iframe ref="frameB" class="wb-frame" :src="srcB"
                sandbox="allow-scripts allow-forms allow-popups allow-modals"
                referrerpolicy="no-referrer"></iframe>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, watch } from 'vue'
import { useRoute } from 'vue-router'
import { LeftOutlined } from '@ant-design/icons-vue'
import ChangeList from '../components/ChangeList.vue'
import { api } from '../api'
import { useAppStore } from '../store'
import { fmtSize } from '../utils'

const props = defineProps({ slug: String })
const route = useRoute()
const app = useAppStore()

const project = ref(null)
const versions = ref([])
const verA = ref(null)
const verB = ref(null)
const a = ref(route.query.a || null)
const b = ref(route.query.b || null)
const showChanges = ref(true)
const syncScroll = ref(false)
const cumulative = ref(null)
const frameA = ref(null)
const frameB = ref(null)

const srcA = computed(() => (a.value ? app.previewUrl(props.slug, a.value) : ''))
const srcB = computed(() => (b.value ? app.previewUrl(props.slug, b.value) : ''))

async function init() {
  const [p, list] = await Promise.all([api.getProject(props.slug), api.listVersions(props.slug)])
  project.value = p
  versions.value = list
  if (!a.value) a.value = p.baselineVersionNo || (list[0] && list[0].versionNo)
  if (!b.value) b.value = (list.find((v) => v.versionNo !== a.value) || {}).versionNo
  await load()
}

async function load() {
  if (!a.value || !b.value) return
  const [va, vb] = await Promise.all([
    api.getVersion(props.slug, a.value),
    api.getVersion(props.slug, b.value)
  ])
  verA.value = va
  verB.value = vb

  // 变更日志是有方向的：从时间靠前的那版算到靠后的那版
  const ia = versions.value.findIndex((v) => v.versionNo === a.value)
  const ib = versions.value.findIndex((v) => v.versionNo === b.value)
  const [older, newer] = ia > ib ? [a.value, b.value] : [b.value, a.value]
  try {
    cumulative.value = await api.cumulative(props.slug, older, newer)
  } catch {
    cumulative.value = null
  }
}

function swap() {
  const t = a.value
  a.value = b.value
  b.value = t
  load()
}

/**
 * 同步滚动。iframe 是跨源的（这正是沙箱隔离的目的），
 * 所以读不到它内部的滚动位置 —— 只能退而求其次，滚动外层容器。
 * 真正的像素级同步需要往原型里注入脚本，那会破坏隔离，不做。
 */
watch(syncScroll, (on) => {
  if (on) {
    // 提示用户这个限制，而不是让他以为功能坏了
    import('ant-design-vue').then(({ message }) => {
      message.info('原型运行在隔离沙箱里，页面内部滚动无法跨源同步；这里同步的是外层视图')
    })
  }
})

watch(() => props.slug, init)
onMounted(init)
</script>

<style>
.cmp-bar {
  height: 40px; flex-shrink: 0; border-bottom: 1px solid #f0f0f0; background: #fafafa;
  display: flex; align-items: center; padding: 0 12px; gap: 4px;
}
</style>

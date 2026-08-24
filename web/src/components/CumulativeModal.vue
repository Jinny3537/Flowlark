<template>
  <a-modal :visible="open" title="跨版本累计变更" :width="740" :footer="false"
           @update:visible="(v) => $emit('update:open', v)">
    <a-alert type="info" show-icon style="margin:16px 0"
             message="研发上次看的可能是好几版之前。这里把区间内所有变更聚合，并标出被反复修改的区域。" />

    <div style="display:flex;align-items:center;gap:8px;margin-bottom:16px">
      <span class="text-secondary" style="font-size:13px">从</span>
      <a-select v-model="from" style="width:200px" @change="load">
        <a-option v-for="v in candidates" :key="v.versionNo" :value="v.versionNo">
          {{ v.versionNo }} — {{ v.title }}
        </a-option>
      </a-select>
      <span class="text-secondary" style="font-size:13px">到</span>
      <a-select v-model="to" style="width:200px" @change="load">
        <a-option v-for="v in versions" :key="v.versionNo" :value="v.versionNo">
          {{ v.versionNo }}{{ v.isBaseline ? '（当前基线）' : '' }}
        </a-option>
      </a-select>
    </div>

    <a-spin :spinning="loading">
      <div v-if="result" class="text-secondary" style="font-size:13px;margin-bottom:14px">
        跨 <b>{{ result.versionCount }}</b> 个版本，共 <b>{{ result.itemCount }}</b> 条变更
      </div>
      <ChangeList v-if="result" :items="result.items" :location-counts="result.locationCounts" show-hot />
    </a-spin>
  </a-modal>
</template>

<script setup>
import { ref, computed, watch } from 'vue'
import ChangeList from './ChangeList.vue'
import { api } from '../api'

const props = defineProps({
  open: Boolean,
  slug: String,
  versions: { type: Array, default: () => [] },
  defaultTo: String
})
defineEmits(['update:open'])

const from = ref(null)
const to = ref(null)
const result = ref(null)
const loading = ref(false)

const candidates = computed(() => props.versions.filter((v) => v.versionNo !== to.value))

watch(() => props.open, (v) => {
  if (!v) return
  to.value = props.defaultTo || (props.versions[0] && props.versions[0].versionNo)
  // 默认起点取时间线上最早的一版，让研发一次看全
  from.value = props.versions.length > 1 ? props.versions[props.versions.length - 1].versionNo : null
  load()
})

async function load() {
  if (!to.value) return
  loading.value = true
  try {
    result.value = await api.cumulative(props.slug, from.value, to.value)
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <div>
    <a-empty v-if="items.length === 0" description="暂无变更记录" />

    <div v-for="g in groups" :key="g.type" style="margin-bottom:18px">
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:10px">
        <a-tag :color="g.meta.color">{{ g.meta.label }}</a-tag>
        <span class="text-secondary" style="font-size:13px">{{ g.items.length }} 条</span>
      </div>

      <div v-for="(c, i) in g.items" :key="i" class="cl-item">
        <span v-if="c.location" class="cl-loc">{{ c.location }}</span>
        <div style="flex:1;font-size:13.5px">
          {{ c.content }}
          <a v-if="c.requirement" style="font-size:11px;margin-left:6px"
             @click="$emit('open-req', c.requirement)">{{ c.requirement }} ↗</a>

          <div v-if="showHot && hot(c.location) > 2" style="margin-top:6px;font-size:12px;color:#faad14">
            🔥 该区域在所选区间内被修改了 {{ hot(c.location) }} 次，建议重点确认
          </div>
        </div>
        <span v-if="c.fromVersionNo" class="text-secondary mono"
              style="font-size:11px;white-space:nowrap">{{ c.fromVersionNo }}</span>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue'
import { groupChanges } from '../utils'

const props = defineProps({
  items: { type: Array, default: () => [] },
  locationCounts: { type: Object, default: () => ({}) },
  showHot: Boolean
})
defineEmits(['open-req'])

const groups = computed(() => groupChanges(props.items))
const hot = (loc) => props.locationCounts[(loc || '').trim() || '未标注位置'] || 0
</script>

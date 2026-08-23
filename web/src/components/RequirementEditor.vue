<template>
  <div>
    <div v-for="(row, i) in rows" :key="i" style="display:flex;gap:8px;margin-bottom:8px">
      <a-input v-model="row.code" placeholder="REQ-2026-0311" style="width:160px" class="mono" :maxlength="40" />
      <a-input v-model="row.title" placeholder="需求标题（选填）" :maxlength="120" />
      <a-input v-model="row.url" placeholder="https://需求池地址" style="width:230px" />
      <a-button type="text" danger @click="rows.splice(i, 1)"><IconClose /></a-button>
    </div>
    <a-button block type="dashed" @click="add">
      <template #icon><IconPlus /></template>添加关联需求
    </a-button>
  </div>
</template>

<script setup>
import { IconClose, IconPlus } from '@arco-design/web-vue/es/icon/index.js'

const rows = defineModel({ type: Array, default: () => [] })
const add = () => rows.value.push({ code: '', title: '', url: '' })
</script>

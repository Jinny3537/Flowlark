<template>
  <div>
    <div v-for="(row, i) in rows" :key="i" style="display:flex;gap:8px;margin-bottom:8px">
      <a-input v-model:value="row.code" placeholder="REQ-2026-0311" style="width:160px" class="mono" :maxlength="40" />
      <a-input v-model:value="row.title" placeholder="需求标题（选填）" :maxlength="120" />
      <a-input v-model:value="row.url" placeholder="https://需求池地址" style="width:230px" />
      <a-button type="text" danger @click="rows.splice(i, 1)"><CloseOutlined /></a-button>
    </div>
    <a-button block type="dashed" @click="add">
      <template #icon><PlusOutlined /></template>添加关联需求
    </a-button>
  </div>
</template>

<script setup>
import { CloseOutlined, PlusOutlined } from '@ant-design/icons-vue'

const rows = defineModel({ type: Array, default: () => [] })
const add = () => rows.value.push({ code: '', title: '', url: '' })
</script>

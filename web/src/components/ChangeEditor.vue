<template>
  <div>
    <div v-for="(row, i) in rows" :key="i" style="display:flex;gap:8px;margin-bottom:8px">
      <a-select v-model:value="row.type" style="width:92px">
        <a-select-option value="ADD">新增</a-select-option>
        <a-select-option value="MODIFY">修改</a-select-option>
        <a-select-option value="REMOVE">删除</a-select-option>
      </a-select>
      <a-input v-model:value="row.location" placeholder="位置（选填）" style="width:160px" :maxlength="50" />
      <a-input v-model:value="row.content" placeholder="改了什么，一句话说清" :maxlength="200" />
      <a-input v-model:value="row.requirement" placeholder="需求号" style="width:120px" class="mono" :maxlength="40" />
      <a-button type="text" danger @click="rows.splice(i, 1)"><CloseOutlined /></a-button>
    </div>
    <a-button block type="dashed" @click="add">
      <template #icon><PlusOutlined /></template>添加一条变更
    </a-button>
  </div>
</template>

<script setup>
import { CloseOutlined, PlusOutlined } from '@ant-design/icons-vue'

const rows = defineModel({ type: Array, default: () => [] })
const add = () => rows.value.push({ type: 'MODIFY', location: '', content: '', requirement: '' })
</script>

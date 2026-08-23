<template>
  <div>
    <div v-for="(row, i) in rows" :key="i" style="display:flex;gap:8px;margin-bottom:8px">
      <a-select v-model="row.type" style="width:92px">
        <a-option value="ADD">新增</a-option>
        <a-option value="MODIFY">修改</a-option>
        <a-option value="REMOVE">删除</a-option>
      </a-select>
      <a-input v-model="row.location" placeholder="位置（选填）" style="width:160px" :maxlength="50" />
      <a-input v-model="row.content" placeholder="改了什么，一句话说清" :maxlength="200" />
      <a-input v-model="row.requirement" placeholder="需求号" style="width:120px" class="mono" :maxlength="40" />
      <a-button type="text" status="danger" @click="rows.splice(i, 1)"><IconClose /></a-button>
    </div>
    <a-button block type="dashed" @click="add">
      <template #icon><IconPlus /></template>添加一条变更
    </a-button>
  </div>
</template>

<script setup>
import { IconClose, IconPlus } from '@arco-design/web-vue/es/icon/index.js'

const rows = defineModel({ type: Array, default: () => [] })
const add = () => rows.value.push({ type: 'MODIFY', location: '', content: '', requirement: '' })
</script>

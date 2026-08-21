<template>
  <div class="cli-hint">
    <span class="prompt">$</span>
    <span>{{ command }}</span>
    <a-tooltip title="复制">
      <button @click="copy"><CopyOutlined /></button>
    </a-tooltip>
  </div>
</template>

<script setup>
import { message } from 'ant-design-vue'
import { CopyOutlined } from '@ant-design/icons-vue'

// CLI 是这个产品的主入口。网页把等价命令摆在旁边，
// 用户点几次之后自然就学会了终端里怎么做 —— 比写在文档里有效得多。
const props = defineProps({ command: { type: String, required: true } })

function copy() {
  navigator.clipboard.writeText(props.command)
    .then(() => message.success('命令已复制'))
    .catch(() => message.error('复制失败，请手动选中'))
}
</script>

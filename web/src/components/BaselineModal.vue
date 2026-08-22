<template>
  <a-modal :open="open" :confirm-loading="saving" @update:open="(v) => $emit('update:open', v)"
           @ok="submit" :ok-button-props="{ disabled: blocked }" ok-text="确认切换">
    <template #title><WarningOutlined style="color:#faad14" /> 设为当前基线</template>

    <div v-if="target">
      <a-alert v-if="blocked" type="error" show-icon style="margin-bottom:16px"
               message="无法切换：变更日志为空"
               description="设为基线前至少要有 1 条变更说明，否则研发无法判断本版改动。请先到工作台的「变更日志」补充。" />

      <div style="background:#fafafa;border-radius:6px;padding:16px;margin-bottom:16px;display:flex;align-items:center;gap:12px">
        <div style="flex:1;text-align:center">
          <div class="text-secondary" style="font-size:12px">当前基线</div>
          <div class="mono" style="font-size:18px;font-weight:600;margin:4px 0">{{ current || '无' }}</div>
          <a-tag v-if="current">将降为「历史版本」</a-tag>
        </div>
        <ArrowRightOutlined style="color:rgba(0,0,0,.25);font-size:18px" />
        <div style="flex:1;text-align:center">
          <div class="text-secondary" style="font-size:12px">新基线</div>
          <div class="mono" style="font-size:18px;font-weight:600;margin:4px 0;color:#1677ff">{{ target.versionNo }}</div>
          <a-tag color="blue">研发默认看到此版</a-tag>
        </div>
      </div>

      <div style="line-height:2;color:rgba(0,0,0,.65);font-size:13.5px">
        <div>• 切换后打开本项目默认落在 <b>{{ target.versionNo }}</b>。</div>
        <div>• 该版本的原型文件与变更日志将被<b>锁定</b>，规格书仍可编辑。</div>
        <div v-if="current">• 可随时用 <code>flowlark rollback {{ slug }}</code> 退回 {{ current }}。</div>
      </div>

      <div style="margin-top:16px"><CliHint :command="cliFor('baseline', slug, target.versionNo)" /></div>
    </div>
  </a-modal>
</template>

<script setup>
import { ref, computed } from 'vue'
import { message } from 'ant-design-vue'
import { WarningOutlined, ArrowRightOutlined } from '@ant-design/icons-vue'
import CliHint from './CliHint.vue'
import { api } from '../api'
import { cliFor } from '../utils'

const props = defineProps({
  open: Boolean,
  slug: String,
  target: Object,
  current: String,
  totalVersions: { type: Number, default: 0 }
})
const emit = defineEmits(['update:open', 'done'])

const saving = ref(false)

// 与服务端 R6 同一套判断：首版、以及当过基线的版本（回滚）豁免
const blocked = computed(() =>
  !!props.target &&
  props.target.changeCount === 0 &&
  props.totalVersions > 1 &&
  !props.target.baselineAt
)

async function submit() {
  saving.value = true
  try {
    const v = await api.setBaseline(props.slug, props.target.versionNo)
    message.success(`当前基线：${v.versionNo}`)
    emit('update:open', false)
    emit('done', v)
  } catch {
    /* api 层已提示 */
  } finally {
    saving.value = false
  }
}
</script>

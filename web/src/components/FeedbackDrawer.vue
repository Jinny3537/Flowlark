<template>
  <a-drawer :open="open" title="记录原型反馈" placement="right" :width="460"
            @update:open="(value) => emit('update:open', value)">
    <a-alert type="info" show-icon class="feedback-alert">
      <template #message>反馈会保存到当前版本上下文，提交后可在版本信息后查看。</template>
    </a-alert>

    <a-form layout="vertical">
      <a-form-item label="反馈标题" required>
        <a-input v-model:value="form.title" :maxlength="200" placeholder="一句话说明问题" />
      </a-form-item>
      <a-form-item label="问题描述" required>
        <a-textarea v-model:value="form.description" :rows="6" :maxlength="5000" placeholder="说明预期、现象和复现方式" />
      </a-form-item>
      <a-form-item label="区域截图">
        <div class="capture-row">
          <a-button :loading="capturing" @click="capture"><template #icon><CameraOutlined /></template>授权截取当前标签页</a-button>
          <a-tag v-if="screenshotBase64" color="green"><CheckOutlined /> 已截取</a-tag>
          <span v-else class="text-secondary code-sm">可选；拒绝授权不影响提交</span>
        </div>
      </a-form-item>
    </a-form>

    <a-descriptions size="small" :column="1" bordered>
      <a-descriptions-item label="项目">{{ context.project }}</a-descriptions-item>
      <a-descriptions-item label="版本">{{ context.version }}</a-descriptions-item>
      <a-descriptions-item label="需求">{{ (context.requirements || []).join(', ') || '无' }}</a-descriptions-item>
    </a-descriptions>

    <template #footer>
      <div class="drawer-actions">
        <a-button @click="emit('update:open', false)">取消</a-button>
        <a-button type="primary" :loading="saving" @click="submit">保存反馈</a-button>
      </div>
    </template>
  </a-drawer>
</template>

<script setup>
import { reactive, ref, watch } from 'vue'
import { message } from 'ant-design-vue'
import { CameraOutlined, CheckOutlined } from '@ant-design/icons-vue'
import { api } from '../api'

const props = defineProps({ open: Boolean, context: { type: Object, required: true }, captureRect: { type: Object, default: null } })
const emit = defineEmits(['update:open', 'submitted'])
const saving = ref(false)
const capturing = ref(false)
const screenshotBase64 = ref('')
const form = reactive({ title: '', description: '' })

watch(() => props.open, (value) => {
  if (!value) return
  form.title = ''
  form.description = ''
  screenshotBase64.value = ''
})

async function capture() {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia) return message.warning('当前浏览器不支持标签页截图')
  capturing.value = true
  let stream
  try {
    stream = await navigator.mediaDevices.getDisplayMedia({ video: { displaySurface: 'browser' }, audio: false })
    const video = document.createElement('video')
    video.srcObject = stream
    await video.play()
    const rect = props.captureRect
    if (!rect) throw new Error('NO_RECT')
    const scaleX = video.videoWidth / window.innerWidth
    const scaleY = video.videoHeight / window.innerHeight
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(rect.width * scaleX))
    canvas.height = Math.max(1, Math.round(rect.height * scaleY))
    canvas.getContext('2d').drawImage(video, rect.left * scaleX, rect.top * scaleY, rect.width * scaleX, rect.height * scaleY, 0, 0, canvas.width, canvas.height)
    screenshotBase64.value = canvas.toDataURL('image/png').split(',')[1]
  } catch { message.info('未截取截图，仍可继续提交反馈') }
  finally {
    if (stream) stream.getTracks().forEach((track) => track.stop())
    capturing.value = false
  }
}

async function submit() {
  if (!form.title.trim() || !form.description.trim()) return message.warning('请填写反馈标题和问题描述')
  saving.value = true
  try {
    const draft = await api.createFeedbackDraft({ ...props.context, title: form.title.trim(), description: form.description.trim(), screenshotBase64: screenshotBase64.value || undefined })
    message.success('反馈已保存')
    emit('submitted', draft)
    emit('update:open', false)
  } finally { saving.value = false }
}
</script>

<style scoped>
.feedback-alert { margin-bottom:var(--fl-s-4); }
.capture-row { display:flex; align-items:center; gap:var(--fl-s-2); flex-wrap:wrap; }
.drawer-actions { display:flex; justify-content:flex-end; gap:var(--fl-s-2); }
</style>

<template>
  <div v-if="active || anchor" class="annotation-layer" :class="{ active }"
       role="application" tabindex="0" aria-label="原型标注区域"
       @pointerdown="start" @pointermove="move" @pointerup="finish" @pointercancel="cancel" @keydown.esc="cancel">
    <div v-if="box" class="annotation-box" :style="boxStyle">
      <span class="annotation-label">反馈区域</span>
    </div>
    <div v-if="active && !dragging && !box" class="annotation-instruction">拖动框选需要反馈的区域 · Esc 退出</div>
  </div>
</template>

<script setup>
import { computed, ref, watch } from 'vue'

const props = defineProps({
  active: Boolean,
  anchor: { type: Object, default: null }
})
const emit = defineEmits(['select', 'cancel'])
const startPoint = ref(null)
const draft = ref(null)
const dragging = ref(false)

watch(() => props.anchor, (value) => { if (!dragging.value) draft.value = value }, { immediate: true })

const box = computed(() => draft.value || props.anchor)
const boxStyle = computed(() => box.value ? {
  left: `${box.value.x * 100}%`, top: `${box.value.y * 100}%`,
  width: `${box.value.width * 100}%`, height: `${box.value.height * 100}%`
} : {})

function point(event) {
  const rect = event.currentTarget.getBoundingClientRect()
  return {
    x: Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width)),
    y: Math.min(1, Math.max(0, (event.clientY - rect.top) / rect.height))
  }
}

function start(event) {
  if (!props.active || event.button !== 0) return
  event.currentTarget.setPointerCapture(event.pointerId)
  startPoint.value = point(event)
  draft.value = { ...startPoint.value, width: 0, height: 0 }
  dragging.value = true
}

function move(event) {
  if (!dragging.value) return
  const current = point(event)
  draft.value = {
    x: Math.min(startPoint.value.x, current.x),
    y: Math.min(startPoint.value.y, current.y),
    width: Math.abs(current.x - startPoint.value.x),
    height: Math.abs(current.y - startPoint.value.y)
  }
}

function finish() {
  if (!dragging.value) return
  dragging.value = false
  if (!draft.value || draft.value.width < 0.01 || draft.value.height < 0.01) {
    draft.value = null
    return
  }
  emit('select', draft.value)
}

function cancel() {
  dragging.value = false
  draft.value = props.anchor
  emit('cancel')
}
</script>

<style scoped>
.annotation-layer { position:absolute; inset:0; z-index:5; pointer-events:none; }
.annotation-layer.active { pointer-events:auto; cursor:crosshair; background:rgba(16,24,40,.08); }
.annotation-layer:focus-visible { outline:2px solid var(--fl-primary); outline-offset:-2px; }
.annotation-box { position:absolute; border:2px solid var(--fl-primary); background:rgba(14,147,132,.12); box-shadow:0 0 0 9999px rgba(16,24,40,.08); }
.annotation-label { position:absolute; left:-2px; top:-26px; height:24px; padding:0 8px; display:flex; align-items:center; border-radius:var(--fl-r-1); background:var(--fl-primary-deep); color:#fff; font-size:var(--fl-fs-2); white-space:nowrap; }
.annotation-instruction { position:absolute; left:50%; top:16px; transform:translateX(-50%); padding:7px 12px; border-radius:var(--fl-r-2); background:var(--fl-text); color:#fff; font-size:var(--fl-fs-2); box-shadow:var(--fl-shadow-2); }
</style>

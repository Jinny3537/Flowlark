<template>
  <a-tag :color="color" class="status-pill">
    <span v-if="dot" class="status-pill-dot" aria-hidden="true" />
    <slot>{{ label }}</slot>
  </a-tag>
</template>

<script setup>
defineProps({
  label: { type: String, default: '' },
  color: { type: String, default: 'gray' },
  dot: { type: Boolean, default: false }
})
</script>

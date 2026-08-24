<template>
  <section class="flow-page">
    <header class="flow-page-header">
      <div>
        <slot name="breadcrumb" />
        <h1 class="flow-page-title">{{ title }}</h1>
        <p v-if="description" class="flow-page-description">{{ description }}</p>
      </div>
      <div v-if="$slots.actions" class="flow-page-actions">
        <slot name="actions" />
      </div>
    </header>

    <div v-if="$slots.stats" class="flow-stats" aria-label="页面状态摘要">
      <slot name="stats" />
    </div>

    <slot />
  </section>
</template>

<script setup>
defineProps({
  title: { type: String, required: true },
  description: { type: String, default: '' }
})
</script>

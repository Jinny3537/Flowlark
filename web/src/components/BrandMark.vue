<!--
  品牌标记：glide —— 一只滑翔的云雀，下面两道是它掠过的气流。
  对应 slogan「Where prototypes flow」。

  做成组件而不是 <img src="/logo.svg">，是为了让描边能跟随上下文换色：
  彩色渲染用青绿渐变，放在深色块上时传 mono 用纯白。
  内联还省掉一次请求，头部不会有 logo 迟到一帧的闪动。

  渐变 id 带上实例后缀 —— 同一页面出现两个标记时，
  重复的 id 会让后一个引用到前一个的定义，换色就失效了。
-->
<template>
  <svg :width="size" :height="size" viewBox="0 0 128 128" fill="none"
       role="img" :aria-label="`Flowlark${alt ? ' · ' + alt : ''}`">
    <title>Flowlark</title>
    <defs v-if="!mono">
      <linearGradient :id="gid" gradientUnits="userSpaceOnUse" x1="8" y1="120" x2="120" y2="8">
        <stop offset="0" stop-color="#0B5F55" />
        <stop offset="1" stop-color="#2ED3B7" />
      </linearGradient>
    </defs>
    <g transform="translate(2.5,-8.566) scale(1.064)">
      <g fill="none" :stroke="paint" stroke-width="8" stroke-linecap="round">
        <path d="M9 98 C26 98 40 94 52 86" />
        <path d="M14 116 C36 115 55 108 70 96" />
      </g>
      <g transform="translate(1,-10) scale(0.8) translate(12,16)" :fill="paint">
        <path d="M120 40 C110 38 98 39 86 42 C66 46 44 40 22 22 C34 44 50 58 68 64
                 C52 74 38 88 28 106 C50 94 72 78 88 62 C100 54 112 47 120 40 Z" />
      </g>
    </g>
  </svg>
</template>

<script setup>
import { computed, getCurrentInstance } from 'vue'

const props = defineProps({
  size: { type: [Number, String], default: 28 },
  /** 单色模式：不用渐变，整体填这个颜色。放在品牌色底块上时用 #fff */
  mono: { type: String, default: '' },
  alt: { type: String, default: '' }
})

const gid = `fl-glide-${getCurrentInstance().uid}`
const paint = computed(() => props.mono || `url(#${gid})`)
</script>

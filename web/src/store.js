import { defineStore } from 'pinia'
import { api } from './api'

export const useAppStore = defineStore('app', {
  state: () => ({
    repo: '',
    repoName: '',
    previewPort: 7789,
    maxFileBytes: 10 * 1024 * 1024,
    connected: false,
    // 局域网只读模式下为 false，界面据此隐藏写操作 ——
    // 让用户点了按钮再收到 403 是很差的体验
    canWrite: true,
    readonlyReason: null,
    gitPermission: null,
    lan: false,
    requirementUrlTemplate: '',
    defaultTags: [],
    dateStyle: 'relative',
    rules: { requireChangelog: true, lockBaseline: true }
  }),

  getters: {
    /**
     * 原型预览的源。必须与工作台不同源，否则 iframe 里的脚本能读到工作台的一切。
     * 端口由服务端 /api/health 下发，改配置时前端自动跟随，不硬编码。
     */
    previewOrigin(state) {
      return `${window.location.protocol}//${window.location.hostname}:${state.previewPort}`
    }
  },

  actions: {
    async load() {
      try {
        const h = await api.health()
        this.repo = h.repo
        this.repoName = h.repoName
        this.previewPort = h.previewPort
        this.maxFileBytes = h.maxFileBytes
        this.canWrite = h.canWrite !== false
        this.readonlyReason = h.readonlyReason || null
        this.gitPermission = h.gitPermission || null
        this.lan = !!h.lan
        this.requirementUrlTemplate = h.requirementUrlTemplate || ''
        this.defaultTags = h.defaultTags || []
        this.dateStyle = h.dateStyle || 'relative'
        this.rules = h.rules || this.rules
        this.connected = true
      } catch {
        this.connected = false
      }
      return this.connected
    },
    /** 把需求编号套进配置好的模板，省得每次手填完整 URL */
    requirementUrl(code, fallback) {
      if (fallback) return fallback
      if (!this.requirementUrlTemplate) return ''
      return this.requirementUrlTemplate.replace('{code}', encodeURIComponent(code))
    },
    previewUrl(slug, versionNo, { offline = false } = {}) {
      const base = `${this.previewOrigin}/p/${encodeURIComponent(slug)}/${encodeURIComponent(versionNo)}`
      return offline ? `${base}?offline=1` : base
    }
  }
})

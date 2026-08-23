<template>
  <div class="page-pad">
    <div class="page-head">
      <div>
        <h2 class="page-title">项目</h2>
        <div class="text-secondary">共 {{ projects.length }} 个</div>
      </div>
      <div class="page-actions">
        <a-button type="primary" :disabled="!app.canWrite" @click="formOpen = true">
          <template #icon><IconPlus /></template>新建项目
        </a-button>
      </div>
    </div>

    <a-alert v-if="!app.canWrite" type="info" show-icon class="timeline-alert"
             message="当前是只读模式"
             description="你仍然可以浏览项目、打开原型和查看规格；新建、上传、删除等写操作需要有 Git 写权限的成员执行。" />

    <a-spin :spinning="loading">
      <a-empty v-if="!loading && projects.length === 0" description="仓库里还没有项目">
        <a-button type="primary" :disabled="!app.canWrite" @click="formOpen = true">创建第一个项目</a-button>
      </a-empty>

      <a-row :gutter="[16, 16]">
        <a-col v-for="p in projects" :key="p.slug" :xs="24" :sm="12" :lg="8" :xxl="6">
          <a-card hoverable class="fl-card project-card" :class="{ 'has-baseline': p.baselineVersionNo }"
                  @click="$router.push(`/projects/${p.slug}`)">
            <div class="project-card-head">
              <div class="project-mark mono">{{ p.slug.slice(0, 2).toUpperCase() }}</div>
              <div class="spacer">
                <div class="project-title">{{ p.name }}</div>
                <div class="mono text-secondary code-sm">{{ p.slug }}</div>
              </div>
              <a-tag :color="p.baselineVersionNo ? 'green' : 'default'">
                {{ p.baselineVersionNo ? '已定基线' : '待定基线' }}
              </a-tag>
            </div>
            <div class="text-secondary project-desc">
              {{ p.description || '暂无描述' }}
            </div>

            <a-divider class="project-divider" />

            <div class="metric-row">
              <div>
                <div class="mono metric-value" :class="p.baselineVersionNo ? 'is-primary' : 'is-muted'">
                  {{ p.baselineVersionNo || '—' }}
                </div>
                <div class="metric-label">
                  {{ p.baselineVersionNo ? '当前基线' : '暂无基线' }}
                </div>
              </div>
              <div>
                <div class="metric-value">{{ p.versionCount }}</div>
                <div class="metric-label">版本数</div>
              </div>
            </div>

            <div class="text-secondary code-sm stack-md">
              {{ fmtTime(p.updatedAt) }} · {{ p.updatedBy || p.createdBy }}
            </div>
          </a-card>
        </a-col>
      </a-row>
    </a-spin>

    <a-modal v-model:visible="formOpen" title="新建项目" :confirm-loading="saving" @ok="submit">
      <a-form layout="vertical" class="stack-md">
        <a-form-item label="项目名称" required>
          <a-input v-model="form.name" placeholder="例如：订单中心重构" :maxlength="60" />
        </a-form-item>
        <a-form-item label="项目标识" required
                     help="同时是磁盘上的目录名，小写字母、数字、连字符">
          <a-input v-model="form.code" class="mono" placeholder="order-center" :maxlength="40" />
        </a-form-item>
        <a-form-item label="描述">
          <a-textarea v-model="form.description" :rows="3" :maxlength="500" show-count />
        </a-form-item>
      </a-form>
    </a-modal>
  </div>
</template>

<script setup>
import { ref, reactive, onMounted } from 'vue'
import { notify } from '../ui/feedback'
import { IconPlus } from '@arco-design/web-vue/es/icon/index.js'
import { api } from '../api'
import { useAppStore } from '../store'
import { fmtTime } from '../utils'

const app = useAppStore()
const projects = ref([])
const loading = ref(false)
const formOpen = ref(false)
const saving = ref(false)
const form = reactive({ name: '', code: '', description: '' })

async function load() {
  loading.value = true
  try {
    projects.value = await api.listProjects()
  } finally {
    loading.value = false
  }
}

async function submit() {
  if (!form.name.trim()) return notify.warning('请填写项目名称')
  saving.value = true
  try {
    const p = await api.createProject({ ...form })
    notify.success(`项目 ${p.name} 已创建`)
    formOpen.value = false
    Object.assign(form, { name: '', code: '', description: '' })
    load()
  } catch {
    /* api 层已提示 */
  } finally {
    saving.value = false
  }
}

onMounted(load)
</script>

<style scoped>
.project-card {
  cursor: pointer;
  position: relative;
  overflow: hidden;
}
.project-card::before {
  content: '';
  position: absolute;
  inset: 0 auto 0 0;
  width: 3px;
  background: var(--fl-line-strong);
}
.project-card.has-baseline::before { background: var(--fl-primary); }
.project-card-head {
  display: flex;
  align-items: flex-start;
  gap: var(--fl-s-3);
}
.project-mark {
  width: 34px;
  height: 34px;
  flex: 0 0 34px;
  display: grid;
  place-items: center;
  border-radius: var(--fl-r-2);
  background: var(--fl-surface-3);
  color: var(--fl-primary-deep);
  font-size: var(--fl-fs-2);
  font-weight: 750;
}
.project-title {
  font-size: 16px;
  font-weight: 700;
  color: var(--fl-ink);
  line-height: 1.35;
}
.project-desc {
  margin-top: var(--fl-s-2);
  height: 36px;
  overflow: hidden;
  line-height: 1.5;
}
.project-divider { margin: 14px 0; }
</style>

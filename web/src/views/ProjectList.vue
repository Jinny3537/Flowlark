<template>
  <div class="page-pad">
    <div style="display:flex;align-items:flex-start;margin-bottom:20px">
      <div>
        <h2 style="margin:0;font-size:20px">项目</h2>
        <div class="text-secondary">共 {{ projects.length }} 个</div>
      </div>
      <div style="margin-left:auto;display:flex;gap:8px;align-items:center">
        <CliHint :command="cliFor('new')" />
        <a-button type="primary" @click="formOpen = true">
          <template #icon><PlusOutlined /></template>新建项目
        </a-button>
      </div>
    </div>

    <a-spin :spinning="loading">
      <a-empty v-if="!loading && projects.length === 0" description="仓库里还没有项目">
        <a-button type="primary" @click="formOpen = true">创建第一个项目</a-button>
      </a-empty>

      <a-row :gutter="[16, 16]">
        <a-col v-for="p in projects" :key="p.slug" :xs="24" :sm="12" :lg="8" :xxl="6">
          <a-card hoverable style="height:100%" @click="$router.push(`/projects/${p.slug}`)">
            <div style="font-size:16px;font-weight:600">{{ p.name }}</div>
            <div class="mono text-secondary" style="font-size:12px">{{ p.slug }}</div>
            <div class="text-secondary" style="margin-top:8px;height:22px;overflow:hidden">
              {{ p.description || '—' }}
            </div>

            <a-divider style="margin:14px 0" />

            <div style="display:flex;gap:24px">
              <div>
                <div class="mono" style="font-size:20px;font-weight:600"
                     :style="p.baselineVersionNo ? 'color:#0E9384' : 'color:rgba(0,0,0,.25)'">
                  {{ p.baselineVersionNo || '—' }}
                </div>
                <div class="text-secondary" style="font-size:12px">
                  {{ p.baselineVersionNo ? '当前基线' : '暂无基线' }}
                </div>
              </div>
              <div>
                <div style="font-size:20px;font-weight:600">{{ p.versionCount }}</div>
                <div class="text-secondary" style="font-size:12px">版本数</div>
              </div>
            </div>

            <div class="text-secondary" style="font-size:12px;margin-top:12px">
              {{ fmtTime(p.updatedAt) }} · {{ p.updatedBy || p.createdBy }}
            </div>
          </a-card>
        </a-col>
      </a-row>
    </a-spin>

    <a-modal v-model:open="formOpen" title="新建项目" :confirm-loading="saving" @ok="submit">
      <a-form layout="vertical" style="margin-top:16px">
        <a-form-item label="项目名称" required>
          <a-input v-model:value="form.name" placeholder="例如：订单中心重构" :maxlength="60" />
        </a-form-item>
        <a-form-item label="项目标识" required
                     help="同时是磁盘上的目录名，小写字母、数字、连字符">
          <a-input v-model:value="form.code" class="mono" placeholder="order-center" :maxlength="40" />
        </a-form-item>
        <a-form-item label="描述">
          <a-textarea v-model:value="form.description" :rows="3" :maxlength="500" show-count />
        </a-form-item>
      </a-form>
    </a-modal>
  </div>
</template>

<script setup>
import { ref, reactive, onMounted } from 'vue'
import { message } from 'ant-design-vue'
import { PlusOutlined } from '@ant-design/icons-vue'
import CliHint from '../components/CliHint.vue'
import { api } from '../api'
import { fmtTime, cliFor } from '../utils'

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
  if (!form.name.trim()) return message.warning('请填写项目名称')
  saving.value = true
  try {
    const p = await api.createProject({ ...form })
    message.success(`项目 ${p.name} 已创建`)
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

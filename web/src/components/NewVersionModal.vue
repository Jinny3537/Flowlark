<template>
  <a-modal :open="open" title="新建版本" width="720px" :confirm-loading="saving"
           @update:open="(v) => $emit('update:open', v)" @ok="submit" ok-text="创建版本">
    <a-alert type="info" show-icon style="margin:16px 0">
      <template #message>
        新版本不继承上一版的规格书与变更日志，创建后状态为「编辑中」。
        <div style="margin-top:8px"><CliHint :command="cliCommand" /></div>
      </template>
    </a-alert>

    <a-form layout="vertical">
      <a-form-item label="原型文件" required>
        <a-upload-dragger v-if="!file" :before-upload="onPick" :show-upload-list="false" accept=".html,.htm">
          <p style="font-size:28px;margin:8px 0;color:rgba(0,0,0,.25)"><InboxOutlined /></p>
          <p>点击或拖拽 HTML 文件到此处</p>
          <p class="text-secondary" style="font-size:12px">仅支持 .html / .htm，上限 {{ fmtSize(app.maxFileBytes) }}</p>
        </a-upload-dragger>

        <div v-else style="border:1px solid #b7eb8f;background:#f6ffed;border-radius:8px;padding:14px 16px;display:flex;align-items:center;gap:12px">
          <CheckCircleFilled style="color:#52c41a;font-size:18px" />
          <div style="flex:1;min-width:0">
            <div>{{ file.name }}</div>
            <div class="text-secondary" style="font-size:12px">
              {{ fmtSize(file.size) }}
              <span v-if="externalRefs.length" style="color:#faad14">
                · 检测到 {{ externalRefs.length }} 个外部依赖
                <a @click="refsOpen = !refsOpen">{{ refsOpen ? '收起' : '查看' }}</a>
              </span>
              <span v-else> · 无外部依赖</span>
            </div>
          </div>
          <a-button size="small" @click="reset()">重选</a-button>
        </div>

        <a-alert v-if="refsOpen && externalRefs.length" type="warning" style="margin-top:8px">
          <template #message>
            <div style="font-size:12px">断网或代理拦截时以下资源会加载失败，原型样式异常属正常现象：</div>
            <div v-for="r in externalRefs.slice(0, 10)" :key="r" class="mono"
                 style="font-size:11px;color:rgba(0,0,0,.45);word-break:break-all">{{ r }}</div>
          </template>
        </a-alert>
      </a-form-item>

      <a-row :gutter="16">
        <a-col :span="8">
          <a-form-item label="版本号" required help="字母数字与 . _ + -，同项目内唯一">
            <a-input v-model:value="form.versionNo" class="mono" placeholder="v1.0" :maxlength="32" />
          </a-form-item>
        </a-col>
        <a-col :span="16">
          <a-form-item label="版本标题" required>
            <a-input v-model:value="form.title" placeholder="一句话说明本版主题" :maxlength="100" />
          </a-form-item>
        </a-col>
      </a-row>

      <a-form-item label="变更日志" help="建版时可不填；设为基线时至少需要 1 条">
        <ChangeEditor v-model="form.changes" />
      </a-form-item>

      <a-form-item label="关联需求">
        <RequirementEditor v-model="form.requirements" />
      </a-form-item>
    </a-form>
  </a-modal>
</template>

<script setup>
import { ref, reactive, computed, watch } from 'vue'
import { message } from 'ant-design-vue'
import { InboxOutlined, CheckCircleFilled } from '@ant-design/icons-vue'
import ChangeEditor from './ChangeEditor.vue'
import RequirementEditor from './RequirementEditor.vue'
import CliHint from './CliHint.vue'
import { api } from '../api'
import { useAppStore } from '../store'
import { fmtSize, cliFor } from '../utils'

const props = defineProps({ open: Boolean, slug: String })
const emit = defineEmits(['update:open', 'created'])
const app = useAppStore()

const file = ref(null)
const html = ref('')
const externalRefs = ref([])
const refsOpen = ref(false)
const saving = ref(false)
const form = reactive({ versionNo: '', title: '', changes: [], requirements: [] })

const cliCommand = computed(() => cliFor('add', props.slug))

watch(() => props.open, (v) => { if (v) reset(true) })

function reset(all = false) {
  file.value = null
  html.value = ''
  externalRefs.value = []
  refsOpen.value = false
  if (all) Object.assign(form, { versionNo: '', title: '', changes: [], requirements: [] })
}

/** 返回 false 阻止 antd 自动上传：内容随元信息一起走一次 JSON 请求 */
function onPick(f) {
  if (f.size > app.maxFileBytes) {
    message.error(`文件 ${fmtSize(f.size)} 超过上限 ${fmtSize(app.maxFileBytes)}`)
    return false
  }
  file.value = f
  const reader = new FileReader()
  reader.onload = () => {
    html.value = String(reader.result || '')
    // 前端先扫一遍让用户在点「创建」之前就知道有坑；服务端会再扫一次作准
    const re = /(?:src|href)\s*=\s*["'](https?:\/\/[^"'\s]+)["']/gi
    const found = new Set()
    let m
    const head = html.value.slice(0, 512 * 1024)
    while ((m = re.exec(head)) !== null && found.size < 50) found.add(m[1])
    externalRefs.value = [...found]
    if (!form.versionNo) form.versionNo = inferVersionNo(f.name)
    if (!form.title) form.title = f.name.replace(/\.html?$/i, '')
  }
  reader.readAsText(f)
  return false
}

/** 与 CLI 的推断逻辑保持一致：订单中心_v1.4.html → v1.4 */
function inferVersionNo(name) {
  const base = name.replace(/\.html?$/i, '')
  const m = base.match(/v?\d+(?:\.\d+){0,3}/i)
  if (!m) return ''
  return /^v/i.test(m[0]) ? m[0].toLowerCase() : 'v' + m[0]
}

async function submit() {
  if (!html.value) return message.warning('请先选择原型 HTML 文件')
  if (!form.versionNo.trim()) return message.warning('请填写版本号')
  if (!form.title.trim()) return message.warning('请填写版本标题')

  saving.value = true
  try {
    const v = await api.addVersion(props.slug, {
      versionNo: form.versionNo.trim(),
      title: form.title.trim(),
      html: html.value,
      changes: form.changes.filter((c) => c.content && c.content.trim()),
      requirements: form.requirements.filter((r) => r.code && r.code.trim())
    })
    message.success(`版本 ${v.versionNo} 已创建`)
    emit('update:open', false)
    emit('created', v)
  } catch {
    /* api 层已提示 */
  } finally {
    saving.value = false
  }
}
</script>

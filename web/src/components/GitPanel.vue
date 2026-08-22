<template>
  <a-drawer :open="open" title="Git" placement="right" :width="480" @update:open="(v) => $emit('update:open', v)">
    <a-spin :spinning="loading">
      <template v-if="!status.tracked">
        <a-alert type="info" show-icon message="这个仓库还没纳入 Git"
                 description="纳入之后，团队协作、历史追溯、冲突处理都由 Git 承担。" />
        <div style="margin-top:14px"><CliHint command="git init && git add . && git commit -m 'init'" /></div>
      </template>

      <template v-else>
        <a-descriptions :column="1" size="small" bordered>
          <a-descriptions-item label="分支">
            <span class="mono">{{ status.branch || '（游离 HEAD）' }}</span>
          </a-descriptions-item>
          <a-descriptions-item label="工作区">
            <a-tag v-if="conflicts.length" color="red">{{ conflicts.length }} 个冲突</a-tag>
            <a-tag v-else-if="status.clean" color="green">干净</a-tag>
            <a-tag v-else color="orange">{{ status.files.length }} 处未提交</a-tag>
          </a-descriptions-item>
          <a-descriptions-item label="与远端">
            <span v-if="!status.hasRemote" class="text-secondary">未配置远端</span>
            <template v-else>
              <a-tag v-if="status.ahead" color="blue">领先 {{ status.ahead }}</a-tag>
              <a-tag v-if="status.behind" color="purple">落后 {{ status.behind }}</a-tag>
              <span v-if="!status.ahead && !status.behind" class="text-secondary">已同步</span>
            </template>
          </a-descriptions-item>
        </a-descriptions>

        <!-- 冲突优先于一切，先解决再谈同步 -->
        <template v-if="conflicts.length">
          <a-divider>冲突</a-divider>
          <div v-for="con in conflicts" :key="con.path" style="margin-bottom:16px">
            <template v-if="con.assisted && con.choices">
              <a-alert type="warning" show-icon style="margin-bottom:10px">
                <template #message>
                  <b>{{ con.project }}</b> 的基线冲突
                  <div class="text-secondary" style="font-size:12px;margin-top:4px">
                    两边各自把基线指向了不同版本，选一个保留
                  </div>
                </template>
              </a-alert>
              <a-space>
                <a-button @click="resolve(con.project, con.choices.ours)">
                  保留 <b class="mono">{{ con.choices.ours }}</b>
                  <span class="text-secondary">（你这边）</span>
                </a-button>
                <a-button @click="resolve(con.project, con.choices.theirs)">
                  保留 <b class="mono">{{ con.choices.theirs }}</b>
                  <span class="text-secondary">（对方）</span>
                </a-button>
              </a-space>
            </template>
            <template v-else>
              <div class="mono" style="font-size:12.5px">{{ con.path }}</div>
              <div class="text-secondary" style="font-size:12px">
                {{ con.kind }} 冲突，需要用编辑器处理后 git add
              </div>
            </template>
          </div>
        </template>

        <template v-else>
          <a-divider />
          <div v-if="!status.clean" style="margin-bottom:14px">
            <div class="text-secondary" style="font-size:12px;margin-bottom:6px">待提交的改动</div>
            <div v-for="f in status.files.slice(0, 15)" :key="f.path"
                 style="font-size:12px;display:flex;gap:8px">
              <span class="text-secondary" style="width:48px;flex-shrink:0">{{ f.label }}</span>
              <span class="mono" style="word-break:break-all">{{ f.path }}</span>
            </div>
            <div v-if="status.files.length > 15" class="text-secondary" style="font-size:12px">
              …还有 {{ status.files.length - 15 }} 处
            </div>
          </div>

          <a-input v-model:value="message" placeholder="提交说明（留空则自动生成）"
                   style="margin-bottom:10px" @press-enter="sync" />
          <a-button type="primary" block :loading="syncing"
                    :disabled="status.clean && !status.ahead" @click="sync">
            {{ status.hasRemote ? '提交并同步' : '提交到本地' }}
          </a-button>

          <div v-if="steps.length" style="margin-top:16px">
            <div v-for="(s, i) in steps" :key="i" style="font-size:13px;line-height:2">
              <CheckCircleFilled v-if="s.ok" style="color:#52c41a" />
              <CloseCircleFilled v-else style="color:#ff4d4f" />
              <span style="margin-left:6px">{{ s.name }}</span>
              <span class="text-secondary" style="margin-left:8px;font-size:12px">{{ s.detail }}</span>
            </div>
          </div>

          <div style="margin-top:16px"><CliHint command="flowlark sync" /></div>
        </template>
      </template>
    </a-spin>
  </a-drawer>
</template>

<script setup>
import { ref, watch } from 'vue'
import { message as msg } from 'ant-design-vue'
import { CheckCircleFilled, CloseCircleFilled } from '@ant-design/icons-vue'
import CliHint from './CliHint.vue'
import { api } from '../api'

const props = defineProps({ open: Boolean })
const emit = defineEmits(['update:open', 'changed'])

const status = ref({ tracked: false, clean: true, files: [] })
const conflicts = ref([])
const loading = ref(false)
const syncing = ref(false)
const message = ref('')
const steps = ref([])

watch(() => props.open, (v) => { if (v) load() })

async function load() {
  loading.value = true
  steps.value = []
  try {
    const [st, cf] = await Promise.all([api.gitStatus(), api.gitConflicts()])
    status.value = st
    conflicts.value = cf
  } finally {
    loading.value = false
  }
}

async function sync() {
  syncing.value = true
  try {
    const r = await api.gitSync(message.value || undefined)
    steps.value = r.steps
    if (r.conflicted) msg.warning('产生了冲突，需要人工确认')
    else msg.success('已同步')
    message.value = ''
    await load()
    emit('changed')
  } finally {
    syncing.value = false
  }
}

async function resolve(slug, versionNo) {
  await api.gitResolve(slug, versionNo)
  msg.success(`已把 ${slug} 的基线定为 ${versionNo}`)
  await load()
  emit('changed')
}
</script>

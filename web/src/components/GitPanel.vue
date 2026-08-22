<!--
  Git 助手面板。

  这个面板以前的做法是：检测到问题，然后印一行 git 命令让用户自己去终端敲。
  对产品经理来说那等于「出错了，自己想办法」。现在每种处境都对应一个按钮，
  按钮背后是 Flowlark 自己的接口，用户从头到尾不需要知道 git 长什么样。

  实在想交给 AI 助理的，有「复制给 AI 助理」——
  它带的是仓库处境和那几条不知道就一定会做错的约定，不是原型内容。
-->
<template>
  <a-drawer :open="open" title="Git" placement="right" :width="520" @update:open="$emit('update:open', $event)">
    <a-spin :spinning="loading">

      <!-- 体检结论：任何时候进来，先看到「现在是什么状况」 -->
      <div v-if="doctor" class="git-checks">
        <div v-for="(chk, i) in doctor.checks" :key="i" class="git-check">
          <CheckCircleOutlined v-if="chk.level === 'ok'" style="color:#52c41a" />
          <ExclamationCircleOutlined v-else-if="chk.level === 'warn'" style="color:#faad14" />
          <CloseCircleOutlined v-else style="color:#ff4d4f" />
          <div>
            <div>{{ chk.title }}</div>
            <div v-if="chk.detail" class="text-secondary" style="font-size:12px">{{ chk.detail }}</div>
          </div>
        </div>
      </div>

      <!-- ① 还没纳入 Git -->
      <template v-if="stage === 'no-git'">
        <a-alert type="error" show-icon message="系统里没有找到 Git"
          description="macOS 在终端运行 xcode-select --install 即可安装；其他系统见 git-scm.com/downloads。装好后回来刷新这个面板。" />
        <a-button style="margin-top:14px" block @click="load">重新检测</a-button>
      </template>

      <template v-else-if="stage === 'no-repo'">
        <a-alert type="info" show-icon message="这个仓库还没纳入 Git"
          description="纳入之后，团队协作、历史追溯、冲突处理都由 Git 承担。下面一步完成初始化、身份和首次提交。" />
        <a-form layout="vertical" style="margin-top:16px">
          <a-form-item label="你的名字">
            <a-input v-model:value="form.name" placeholder="提交记录上显示的名字" />
          </a-form-item>
          <a-form-item label="你的邮箱">
            <a-input v-model:value="form.email" placeholder="name@example.com" />
          </a-form-item>
          <a-form-item label="远端地址">
            <a-input v-model:value="form.remote" placeholder="可留空，之后在设置里配也行" />
          </a-form-item>
        </a-form>
        <a-button type="primary" block :loading="busy" @click="doInit">纳入 Git 管理</a-button>
      </template>

      <!-- ② 缺提交身份：Git 会直接拒绝提交，先解决它 -->
      <template v-else-if="needIdentity">
        <a-alert type="warning" show-icon message="还没有配置提交身份"
          description="Git 需要知道每次提交是谁做的，没有身份它会拒绝提交。填一次就好。" />
        <a-form layout="vertical" style="margin-top:16px">
          <a-form-item label="你的名字"><a-input v-model:value="form.name" /></a-form-item>
          <a-form-item label="你的邮箱"><a-input v-model:value="form.email" /></a-form-item>
        </a-form>
        <a-button type="primary" block :loading="busy" @click="doIdentity">保存身份</a-button>
      </template>

      <!-- ③ 卡在冲突上 -->
      <template v-else-if="stage === 'conflicted'">
        <a-alert v-if="!conflicts.length" type="success" show-icon
          message="冲突都解决了，还差最后一步"
          description="点下面的按钮，让这次同步走完。" />
        <a-alert v-else type="warning" show-icon
          :message="`${conflicts.length} 个文件需要处理`"
          description="基线冲突可以直接选一边；其余的用编辑器改完，回来点「我改好了」。" />

        <div v-for="con in conflicts" :key="con.path" style="margin:16px 0">
          <template v-if="con.assisted && con.choices">
            <div style="margin-bottom:8px">
              <b>{{ con.project }}</b> 的基线两边指向了不同版本
            </div>
            <a-space>
              <a-button @click="pickBaseline(con.project, con.choices.mine)">
                保留 <b class="mono">{{ con.choices.mine }}</b>
                <span class="text-secondary">（你这边）</span>
              </a-button>
              <a-button @click="pickBaseline(con.project, con.choices.others)">
                保留 <b class="mono">{{ con.choices.others }}</b>
                <span class="text-secondary">（对方）</span>
              </a-button>
            </a-space>
          </template>
          <template v-else>
            <div class="mono" style="font-size:12.5px">{{ con.path }}</div>
            <div class="text-secondary" style="font-size:12px;margin-bottom:6px">
              {{ con.kind }} 冲突，用编辑器打开，把不要的那一半连同分隔标记删掉
            </div>
            <a-button size="small" :loading="busy" @click="markResolved(con.path)">我改好了</a-button>
          </template>
        </div>

        <a-divider />
        <a-space direction="vertical" style="width:100%">
          <a-button type="primary" block :disabled="conflicts.length > 0" :loading="busy" @click="doContinue">
            继续完成同步
          </a-button>
          <a-button block @click="copyBrief('conflict')">复制给 AI 助理</a-button>
          <a-popconfirm title="回到同步之前的状态？本地已提交的内容不会丢。" ok-text="放弃" cancel-text="再想想" @confirm="doAbort">
            <a-button block danger type="text">放弃这次同步</a-button>
          </a-popconfirm>
        </a-space>
      </template>

      <!-- ④ 正常状态：提交与同步 -->
      <template v-else>
        <a-divider />

        <div v-if="!status.clean" style="margin-bottom:14px">
          <div class="text-secondary" style="font-size:12px;margin-bottom:6px">待提交的改动</div>
          <div v-for="f in status.files.slice(0, 15)" :key="f.path" style="font-size:12px;display:flex;gap:8px">
            <span class="text-secondary" style="width:48px;flex-shrink:0">{{ f.label }}</span>
            <span class="mono" style="word-break:break-all">{{ f.path }}</span>
          </div>
          <div v-if="status.files.length > 15" class="text-secondary" style="font-size:12px">
            …还有 {{ status.files.length - 15 }} 处
          </div>
        </div>

        <div v-if="status.foreignFiles && status.foreignFiles.length" style="margin-bottom:14px">
          <div class="text-secondary" style="font-size:12px">
            另有 {{ status.foreignFiles.length }} 个文件不归 Flowlark 管，不会被提交
          </div>
        </div>

        <a-input v-model:value="message" placeholder="提交说明（留空则自动生成）" style="margin-bottom:8px" @press-enter="doSync" />
        <a-button size="small" type="link" style="padding:0;margin-bottom:10px" :disabled="status.clean" @click="fillSuggestion">
          帮我写一条
        </a-button>

        <a-button type="primary" block :loading="busy" :disabled="status.clean && !status.ahead && !status.behind" @click="doSync">
          {{ syncLabel }}
        </a-button>

        <div v-if="steps.length" style="margin-top:16px">
          <div v-for="(s, i) in steps" :key="i" style="font-size:13px;line-height:2">
            <CheckCircleOutlined v-if="s.ok" style="color:#52c41a" />
            <CloseCircleOutlined v-else style="color:#ff4d4f" />
            <span style="margin-left:6px">{{ s.name }}</span>
            <span class="text-secondary" style="margin-left:8px;font-size:12px">{{ s.detail }}</span>
          </div>
        </div>

        <a-divider />
        <a-button block @click="copyBrief('commit')">复制给 AI 助理</a-button>
        <div class="text-secondary" style="font-size:12px;margin-top:8px;line-height:1.7">
          复制的是仓库处境和几条容易踩错的约定，粘给 Claude Code、Cursor 之类的助理即可。
          不含任何原型内容。
        </div>
      </template>

    </a-spin>
  </a-drawer>
</template>

<script setup>
import { ref, computed, watch } from 'vue'
import { message as msg } from 'ant-design-vue'
import {
  CheckCircleOutlined, CloseCircleOutlined, ExclamationCircleOutlined
} from '@ant-design/icons-vue'
import { api } from '../api'

const props = defineProps({ open: Boolean })
const emit = defineEmits(['update:open', 'changed'])

const doctor = ref(null)
const status = ref({ tracked: false, clean: true, files: [] })
const conflicts = ref([])
const loading = ref(false)
const busy = ref(false)
const message = ref('')
const steps = ref([])
const form = ref({ name: '', email: '', remote: '' })

const stage = computed(() => (doctor.value ? doctor.value.stage : null))
const needIdentity = computed(() =>
  !!doctor.value && stage.value !== 'no-repo' && stage.value !== 'no-git' &&
  !!doctor.value.identity && !doctor.value.identity.complete)

const syncLabel = computed(() => {
  if (!status.value.hasRemote) return '提交到本地'
  if (status.value.clean && status.value.behind) return '拉取更新'
  if (status.value.clean && status.value.ahead) return '推送到远端'
  return '提交并同步'
})

watch(() => props.open, (v) => { if (v) load() })

async function load() {
  loading.value = true
  steps.value = []
  try {
    doctor.value = await api.gitDoctor()
    if (doctor.value.stage !== 'no-git' && doctor.value.stage !== 'no-repo') {
      const [st, cf] = await Promise.all([api.gitStatus(), api.gitConflicts()])
      status.value = st
      conflicts.value = cf
      if (doctor.value.identity) {
        form.value.name = form.value.name || doctor.value.identity.name
        form.value.email = form.value.email || doctor.value.identity.email
      }
    } else {
      conflicts.value = []
    }
  } finally {
    loading.value = false
  }
}

async function guard(fn, okMsg) {
  busy.value = true
  try {
    const r = await fn()
    if (okMsg) msg.success(typeof okMsg === 'function' ? okMsg(r) : okMsg)
    await load()
    emit('changed')
    return r
  } finally {
    busy.value = false
  }
}

const doInit = () => guard(async () => {
  const r = await api.gitInit({
    name: form.value.name, email: form.value.email, remote: form.value.remote
  })
  steps.value = r.steps
  return r
}, (r) => (r.needIdentity ? '仓库已建立，还差提交身份' : '已纳入 Git 管理'))

const doIdentity = () => guard(
  () => api.gitSetIdentity({ name: form.value.name, email: form.value.email }),
  '身份已保存')

const pickBaseline = (slug, versionNo) => guard(
  () => api.gitResolve(slug, versionNo), `已把 ${slug} 的基线定为 ${versionNo}`)

const markResolved = (path) => guard(() => api.gitMarkResolved([path]), '已标记为解决')

const doContinue = () => guard(async () => {
  const r = await api.gitContinue()
  if (r.conflicts && r.conflicts.length) msg.warning(r.message)
  else msg.success(r.message)
  return r
})

const doAbort = () => guard(() => api.gitAbort(), '已回到同步之前的状态')

const doSync = () => guard(async () => {
  const r = await api.gitSync(message.value || undefined)
  steps.value = r.steps
  if (r.conflicted) msg.warning('产生了冲突，下面可以逐个处理')
  else msg.success('已同步')
  message.value = ''
  return r
})

async function fillSuggestion() {
  const r = await api.gitSuggestMessage()
  if (r.message) message.value = r.message
  else msg.info('没有待提交的改动')
}

async function copyBrief(intent) {
  const r = await api.gitBrief(intent)
  try {
    await navigator.clipboard.writeText(r.text)
    msg.success('已复制，粘给你的 AI 助理即可')
  } catch {
    // 局域网访问走的是 http，部分浏览器在非安全上下文里禁用剪贴板
    msg.error('浏览器不允许复制，请手动选中下面的文本')
    // eslint-disable-next-line no-console
    console.log(r.text)
  }
}
</script>

<style scoped>
.git-checks { margin-bottom: 4px; }
.git-check {
  display: flex; gap: 10px; align-items: flex-start;
  padding: 7px 0; font-size: 13px; line-height: 1.5;
}
</style>

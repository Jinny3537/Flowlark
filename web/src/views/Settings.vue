<template>
  <div class="page-pad">
    <h2 style="margin:0 0 4px;font-size:20px">设置</h2>
    <div class="text-secondary" style="margin-bottom:20px">
      配置存在仓库根目录的 <span class="mono">flowlark.json</span> 里，随 Git 一起提交，团队共用同一份。
    </div>

    <a-alert v-for="p in problems" :key="p" type="warning" show-icon :message="p" style="margin-bottom:12px" />

    <a-alert v-if="!app.canWrite" type="info" show-icon style="margin-bottom:16px"
             message="只读模式" description="这是别人共享出来的视图，设置项不可修改。" />

    <a-spin :spinning="loading">
      <!-- 局域网分享单独提到最上面：它是最需要「看一眼就知道怎么用」的功能 -->
      <a-card title="局域网分享" style="margin-bottom:16px">
        <template #extra>
          <a-switch :checked="lanOn" :disabled="!app.canWrite" :loading="lanBusy"
                    @change="toggleLan" checked-children="开" un-checked-children="关" />
        </template>

        <template v-if="lanOn">
          <div v-if="lanInfo && lanInfo.addresses.length">
            <div class="text-secondary" style="font-size:13px;margin-bottom:10px">
              把下面的地址发给同事，他们在同一网段就能直接打开看原型：
            </div>
            <div v-for="a in lanInfo.addresses" :key="a.address" class="lan-addr">
              <span class="mono">http://{{ a.address }}:{{ lanInfo.port }}</span>
              <span class="text-secondary" style="font-size:12px">{{ a.iface }}</span>
              <a-button size="small" type="text" @click="copy(`http://${a.address}:${lanInfo.port}`)">
                <CopyOutlined />
              </a-button>
            </div>
          </div>
          <a-empty v-else description="没有检测到局域网地址，可能没连网络" :image="simpleImage" />

          <a-divider style="margin:16px 0" />

          <div style="display:flex;align-items:flex-start;gap:12px">
            <a-switch :checked="readonlyOn" :disabled="!app.canWrite"
                      @change="(v) => save('server.readonlyFromLan', v)" />
            <div style="flex:1">
              <div style="font-weight:500">局域网只读</div>
              <div class="text-secondary" style="font-size:12.5px;line-height:1.8">
                开启时局域网来的请求只能查看，写操作仅限运行 Flowlark 的这台机器。
                <span v-if="!readonlyOn" style="color:#ff4d4f">
                  当前已关闭 —— 同网段任何人都能删版本、改基线。
                </span>
              </div>
            </div>
          </div>
        </template>

        <template v-else>
          <div class="text-secondary" style="font-size:13px;line-height:1.9">
            当前只监听 127.0.0.1，别人访问不到。<br>
            开启后同网段的同事可以直接打开工作台看原型，默认只读。
          </div>
        </template>

        <a-alert v-if="restartNeeded" type="warning" show-icon style="margin-top:14px"
                 message="改动需要重启服务才生效"
                 description="在运行 Flowlark 的终端按 Ctrl+C 后重新执行 flowlark serve" />
      </a-card>

      <!-- Git 远端 -->
      <a-card title="Git 远端" style="margin-bottom:16px">
        <div class="text-secondary" style="font-size:13px;margin-bottom:12px">
          配置后 <span class="mono">flowlark sync</span> 或工作台的同步按钮就能把原型、规格书、附件推给团队。
        </div>
        <a-input-group compact>
          <a-input v-model:value="remoteUrl" style="width:calc(100% - 160px)"
                   placeholder="git@github.com:team/prototypes.git" :disabled="!app.canWrite" />
          <a-button type="primary" :disabled="!app.canWrite || !remoteUrl.trim()" @click="saveRemote">
            保存
          </a-button>
          <a-button danger :disabled="!app.canWrite || !currentRemote" @click="clearRemote">移除</a-button>
        </a-input-group>
        <div v-if="currentRemote" class="text-secondary" style="font-size:12px;margin-top:8px">
          当前：<span class="mono">{{ currentRemote.url }}</span>
        </div>
      </a-card>

      <!-- 其余分组 -->
      <a-card v-for="g in groups" :key="g.key" :title="g.label" style="margin-bottom:16px">
        <div v-for="item in g.items" :key="item.key" class="cfg-row">
          <div style="flex:1;min-width:0">
            <div style="font-weight:500">
              {{ item.label }}
              <a-tag v-if="item.danger" color="red" style="margin-left:6px">高风险</a-tag>
              <a-tag v-if="!item.isDefault" color="blue" style="margin-left:6px">已修改</a-tag>
            </div>
            <div v-if="item.note" class="text-secondary" style="font-size:12.5px;line-height:1.8">
              {{ item.note }}
            </div>
            <div class="mono text-secondary" style="font-size:11px;margin-top:2px">{{ item.key }}</div>
          </div>

          <div class="cfg-control">
            <a-switch v-if="item.type === 'bool'" :checked="item.value" :disabled="!app.canWrite"
                      @change="(v) => confirmSave(item, v)" />

            <a-select v-else-if="item.enum" :value="item.value" style="width:150px" :disabled="!app.canWrite"
                      @change="(v) => save(item.key, v)">
              <a-select-option v-for="o in item.enum" :key="o" :value="o">{{ o }}</a-select-option>
            </a-select>

            <a-input-number v-else-if="item.type === 'port' || item.type === 'int'"
                            :value="item.value" style="width:130px" :disabled="!app.canWrite"
                            :min="1" :max="65535" @change="(v) => save(item.key, v)" />

            <a-input v-else-if="item.type === 'bytes'" :value="bytesText(item.value)" style="width:130px"
                     :disabled="!app.canWrite" placeholder="10MB"
                     @blur="(e) => save(item.key, e.target.value)" />

            <a-select v-else-if="item.type === 'list'" :value="item.value" mode="tags" style="width:230px"
                      :disabled="!app.canWrite" placeholder="回车添加"
                      @change="(v) => save(item.key, v.join(','))" />

            <a-input v-else :value="item.value" style="width:230px" :disabled="!app.canWrite"
                     :placeholder="String(item.default || '')"
                     @blur="(e) => save(item.key, e.target.value)" />

            <a-tooltip title="恢复默认值">
              <a-button v-if="!item.isDefault && app.canWrite" type="text" size="small"
                        @click="reset(item.key)"><UndoOutlined /></a-button>
            </a-tooltip>
          </div>
        </div>
      </a-card>

      <div class="text-secondary" style="font-size:12px;margin-bottom:24px">
        也可以用命令行改：<span class="mono">flowlark config &lt;配置项&gt; &lt;值&gt;</span>
        <div style="margin-top:8px"><CliHint command="flowlark config" /></div>
      </div>
    </a-spin>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import { Modal, message, Empty } from 'ant-design-vue'
import { CopyOutlined, UndoOutlined } from '@ant-design/icons-vue'
import CliHint from '../components/CliHint.vue'
import { api } from '../api'
import { useAppStore } from '../store'

const app = useAppStore()
const simpleImage = Empty.PRESENTED_IMAGE_SIMPLE

const items = ref([])
const problems = ref([])
const loading = ref(false)
const restartNeeded = ref(false)
const lanInfo = ref(null)
const lanBusy = ref(false)
const currentRemote = ref(null)
const remoteUrl = ref('')

const GROUP_LABELS = { server: '服务与网络', git: 'Git 与身份', rules: '业务规则', ui: '外观与默认值' }

const byKey = (k) => items.value.find((i) => i.key === k)
const lanOn = computed(() => { const i = byKey('server.lan'); return i ? i.value : false })
const readonlyOn = computed(() => { const i = byKey('server.readonlyFromLan'); return i ? i.value : true })

// 局域网两项已经在上面的卡片里单独呈现了，分组列表里不重复
const HOISTED = new Set(['server.lan', 'server.readonlyFromLan', 'git.remote'])

const groups = computed(() =>
  Object.entries(GROUP_LABELS)
    .map(([key, label]) => ({
      key,
      label,
      items: items.value.filter((i) => i.group === key && !HOISTED.has(i.key))
    }))
    .filter((g) => g.items.length)
)

async function load() {
  loading.value = true
  try {
    const [cfg, lan, remote] = await Promise.all([
      api.getConfig(),
      api.lan().catch(() => null),
      api.getRemote().catch(() => null)
    ])
    items.value = cfg.items
    problems.value = cfg.problems
    lanInfo.value = lan
    currentRemote.value = remote
    remoteUrl.value = remote ? remote.url : ''
  } finally {
    loading.value = false
  }
}

function bytesText(n) {
  if (n >= 1024 ** 3) return `${(n / 1024 ** 3).toFixed(1)}GB`
  if (n >= 1024 ** 2) return `${Math.round(n / 1024 ** 2)}MB`
  if (n >= 1024) return `${Math.round(n / 1024)}KB`
  return `${n}B`
}

async function save(key, value) {
  try {
    const r = await api.setConfig(key, value)
    if (r.needsRestart) restartNeeded.value = true
    for (const p of r.problems || []) message.warning(p)
    for (const s of r.sideEffects || []) message.info(s)
    await load()
    await app.load()
  } catch {
    await load() // 失败时回到服务端的真实状态，不留下假的界面值
  }
}

/** 高风险开关关掉之前先说清楚后果，而不是让人事后才发现规则失效了 */
function confirmSave(item, value) {
  if (item.danger && value === false) {
    return Modal.confirm({
      title: `确定关闭「${item.label}」？`,
      content: item.note,
      okText: '确定关闭',
      okType: 'danger',
      onOk: () => save(item.key, value)
    })
  }
  save(item.key, value)
}

async function toggleLan(value) {
  lanBusy.value = true
  try {
    await save('server.lan', value)
    lanInfo.value = await api.lan()
  } finally {
    lanBusy.value = false
  }
}

async function reset(key) {
  await api.resetConfig(key)
  await load()
}

async function saveRemote() {
  await api.setRemote(remoteUrl.value.trim())
  message.success('远端已保存')
  await load()
}

async function clearRemote() {
  await api.removeRemote()
  message.success('远端已移除')
  await load()
}

function copy(text) {
  navigator.clipboard.writeText(text)
    .then(() => message.success('已复制'))
    .catch(() => message.error('复制失败，请手动选中'))
}

onMounted(load)
</script>

<style>
.cfg-row {
  display: flex; align-items: flex-start; gap: 20px;
  padding: 14px 0; border-bottom: 1px solid #fafafa;
}
.cfg-row:last-child { border-bottom: none; }
.cfg-control { display: flex; align-items: center; gap: 6px; flex-shrink: 0; }
.lan-addr {
  display: flex; align-items: center; gap: 10px; padding: 8px 12px;
  background: #fafafa; border-radius: 6px; margin-bottom: 8px;
}
</style>

<template>
  <div class="page-pad entity-page">
    <div class="entity-header">
      <div class="entity-title">
        <h2>需求</h2>
        <p class="text-secondary">接入需求池数据，并追踪本地原型版本演进</p>
      </div>
      <div class="entity-actions">
        <a-button :loading="syncing" :disabled="!app.canWrite" @click="syncPool"><template #icon><IconRefresh /></template>同步需求池</a-button>
        <a-button :disabled="!app.canWrite" @click="externalOpen = true"><template #icon><IconCloudDownload /></template>需求池导入</a-button>
        <a-button type="primary" :disabled="!app.canWrite" @click="open = true"><template #icon><IconPlus /></template>新建需求</a-button>
      </div>
    </div>

    <div class="entity-summary">
      <div><strong>{{ items.length }}</strong><span>需求总数</span></div>
      <div><strong>{{ poolCount }}</strong><span>来自需求池</span></div>
      <div><strong>{{ linkedCount }}</strong><span>已关联版本</span></div>
    </div>

    <div class="entity-filters">
      <a-input-search v-model="query" placeholder="搜索编号、标题、项目或模块" allow-clear />
      <a-select v-model="projectFilter" allow-clear placeholder="全部项目">
        <a-option v-for="name in projectOptions" :key="name" :value="name">{{ name }}</a-option>
      </a-select>
      <a-select v-model="sourceFilter" allow-clear placeholder="全部来源">
        <a-option value="pool">需求池</a-option>
        <a-option value="local">本地</a-option>
      </a-select>
      <a-select v-model="status" allow-clear placeholder="全部本地状态">
        <a-option v-for="(label,key) in labels" :key="key" :value="key">{{ label }}</a-option>
      </a-select>
    </div>

    <a-table :data="filtered" :columns="columns" row-key="code" :loading="loading" size="middle" :custom-row="rowProps" :scroll="{ x: 980 }">
      <template #bodyCell="{ column, record }">
        <template v-if="column.key === 'requirement'"><div class="entity-name"><span class="mono">{{ record.code }}</span><strong>{{ record.title }}</strong><span class="text-secondary">{{ record.description || '暂无描述' }}</span></div></template>
        <template v-else-if="column.key === 'scope'"><div class="scope-cell"><strong>{{ record.project || '未分项目' }}</strong><span class="text-secondary">{{ record.module || '未分模块' }}</span></div></template>
        <template v-else-if="column.key === 'classify'"><a-space size="small" wrap><a-tag v-if="record.type">{{ record.type }}</a-tag><a-tag v-if="record.priority" color="gold">{{ record.priority }}</a-tag><span v-if="!record.type && !record.priority" class="text-secondary">—</span></a-space></template>
        <template v-else-if="column.key === 'status'"><a-tag :color="colors[record.derivedStatus]">{{ labels[record.derivedStatus] }}</a-tag><span v-if="record.manualStatus" class="text-secondary code-sm">手动</span></template>
        <template v-else-if="column.key === 'pool'"><a-tag :color="record.external ? 'blue' : 'default'">{{ record.external ? '需求池' : '本地' }}</a-tag><span v-if="record.external?.status" class="text-secondary code-sm">{{ record.external.status }}</span></template>
        <template v-else-if="column.key === 'versions'">{{ record.versions.length }} 个版本 · {{ projectCount(record) }} 个项目</template>
      </template>
    </a-table>

    <a-modal v-model:visible="open" title="新建需求" :width="760" @ok="create" :confirm-loading="saving">
      <a-form layout="vertical">
        <a-row :gutter="12">
          <a-col :span="8"><a-form-item label="需求编号" required><a-input v-model="form.code" class="mono" placeholder="REQ-0275" /></a-form-item></a-col>
          <a-col :span="16"><a-form-item label="标题" required><a-input v-model="form.title" placeholder="一句话描述业务目标" /></a-form-item></a-col>
        </a-row>
        <a-row :gutter="12">
          <a-col :span="8"><a-form-item label="所属项目"><a-input v-model="form.project" placeholder="订单中心" /></a-form-item></a-col>
          <a-col :span="8"><a-form-item label="业务模块"><a-input v-model="form.module" placeholder="订单列表" /></a-form-item></a-col>
          <a-col :span="8"><a-form-item label="负责人"><a-input v-model="form.owner" placeholder="PM / 研发负责人" /></a-form-item></a-col>
        </a-row>
        <a-row :gutter="12">
          <a-col :span="8"><a-form-item label="需求类型"><a-select v-model="form.type" allow-clear placeholder="选择类型"><a-option value="功能">功能</a-option><a-option value="优化">优化</a-option><a-option value="缺陷">缺陷</a-option><a-option value="合规">合规</a-option></a-select></a-form-item></a-col>
          <a-col :span="8"><a-form-item label="优先级"><a-select v-model="form.priority" allow-clear placeholder="选择优先级"><a-option value="P0">P0</a-option><a-option value="P1">P1</a-option><a-option value="P2">P2</a-option><a-option value="P3">P3</a-option></a-select></a-form-item></a-col>
          <a-col :span="8"><a-form-item label="外部链接"><a-input v-model="form.url" placeholder="https://..." /></a-form-item></a-col>
        </a-row>
        <a-form-item label="描述"><a-textarea v-model="form.description" :rows="4" placeholder="补充背景、验收边界或关键约束" /></a-form-item>
      </a-form>
    </a-modal>

    <a-modal v-model:visible="externalOpen" title="从需求池导入" :width="720" :footer="false">
      <a-form layout="vertical">
        <a-row :gutter="12">
          <a-col :span="8"><a-form-item label="接入方式"><a-select v-model="external.provider"><a-option value="mcp">MCP</a-option></a-select></a-form-item></a-col>
          <a-col :span="16"><a-form-item label="Token（可选，保存到钥匙串）"><a-input-password v-model="external.token" placeholder="留空则使用环境变量或已保存密钥" /></a-form-item></a-col>
        </a-row>
        <a-input-search v-model="external.query" placeholder="搜索需求编号或标题" enter-button="搜索" :loading="externalLoading" @search="searchExternal" />
        <a-space class="external-actions">
          <a-button :disabled="!external.token" @click="saveExternalToken">保存 Token</a-button>
          <a-button @click="$router.push('/settings')">打开集成配置</a-button>
        </a-space>
      </a-form>
      <a-list :data="externalResults" :loading="externalLoading" bordered class="external-list">
        <template #renderItem="{ item }">
          <a-list-item>
            <a-list-item-meta>
              <template #title><span class="mono">{{ item.code }}</span> · {{ item.title }}</template>
              <template #description>{{ item.project || '未分项目' }} · {{ item.module || '未分模块' }} · {{ item.status || '无状态' }} · {{ item.owner || '未分配' }}</template>
            </a-list-item-meta>
            <a-button size="small" type="primary" :loading="importingCode === item.code" @click="importExternal(item.code)">导入</a-button>
          </a-list-item>
        </template>
      </a-list>
    </a-modal>
  </div>
</template>
<script setup>
import { computed, onMounted, reactive, ref } from 'vue'
import { useRouter } from 'vue-router'
import { notify } from '../ui/feedback'
import { IconCloudDownload, IconPlus, IconRefresh } from '@arco-design/web-vue/es/icon/index.js'
import { api } from '../api'
import { useAppStore } from '../store'
const app=useAppStore(), router=useRouter(), items=ref([]), loading=ref(false), saving=ref(false), syncing=ref(false), open=ref(false), query=ref(''), status=ref(), projectFilter=ref(), sourceFilter=ref()
const form=reactive({code:'',title:'',description:'',project:'',module:'',type:undefined,priority:undefined,owner:'',url:''})
const externalOpen=ref(false), externalLoading=ref(false), externalResults=ref([]), importingCode=ref('')
const external=reactive({provider:'mcp',query:'',token:''})
const labels={not_started:'未开始',designing:'设计中',finalized:'已定稿',delivered:'已交付'}
const colors={not_started:'default',designing:'gold',finalized:'cyan',delivered:'green'}
const columns=[{title:'需求',key:'requirement',width:360},{title:'项目 / 模块',key:'scope',width:170},{title:'类型 / 优先级',key:'classify',width:140},{title:'本地状态',key:'status',width:150},{title:'来源',key:'pool',width:150},{title:'关联范围',key:'versions',width:180},{title:'负责人',dataIndex:'owner',width:130}]
const poolCount=computed(()=>items.value.filter(item=>item.external).length)
const linkedCount=computed(()=>items.value.filter(item=>item.versions.length).length)
const projectOptions=computed(()=>[...new Set(items.value.map(item=>item.project).filter(Boolean))].sort())
const filtered=computed(()=>items.value.filter(item=>{
  const haystack=`${item.code} ${item.title} ${item.project||''} ${item.module||''}`.toLowerCase()
  return (!status.value||item.derivedStatus===status.value)
    &&(!projectFilter.value||item.project===projectFilter.value)
    &&(!sourceFilter.value||(sourceFilter.value==='pool'?!!item.external:!item.external))
    &&(!query.value||haystack.includes(query.value.toLowerCase()))
}))
const projectCount=(item)=>new Set(item.versions.map(v=>v.project)).size
const rowProps=(record)=>({class:'clickable-row',onClick:()=>router.push(`/requirements/${encodeURIComponent(record.code)}`)})
async function load(){loading.value=true;try{items.value=await api.listRequirements()}finally{loading.value=false}}
async function create(){if(!form.code.trim()||!form.title.trim())return notify.warning('请填写需求编号和标题');saving.value=true;try{const item=await api.createRequirement(form);open.value=false;router.push(`/requirements/${encodeURIComponent(item.code)}`)}finally{saving.value=false}}
async function saveExternalToken(){await api.setRequirementToken(external.provider,external.token);external.token='';notify.success('Token 已保存到钥匙串')}
async function searchExternal(){if(!external.query.trim())return notify.warning('请输入搜索关键词');externalLoading.value=true;try{externalResults.value=await api.searchExternalRequirements(external.provider,external.query,{token:external.token})}finally{externalLoading.value=false}}
async function importExternal(code){importingCode.value=code;try{const item=await api.importExternalRequirement(external.provider,code,{token:external.token});notify.success(`已导入 ${item.code}`);externalOpen.value=false;await load();router.push(`/requirements/${encodeURIComponent(item.code)}`)}finally{importingCode.value=''}}
async function syncPool(){syncing.value=true;try{const result=await api.syncRequirements(external.provider,{token:external.token});items.value=result.items;const failText=result.failed.length?`，失败 ${result.failed.length} 条`:'';notify.success(`已同步 ${result.updated}/${result.total} 条${failText}`)}finally{syncing.value=false}}
onMounted(load)
</script>
<style scoped>
.entity-header{display:flex;align-items:flex-start;gap:var(--fl-s-4);margin-bottom:var(--fl-s-4)}.entity-title{flex:1;min-width:0}.entity-header h2{margin:0 0 var(--fl-s-1);font-size:var(--fl-fs-5)}.entity-header p{margin:0}.entity-actions{display:flex;justify-content:flex-end;align-items:flex-start;gap:var(--fl-s-2);flex-wrap:wrap}.entity-summary{display:grid;grid-template-columns:repeat(3,minmax(120px,1fr));gap:var(--fl-s-3);margin-bottom:var(--fl-s-4)}.entity-summary>div{background:var(--fl-surface);border:1px solid var(--fl-line);border-radius:var(--fl-r-3);padding:var(--fl-s-3) var(--fl-s-4);box-shadow:var(--fl-shadow-1)}.entity-summary strong{display:block;font-size:var(--fl-fs-5);line-height:1.2;color:var(--fl-ink)}.entity-summary span{font-size:var(--fl-fs-2);color:var(--fl-text-2)}.entity-filters{display:grid;grid-template-columns:minmax(260px,1fr) 180px 150px 180px;gap:var(--fl-s-3);margin-bottom:var(--fl-s-4)}.entity-name{display:grid;grid-template-columns:110px 1fr;gap:2px var(--fl-s-3)}.entity-name .text-secondary{grid-column:2;font-size:var(--fl-fs-2);line-height:1.5}.scope-cell{display:flex;flex-direction:column;gap:2px}.scope-cell strong{font-weight:600}.external-actions{margin:var(--fl-s-3) 0}.external-list{margin-top:var(--fl-s-3)}:deep(.clickable-row){cursor:pointer}:deep(.clickable-row:hover td){background:var(--fl-primary-bg)!important}@media(max-width:1024px){.entity-filters{grid-template-columns:1fr 1fr}.entity-summary{grid-template-columns:repeat(3,1fr)}}@media(max-width:768px){.entity-header{display:block}.entity-actions{justify-content:flex-start;margin-top:var(--fl-s-3)}.entity-filters,.entity-summary{grid-template-columns:1fr}.entity-name{grid-template-columns:1fr}.entity-name .text-secondary{grid-column:1}}
</style>

<template>
  <div class="page-pad entity-page">
    <div class="entity-header">
      <div><h2>需求</h2><p class="text-secondary">跨项目查看同一需求的原型演进</p></div>
      <a-space>
        <a-button :disabled="!app.canWrite" @click="externalOpen = true"><template #icon><CloudDownloadOutlined /></template>外部导入</a-button>
        <a-button type="primary" :disabled="!app.canWrite" @click="open = true"><template #icon><PlusOutlined /></template>新建需求</a-button>
      </a-space>
    </div>
    <div class="entity-filters"><a-input-search v-model:value="query" placeholder="搜索需求编号或标题" allow-clear /><a-select v-model:value="status" allow-clear placeholder="全部状态"><a-select-option v-for="(label,key) in labels" :key="key" :value="key">{{ label }}</a-select-option></a-select></div>
    <a-table :data-source="filtered" :columns="columns" row-key="code" :loading="loading" size="middle" :custom-row="rowProps" :scroll="{ x: 720 }">
      <template #bodyCell="{ column, record }">
        <template v-if="column.key === 'requirement'"><div class="entity-name"><span class="mono">{{ record.code }}</span><strong>{{ record.title }}</strong><span class="text-secondary">{{ record.description || '暂无描述' }}</span></div></template>
        <template v-else-if="column.key === 'status'"><a-tag :color="colors[record.derivedStatus]">{{ labels[record.derivedStatus] }}</a-tag><span v-if="record.manualStatus" class="text-secondary code-sm">手动</span></template>
        <template v-else-if="column.key === 'versions'">{{ record.versions.length }} 个版本 · {{ projectCount(record) }} 个项目</template>
      </template>
    </a-table>
    <a-modal v-model:open="open" title="新建需求" @ok="create" :confirm-loading="saving"><a-form layout="vertical"><a-form-item label="需求编号" required><a-input v-model:value="form.code" class="mono" placeholder="REQ-0275" /></a-form-item><a-form-item label="标题" required><a-input v-model:value="form.title" /></a-form-item><a-form-item label="描述"><a-textarea v-model:value="form.description" :rows="4" /></a-form-item><a-form-item label="负责人"><a-input v-model:value="form.owner" /></a-form-item></a-form></a-modal>
    <a-modal v-model:open="externalOpen" title="从需求平台导入" width="720px" :footer="null">
      <a-form layout="vertical">
        <a-row :gutter="12">
          <a-col :span="8"><a-form-item label="平台"><a-select v-model:value="external.provider"><a-select-option value="hubpool">Hubpool</a-select-option><a-select-option value="custom">自建任务平台</a-select-option></a-select></a-form-item></a-col>
          <a-col :span="16"><a-form-item label="Token（可选，保存到钥匙串）"><a-input-password v-model:value="external.token" placeholder="留空则使用环境变量或已保存密钥" /></a-form-item></a-col>
        </a-row>
        <a-input-search v-model:value="external.query" placeholder="搜索需求编号或标题" enter-button="搜索" :loading="externalLoading" @search="searchExternal" />
        <a-space class="external-actions">
          <a-button :disabled="!external.token" @click="saveExternalToken">保存 Token</a-button>
          <a-button @click="$router.push('/settings')">打开集成配置</a-button>
        </a-space>
      </a-form>
      <a-list :data-source="externalResults" :loading="externalLoading" bordered class="external-list">
        <template #renderItem="{ item }">
          <a-list-item>
            <a-list-item-meta>
              <template #title><span class="mono">{{ item.code }}</span> · {{ item.title }}</template>
              <template #description>{{ item.status || '无状态' }} · {{ item.owner || '未分配' }}</template>
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
import { message } from 'ant-design-vue'
import { CloudDownloadOutlined, PlusOutlined } from '@ant-design/icons-vue'
import { api } from '../api'
import { useAppStore } from '../store'
const app=useAppStore(), router=useRouter(), items=ref([]), loading=ref(false), saving=ref(false), open=ref(false), query=ref(''), status=ref()
const form=reactive({code:'',title:'',description:'',owner:''})
const externalOpen=ref(false), externalLoading=ref(false), externalResults=ref([]), importingCode=ref('')
const external=reactive({provider:'hubpool',query:'',token:''})
const labels={not_started:'未开始',designing:'设计中',finalized:'已定稿',delivered:'已交付'}
const colors={not_started:'default',designing:'gold',finalized:'cyan',delivered:'green'}
const columns=[{title:'需求',key:'requirement'},{title:'状态',key:'status',width:150},{title:'关联范围',key:'versions',width:200},{title:'负责人',dataIndex:'owner',width:140}]
const filtered=computed(()=>items.value.filter(item=>(!status.value||item.derivedStatus===status.value)&&(!query.value||`${item.code} ${item.title}`.toLowerCase().includes(query.value.toLowerCase()))))
const projectCount=(item)=>new Set(item.versions.map(v=>v.project)).size
const rowProps=(record)=>({class:'clickable-row',onClick:()=>router.push(`/requirements/${encodeURIComponent(record.code)}`)})
async function load(){loading.value=true;try{items.value=await api.listRequirements()}finally{loading.value=false}}
async function create(){if(!form.code.trim()||!form.title.trim())return message.warning('请填写需求编号和标题');saving.value=true;try{const item=await api.createRequirement(form);open.value=false;router.push(`/requirements/${encodeURIComponent(item.code)}`)}finally{saving.value=false}}
async function saveExternalToken(){await api.setRequirementToken(external.provider,external.token);external.token='';message.success('Token 已保存到钥匙串')}
async function searchExternal(){if(!external.query.trim())return message.warning('请输入搜索关键词');externalLoading.value=true;try{externalResults.value=await api.searchExternalRequirements(external.provider,external.query,{token:external.token})}finally{externalLoading.value=false}}
async function importExternal(code){importingCode.value=code;try{const item=await api.importExternalRequirement(external.provider,code,{token:external.token});message.success(`已导入 ${item.code}`);externalOpen.value=false;await load();router.push(`/requirements/${encodeURIComponent(item.code)}`)}finally{importingCode.value=''}}
onMounted(load)
</script>
<style scoped>
.entity-header{display:flex;align-items:center;gap:16px;margin-bottom:20px}.entity-header>div{flex:1}.entity-header h2{margin:0 0 4px;font-size:var(--fl-fs-5)}.entity-header p{margin:0}.entity-filters{display:grid;grid-template-columns:minmax(240px,1fr) 180px;gap:12px;margin-bottom:16px}.entity-name{display:grid;grid-template-columns:110px 1fr;gap:2px 12px}.entity-name .text-secondary{grid-column:2;font-size:var(--fl-fs-2)}.external-actions{margin:12px 0}.external-list{margin-top:12px}:deep(.clickable-row){cursor:pointer}:deep(.clickable-row:hover td){background:var(--fl-primary-bg)!important}@media(max-width:768px){.entity-header{display:block}.entity-header .ant-space{margin-top:12px}.entity-filters{grid-template-columns:1fr}.entity-name{grid-template-columns:1fr}.entity-name .text-secondary{grid-column:1}}
</style>

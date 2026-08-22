<template>
  <div class="page-pad entity-page">
    <div class="entity-header"><div><h2>需求</h2><p class="text-secondary">跨项目查看同一需求的原型演进</p></div><a-button type="primary" :disabled="!app.canWrite" @click="open = true"><template #icon><PlusOutlined /></template>新建需求</a-button></div>
    <div class="entity-filters"><a-input-search v-model:value="query" placeholder="搜索需求编号或标题" allow-clear /><a-select v-model:value="status" allow-clear placeholder="全部状态"><a-select-option v-for="(label,key) in labels" :key="key" :value="key">{{ label }}</a-select-option></a-select></div>
    <a-table :data-source="filtered" :columns="columns" row-key="code" :loading="loading" size="middle" :custom-row="rowProps" :scroll="{ x: 720 }">
      <template #bodyCell="{ column, record }">
        <template v-if="column.key === 'requirement'"><div class="entity-name"><span class="mono">{{ record.code }}</span><strong>{{ record.title }}</strong><span class="text-secondary">{{ record.description || '暂无描述' }}</span></div></template>
        <template v-else-if="column.key === 'status'"><a-tag :color="colors[record.derivedStatus]">{{ labels[record.derivedStatus] }}</a-tag><span v-if="record.manualStatus" class="text-secondary code-sm">手动</span></template>
        <template v-else-if="column.key === 'versions'">{{ record.versions.length }} 个版本 · {{ projectCount(record) }} 个项目</template>
      </template>
    </a-table>
    <a-modal v-model:open="open" title="新建需求" @ok="create" :confirm-loading="saving"><a-form layout="vertical"><a-form-item label="需求编号" required><a-input v-model:value="form.code" class="mono" placeholder="REQ-0275" /></a-form-item><a-form-item label="标题" required><a-input v-model:value="form.title" /></a-form-item><a-form-item label="描述"><a-textarea v-model:value="form.description" :rows="4" /></a-form-item><a-form-item label="负责人"><a-input v-model:value="form.owner" /></a-form-item></a-form></a-modal>
  </div>
</template>
<script setup>
import { computed, onMounted, reactive, ref } from 'vue'
import { useRouter } from 'vue-router'
import { message } from 'ant-design-vue'
import { PlusOutlined } from '@ant-design/icons-vue'
import { api } from '../api'
import { useAppStore } from '../store'
const app=useAppStore(), router=useRouter(), items=ref([]), loading=ref(false), saving=ref(false), open=ref(false), query=ref(''), status=ref()
const form=reactive({code:'',title:'',description:'',owner:''})
const labels={not_started:'未开始',designing:'设计中',finalized:'已定稿',delivered:'已交付'}
const colors={not_started:'default',designing:'gold',finalized:'cyan',delivered:'green'}
const columns=[{title:'需求',key:'requirement'},{title:'状态',key:'status',width:150},{title:'关联范围',key:'versions',width:200},{title:'负责人',dataIndex:'owner',width:140}]
const filtered=computed(()=>items.value.filter(item=>(!status.value||item.derivedStatus===status.value)&&(!query.value||`${item.code} ${item.title}`.toLowerCase().includes(query.value.toLowerCase()))))
const projectCount=(item)=>new Set(item.versions.map(v=>v.project)).size
const rowProps=(record)=>({class:'clickable-row',onClick:()=>router.push(`/requirements/${encodeURIComponent(record.code)}`)})
async function load(){loading.value=true;try{items.value=await api.listRequirements()}finally{loading.value=false}}
async function create(){if(!form.code.trim()||!form.title.trim())return message.warning('请填写需求编号和标题');saving.value=true;try{const item=await api.createRequirement(form);open.value=false;router.push(`/requirements/${encodeURIComponent(item.code)}`)}finally{saving.value=false}}
onMounted(load)
</script>
<style scoped>
.entity-header{display:flex;align-items:center;gap:16px;margin-bottom:20px}.entity-header>div{flex:1}.entity-header h2{margin:0 0 4px;font-size:var(--fl-fs-5)}.entity-header p{margin:0}.entity-filters{display:grid;grid-template-columns:minmax(240px,1fr) 180px;gap:12px;margin-bottom:16px}.entity-name{display:grid;grid-template-columns:110px 1fr;gap:2px 12px}.entity-name .text-secondary{grid-column:2;font-size:var(--fl-fs-2)}:deep(.clickable-row){cursor:pointer}:deep(.clickable-row:hover td){background:var(--fl-primary-bg)!important}@media(max-width:768px){.entity-filters{grid-template-columns:1fr}.entity-name{grid-template-columns:1fr}.entity-name .text-secondary{grid-column:1}}
</style>

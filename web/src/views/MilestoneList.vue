<template>
  <div class="page-pad entity-page"><div class="entity-header"><div><h2>迭代</h2><p class="text-secondary">按交付周期组织需求与明确版本</p></div><a-button type="primary" :disabled="!app.canWrite" @click="open=true"><template #icon><PlusOutlined /></template>新建迭代</a-button></div>
    <a-table :data-source="items" :columns="columns" row-key="name" :loading="loading" :custom-row="rowProps" :scroll="{ x: 680 }"><template #bodyCell="{column,record}"><template v-if="column.key==='name'"><div><strong>{{ record.title }}</strong><div class="mono text-secondary">{{ record.name }}</div></div></template><template v-else-if="column.key==='status'"><a-tag :color="record.ready?'green':'gold'">{{ record.ready?'可交付':`${record.warnings.length} 项风险` }}</a-tag></template></template></a-table>
    <a-modal v-model:open="open" title="新建迭代" @ok="create" :confirm-loading="saving"><a-form layout="vertical"><a-form-item label="迭代标识" required><a-input v-model:value="form.name" class="mono" placeholder="2026-S12" /></a-form-item><a-form-item label="标题"><a-input v-model:value="form.title" /></a-form-item><a-row :gutter="12"><a-col :span="12"><a-form-item label="开始日期"><a-input v-model:value="form.startAt" type="date" /></a-form-item></a-col><a-col :span="12"><a-form-item label="结束日期"><a-input v-model:value="form.endAt" type="date" /></a-form-item></a-col></a-row></a-form></a-modal>
  </div>
</template>
<script setup>
import { onMounted, reactive, ref } from 'vue';import { useRouter } from 'vue-router';import { message } from 'ant-design-vue';import { PlusOutlined } from '@ant-design/icons-vue';import { api } from '../api';import { useAppStore } from '../store'
const app=useAppStore(),router=useRouter(),items=ref([]),loading=ref(false),saving=ref(false),open=ref(false),form=reactive({name:'',title:'',startAt:'',endAt:''})
const columns=[{title:'迭代',key:'name'},{title:'周期',customRender:({record})=>`${record.startAt||'—'} → ${record.endAt||'—'}`,width:240},{title:'版本数',customRender:({record})=>record.items.length,width:100},{title:'状态',key:'status',width:140}]
const rowProps=(record)=>({class:'clickable-row',onClick:()=>router.push(`/milestones/${encodeURIComponent(record.name)}`)})
async function load(){loading.value=true;try{items.value=await api.listMilestones()}finally{loading.value=false}}
async function create(){if(!form.name.trim())return message.warning('请填写迭代标识');saving.value=true;try{const item=await api.createMilestone({...form,items:[]});open.value=false;router.push(`/milestones/${encodeURIComponent(item.name)}`)}finally{saving.value=false}}
onMounted(load)
</script>
<style scoped>.entity-header{display:flex;align-items:center;gap:16px;margin-bottom:20px}.entity-header>div{flex:1}.entity-header h2{margin:0 0 4px;font-size:var(--fl-fs-5)}.entity-header p{margin:0}:deep(.clickable-row){cursor:pointer}:deep(.clickable-row:hover td){background:var(--fl-primary-bg)!important}</style>

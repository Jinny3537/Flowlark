<template>
  <div class="page-pad detail-page" v-if="item">
    <a-breadcrumb><a-breadcrumb-item><a @click="$router.push('/requirements')">需求</a></a-breadcrumb-item><a-breadcrumb-item>{{ item.code }}</a-breadcrumb-item></a-breadcrumb>
    <div class="detail-header"><div><div class="mono text-secondary">{{ item.code }}</div><h2>{{ item.title }}</h2><p>{{ item.description || '暂无描述' }}</p></div><a-space><a-button :disabled="!app.canWrite" @click="startEdit"><template #icon><EditOutlined /></template>编辑</a-button><a-button :loading="exporting" :disabled="!app.canWrite" @click="exportPackage"><template #icon><ExportOutlined /></template>导出需求包</a-button></a-space></div>
    <a-descriptions bordered size="small" :column="3"><a-descriptions-item label="状态"><a-tag color="cyan">{{ labels[item.derivedStatus] }}</a-tag></a-descriptions-item><a-descriptions-item label="负责人">{{ item.owner || '—' }}</a-descriptions-item><a-descriptions-item label="关联版本">{{ item.versions.length }}</a-descriptions-item></a-descriptions>
    <h3>跨项目版本演进</h3><a-table :data-source="item.versions" :columns="columns" row-key="versionNo" size="middle" :pagination="false" :scroll="{ x: 760 }"><template #bodyCell="{column,record}"><template v-if="column.key==='version'"><a @click="$router.push(`/projects/${record.project}/versions/${record.versionNo}`)">{{ record.versionNo }} · {{ record.title }}</a></template><template v-else-if="column.key==='baseline'"><a-tag :color="record.isBaseline?'green':'default'">{{ record.isBaseline?'当前基线':'非基线' }}</a-tag></template></template></a-table>
    <a-empty class="feedback-empty" description="反馈由已配置的 Issue 平台按 Flowlark 标签实时查询" />
    <a-modal v-model:open="editOpen" title="编辑需求" @ok="save" :confirm-loading="saving"><a-form layout="vertical"><a-form-item label="标题" required><a-input v-model:value="form.title" /></a-form-item><a-form-item label="描述"><a-textarea v-model:value="form.description" :rows="5" /></a-form-item><a-form-item label="负责人"><a-input v-model:value="form.owner" /></a-form-item></a-form></a-modal>
  </div>
</template>
<script setup>
import { onMounted, reactive, ref, watch } from 'vue'
import { message } from 'ant-design-vue'
import { EditOutlined, ExportOutlined } from '@ant-design/icons-vue'
import { api } from '../api'; import { useAppStore } from '../store'
const props=defineProps({code:String}),app=useAppStore(),item=ref(null),editOpen=ref(false),saving=ref(false),exporting=ref(false),form=reactive({title:'',description:'',owner:''})
const labels={not_started:'未开始',designing:'设计中',finalized:'已定稿',delivered:'已交付'}
const columns=[{title:'项目',dataIndex:'project',width:160},{title:'版本',key:'version'},{title:'基线',key:'baseline',width:120},{title:'创建时间',dataIndex:'createdAt',width:190}]
async function load(){item.value=await api.getRequirement(props.code)}
function startEdit(){Object.assign(form,{title:item.value.title,description:item.value.description,owner:item.value.owner});editOpen.value=true}
async function save(){saving.value=true;try{item.value=await api.updateRequirement(props.code,form);editOpen.value=false;message.success('需求已更新')}finally{saving.value=false}}
async function exportPackage(){exporting.value=true;try{const result=await api.exportRequirement(props.code);message.success(`已导出到 ${result.outputDir}`)}finally{exporting.value=false}}
watch(()=>props.code,load);onMounted(load)
</script>
<style scoped>
.detail-header{display:flex;align-items:flex-start;gap:16px;margin:20px 0}.detail-header>div{flex:1}.detail-header h2{margin:2px 0 6px;font-size:var(--fl-fs-5)}.detail-header p{margin:0;color:var(--fl-text-2)}.detail-page h3{margin:24px 0 12px;font-size:15px}.feedback-empty{margin-top:20px}@media(max-width:768px){.detail-header{flex-direction:column}.detail-header .ant-space{width:100%}}
</style>

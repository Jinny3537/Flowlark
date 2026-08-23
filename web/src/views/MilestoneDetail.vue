<template>
  <div class="page-pad detail-page" v-if="item"><a-breadcrumb><a-breadcrumb-item><a @click="$router.push('/milestones')">迭代</a></a-breadcrumb-item><a-breadcrumb-item>{{ item.name }}</a-breadcrumb-item></a-breadcrumb>
    <div class="detail-header"><div><div class="mono text-secondary">{{ item.name }}</div><h2>{{ item.title }}</h2><p>{{ item.startAt||'未设开始' }} → {{ item.endAt||'未设结束' }}</p><p v-if="item.external" class="text-secondary">任务平台：{{ item.external.status || '已关联' }}<span v-if="item.external.syncedAt"> · {{ fmtTime(item.external.syncedAt) }}</span></p></div><div class="page-actions"><a-button :disabled="!app.canWrite" @click="addOpen=true"><template #icon><IconPlus /></template>添加版本</a-button><a-button :disabled="!app.canWrite" :loading="syncing" @click="syncExternal"><template #icon><IconRefresh /></template>同步到任务平台</a-button><a-button :disabled="!app.canWrite" :loading="exporting" @click="exportPackage"><template #icon><IconExport /></template>导出迭代包</a-button></div></div>
    <a-alert v-if="item.warnings.length" type="warning" show-icon class="stack-md"><template #message><strong>{{ item.warnings.length }} 项交付风险</strong><div v-for="warning in item.warnings" :key="`${warning.code}-${warning.project}-${warning.version}`">{{ warning.message }}</div></template></a-alert>
    <a-table :data="item.items" row-key="requirement" :pagination="false" :scroll="{ x: 760 }">
      <template #columns>
        <a-table-column title="需求" data-index="requirement" :width="170" />
        <a-table-column title="项目" data-index="project" :width="150" />
        <a-table-column title="版本">
          <template #cell="{ record }"><a @click="$router.push(`/projects/${record.project}/versions/${record.version}`)">{{ record.version }} · {{ record.versionTitle }}</a></template>
        </a-table-column>
        <a-table-column title="基线" :width="140">
          <template #cell="{ record }"><a-tag :color="record.currentBaseline===record.version?'green':'gold'">{{ record.currentBaseline===record.version?'当前基线':'基线已变化' }}</a-tag></template>
        </a-table-column>
        <a-table-column title="" :width="80">
          <template #cell="{ record }"><a-button type="text" status="danger" :disabled="!app.canWrite" @click.stop="removeItem(record)">移除</a-button></template>
        </a-table-column>
      </template>
    </a-table>
    <a-modal v-model:visible="addOpen" title="添加需求版本" @ok="addItem"><a-form layout="vertical"><a-form-item label="需求" required><a-select v-model="draft.requirement" show-search><a-option v-for="req in requirements" :key="req.code" :value="req.code">{{ req.code }} · {{ req.title }}</a-option></a-select></a-form-item><a-form-item label="项目" required><a-select v-model="draft.project" @change="loadVersions"><a-option v-for="project in projects" :key="project.slug" :value="project.slug">{{ project.name }}</a-option></a-select></a-form-item><a-form-item label="版本" required><a-select v-model="draft.version"><a-option v-for="version in versions" :key="version.versionNo" :value="version.versionNo">{{ version.versionNo }} · {{ version.title }}</a-option></a-select></a-form-item></a-form></a-modal>
  </div>
</template>
<script setup>
import { onMounted, reactive, ref, watch } from 'vue';import { notify } from '../ui/feedback';import { IconPlus,IconExport,IconRefresh } from '@arco-design/web-vue/es/icon/index.js';import { api } from '../api';import { useAppStore } from '../store';import { fmtTime } from '../utils'
const props=defineProps({name:String}),app=useAppStore(),item=ref(null),addOpen=ref(false),exporting=ref(false),syncing=ref(false),requirements=ref([]),projects=ref([]),versions=ref([]),draft=reactive({requirement:null,project:null,version:null})
async function load(){item.value=await api.getMilestone(props.name);[requirements.value,projects.value]=await Promise.all([api.listRequirements(),api.listProjects()])}
async function loadVersions(project){versions.value=await api.listVersions(project);draft.version=null}
async function addItem(){if(!draft.requirement||!draft.project||!draft.version)return notify.warning('请选择需求、项目和版本');item.value=await api.updateMilestone(props.name,{items:[...item.value.items.map(({requirement,project,version})=>({requirement,project,version})),{...draft}]});addOpen.value=false}
async function removeItem(record){item.value=await api.updateMilestone(props.name,{items:item.value.items.filter(row=>row!==record).map(({requirement,project,version})=>({requirement,project,version}))})}
async function exportPackage(){exporting.value=true;try{const result=await api.exportMilestone(props.name);notify.success(`已导出到 ${result.outputDir}`)}finally{exporting.value=false}}
async function syncExternal(){syncing.value=true;try{item.value=await api.syncMilestone(props.name);notify.success('已同步到任务平台')}finally{syncing.value=false}}
watch(()=>props.name,load);onMounted(load)
</script>

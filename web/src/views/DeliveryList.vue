<template>
  <div class="page-pad delivery-page"><div class="delivery-head"><div><h2>交付</h2><p class="text-secondary">冻结评审材料、导出静态包并追踪团队通知</p></div><a-space><a-button @click="notifyOpen=true"><template #icon><IconNotification /></template>通知</a-button><a-button type="primary" :disabled="!app.canWrite" @click="createOpen=true"><template #icon><IconPlus /></template>创建快照</a-button></a-space></div>
    <a-alert v-if="pending.length" type="warning" show-icon class="stack-md"><template #message>{{ pending.length }} 条通知待重试 <a-button type="link" size="small" @click="flush">立即重试</a-button></template></a-alert>
    <a-list :data="snapshots" bordered :loading="loading"><template #renderItem="{item}"><a-list-item class="delivery-row" @click="$router.push(`/deliveries/${item.name}`)"><a-list-item-meta :title="item.title"><template #description><span class="mono">{{ item.name }}</span> · {{ item.items.length }} 个版本 · {{ item.createdBy }}</template></a-list-item-meta><a-tag color="green">已冻结</a-tag></a-list-item></template></a-list>
    <a-modal v-model:visible="createOpen" title="创建不可变交付快照" @ok="create" :confirm-loading="saving"><a-form layout="vertical"><a-form-item label="快照标识" required><a-input v-model="form.name" class="mono" placeholder="2026-S12-review" /></a-form-item><a-form-item label="标题"><a-input v-model="form.title" /></a-form-item><a-form-item label="来源迭代" required><a-select v-model="form.milestone"><a-option v-for="item in milestones" :key="item.name" :value="item.name">{{ item.name }} · {{ item.title }}</a-option></a-select></a-form-item></a-form><a-alert type="info" show-icon message="快照只接受已确认版本，创建后不可修改或删除。" /></a-modal>
    <a-modal v-model:visible="notifyOpen" title="团队通知" :footer="false"><a-form layout="vertical"><a-form-item label="平台"><a-select v-model="notify.provider"><a-option value="wecom">企业微信</a-option><a-option value="dingtalk">钉钉</a-option><a-option value="slack">Slack</a-option></a-select></a-form-item><a-form-item label="Webhook"><a-input-password v-model="notify.webhookUrl" placeholder="仅保存到 macOS 钥匙串" /></a-form-item><a-space><a-button :loading="testing" @click="testNotify">测试连接</a-button><a-button type="primary" @click="saveWebhook">保存到钥匙串</a-button></a-space></a-form><a-divider /><a-list size="small" :data="notifications"><template #renderItem="{item}"><a-list-item><span>{{ item.event.event }}</span><a-tag :color="item.status==='sent'?'green':'gold'">{{ item.status==='sent'?'已发送':'待重试' }}</a-tag></a-list-item></template></a-list></a-modal>
  </div>
</template>
<script setup>
import { computed,onMounted,reactive,ref } from 'vue';import { notify as toast } from '../ui/feedback';import { IconNotification,IconPlus } from '@arco-design/web-vue/es/icon/index.js';import { api } from '../api';import { useAppStore } from '../store'
const app=useAppStore(),snapshots=ref([]),milestones=ref([]),notifications=ref([]),loading=ref(false),saving=ref(false),testing=ref(false),createOpen=ref(false),notifyOpen=ref(false),form=reactive({name:'',title:'',milestone:null}),notify=reactive({provider:'wecom',webhookUrl:''})
const pending=computed(()=>notifications.value.filter(item=>item.status==='pending'))
async function load(){loading.value=true;try{[snapshots.value,milestones.value,notifications.value]=await Promise.all([api.listSnapshots(),api.listMilestones(),api.listNotifications()])}finally{loading.value=false}}
async function create(){if(!form.name||!form.milestone)return toast.warning('请填写快照标识并选择迭代');saving.value=true;try{const item=await api.createSnapshot(form);createOpen.value=false;toast.success('交付快照已冻结');await load();location.hash=`#/deliveries/${encodeURIComponent(item.name)}`}finally{saving.value=false}}
async function flush(){await api.flushNotifications();toast.success('通知队列已处理');await load()}
async function testNotify(){testing.value=true;try{await api.testNotification(notify);toast.success('测试通知已发送')}finally{testing.value=false}}
async function saveWebhook(){if(!notify.webhookUrl)return toast.warning('请输入 Webhook');await api.setNotificationWebhook(notify.provider,notify.webhookUrl);notify.webhookUrl='';toast.success('Webhook 已保存到钥匙串')}
onMounted(load)
</script>
<style scoped>
.delivery-row:hover { background: var(--fl-primary-bg); }
</style>

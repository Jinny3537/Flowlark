<template><a-select :value="status" size="small" :disabled="disabled||status==='obsolete'" class="review-select" @change="change"><a-option v-for="item in options" :key="item.value" :value="item.value"><a-badge :status="item.badge" :text="item.label" /></a-option></a-select></template>
<script setup>
import { notify } from '../ui/feedback';import { api } from '../api'
const props=defineProps({slug:String,versionNo:String,status:String,disabled:Boolean});const emit=defineEmits(['changed'])
const options=[{value:'pending',label:'待评审',badge:'warning'},{value:'confirmed',label:'已确认',badge:'success'},{value:'questions',label:'有疑问',badge:'error'}]
async function change(value){try{const result=await api.setReviewStatus(props.slug,props.versionNo,value);notify.success('审阅状态已更新');emit('changed',result)}catch{/* api 已提示 */}}
</script>
<style scoped>.review-select{width:112px}</style>

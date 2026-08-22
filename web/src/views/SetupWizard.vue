<template>
  <div class="page-pad prototype-workbench-page">
    <div class="prototype-workbench-head">
      <div>
        <h2>原型修改工作台</h2>
        <p class="text-secondary">这里预留给后续的原型改稿、局部替换和修改记录工作流。</p>
      </div>
      <a-button @click="$router.push('/settings')">
        <template #icon><SettingOutlined /></template>工作区设置
      </a-button>
    </div>

    <a-empty description="原型修改工作台尚未启用">
      <a-space>
        <a-button type="primary" @click="$router.push('/projects')">
          <template #icon><FolderOutlined /></template>查看项目
        </a-button>
        <a-button @click="$router.push('/settings')">
          管理工作区
        </a-button>
      </a-space>
    </a-empty>
  </div>
</template>

<script setup>
import { FolderOutlined, SettingOutlined } from '@ant-design/icons-vue'
</script>

<style scoped>
.prototype-workbench-page {
  max-width: 920px;
}
.prototype-workbench-head {
  display: flex;
  align-items: center;
  gap: var(--fl-s-4);
  margin-bottom: var(--fl-s-6);
}
.prototype-workbench-head > div {
  flex: 1;
  min-width: 0;
}
.prototype-workbench-head h2 {
  margin: 0 0 4px;
  font-size: var(--fl-fs-5);
}
.prototype-workbench-head p {
  margin: 0;
}
@media (max-width: 640px) {
  .prototype-workbench-head {
    display: block;
  }
  .prototype-workbench-head .ant-btn {
    margin-top: var(--fl-s-3);
  }
}
</style>

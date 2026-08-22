import { createRouter, createWebHashHistory } from 'vue-router'

// hash 路由：静态服务不需要为前端路由做 rewrite，CLI 拼跳转链接也简单
export default createRouter({
  history: createWebHashHistory(),
  routes: [
    { path: '/', redirect: '/projects' },
    { path: '/projects', name: 'projects', component: () => import('./views/ProjectList.vue') },
    {
      path: '/projects/:slug',
      name: 'versions',
      component: () => import('./views/VersionTimeline.vue'),
      props: true
    },
    {
      path: '/projects/:slug/compare',
      name: 'compare',
      component: () => import('./views/Compare.vue'),
      props: true
    },
    {
      path: '/projects/:slug/versions/:versionNo',
      name: 'workbench',
      component: () => import('./views/Workbench.vue'),
      props: true
    },
    { path: '/oplog', name: 'oplog', component: () => import('./views/OpLog.vue') },
    { path: '/watch', name: 'watch', component: () => import('./views/WatchInbox.vue') },
    { path: '/trash', name: 'trash', component: () => import('./views/Trash.vue') },
    { path: '/settings', name: 'settings', component: () => import('./views/Settings.vue') }
  ]
})

/**
 * 页面路由（HTML5 history 模式，Vercel 托管：vercel.json rewrites 全部落 index.html；
 * mod 本机静态托管无 SPA fallback，刷新子路径会 404，深链入口恒为根路径不受影响）。
 * 深链 ?host=&pair= 落在 search 上，connection.consumeDeepLink 口径不变。
 * 连接守卫：会话未建立（从未连接/主动断开/解除配对）一律先到 /connect；
 * 曾在线后的断线保持原路由（顶部横幅接管提示）；在线访问 /connect 跳回编辑器。
 */

import { createRouter, createWebHistory } from 'vue-router'
import { connection, lastHost } from '@/stores/connection'
import { workspace } from '@/stores/workspace'
import type { MacroCategory } from '@/types/api'

/* 主视图懒加载：断开 workspace↔组件↔router 的模块求值环，编辑器（Monaco）按需加载 */
const ConnectView = (): Promise<typeof import('@/components/connect/ConnectView.vue')> =>
  import('@/components/connect/ConnectView.vue')
const EditorArea = (): Promise<typeof import('@/components/editor/EditorArea.vue')> =>
  import('@/components/editor/EditorArea.vue')
const TaskManagerView = (): Promise<typeof import('@/components/tasks/TaskManagerView.vue')> =>
  import('@/components/tasks/TaskManagerView.vue')
const SettingsView = (): Promise<typeof import('@/components/settings/SettingsView.vue')> =>
  import('@/components/settings/SettingsView.vue')
const AboutView = (): Promise<typeof import('@/components/settings/AboutView.vue')> =>
  import('@/components/settings/AboutView.vue')

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', redirect: () => ({ name: 'editor', params: { category: workspace.lastCategory } }) },
    { path: '/connect', name: 'connect', component: ConnectView },
    { path: '/editor', redirect: () => ({ name: 'editor', params: { category: workspace.lastCategory } }) },
    {
      path: '/editor/:category(keypress|event|services)',
      name: 'editor',
      component: EditorArea,
    },
    { path: '/tasks', name: 'tasks', component: TaskManagerView },
    { path: '/settings', name: 'settings', component: SettingsView },
    { path: '/about', name: 'about', component: AboutView },
    { path: '/:pathMatch(.*)*', redirect: '/' },
  ],
})

/** 会话是否已建立（在线，或曾在线后的断线自愈中） */
function sessionReady(): boolean {
  return connection.status === 'online' || connection.sessionEstablished
}

router.beforeEach((to) => {
  if (sessionReady()) {
    return to.name === 'connect' ? { name: 'editor', params: { category: workspace.lastCategory } } : true
  }
  // 未就绪：有记忆 host 时放行（boot 自动连上次地址，连上留原页；失败由 App 补跳 /connect），
  // 无 host（全新访客）一律先到连接页
  if (to.name === 'connect') return true
  return lastHost() ? true : { name: 'connect' }
})

/** 导航落地后派生 activity/mainSpecial（ActivityBar 高亮、侧栏分类、特殊视图判断） */
router.afterEach((to) => {
  if (to.name === 'editor') {
    const category = to.params.category as MacroCategory
    workspace.activity = category
    workspace.lastCategory = category
    workspace.mainSpecial = null
  } else if (to.name === 'tasks' || to.name === 'settings' || to.name === 'about') {
    workspace.activity = to.name
    workspace.mainSpecial = to.name
  }
})

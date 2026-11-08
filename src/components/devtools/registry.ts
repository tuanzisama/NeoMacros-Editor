/**
 * DevTools 面板注册表：新增面板 = 追加一项（id 同步 workspace.devtoolsTab）。
 * 每个面板组件自带工具栏 + 内容，外壳只负责标签栏与全局工具。
 */

import { markRaw, type Component } from 'vue'
import ConsoleTab from './ConsoleTab.vue'
import NetworkTab from './NetworkTab.vue'
import TaskManagerTab from './TaskManagerTab.vue'
import MemoryTab from './MemoryTab.vue'

export interface DevToolsTabDef {
  id: string
  label: string
  component: Component
}

export const devtoolsTabs: DevToolsTabDef[] = [
  { id: 'console', label: '控制台', component: markRaw(ConsoleTab) },
  { id: 'network', label: '网络', component: markRaw(NetworkTab) },
  { id: 'tasks', label: '任务', component: markRaw(TaskManagerTab) },
  { id: 'memory', label: '内存', component: markRaw(MemoryTab) },
]

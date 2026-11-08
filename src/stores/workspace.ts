/**
 * 工作区 UI 状态：activity/mainSpecial 由路由派生（router/index.ts afterEach 同步），
 * 侧栏/底部面板开合、DevTools 页签、状态栏反馈消息。导航函数（selectActivity 等）
 * 保持原签名，内部走 router.push。
 */

import { reactive } from 'vue'
import { router } from '@/router'
import { CATEGORY_LABELS } from '@/types/api'
import type { MacroCategory, MacroView } from '@/types/api'

/** 活动 = 宏分类（资源管理器三入口）+ 任务/设置/关于；DevTools 入口在状态栏，不经活动栏 */
export type Activity = MacroCategory | 'tasks' | 'settings' | 'about'
export type MainSpecial = null | 'tasks' | 'settings' | 'about'

export function isCategory(a: Activity): a is MacroCategory {
  return a in CATEGORY_LABELS
}

export interface Feedback {
  text: string
  kind: 'info' | 'success' | 'warning' | 'error'
  seq: number
}

interface WorkspaceState {
  activity: Activity
  /** 最近一次选中的宏分类（从 settings/about 返回时恢复） */
  lastCategory: MacroCategory
  sidebarOpen: boolean
  bottomPanelOpen: boolean
  /** DevTools 活动标签页 id（registry.ts 的 DevToolsTabDef.id） */
  devtoolsTab: string
  mainSpecial: MainSpecial
  feedback: Feedback | null
  /** 模态：新建向导 / 删除确认 */
  showNewMacro: boolean
  /** 新建向导预设分类（打开时所在分类侧栏） */
  presetCategory: MacroCategory | null
  deleteTarget: MacroView | null
}

export const workspace = reactive<WorkspaceState>({
  activity: 'keypress',
  lastCategory: 'keypress',
  sidebarOpen: true,
  bottomPanelOpen: false,
  devtoolsTab: 'console',
  mainSpecial: null,
  feedback: null,
  showNewMacro: false,
  presetCategory: null,
  deleteTarget: null,
})

export function openNewMacroWizard(category?: MacroCategory): void {
  workspace.presetCategory = category ?? (isCategory(workspace.activity) ? workspace.activity : null)
  workspace.showNewMacro = true
}

export function askDelete(macro: MacroView): void {
  workspace.deleteTarget = macro
}

let feedbackSeq = 0
let feedbackTimer: ReturnType<typeof setTimeout> | null = null

export function notify(text: string, kind: Feedback['kind'] = 'info'): void {
  workspace.feedback = { text, kind, seq: ++feedbackSeq }
  if (feedbackTimer !== null) clearTimeout(feedbackTimer)
  feedbackTimer = setTimeout(() => {
    workspace.feedback = null
  }, 4000)
}

export function selectActivity(activity: Activity): void {
  const prev = workspace.activity
  if (isCategory(activity)) {
    workspace.lastCategory = activity
    // VS Code 行为：重复点击已激活分类 → 切换侧栏开合
    workspace.sidebarOpen = prev === activity ? !workspace.sidebarOpen : true
    void router.push({ name: 'editor', params: { category: activity } })
  } else {
    // settings / about / tasks：主区特殊视图
    workspace.sidebarOpen = true
    void router.push({ name: activity })
  }
}

/** 状态栏 DevTools 按钮：切换底部 DevTools 面板 */
export function toggleDevTools(): void {
  workspace.bottomPanelOpen = !workspace.bottomPanelOpen
}

/** 从 settings/about 返回编辑器（恢复最近分类侧栏） */
export function backToExplorer(): void {
  selectActivity(workspace.lastCategory)
}

/** 打开文件标签时回到编辑器主区；macroId（category/name）用于定位分类侧栏 */
export function focusEditor(macroId?: string): void {
  const category = macroId ? (macroId.split('/')[0] as Activity) : workspace.lastCategory
  if (isCategory(category)) {
    workspace.lastCategory = category
    void router.push({ name: 'editor', params: { category } })
    return
  }
  void router.push({ name: 'editor', params: { category: workspace.lastCategory } })
}

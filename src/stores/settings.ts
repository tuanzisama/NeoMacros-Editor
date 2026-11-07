/**
 * 面板设置（localStorage 持久化）：编辑器行为 + 日志过滤记忆。
 */

import { reactive, watch } from 'vue'
import type { LanguageSetting } from '@/monaco/locale'

export type ThemePref = 'dark' | 'light' | 'auto'

export interface PanelSettings {
  /** 主题偏好：深色 / 浅色 / 跟随系统 */
  theme: ThemePref
  /** Monaco UI 语言：auto 跟随浏览器；刷新页面生效（见 monaco/nls-boot.ts） */
  language: LanguageSetting
  /** 侧栏宽度（资源管理器，可拖拽调宽） */
  sidebarWidth: number
  /** DevTools 面板高度（底部，可拖拽调高） */
  devtoolsHeight: number
  /** DevTools 控制台左侧级别侧栏（Chrome 式，默认隐藏） */
  consoleSidebar: boolean
  /** 编辑器字号 */
  fontSize: number
  tabSize: number
  wordWrap: boolean
  minimap: boolean
  /** JS 语义诊断（checkJs）；默认关，仅语法级提示 */
  checkJs: boolean
  /** 任务管理器可见列（id 列表；null = 全部默认列） */
  taskColumns: string[] | null
}

const DEFAULTS: PanelSettings = {
  theme: 'auto',
  language: 'auto',
  sidebarWidth: 280,
  devtoolsHeight: 260,
  consoleSidebar: false,
  fontSize: 14,
  tabSize: 4,
  wordWrap: false,
  minimap: true,
  checkJs: false,
  taskColumns: null,
}

const KEY = 'neomacros-panel-settings-v1'

function load(): PanelSettings {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return { ...DEFAULTS }
    return { ...DEFAULTS, ...(JSON.parse(raw) as Partial<PanelSettings>) }
  } catch {
    return { ...DEFAULTS }
  }
}

export const settings = reactive<PanelSettings>(load())

watch(
  settings,
  () => {
    try {
      localStorage.setItem(KEY, JSON.stringify(settings))
    } catch {
      /* 忽略持久化失败 */
    }
  },
  { deep: true },
)

export function resetSettings(): void {
  Object.assign(settings, DEFAULTS)
}

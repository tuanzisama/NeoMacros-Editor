/**
 * 编辑器工作区：多标签文件、保存流（If-Match 乐观并发 + 热重载回传错误）、409 冲突、
 * 磁盘外部修改提示。
 * 文件路径 = 宏目录根相对 POSIX 路径（如 event/auto-welcome/index.js），与 LocatedError.script 同口径。
 */

import { reactive, computed, ref } from 'vue'
import { readFile, writeFile, conflictFrom } from '@/api/endpoints'
import { sse } from '@/api/sse'
import { sha256B64Url } from '@/api/nm1'
import { ApiError } from '@/types/api'
import type { LocatedError, MacroView } from '@/types/api'
import { notify } from './workspace'
import { macros, entryFileOf, refresh } from './macros'

export type FileLanguage = 'javascript' | 'yaml' | 'plaintext'

export interface EditorTab {
  path: string
  macroId: string
  title: string
  language: FileLanguage
  /** 服务端已保存内容 */
  content: string
  /** 编辑器缓冲（未保存） */
  buffer: string
  etag: string
  dirty: boolean
  loading: boolean
  loadError: string
  saving: boolean
  locatedError: LocatedError | null
  /** 409 冲突数据 */
  conflict: { serverContent: string; serverEtag: string } | null
  /** 磁盘外部修改待处理 */
  externalChange: boolean
  /** 内容被程序化整段替换的次数（MonacoPane 据此同步 model） */
  rev: number
  /** 类型定义标签（d.ts，只读）：path 为 file:/// URI，不可保存 */
  definition?: boolean
}

interface EditorState {
  tabs: EditorTab[]
  activePath: string | null
}

export const editor = reactive<EditorState>({
  tabs: [],
  activePath: null,
})

export const activeTab = computed(() => editor.tabs.find((t) => t.path === editor.activePath) ?? null)

/** 状态栏光标位置（MonacoPane 回写） */
export const cursor = reactive({ line: 1, column: 1 })

/**
 * 跳转请求（控制台定位/错误定位共用）：MonacoPane 监听后滚动到目标行。
 * token 自增保证同位置重复点击也能重新触发。
 */
export interface RevealTarget {
  path: string
  line: number
  column: number
  token: number
}

export const revealTarget = ref<RevealTarget | null>(null)
let revealToken = 0

/** 打开文件（必要时）并跳到指定行列 */
export async function revealInEditor(path: string, macroId: string, line: number, column: number): Promise<void> {
  await openFile(path, macroId)
  revealToken++
  revealTarget.value = {
    path,
    line: Math.max(1, line),
    column: Math.max(1, column),
    token: revealToken,
  }
}

/** 仅 yml 走 YAML、js/ts（含 d.ts）走 JS 高亮，其余一律纯文本 */
export function languageOf(path: string): FileLanguage {
  if (/\.(yaml|yml)$/i.test(path)) return 'yaml'
  if (/\.(js|ts)$/i.test(path)) return 'javascript'
  return 'plaintext'
}

function makeTab(path: string, macroId: string): EditorTab {
  return {
    path,
    macroId,
    title: path.split('/').pop() ?? path,
    language: languageOf(path),
    content: '',
    buffer: '',
    etag: '',
    dirty: false,
    loading: true,
    loadError: '',
    saving: false,
    locatedError: null,
    conflict: null,
    externalChange: false,
    rev: 0,
  }
}

export function findTab(path: string): EditorTab | undefined {
  return editor.tabs.find((t) => t.path === path)
}

export async function openFile(path: string, macroId: string): Promise<void> {
  const existing = findTab(path)
  if (existing) {
    editor.activePath = path
    return
  }
  const raw = makeTab(path, macroId)
  editor.tabs.push(raw)
  // 取数组里的响应式代理再继续改，raw 引用不触发依赖更新
  const tab = findTab(path)!
  editor.activePath = path
  try {
    const file = await readFile(path)
    tab.content = file.text
    tab.buffer = file.text
    tab.etag = file.etag
    tab.loading = false
    syncLocatedErrorFromState(tab)
  } catch (e) {
    tab.loading = false
    tab.loadError = e instanceof ApiError ? e.label : String(e)
  }
}

/** 转到定义落地（Ctrl+Click / F12）：登记只读 d.ts 标签；模型已在 setup 阶段创建 */
export function openDefinitionTab(uri: string, title: string): void {
  const existing = findTab(uri)
  if (existing) {
    editor.activePath = uri
    return
  }
  const raw = makeTab(uri, '')
  raw.title = title
  raw.definition = true
  raw.loading = false
  editor.tabs.push(raw)
  editor.activePath = uri
}

/** 打开一个宏的入口文件：读 neomacro.yml 的 main（缺省 index.js） */
export async function openMacro(m: MacroView): Promise<void> {
  const entry = await entryFileOf(m)
  await openFile(`${m.id}/${entry}`, m.id)
}

export function closeTab(path: string): void {
  const i = editor.tabs.findIndex((t) => t.path === path)
  if (i < 0) return
  editor.tabs.splice(i, 1)
  if (editor.activePath === path) {
    const next = editor.tabs[Math.min(i, editor.tabs.length - 1)]
    editor.activePath = next ? next.path : null
  }
}

/**
 * 关闭属于某宏的全部标签（磁盘删除宏后调用）。即时保存模式下无未保存
 * 缓冲的标签直接关；dirty 标签保留并标记外部变更（磁盘已消失，保存会
 * 404，交给用户自行处置），活动标签被关掉后落到相邻标签。
 */
export function closeTabsOfMacro(macroId: string): void {
  for (const tab of [...editor.tabs].filter((t) => t.macroId === macroId)) {
    if (tab.dirty) {
      tab.externalChange = true
    } else {
      closeTab(tab.path)
    }
  }
  if (editor.activePath !== null && !findTab(editor.activePath)) {
    const next = editor.tabs[0]
    editor.activePath = next ? next.path : null
  }
}

export function setBuffer(path: string, value: string): void {
  const tab = findTab(path)
  if (!tab || tab.definition) return
  tab.buffer = value
  tab.dirty = value !== tab.content
}

export async function save(path: string): Promise<boolean> {
  const tab = findTab(path)
  if (!tab || tab.saving || tab.loading || tab.definition) return false
  tab.saving = true
  tab.conflict = null
  try {
    const result = await writeFile(tab.path, tab.buffer, tab.etag)
    tab.content = tab.buffer
    tab.dirty = false
    tab.locatedError = result.error
    // ETag 以服务端返回为准（口径可能与本地计算有偏差，本地计算仅作缺省兜底）
    tab.etag = result.etag ?? (await sha256B64Url(tab.content))
    if (result.error) {
      notify(`已保存，但热重载报错：${result.error.message}`, 'warning')
    } else {
      notify('已保存并热重载', 'success')
    }
    // 声明即配置：清单保存后同步树显示（名称/按键/生命周期跟随 yml）
    if (/neomacro\.ya?ml$/i.test(tab.path)) void refresh()
    return true
  } catch (e) {
    if (e instanceof ApiError && e.status === 409) {
      const conflict = conflictFrom(e)
      if (conflict) {
        tab.conflict = {
          serverContent: conflict.content,
          serverEtag: conflict.etag || (await sha256B64Url(conflict.content)),
        }
        return false
      }
    }
    notify(e instanceof ApiError ? e.label : String(e), 'error')
    return false
  } finally {
    tab.saving = false
  }
}

export async function resolveConflict(path: string, mode: 'overwrite' | 'takeServer'): Promise<void> {
  const tab = findTab(path)
  if (!tab?.conflict) return
  if (mode === 'overwrite') {
    tab.etag = tab.conflict.serverEtag
    const ok = await save(path)
    if (ok) tab.conflict = null
  } else {
    tab.content = tab.conflict.serverContent
    tab.buffer = tab.conflict.serverContent
    tab.etag = tab.conflict.serverEtag
    tab.dirty = false
    tab.conflict = null
    tab.locatedError = null
    tab.rev++
  }
}

export function dismissConflict(path: string): void {
  const tab = findTab(path)
  if (tab) tab.conflict = null
}

/** 磁盘外部修改：重新读取服务端内容（未保存缓冲会被覆盖，调用前由 UI 确认） */
export async function reloadFromDisk(path: string): Promise<void> {
  const tab = findTab(path)
  if (!tab) return
  try {
    const file = await readFile(path)
    tab.content = file.text
    tab.buffer = file.text
    tab.etag = file.etag
    tab.dirty = false
    tab.externalChange = false
    tab.locatedError = null
    tab.rev++
    syncLocatedErrorFromState(tab)
  } catch (e) {
    notify(e instanceof ApiError ? e.label : String(e), 'error')
  }
}

export function ignoreExternalChange(path: string): void {
  const tab = findTab(path)
  if (tab) tab.externalChange = false
}

/** 宏列表快照中的 LocatedError 同步到已打开标签 */
function syncLocatedErrorFromState(tab: EditorTab): void {
  const m = macros.macros.find((x) => x.id === tab.macroId)
  if (m?.error && m.error.script.replace(/\\/g, '/') === tab.path) {
    tab.locatedError = m.error
  }
}

export function bindSse(): void {
  sse.onFileChanged((e) => {
    if (e.by === 'web') return // 自己保存的回声
    const tab = findTab(e.path)
    if (tab) tab.externalChange = true
  })
}

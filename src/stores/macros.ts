/**
 * 宏清单：全量快照 + 行内生命周期动作 + SSE 增量同步。
 */

import { reactive, computed } from 'vue'
import {
  getState,
  macroAction,
  createMacro,
  deleteMacro,
  listMacroFiles,
  readFile,
} from '@/api/endpoints'
import { sse } from '@/api/sse'
import { closeTabsOfMacro } from './editor'
import { notify } from './workspace'
import { ApiError } from '@/types/api'
import type {
  CreateMacroRequest,
  MacroAction,
  MacroStateEvent,
  MacroView,
  ServerInfo,
} from '@/types/api'
import { MACRO_CATEGORIES } from '@/types/api'

interface MacrosState {
  macros: MacroView[]
  server: ServerInfo | null
  /** 宏目录根的磁盘绝对路径（state.macrosRoot，旧版 mod 缺省为空） */
  root: string
  search: string
  loading: boolean
  error: string
  /** 行内动作进行中的 id 集合 */
  busy: Set<string>
}

export const macros = reactive<MacrosState>({
  macros: [],
  server: null,
  root: '',
  search: '',
  loading: false,
  error: '',
  busy: new Set(),
})

export const counts = computed(() => {
  const total = macros.macros.length
  const enabled = macros.macros.filter((m) => m.enabled).length
  const running = macros.macros.filter((m) => m.running).length
  return { total, enabled, running }
})

export function hasError(m: MacroView): boolean {
  return m.error !== null && m.error !== undefined
}

/** 按名称/按键/ID 过滤（§5.5） */
export const filteredByCategory = computed(() => {
  const q = macros.search.trim().toLowerCase()
  return MACRO_CATEGORIES.map((category) => ({
    category,
    items: macros.macros.filter((m) => {
      if (m.category !== category) return false
      if (!q) return true
      return (
        m.name.toLowerCase().includes(q) ||
        m.id.toLowerCase().includes(q) ||
        (m.key ?? '').toLowerCase().includes(q)
      )
    }),
  }))
})

export async function refresh(): Promise<void> {
  macros.loading = true
  macros.error = ''
  try {
    const snap = await getState()
    macros.macros = snap.macros
    macros.server = snap.server
    macros.root = snap.macrosRoot ?? ''
  } catch (e) {
    macros.error = e instanceof ApiError ? e.label : String(e)
  } finally {
    macros.loading = false
  }
}

function upsert(view: MacroView): void {
  const i = macros.macros.findIndex((m) => m.id === view.id)
  if (i >= 0) macros.macros[i] = view
  else macros.macros.push(view)
}

/** 行内生命周期动作（enable=持久意图，start/stop=运行态）；失败（如断线）就地提示 */
export async function runAction(id: string, action: MacroAction): Promise<void> {
  macros.busy.add(id)
  try {
    const view = await macroAction(id, action)
    upsert(view)
  } catch (e) {
    notify(e instanceof ApiError ? e.label : String(e), 'error')
  } finally {
    macros.busy.delete(id)
  }
}

export async function toggleEnabled(m: MacroView): Promise<void> {
  await runAction(m.id, m.enabled ? 'disable' : 'enable')
}

export async function toggleRunning(m: MacroView): Promise<void> {
  await runAction(m.id, m.running ? 'stop' : 'start')
}

export async function reload(id: string): Promise<void> {
  await runAction(id, 'reload')
}

/** W2：新建宏（409=重名，422=非法） */
export async function createNew(req: CreateMacroRequest): Promise<MacroView> {
  const view = await createMacro(req)
  upsert(view)
  return view
}

/** W2：删除宏目录（不可恢复） */
export async function remove(id: string): Promise<void> {
  await deleteMacro(id)
  macros.macros = macros.macros.filter((m) => m.id !== id)
  invalidateFiles(id)
  expandedIds.delete(id)
}

/** 名称校验（§5.4：非空、[A-Za-z0-9_-]、跨目录唯一） */
export function validateName(name: string, ignoreId?: string): string {
  if (!name) return '名称不能为空'
  if (!/^[A-Za-z0-9_-]+$/.test(name)) return '仅允许字母、数字、下划线和连字符'
  if (macros.macros.some((m) => m.name === name && m.id !== ignoreId)) return '名称已存在（跨分类唯一）'
  return ''
}

/* ---- 资源管理器文件树 ---- */

/** 宏目录内容缓存（相对路径）；incomplete=仅已知文件（列目录端点未就绪） */
export interface MacroFiles {
  files: string[]
  dirs: string[]
  loading: boolean
  incomplete: boolean
}

export const filesByMacro = reactive<Record<string, MacroFiles>>({})

/** 会话内展开态（跨侧栏重挂载保留） */
export const expandedIds = reactive(new Set<string>())

export function toggleExpanded(id: string): void {
  if (expandedIds.has(id)) expandedIds.delete(id)
  else {
    expandedIds.add(id)
    void ensureFiles(id)
  }
}

export function invalidateFiles(id: string): void {
  delete filesByMacro[id]
}

/** 清单 main 入口解析（缺省 index.js） */
export async function entryFileOf(m: MacroView): Promise<string> {
  try {
    const manifest = await readFile(`${m.id}/neomacro.yml`)
    const match = /^\s*main:\s*["']?([\w./-]+)["']?\s*$/m.exec(manifest.text)
    const main = match?.[1]
    if (main) return main
  } catch {
    /* 清单读不到则回落 index.js */
  }
  return 'index.js'
}

function sortFiles(items: string[]): string[] {
  const rank = (p: string) => (/neomacro\.ya?ml$/i.test(p) ? 0 : 1)
  return [...items].sort((a, b) => rank(a) - rank(b) || a.localeCompare(b))
}

/** 展开时取文件列表：缓存直返；端点 404 → 回落「neomacro.yml + 清单 main 入口」，不造假数据 */
export async function ensureFiles(id: string): Promise<MacroFiles> {
  const cached = filesByMacro[id]
  if (cached) return cached
  const entry = reactive<MacroFiles>({ files: [], dirs: [], loading: true, incomplete: false })
  filesByMacro[id] = entry
  try {
    const listing = await listMacroFiles(id)
    entry.files = sortFiles(listing.files)
    entry.dirs = [...listing.dirs].sort((a, b) => a.localeCompare(b))
  } catch (e) {
    entry.incomplete = true
    if (e instanceof ApiError && e.status === 404) {
      const m = macros.macros.find((x) => x.id === id)
      const main = m ? await entryFileOf(m) : 'index.js'
      entry.files = sortFiles(['neomacro.yml', main])
    }
  } finally {
    entry.loading = false
  }
  return entry
}

/** SSE：macro:state 增量（含游戏内操作引发的变更） */
export function applyMacroStateEvent(e: MacroStateEvent): void {
  const m = macros.macros.find((x) => x.id === e.id)
  if (!m) {
    void refresh()
    return
  }
  m.enabled = e.enabled
  m.running = e.running
  m.error = e.error
}

/**
 * 磁盘结构变更（宏文件夹/子目录/文件增删）后的再同步：
 * 全量刷新 + 清理消失宏的树缓存、展开态与编辑器标签。
 */
async function syncAfterDiskChange(): Promise<void> {
  const before = macros.macros.map((m) => m.id)
  await refresh()
  const after = new Set(macros.macros.map((m) => m.id))
  for (const id of before) {
    if (!after.has(id)) {
      invalidateFiles(id)
      expandedIds.delete(id)
      closeTabsOfMacro(id)
    }
  }
}

let diskSyncTimer: ReturnType<typeof setTimeout> | null = null

/** 一次扫描常触发多条信号，去抖 300ms 合并成一次刷新 */
function scheduleDiskSync(): void {
  if (diskSyncTimer !== null) clearTimeout(diskSyncTimer)
  diskSyncTimer = setTimeout(() => {
    diskSyncTimer = null
    void syncAfterDiskChange()
  }, 300)
}

export function bindSse(): void {
  sse.onMacroState(applyMacroStateEvent)
  sse.onMacrosChanged(() => scheduleDiskSync())
  // 磁盘外部增删文件 → 失效对应宏的文件列表缓存（id 含「/」，按已知 id 前缀匹配）；
  // 树正展开显示时立即重拉，侧栏无需折叠再展开
  sse.onFileChanged((e) => {
    if (e.by !== 'disk') return
    for (const id of Object.keys(filesByMacro)) {
      if (e.path.startsWith(`${id}/`)) {
        invalidateFiles(id)
        if (expandedIds.has(id)) void ensureFiles(id)
        break
      }
    }
  })
}

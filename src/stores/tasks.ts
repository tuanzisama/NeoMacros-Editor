/**
 * 任务管理器：GET /tasks 全量快照（活动 + 历史）+ SSE `task:state` 增量合并。
 * 运行中任务由 1s 心跳驱动「持续时间」刷新；停止的任务进入历史（上限 500，超出裁最旧）。
 * 过滤：状态 + 文本搜索（匹配任务名/宏文件/玩家/服务器）。
 */

import { reactive, computed } from 'vue'
import { getTasks, stopTask, restartTask } from '@/api/endpoints'
import { sse } from '@/api/sse'
import { ApiError } from '@/types/api'
import type { TaskEntry } from '@/types/api'
import { notify, workspace } from './workspace'
import { mergedFilters } from './mergedConsole'
import { resolveMacroId } from './console'

const HISTORY_CAP = 500

interface TasksState {
  active: TaskEntry[]
  history: TaskEntry[]
  search: string
  /** 状态过滤：'' 全部 / running / stopped（AppSelect 直绑，取原值） */
  statusFilter: string
  error: string
  /** 心跳时钟：驱动运行中任务的持续时间渲染 */
  now: number
}

export const tasksStore = reactive<TasksState>({
  active: [],
  history: [],
  search: '',
  statusFilter: '',
  error: '',
  now: Date.now(),
})

/** 合并视图：活动在前（按 id 升序），历史在后（按启动时间倒序） */
export const allTasks = computed<TaskEntry[]>(() => [
  ...[...tasksStore.active].sort((a, b) => a.id - b.id),
  ...[...tasksStore.history].sort((a, b) => b.startedAt - a.startedAt),
])

/** 过滤视图：状态 + 文本搜索 */
export const filteredTasks = computed<TaskEntry[]>(() => {
  const q = tasksStore.search.trim().toLowerCase()
  return allTasks.value.filter((task) => {
    if (tasksStore.statusFilter && task.status !== tasksStore.statusFilter) return false
    if (!q) return true
    const haystack = [task.macro, task.category, task.playerName ?? '', task.server ?? '']
      .join(' ')
      .toLowerCase()
    return haystack.includes(q)
  })
})

/** 持续时间文本；运行中的任务随 tasksStore.now 刷新 */
export function durationText(task: TaskEntry): string {
  const end = task.endedAt > 0 ? task.endedAt : tasksStore.now
  let seconds = Math.max(0, Math.floor((end - task.startedAt) / 1000))
  const hours = Math.floor(seconds / 3600)
  seconds %= 3600
  const minutes = Math.floor(seconds / 60)
  seconds %= 60
  const pad = (n: number): string => String(n).padStart(2, '0')
  return hours > 0
    ? `${hours}:${pad(minutes)}:${pad(seconds)}`
    : `${minutes}:${pad(seconds)}`
}

function upsert(entry: TaskEntry): void {
  if (entry.status === 'running') {
    tasksStore.history = tasksStore.history.filter((t) => t.id !== entry.id)
    const at = tasksStore.active.findIndex((t) => t.id === entry.id)
    if (at >= 0) tasksStore.active.splice(at, 1, entry)
    else tasksStore.active.push(entry)
  } else {
    tasksStore.active = tasksStore.active.filter((t) => t.id !== entry.id)
    const at = tasksStore.history.findIndex((t) => t.id === entry.id)
    if (at >= 0) tasksStore.history.splice(at, 1, entry)
    else tasksStore.history.unshift(entry)
    if (tasksStore.history.length > HISTORY_CAP) {
      tasksStore.history = [...tasksStore.history]
        .sort((a, b) => b.startedAt - a.startedAt)
        .slice(0, HISTORY_CAP)
    }
  }
}

/**
 * 内存采样驱动的轻量更新：原地刷新任务内存列（memBytes），不触发
 * task:state 全量合并。由 memory store 在每条采样到达时调用。
 */
export function updateTaskMemory(id: number, memBytes: number): void {
  for (const list of [tasksStore.active, tasksStore.history]) {
    const at = list.findIndex((t) => t.id === id)
    if (at >= 0) list.splice(at, 1, { ...list[at], memBytes })
  }
}

/** 停止一条任务；快照回包直接作为增量合并 */
export async function stopTaskById(id: number): Promise<void> {
  try {
    const res = await stopTask(id)
    for (const entry of [...res.active, ...res.history]) upsert(entry)
  } catch (e) {
    notify(e instanceof Error ? e.message : String(e), 'error')
  }
}

/**
 * 重启一条任务（卸载重载宏后重新拉起）。旧版 mod 无此端点（404）→ 提示未实现；
 * 快照回包直接作为增量合并（与 stop 同口径）。
 */
export async function restartTaskById(id: number): Promise<void> {
  try {
    const res = await restartTask(id)
    tasksStore.error = ''
    for (const entry of [...res.active, ...res.history]) upsert(entry)
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) {
      notify('当前 mod 版本不支持任务重启（端点未实现）', 'warning')
      return
    }
    notify(e instanceof Error ? e.message : String(e), 'error')
  }
}

/** 调试：打开 DevTools 控制台并只看该任务宏的输出 */
export function debugTask(task: TaskEntry): void {
  workspace.bottomPanelOpen = true
  workspace.devtoolsTab = 'console'
  mergedFilters.macroFilter = resolveMacroId(task.macro)
}

let bound = false
let heartbeat: ReturnType<typeof setInterval> | null = null

/** SSE 事件绑定（幂等注册） */
export function bindTasksSse(): void {
  if (bound) return
  bound = true
  sse.onTaskState((entry) => upsert(entry))
}

export function startTasks(): void {
  tasksStore.error = ''
  bindTasksSse()
  void refreshTasks()
  if (heartbeat === null) {
    heartbeat = setInterval(() => {
      tasksStore.now = Date.now()
    }, 1000)
  }
}

/** 手动刷新快照（工具栏刷新按钮） */
export async function refreshTasks(): Promise<void> {
  try {
    const res = await getTasks()
    tasksStore.error = ''
    tasksStore.active = res.active
    tasksStore.history = res.history
  } catch (e) {
    tasksStore.error = e instanceof Error ? e.message : String(e)
  }
}

export function stopTasks(): void {
  // 断线只停心跳与刷新，不清数据：任务表保留断线前的内容（横幅提示连接
  // 状态），恢复在线后 startTasks 重新拉快照覆盖。
  if (heartbeat !== null) {
    clearInterval(heartbeat)
    heartbeat = null
  }
}

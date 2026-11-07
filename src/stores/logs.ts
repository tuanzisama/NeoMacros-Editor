/**
 * 日志台:/logs 环形日志回放(2s 轮询兜底,W1 尚未接线 SSE log 帧)+ SSE 增量。
 * 服务每次 start 重建日志环(seq 归零),连接重建时由 reset() 对齐。
 * 每条追加打上共享单调 arrival 戳并补齐 ts(旧版 mod 无 ts 字段时按到达
 * 时刻兜底),供合并控制台的单一时间线排序;过滤与展示在 mergedConsole。
 */

import { reactive, computed } from 'vue'
import { getLogs } from '@/api/endpoints'
import { sse } from '@/api/sse'
import { nextArrival } from './arrival'
import type { LogEntry } from '@/types/api'

const MAX_ENTRIES = 1000

/** 一条日志行:附合并视图用的到达序号与兜底后的时间戳 */
export type LogRow = LogEntry & { arrival: number; ts: number }

interface LogsState {
  entries: LogRow[]
  lastSeq: number
  error: string
}

export const logs = reactive<LogsState>({
  entries: [],
  lastSeq: 0,
  error: '',
})

/** 三级计数(状态栏 badge 用,统计环形内全部条目,不受面板过滤影响) */
export const levelCounts = computed(() => {
  let info = 0
  let warn = 0
  let error = 0
  for (const e of logs.entries) {
    if (e.level === 'ERROR') error++
    else if (e.level === 'WARN') warn++
    else if (e.level === 'INFO') info++
  }
  return { info, warn, error }
})

let pollTimer: ReturnType<typeof setInterval> | null = null

function append(entries: LogEntry[]): void {
  for (const e of entries) {
    if (e.seq <= logs.lastSeq) continue
    logs.entries.push({ ...e, ts: e.ts ?? Date.now(), arrival: nextArrival() })
    logs.lastSeq = e.seq
  }
  if (logs.entries.length > MAX_ENTRIES) {
    logs.entries.splice(0, logs.entries.length - MAX_ENTRIES)
  }
}

async function poll(): Promise<void> {
  try {
    const res = await getLogs(logs.lastSeq)
    logs.error = ''
    append(res.entries)
  } catch (e) {
    logs.error = e instanceof Error ? e.message : String(e)
  }
}

export function startLogs(): void {
  stopLogs()
  logs.entries = []
  logs.lastSeq = 0
  void poll()
  pollTimer = setInterval(() => void poll(), 2000)
}

export function stopLogs(): void {
  if (pollTimer !== null) {
    clearInterval(pollTimer)
    pollTimer = null
  }
}

export function resetLogs(): void {
  logs.entries = []
  logs.lastSeq = 0
}

export function clearView(): void {
  logs.entries = []
}

export function bindSse(): void {
  sse.onLog((entry) => append([entry]))
}

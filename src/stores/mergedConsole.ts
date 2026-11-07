/**
 * 合并控制台视图:宿主日志行与脚本 console 行按时间戳交错成单一时间线
 * (ts 相同按共享到达序决胜),提供 Chrome 风格的统一级别桶、搜索、宏过滤
 * 与各级计数。REPL(input/result 条目)与 clear 语义经各自 store 落地后
 * 在此呈现;级别映射对齐 Chrome "Default levels" 四桶(详细/信息/警告/错误)。
 */

import { computed, reactive } from 'vue'
import { logs } from './logs'
import { scriptConsole, flattenEntry, entryMacroId } from './console'
import type { ConsoleEntry } from '@/types/api'
import type { LogRow } from './logs'
import type { ConsoleRow } from './console'

/** Chrome "Default levels" 的四个级别桶 */
export type LevelBucket = 'verbose' | 'info' | 'warn' | 'error'

/** 桶的中文标签(级别下拉与侧栏) */
export const BUCKET_LABELS: Record<LevelBucket, string> = {
  verbose: '详细',
  info: '信息',
  warn: '警告',
  error: '错误',
}

/** 合并时间线上的一行 */
export type MergedRow =
  | { source: 'log'; ts: number; arrival: number; entry: LogRow }
  | { source: 'console'; ts: number; arrival: number; entry: ConsoleRow }

/** log4j 级别 → 级别桶(TRACE/DEBUG/未知 → 详细) */
export function bucketOfLog(level: string): LevelBucket {
  switch (level) {
    case 'ERROR':
      return 'error'
    case 'WARN':
      return 'warn'
    case 'INFO':
      return 'info'
    default:
      return 'verbose'
  }
}

/** 脚本 console 级别 → 级别桶(assert 失败以 error 级落地) */
export function bucketOfConsole(entry: ConsoleEntry): LevelBucket {
  switch (entry.level) {
    case 'error':
      return 'error'
    case 'warn':
      return 'warn'
    case 'debug':
      return 'verbose'
    default:
      return 'info'
  }
}

/** 一行的级别桶 */
export function bucketOf(row: MergedRow): LevelBucket {
  return row.source === 'log' ? bucketOfLog(row.entry.level) : bucketOfConsole(row.entry)
}

interface MergedFilters {
  search: string
  /** 启用的级别桶(Chrome 默认全开;侧栏点击/下拉复选均可改) */
  buckets: Record<LevelBucket, boolean>
  /** 只看某个宏(隐藏宿主日志行) */
  macroFilter: string
}

export const mergedFilters = reactive<MergedFilters>({
  search: '',
  buckets: { verbose: true, info: true, warn: true, error: true },
  macroFilter: '',
})

/** 单一时间线:日志 + 脚本 console 按 ts 排序,同 ts 按到达序决胜 */
export const mergedRows = computed<MergedRow[]>(() => {
  const rows: MergedRow[] = []
  for (const e of logs.entries) {
    rows.push({ source: 'log', ts: e.ts, arrival: e.arrival, entry: e })
  }
  for (const e of scriptConsole.entries) {
    rows.push({ source: 'console', ts: e.ts, arrival: e.arrival, entry: e })
  }
  rows.sort((a, b) => a.ts - b.ts || a.arrival - b.arrival)
  return rows
})

/** 过滤后的可见行(级别桶 + 宏 + 搜索) */
export const filteredMergedRows = computed(() => {
  const q = mergedFilters.search.trim().toLowerCase()
  return mergedRows.value.filter((row) => {
    if (!mergedFilters.buckets[bucketOf(row)]) return false
    if (mergedFilters.macroFilter) {
      if (row.source !== 'console' || entryMacroId(row.entry) !== mergedFilters.macroFilter) {
        return false
      }
    }
    if (q) {
      const text = row.source === 'log'
        ? `${row.entry.line} ${row.entry.logger}`
        : flattenEntry(row.entry)
      if (!text.toLowerCase().includes(q)) return false
    }
    return true
  })
})

/** 各级别桶计数(侧栏用;统计合并视图全量,不受过滤影响) */
export const bucketCounts = computed(() => {
  const counts = {
    all: mergedRows.value.length,
    verbose: 0,
    info: 0,
    warn: 0,
    error: 0,
  }
  for (const row of mergedRows.value) counts[bucketOf(row)]++
  return counts
})

/** 清空合并视图(清屏按钮) */
export function clearMergedView(): void {
  logs.entries = []
  scriptConsole.entries = []
}

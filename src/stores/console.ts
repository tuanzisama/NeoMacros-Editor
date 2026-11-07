/**
 * 脚本控制台:/console 环形回放 + SSE `console` 事件增量。
 * 重连后(status 变 open)从 lastSeq 补洞;`clear` 条目按浏览器语义清空
 * 合并视图(宿主日志一并清,seq 游标保留)。每条追加打上共享单调 arrival
 * 戳,供合并控制台的单一时间线排序;过滤与展示在 mergedConsole。
 */

import { reactive, watch } from 'vue'
import { getConsole } from '@/api/endpoints'
import { sse } from '@/api/sse'
import { nextArrival } from './arrival'
import { clearView as clearLogView } from './logs'
import { macros } from './macros'
import { formatMs, stringifyNode } from '@/components/devtools/consoleFormat'
import type { ConsoleEntry } from '@/types/api'

const MAX_ENTRIES = 2000

/** 一条脚本控制台条目:附合并视图用的到达序号 */
export type ConsoleRow = ConsoleEntry & { arrival: number }

interface ConsoleState {
  entries: ConsoleRow[]
  lastSeq: number
  error: string
}

export const scriptConsole = reactive<ConsoleState>({
  entries: [],
  lastSeq: 0,
  error: '',
})

/** manifest 名 → 完整 id（category/name）；宏列表缺失时回退原名 */
export function resolveMacroId(macroName: string): string {
  const found = macros.macros.find((m) => m.name === macroName)
  return found ? found.id : macroName
}

/** 条目的完整宏 id */
export function entryMacroId(entry: ConsoleEntry): string {
  return resolveMacroId(entry.macro)
}

/** 一条消息的扁平文本（搜索与提示用）：参数节点按展示口径拼接 */
export function flattenEntry(entry: ConsoleEntry): string {
  const parts = entry.args.map((node) => stringifyNode(node))
  if (entry.kind === 'count') parts.push(`${entry.label}: ${entry.count}`)
  if (entry.kind === 'time' || entry.kind === 'timeEnd') {
    parts.push(`${entry.label}: ${formatMs(entry.ms ?? 0)}`)
  }
  if (entry.kind === 'input') return String(parts[0] ?? '')
  return parts.join(' ')
}

function append(entry: ConsoleEntry): void {
  if (entry.seq <= scriptConsole.lastSeq) return
  scriptConsole.lastSeq = entry.seq
  if (entry.kind === 'clear') {
    // 浏览器语义：clear 清空之前的合并视图（seq 游标保留；宿主日志一并清）
    scriptConsole.entries = []
    clearLogView()
    return
  }
  scriptConsole.entries.push({ ...entry, arrival: nextArrival() })
  if (scriptConsole.entries.length > MAX_ENTRIES) {
    scriptConsole.entries.splice(0, scriptConsole.entries.length - MAX_ENTRIES)
  }
}

function appendAll(entries: ConsoleEntry[]): void {
  for (const entry of entries) append(entry)
}

/** 初始回放 + 断线补洞。0 起点全量；有游标时只拉缺口。 */
async function replay(after: number): Promise<void> {
  try {
    const res = await getConsole(after)
    scriptConsole.error = ''
    if (after === 0) scriptConsole.entries = []
    appendAll(res.entries)
    if (res.lastSeq > scriptConsole.lastSeq) scriptConsole.lastSeq = res.lastSeq
  } catch (e) {
    scriptConsole.error = e instanceof Error ? e.message : String(e)
  }
}

let started = false
let bound = false

/** SSE 事件绑定（幂等注册）：实时追加 + 重连补洞 */
export function bindConsoleSse(): void {
  if (bound) return
  bound = true
  sse.onConsole((entry) => append(entry))
  watch(
    sse.status,
    (status) => {
      // 重连补洞：断线期间的输出靠环形回放找回
      if (status === 'open' && started && scriptConsole.lastSeq > 0) {
        void replay(scriptConsole.lastSeq)
      }
    },
  )
}

export function startConsole(): void {
  scriptConsole.entries = []
  scriptConsole.lastSeq = 0
  scriptConsole.error = ''
  bindConsoleSse()
  void replay(0)
  started = true
}

export function stopConsole(): void {
  started = false
}

export function clearConsoleView(): void {
  scriptConsole.entries = []
}

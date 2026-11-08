/**
 * 内存面板：/memory 环形回放 + SSE `memory:sample` 增量。重连后(status 变
 * open)从 lastSeq 补洞。每条样本：JVM 堆 + 逐脚本累计分配（增长/泄漏信号，
 * 非实时堆占用——GC 不按脚本归因）。派生序列供 uPlot 绘制：
 *  - jvmSeries/graalSeries：随时间的字节数
 *  - scriptSeries(taskId)：单个脚本（含死脚本——曲线止于最后一次出现）
 * 死脚本最终值可从 tasksStore 的 memBytes（停止时冻结）读取。
 * 采样同时轻量回写任务表内存列（updateTaskMemory）。
 */

import { computed, reactive, watch } from 'vue'
import { getMemory } from '@/api/endpoints'
import { sse } from '@/api/sse'
import type { MemorySample, ScriptMemory } from '@/types/api'
import { tasksStore, updateTaskMemory } from './tasks'

/** 编辑器侧保留上限：1h @ 1s（mod 端 ring 1800 点只用于断线补洞） */
const MAX_ENTRIES = 3600

interface MemoryState {
  entries: MemorySample[]
  lastSeq: number
  error: string
  /** true = 暂停捕获（实时样本丢弃，游标仍推进） */
  paused: boolean
}

export const memory = reactive<MemoryState>({
  entries: [],
  lastSeq: 0,
  error: '',
  paused: false,
})

function append(sample: MemorySample): void {
  if (sample.seq <= memory.lastSeq) return
  memory.lastSeq = sample.seq
  // 每条采样回写任务表内存列（运行中/已停止任务都以最新值为准）
  for (const script of sample.scripts) {
    if (script.taskId > 0) updateTaskMemory(script.taskId, script.bytes)
  }
  if (memory.paused) return
  memory.entries.push(sample)
  if (memory.entries.length > MAX_ENTRIES) {
    memory.entries.splice(0, memory.entries.length - MAX_ENTRIES)
  }
}

/** 初始回放 + 断线补洞。0 起点全量；有游标时只拉缺口。 */
async function replay(after: number): Promise<void> {
  try {
    const res = await getMemory(after)
    memory.error = ''
    if (after === 0) memory.entries = []
    for (const sample of res.samples) append(sample)
    if (res.lastSeq > memory.lastSeq) memory.lastSeq = res.lastSeq
  } catch (e) {
    memory.error = e instanceof Error ? e.message : String(e)
  }
}

/** uPlot 数据格式：[时间戳数组, ...值数组]；值允许 null（缺采样断点） */
export type UplotData = [number[], ...(number | null)[][]]

/** 每个脚本 taskId → 最新一次出现的 ScriptMemory（含死脚本的最后值） */
export const scriptLatest = computed<Map<number, ScriptMemory>>(() => {
  const map = new Map<number, ScriptMemory>()
  for (const sample of memory.entries) {
    for (const script of sample.scripts) {
      map.set(script.taskId, script)
    }
  }
  return map
})

/** 脚本列表（taskId 升序，稳定排序；带出现过的最新元数据） */
export const scriptList = computed<ScriptMemory[]>(() => {
  const list = [...scriptLatest.value.values()]
  return list.sort((a, b) => a.taskId - b.taskId)
})

/** 任务是否已停止（死脚本：灰显 + 曲线止于死亡点）。查任务表，未知按运行中处理 */
export function taskDead(taskId: number): boolean {
  return (
    !tasksStore.active.some((t) => t.id === taskId) &&
    tasksStore.history.some((t) => t.id === taskId)
  )
}

let started = false
let bound = false

/** SSE 事件绑定（幂等注册）：实时追加 + 重连补洞 */
export function bindMemorySse(): void {
  if (bound) return
  bound = true
  sse.onMemory((sample) => append(sample))
  watch(
    sse.status,
    (status) => {
      // 重连补洞：断线期间的采样靠环形回放找回
      if (status === 'open' && started && memory.lastSeq > 0) {
        void replay(memory.lastSeq)
      }
    },
  )
}

export function startMemory(): void {
  memory.entries = []
  memory.lastSeq = 0
  memory.error = ''
  bindMemorySse()
  void replay(0)
  started = true
}

export function stopMemory(): void {
  started = false
}

/** 清空当前视图（保留游标，避免重放整段历史） */
export function clearMemoryView(): void {
  memory.entries = []
}

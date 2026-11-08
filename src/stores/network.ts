/**
 * 网络面板:/network 环形回放 + SSE `network` 事件增量。重连后(status 变
 * open)从 lastSeq 补洞。每条追加打上共享单调 arrival 戳;`paused` 时实时
 * 事件丢弃(Chrome 录制开关语义,游标仍推进),回放不受影响;过滤状态也放
 * 这里,标签切换(组件重挂载)后保留。
 */

import { computed, reactive, watch } from 'vue'
import { getNetwork } from '@/api/endpoints'
import { sse } from '@/api/sse'
import { nextArrival } from './arrival'
import type { NetworkEntry } from '@/types/api'

const MAX_ENTRIES = 1000

/** 一条请求记录:附到达序号 */
export type NetworkRow = NetworkEntry & { arrival: number }

/** 状态筛选：'' 全部 / '2'..'5' 状态段 / 'failed' 失败 */
export type StatusBucket = '' | '2' | '3' | '4' | '5' | 'failed'

/** 详情面板标签（Chrome DevTools Network 口径） */
export type DetailTab = 'headers' | 'payload' | 'response' | 'initiator' | 'timing'

interface NetworkState {
  entries: NetworkRow[]
  lastSeq: number
  error: string
  /** true = 暂停捕获（工具栏录制开关） */
  paused: boolean
  /** 过滤：URL / 发起者 / 方法 / 错误 包含匹配 */
  search: string
  /** 状态筛选：'' 全部 / '2'..'5' 状态段 / 'failed' 失败（AppSelect 直绑，取原值） */
  statusFilter: string
  /** 详情面板当前标签（切 DevTools 标签后保留） */
  detailTab: DetailTab
}

export const network = reactive<NetworkState>({
  entries: [],
  lastSeq: 0,
  error: '',
  paused: false,
  search: '',
  statusFilter: '',
  detailTab: 'headers',
})

function append(entry: NetworkEntry): void {
  if (entry.seq <= network.lastSeq) return
  network.lastSeq = entry.seq
  if (network.paused) return
  network.entries.push({ ...entry, arrival: nextArrival() })
  if (network.entries.length > MAX_ENTRIES) {
    network.entries.splice(0, network.entries.length - MAX_ENTRIES)
  }
}

function appendAll(entries: NetworkEntry[]): void {
  for (const entry of entries) append(entry)
}

/** 行的失败归属：error 非空 = 失败 */
export function isFailed(row: NetworkRow): boolean {
  return row.error != null
}

/** 过滤后的行（按记录顺序，新的在底部） */
export const filteredRequests = computed<NetworkRow[]>(() => {
  const needle = network.search.trim().toLowerCase()
  return network.entries.filter((row) => {
    if (network.statusFilter === 'failed') {
      if (!isFailed(row)) return false
    } else if (network.statusFilter !== '') {
      const status = row.status ?? 0
      if (status === 0 || Math.floor(status / 100) !== Number(network.statusFilter)) return false
    }
    if (needle !== '') {
      const hay = `${row.url} ${row.method} ${row.initiator ?? ''} ${row.error ?? ''}`.toLowerCase()
      if (!hay.includes(needle)) return false
    }
    return true
  })
})

/** 初始回放 + 断线补洞。0 起点全量；有游标时只拉缺口。 */
async function replay(after: number): Promise<void> {
  try {
    const res = await getNetwork(after)
    network.error = ''
    if (after === 0) network.entries = []
    appendAll(res.entries)
    if (res.lastSeq > network.lastSeq) network.lastSeq = res.lastSeq
  } catch (e) {
    network.error = e instanceof Error ? e.message : String(e)
  }
}

let started = false
let bound = false

/** SSE 事件绑定（幂等注册）：实时追加 + 重连补洞 */
export function bindNetworkSse(): void {
  if (bound) return
  bound = true
  sse.onNetwork((entry) => append(entry))
  watch(
    sse.status,
    (status) => {
      // 重连补洞：断线期间的记录靠环形回放找回（游标推进不受暂停影响）
      if (status === 'open' && started && network.lastSeq > 0) {
        void replay(network.lastSeq)
      }
    },
  )
}

export function startNetwork(): void {
  network.entries = []
  network.lastSeq = 0
  network.error = ''
  bindNetworkSse()
  void replay(0)
  started = true
}

export function stopNetwork(): void {
  started = false
}

export function clearNetworkView(): void {
  network.entries = []
}

/**
 * SSE 事件流管理（§6）：一次性 ticket（30s）→ EventSource ?ticket=。
 * 401/掉线自动重取 ticket 重连（带退避）；server:shutdown 转入重连中状态。
 */

import { ref } from 'vue'
import { client } from './client'
import { eventsTicket } from './endpoints'
import type {
  ConfigChangedEvent,
  ConsoleEntry,
  FileChangedEvent,
  LogEntry,
  MacroStateEvent,
  MacrosChangedEvent,
  MemorySample,
  NetworkEntry,
  TaskEntry,
  UpdateAvailableEvent,
} from '@/types/api'

export type SseStatus = 'off' | 'connecting' | 'open' | 'reconnecting'

type Handler<T> = (data: T) => void

/** 一条 `segment` 帧的信封（超限事件分片；mod 端 SseHub.MAX_EVENT_BYTES） */
interface SegmentEnvelope {
  /** 原始事件名（重组后按此路由） */
  ev: string
  /** 分片组 id（一次 broadcast 一个） */
  id: number
  /** 组内序号（0 起） */
  i: number
  /** 组内分片总数 */
  total: number
  /** 原始 JSON 负载的切片 */
  data: string
}

/** 单组分片的组装态 */
interface SegmentGroup {
  ev: string
  total: number
  parts: string[]
  received: number
}

/** 同时在组装的分片组上限（超出丢最旧；断线后残组由环形回放补齐） */
const MAX_SEGMENT_GROUPS = 8
/** 单组分片数上限（mod 端 16 KiB/片 → 1 GiB 负载，正常结果远低于此） */
const MAX_SEGMENT_TOTAL = 65_536

export class SseManager {
  status = ref<SseStatus>('off')
  private source: EventSource | null = null
  private stopped = true
  private retryTimer: ReturnType<typeof setTimeout> | null = null
  private retryDelayMs = 1000

  private logHandlers = new Set<Handler<LogEntry>>()
  private consoleHandlers = new Set<Handler<ConsoleEntry>>()
  private networkHandlers = new Set<Handler<NetworkEntry>>()
  private memoryHandlers = new Set<Handler<MemorySample>>()
  private macroStateHandlers = new Set<Handler<MacroStateEvent>>()
  private macrosChangedHandlers = new Set<Handler<MacrosChangedEvent>>()
  private taskStateHandlers = new Set<Handler<TaskEntry>>()
  private fileChangedHandlers = new Set<Handler<FileChangedEvent>>()
  private configChangedHandlers = new Set<Handler<ConfigChangedEvent>>()
  private pairingPendingHandlers = new Set<Handler<{ label: string }>>()
  private updateHandlers = new Set<Handler<UpdateAvailableEvent>>()
  private shutdownHandlers = new Set<Handler<void>>()
  private deadHandlers = new Set<Handler<void>>()
  /** 连续取票失败次数（连上即清零）；达到阈值判「服务已死」，触发 onDead */
  private failureStreak = 0
  /** 分片组装缓冲：组 id → 已收到的分片（超限事件在 mod 端拆分） */
  private segments = new Map<number, SegmentGroup>()

  onLog(fn: Handler<LogEntry>): () => void {
    this.logHandlers.add(fn)
    return () => this.logHandlers.delete(fn)
  }

  onConsole(fn: Handler<ConsoleEntry>): () => void {
    this.consoleHandlers.add(fn)
    return () => this.consoleHandlers.delete(fn)
  }

  onNetwork(fn: Handler<NetworkEntry>): () => void {
    this.networkHandlers.add(fn)
    return () => this.networkHandlers.delete(fn)
  }

  onMemory(fn: Handler<MemorySample>): () => void {
    this.memoryHandlers.add(fn)
    return () => this.memoryHandlers.delete(fn)
  }

  onMacroState(fn: Handler<MacroStateEvent>): () => void {
    this.macroStateHandlers.add(fn)
    return () => this.macroStateHandlers.delete(fn)
  }

  onMacrosChanged(fn: Handler<MacrosChangedEvent>): () => void {
    this.macrosChangedHandlers.add(fn)
    return () => this.macrosChangedHandlers.delete(fn)
  }

  onTaskState(fn: Handler<TaskEntry>): () => void {
    this.taskStateHandlers.add(fn)
    return () => this.taskStateHandlers.delete(fn)
  }

  onFileChanged(fn: Handler<FileChangedEvent>): () => void {
    this.fileChangedHandlers.add(fn)
    return () => this.fileChangedHandlers.delete(fn)
  }

  onConfigChanged(fn: Handler<ConfigChangedEvent>): () => void {
    this.configChangedHandlers.add(fn)
    return () => this.configChangedHandlers.delete(fn)
  }

  onPairingPending(fn: Handler<{ label: string }>): () => void {
    this.pairingPendingHandlers.add(fn)
    return () => this.pairingPendingHandlers.delete(fn)
  }

  onUpdate(fn: Handler<UpdateAvailableEvent>): () => void {
    this.updateHandlers.add(fn)
    return () => this.updateHandlers.delete(fn)
  }

  onShutdown(fn: Handler<void>): () => void {
    this.shutdownHandlers.add(fn)
    return () => this.shutdownHandlers.delete(fn)
  }

  /**
   * 服务判死回调：无 server:shutdown 的硬断线（游戏崩溃/强杀）下，连续三次取票
   * 失败即认定服务不在了，调用方应停止 SSE 并转入连接级自愈重连。
   */
  onDead(fn: Handler<void>): () => void {
    this.deadHandlers.add(fn)
    return () => this.deadHandlers.delete(fn)
  }

  start(): void {
    if (!client.isPaired()) return
    this.stopped = false
    this.retryDelayMs = 1000
    void this.connect()
  }

  stop(): void {
    this.stopped = true
    this.clearRetry()
    this.closeSource()
    this.status.value = 'off'
  }

  restart(): void {
    this.stop()
    this.start()
  }

  private clearRetry(): void {
    if (this.retryTimer !== null) {
      clearTimeout(this.retryTimer)
      this.retryTimer = null
    }
  }

  private closeSource(): void {
    if (this.source) {
      this.source.close()
      this.source = null
    }
    // 断线丢弃未完成的分片组：重连后环形回放会补上整条 entry，
    // 残缺片段拼不出合法 JSON，留在缓冲里只会污染下一条同 id 组。
    this.segments.clear()
  }

  private async connect(): Promise<void> {
    if (this.stopped || !client.isPaired()) {
      // 已不再配对（降级/断开）：结束重连循环并复位状态
      if (!client.isPaired()) this.status.value = 'off'
      return
    }
    this.closeSource()
    this.status.value = this.retryDelayMs > 1000 ? 'reconnecting' : 'connecting'
    let ticket: string
    try {
      ticket = (await eventsTicket()).ticket
    } catch {
      this.failureStreak++
      if (this.failureStreak >= 3) {
        for (const fn of this.deadHandlers) fn()
      }
      this.scheduleRetry()
      return
    }
    const source = new EventSource(`${client.baseUrl}/api/v1/events?ticket=${encodeURIComponent(ticket)}`)
    this.source = source

    source.onopen = () => {
      this.status.value = 'open'
      this.retryDelayMs = 1000
      this.failureStreak = 0
    }
    source.onerror = () => {
      // ticket 一次性/过期或连接断开：关闭并换新票重连（EventSource 不自动带新票）
      source.close()
      if (this.source === source) this.source = null
      if (!this.stopped) this.scheduleRetry()
    }

    source.addEventListener('log', (e) => this.dispatch(this.logHandlers, e.data))
    source.addEventListener('console', (e) => this.dispatch(this.consoleHandlers, e.data))
    source.addEventListener('network', (e) => this.dispatch(this.networkHandlers, e.data))
    source.addEventListener('macro:state', (e) => this.dispatch(this.macroStateHandlers, e.data))
    source.addEventListener('macros:changed', (e) =>
      this.dispatch(this.macrosChangedHandlers, e.data),
    )
    source.addEventListener('memory:sample', (e) => this.dispatch(this.memoryHandlers, e.data))
    source.addEventListener('task:state', (e) => this.dispatch(this.taskStateHandlers, e.data))
    source.addEventListener('file:changed', (e) => this.dispatch(this.fileChangedHandlers, e.data))
    source.addEventListener('config:changed', (e) => this.dispatch(this.configChangedHandlers, e.data))
    source.addEventListener('pairing:pending', (e) => this.dispatch(this.pairingPendingHandlers, e.data))
    source.addEventListener('update:available', (e) => this.dispatch(this.updateHandlers, e.data))
    source.addEventListener('segment', (e) => this.onSegment(e.data))
    source.addEventListener('server:shutdown', () => {
      for (const fn of this.shutdownHandlers) fn()
      // 优雅停机：转重连态，持续探测直到服务回来
      if (!this.stopped) this.scheduleRetry()
    })
  }

  /**
   * 组装一条被 mod 端按 64 KiB 上限拆分的事件：按组 id 攒齐分片、
   * 拼回原始 JSON 后按 ev 路由，行为与未分片的直发帧一致。
   * 分片在服务端同一把锁内连续写出，同组内不会与其他事件交错。
   */
  private onSegment(raw: string | null): void {
    if (raw === null) return
    let segment: SegmentEnvelope
    try {
      segment = JSON.parse(raw) as SegmentEnvelope
    } catch {
      return
    }
    if (
      typeof segment.ev !== 'string' ||
      typeof segment.id !== 'number' ||
      !Number.isInteger(segment.i) ||
      !Number.isInteger(segment.total) ||
      segment.total < 1 ||
      segment.total > MAX_SEGMENT_TOTAL ||
      segment.i < 0 ||
      segment.i >= segment.total ||
      typeof segment.data !== 'string'
    ) {
      return
    }
    let group = this.segments.get(segment.id)
    if (!group) {
      if (segment.i !== 0) {
        // 组头已丢（理论上仅在写入中途断线时出现）：整组放弃，等回放补
        return
      }
      if (this.segments.size >= MAX_SEGMENT_GROUPS) {
        const oldest = this.segments.keys().next().value
        if (oldest !== undefined) this.segments.delete(oldest)
      }
      group = { ev: segment.ev, total: segment.total, parts: [], received: 0 }
      this.segments.set(segment.id, group)
    }
    if (group.parts[segment.i] !== undefined) return
    group.parts[segment.i] = segment.data
    group.received++
    if (group.received < group.total) return
    this.segments.delete(segment.id)
    this.route(group.ev, group.parts.join(''))
  }

  /** 按原始事件名把重组后的负载派发到对应的处理器集。 */
  private route(ev: string, data: string): void {
    switch (ev) {
      case 'log':
        return this.dispatch(this.logHandlers, data)
      case 'console':
        return this.dispatch(this.consoleHandlers, data)
      case 'network':
        return this.dispatch(this.networkHandlers, data)
      case 'macro:state':
        return this.dispatch(this.macroStateHandlers, data)
      case 'macros:changed':
        return this.dispatch(this.macrosChangedHandlers, data)
      case 'memory:sample':
        return this.dispatch(this.memoryHandlers, data)
      case 'task:state':
        return this.dispatch(this.taskStateHandlers, data)
      case 'file:changed':
        return this.dispatch(this.fileChangedHandlers, data)
      case 'config:changed':
        return this.dispatch(this.configChangedHandlers, data)
      case 'pairing:pending':
        return this.dispatch(this.pairingPendingHandlers, data)
      case 'update:available':
        return this.dispatch(this.updateHandlers, data)
      default:
        // 未知事件名：与未注册的直发帧一样静默忽略
        return
    }
  }

  private dispatch<T>(handlers: Set<Handler<T>>, raw: string | null): void {
    if (raw === null) return
    try {
      const data = JSON.parse(raw) as T
      for (const fn of handlers) fn(data)
    } catch {
      /* 忽略坏帧 */
    }
  }

  private scheduleRetry(): void {
    if (this.stopped || this.retryTimer !== null) return
    this.status.value = 'reconnecting'
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null
      void this.connect()
      this.retryDelayMs = Math.min(this.retryDelayMs * 2, 8000)
    }, this.retryDelayMs)
  }
}

export const sse = new SseManager()

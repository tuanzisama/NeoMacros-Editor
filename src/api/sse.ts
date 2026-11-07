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
  NetworkEntry,
  TaskEntry,
} from '@/types/api'

export type SseStatus = 'off' | 'connecting' | 'open' | 'reconnecting'

type Handler<T> = (data: T) => void

export class SseManager {
  status = ref<SseStatus>('off')
  private source: EventSource | null = null
  private stopped = true
  private retryTimer: ReturnType<typeof setTimeout> | null = null
  private retryDelayMs = 1000

  private logHandlers = new Set<Handler<LogEntry>>()
  private consoleHandlers = new Set<Handler<ConsoleEntry>>()
  private networkHandlers = new Set<Handler<NetworkEntry>>()
  private macroStateHandlers = new Set<Handler<MacroStateEvent>>()
  private macrosChangedHandlers = new Set<Handler<MacrosChangedEvent>>()
  private taskStateHandlers = new Set<Handler<TaskEntry>>()
  private fileChangedHandlers = new Set<Handler<FileChangedEvent>>()
  private configChangedHandlers = new Set<Handler<ConfigChangedEvent>>()
  private pairingPendingHandlers = new Set<Handler<{ label: string }>>()
  private shutdownHandlers = new Set<Handler<void>>()
  private deadHandlers = new Set<Handler<void>>()
  /** 连续取票失败次数（连上即清零）；达到阈值判「服务已死」，触发 onDead */
  private failureStreak = 0

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
    source.addEventListener('task:state', (e) => this.dispatch(this.taskStateHandlers, e.data))
    source.addEventListener('file:changed', (e) => this.dispatch(this.fileChangedHandlers, e.data))
    source.addEventListener('config:changed', (e) => this.dispatch(this.configChangedHandlers, e.data))
    source.addEventListener('pairing:pending', (e) => this.dispatch(this.pairingPendingHandlers, e.data))
    source.addEventListener('server:shutdown', () => {
      for (const fn of this.shutdownHandlers) fn()
      // 优雅停机：转重连态，持续探测直到服务回来
      if (!this.stopped) this.scheduleRetry()
    })
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

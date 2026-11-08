/**
 * 更新通知状态：mod 检查到新版本后经 SSE update:available 推送过来。
 * 会话内最新一条通知驱动 UpdateBanner；「忽略」按 channel@version 记在
 * localStorage（跨会话生效）。SSE 无历史，断线重连不会重放旧通知，下一
 * 轮检查命中会再次推送。
 */
import { reactive } from 'vue'
import { sse } from '@/api/sse'
import type { UpdateAvailableEvent } from '@/types/api'

const IGNORED_KEY = 'neomacros-panel-ignored-updates-v1'

function loadIgnored(): string[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(IGNORED_KEY) ?? '[]')
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : []
  } catch {
    return []
  }
}

/** 忽略表的键：渠道@版本 */
export function updateKey(event: UpdateAvailableEvent): string {
  return `${event.channel}@${event.latest}`
}

export const updates = reactive({
  /** 最新一条更新通知；null = 无待展示的通知 */
  latest: null as UpdateAvailableEvent | null,
  /** 推送时携带的当前版本（横幅文案对照用） */
  current: '',
  /** 跨会话忽略的 channel@version 列表 */
  ignored: loadIgnored(),
})

let bound = false

/** SSE 事件绑定（幂等注册） */
export function bindUpdateSse(): void {
  if (bound) return
  bound = true
  sse.onUpdate((event) => {
    if (updates.ignored.includes(updateKey(event))) return
    updates.current = event.current
    updates.latest = event
  })
}

/** 关闭横幅（仅本会话不再显示，不影响忽略表） */
export function dismissUpdate(): void {
  updates.latest = null
}

/** 忽略该版本（跨会话不再提示） */
export function ignoreUpdate(): void {
  if (updates.latest) {
    const key = updateKey(updates.latest)
    if (!updates.ignored.includes(key)) {
      updates.ignored.push(key)
    }
    try {
      localStorage.setItem(IGNORED_KEY, JSON.stringify(updates.ignored))
    } catch {
      /* 存储失败只影响跨会话忽略，会话内仍然生效 */
    }
  }
  updates.latest = null
}

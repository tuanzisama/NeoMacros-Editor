/**
 * 类型化端点封装。W1 已实现端点直接可用；
 * W2（宏增删/设备）与 W3（文件）按 11-web-panel.md 契约预实现，404 = mod 侧尚未落地。
 */

import { client } from './client'
import { sha256B64Url } from './nm1'
import { ApiError } from '@/types/api'
import type {
  ConsoleEvalRequest,
  ConsoleResponse,
  CreateMacroRequest,
  DeviceRecord,
  EventCatalog,
  EventCatalogEntry,
  FileSaveResult,
  LogEntry,
  LocatedError,
  LogsResponse,
  MacroAction,
  MacroCategory,
  MacroView,
  Meta,
  NetworkResponse,
  StateSnapshot,
  TasksResponse,
} from '@/types/api'

/** 配对请求（§4）：同步单次，成功即返回 clientId；token 必填（深链一次性令牌） */
export interface PairRequest {
  token: string
  label: string
  algo: string
  pubJwk: Record<string, string>
}

export interface PairResponse {
  clientId: string
}

/** 免 token 配对申请（§4.1）：仅限本机回环 + Origin 白名单，首次需游戏内确认 */
export interface PairApplyRequest {
  label: string
  algo: string
  pubJwk: Record<string, string>
}

/** 免 token 配对申请应答：paired（信任本机时）或 pending（等游戏内决定） */
export interface PairApplyResponse {
  status: 'paired' | 'pending'
  requestId?: string
  clientId?: string
  expiresIn?: number
}

/** 免 token 配对轮询应答 */
export interface PairApplyStatus {
  status: 'pending' | 'approved' | 'denied' | 'expired'
  clientId?: string
}

export interface TicketResponse {
  ticket: string
  expiresIn: number
}

export interface MacroFile {
  text: string
  etag: string
}

/** 免签首探（§D8 版本协商） */
export async function getMeta(): Promise<Meta> {
  const res = await client.request('GET', '/api/v1/meta', { unsigned: true })
  return res.json() as Meta
}

/** 配对（§4）：token 单次有效，配对即生效返回 clientId */
export async function pair(request: PairRequest): Promise<PairResponse> {
  const res = await client.request('POST', '/api/v1/pair', {
    unsigned: true,
    body: JSON.stringify(request),
  })
  return res.json() as PairResponse
}

/**
 * 免 token 配对申请（§4.1，免签）。mod 侧未实现时 404 → 视为不支持，
 * 调用方回落到 token 配对；403 = Origin 不在白名单或非本机回环来源。
 */
export async function requestPair(req: PairApplyRequest): Promise<PairApplyResponse> {
  const res = await client.request('POST', '/api/v1/pair-request', {
    unsigned: true,
    body: JSON.stringify(req),
  })
  return res.json() as PairApplyResponse
}

/** 轮询一次免 token 配对申请的决定（免签）；未知 id → expired */
export async function getPairRequest(id: string): Promise<PairApplyStatus> {
  const res = await client.request('GET', `/api/v1/pair-request/${id}`, { unsigned: true })
  return res.json() as PairApplyStatus
}

export async function getState(): Promise<StateSnapshot> {
  const res = await client.request('GET', '/api/v1/state')
  return res.json() as StateSnapshot
}

export async function macroAction(id: string, action: MacroAction): Promise<MacroView> {
  const res = await client.request('POST', `/api/v1/macros/${id}/${action}`)
  return res.json() as MacroView
}

/** W2：新建宏（409=重名，422=非法） */
export async function createMacro(req: CreateMacroRequest): Promise<MacroView> {
  const res = await client.request('POST', '/api/v1/macros', {
    body: JSON.stringify(req),
  })
  return res.json() as MacroView
}

/** W2：删除宏目录（不可恢复） */
export async function deleteMacro(id: string): Promise<void> {
  await client.request('DELETE', `/api/v1/macros/${id}`, { body: JSON.stringify({ confirm: true }) })
}

/** W4 契约：列宏目录内容（递归相对 POSIX 路径）。dirs 缺省视为空数组（dirs 增补待 mod 实现） */
export interface MacroDirListing {
  files: string[]
  dirs: string[]
}

/**
 * W4 契约：列宏目录文件+子目录。
 * mod 侧未实现时 404 → 调用方回落「neomacro.yml + 清单 main 入口」。
 */
export async function listMacroFiles(id: string): Promise<MacroDirListing> {
  const res = await client.request('GET', `/api/v1/macros/${id}/files`)
  const data = res.json() as { files?: unknown; dirs?: unknown }
  if (!Array.isArray(data.files)) throw new ApiError(200, 'internal', 'files 响应不合法')
  return {
    files: data.files.filter((f): f is string => typeof f === 'string'),
    dirs: Array.isArray(data.dirs) ? data.dirs.filter((d): d is string => typeof d === 'string') : [],
  }
}

/** W5 契约：删除文件/目录（目录递归；neomacro.yml 受保护 422/403）。mod 未实现时 404 */
export async function deleteFile(path: string): Promise<void> {
  await client.request('DELETE', `/api/v1/files/${path}`, { body: JSON.stringify({ confirm: true }) })
}

/** W5 契约：移动/重命名（同宏根内；目标存在 409；清单受保护 403）。mod 未实现时 404 */
export async function moveFile(from: string, to: string): Promise<void> {
  await client.request('POST', '/api/v1/files/move', {
    body: JSON.stringify({ from, to }),
  })
}

/** W5 契约：递归建目录（已存在 409）。mod 未实现时 404 */
export async function mkdirPath(path: string): Promise<void> {
  await client.request('POST', '/api/v1/files/mkdir', {
    body: JSON.stringify({ path }),
  })
}

/** W2：受信设备列表 */
export async function listDevices(): Promise<DeviceRecord[]> {
  const res = await client.request('GET', '/api/v1/devices')
  const data = res.json() as { devices?: DeviceRecord[] } | DeviceRecord[]
  return Array.isArray(data) ? data : (data.devices ?? [])
}

/** W2：吊销设备 */
export async function revokeDevice(id: string): Promise<void> {
  await client.request('DELETE', `/api/v1/devices/${id}`)
}

/** 移动宏到另一分类（面板剪切粘贴）。mod 端待实现：docs/mod-api-pending.md §7.1 */
export async function moveMacro(from: string, to: MacroCategory): Promise<MacroView> {
  const res = await client.request('POST', '/api/v1/macros/move', {
    body: JSON.stringify({ from, to }),
  })
  return res.json() as MacroView
}

/** 在系统文件管理器中打开（Explorer/访达/xdg-open）。mod 端待实现：docs/mod-api-pending.md §7.3 */
export async function revealPath(path: string): Promise<void> {
  await client.request('POST', '/api/v1/files/reveal', {
    body: JSON.stringify({ path }),
  })
}

export async function getLogs(after: number): Promise<LogsResponse> {
  const res = await client.request('GET', '/api/v1/logs', { query: { after } })
  return res.json() as LogsResponse
}

/** 脚本控制台环形回放。旧版 mod 无此端点：404 时静默回退为空。 */
export async function getConsole(after: number): Promise<ConsoleResponse> {
  try {
    const res = await client.request('GET', '/api/v1/console', { query: { after } })
    return res.json() as ConsoleResponse
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) {
      return { entries: [], lastSeq: after }
    }
    throw e
  }
}

/** neo.net 请求记录环形回放。旧版 mod 无此端点：404 时静默回退为空。 */
export async function getNetwork(after: number): Promise<NetworkResponse> {
  try {
    const res = await client.request('GET', '/api/v1/network', { query: { after } })
    return res.json() as NetworkResponse
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) {
      return { entries: [], lastSeq: after }
    }
    throw e
  }
}

/**
 * 拉取一条记录保留的完整请求/响应体（≤1MB，mod 侧按预算逐出）。
 * 404 = seq 不存在；410 = 记录时超限或已被预算挤出。错误原样抛出，
 * 由调用方在按钮处提示（不静默降级）。
 */
export async function getNetworkBody(
  seq: number,
  side: 'request' | 'response',
): Promise<{ bytes: ArrayBuffer; contentType: string }> {
  const res = await client.request('GET', `/api/v1/network/${seq}/body`, {
    query: { side: side === 'request' ? 'request' : undefined },
  })
  return {
    bytes: res.bytes,
    contentType: res.headers.get('Content-Type') ?? 'application/octet-stream',
  }
}

/**
 * DevTools 控制台 REPL：在独立 devtools 会话（target 缺省/'devtools'）或指定
 * 已加载宏的上下文里执行一个表达式。输入回显与结果已由 mod 端写入控制台环
 * （SSE 与回放同源，编辑器按 seq 去重，HTTP 应答只用于即时渲染）。
 * 504 eval_timeout = 表达式未在上下文循环预算内结算。
 */
export async function evalConsole(req: ConsoleEvalRequest): Promise<ConsoleResponse> {
  const res = await client.request('POST', '/api/v1/console/eval', {
    body: JSON.stringify(req),
  })
  return res.json() as ConsoleResponse
}

/** 任务管理器快照（活动 + 历史）。旧版 mod 无此端点：404 时静默回退为空。 */
export async function getTasks(): Promise<TasksResponse> {
  try {
    const res = await client.request('GET', '/api/v1/tasks')
    return res.json() as TasksResponse
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) {
      return { active: [], history: [] }
    }
    throw e
  }
}

/** 停止一条任务（卸载其宏）。404=未知任务，409=已停止。 */
export async function stopTask(id: number): Promise<TasksResponse> {
  const res = await client.request('POST', `/api/v1/tasks/${id}/stop`)
  return res.json() as TasksResponse
}

export async function eventsTicket(): Promise<TicketResponse> {
  const res = await client.request('POST', '/api/v1/events/ticket')
  return res.json() as TicketResponse
}

/**
 * 可订阅事件目录（配置弹窗「事件」下拉数据源）。
 * 旧版 mod 无此端点：404 → 返回 null，调用方降级为仅显示已声明事件。
 */
export async function getEventCatalog(): Promise<EventCatalog | null> {
  try {
    const res = await client.request('GET', '/api/v1/events/catalog')
    const data = res.json() as { events?: unknown }
    if (!Array.isArray(data.events)) throw new ApiError(200, 'internal', 'events 响应不合法')
    return {
      events: data.events.filter(
        (e): e is EventCatalogEntry => typeof (e as EventCatalogEntry)?.name === 'string',
      ),
    }
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) return null
    throw e
  }
}

/**
 * W3：读文本文件。服务端 ETag = sha256(content)；
 * 跨域未 expose ETag 头时按同口径本地计算，契约兼容。
 */
export async function readFile(path: string): Promise<MacroFile> {
  const res = await client.request('GET', `/api/v1/files/${path}`)
  const header = res.headers.get('ETag')
  const etag = header && header.length > 0 ? header.replace(/"/g, '') : await sha256B64Url(res.text)
  return { text: res.text, etag }
}

/** W3：写文本文件（If-Match 乐观并发；成功即热重载并回传 LocatedError）。优先取服务端返回的新 ETag */
export async function writeFile(path: string, content: string, etag: string): Promise<FileSaveResult> {
  const res = await client.request('PUT', `/api/v1/files/${path}`, {
    body: content,
    headers: { 'If-Match': etag },
  })
  const header = res.headers.get('ETag')
  const data = (res.json() ?? {}) as { error?: LocatedError | null; etag?: unknown }
  const bodyEtag = typeof data.etag === 'string' ? data.etag : null
  return { error: data.error ?? null, etag: (header && header.replace(/"/g, '')) || bodyEtag }
}

/** W3：409 冲突 → 取回服务端当前内容 */
export function conflictFrom(e: ApiError): { content: string; etag: string } | null {
  if (e.status !== 409 || typeof e.payload !== 'object' || e.payload === null) return null
  const p = e.payload as { content?: unknown; etag?: unknown; current?: unknown }
  const content =
    typeof p.content === 'string' ? p.content : typeof p.current === 'string' ? p.current : null
  if (content === null) return null
  const etag = typeof p.etag === 'string' ? p.etag : ''
  return { content, etag }
}

export type { LogEntry, LocatedError, LogsResponse, MacroView, Meta, StateSnapshot }

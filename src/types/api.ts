/**
 * NeoMacros Web Panel API 类型
 * 对齐 api-docs.json（W1 生成契约）+ 11-web-panel.md §5/§6/§8（W2/W3 设计契约）。
 */

export const MACRO_CATEGORIES = ['keypress', 'event', 'services'] as const
export type MacroCategory = (typeof MACRO_CATEGORIES)[number]

export const CATEGORY_LABELS: Record<MacroCategory, string> = {
  keypress: '按键',
  event: '事件',
  services: '服务',
}

export type Lifecycle = 'always' | 'world' | 'manual'

export const LIFECYCLE_LABELS: Record<Lifecycle, string> = {
  always: '常驻',
  world: '进世界',
  manual: '手动',
}

/** config.keypress 触发边沿（缺省 keypress） */
export const KEYPRESS_EDGES = ['keydown', 'keyup', 'keypress'] as const
export type KeypressEdge = (typeof KEYPRESS_EDGES)[number]

/** 一条可订阅事件（GET /api/v1/events/catalog 条目；EventDescriptor 投影） */
export interface EventCatalogEntry {
  name: string
  cancellable: boolean
}

export interface EventCatalog {
  events: EventCatalogEntry[]
}

/** M3 结构化错误（state.error / 文件保存回传） */
export interface LocatedError {
  script: string
  line?: number | null
  column?: number | null
  message: string
}

export interface MacroView {
  id: string // category/name
  category: MacroCategory
  name: string
  version: string
  author: string
  lifecycle: Lifecycle
  enabled: boolean // 自启意图
  running: boolean // 运行态
  key: string | null // effectiveKey，null=未绑定
  /** 声明的触发定义：keypress 边沿（keydown/keyup/keypress）或 event 事件名 */
  on: string[]
  /** keypress 要求的修饰键（ctrl/shift/alt） */
  modifiers: string[]
  permissions: string[]
  error: LocatedError | null
}

export interface ServerInfo {
  port: number
  uptimeMs: number
  listen: string
}

export interface StateSnapshot {
  macros: MacroView[]
  server: ServerInfo
  /**
   * 【待 mod 实现】宏目录根的磁盘绝对路径（如 `C:\Users\xxx\s\<mc>\config\neomacros\macros`），
   * 供面板「复制绝对路径」拼接；旧版 mod 无此字段，面板回退 `config/neomacros/macros` 口径。
   */
  macrosRoot?: string
}

export interface Meta {
  api: number[]
  modVersion: string
  gameVersion: string
}

export interface LogEntry {
  seq: number
  /** log4j 事件时间（epoch 毫秒）；旧版 mod 无此字段，合并视图按到达顺序兜底 */
  ts?: number
  level: string
  logger: string
  line: string
}

export interface LogsResponse {
  entries: LogEntry[]
  lastSeq: number
}

// ---- 脚本控制台（/api/v1/console + SSE console 事件契约）--------------------

/** 中立富文本节点（对齐 port 模型 ChatComponent；null = 继承） */
export interface RichComponent {
  text: string
  color?: string | null
  bold?: boolean | null
  italic?: boolean | null
  underlined?: boolean | null
  strikethrough?: boolean | null
  obfuscated?: boolean | null
  children?: RichComponent[]
}

/** 对象/数组节点的属性项 */
export interface ConsoleProp {
  k: string
  v: ConsoleNode
}

/** 结构化参数树：按 t 判别（对齐引擎 ConsoleValueFormatter） */
export type ConsoleNode =
  | { t: 'str'; v: string }
  | { t: 'num'; v: number | 'NaN' | 'Infinity' | '-Infinity' }
  | { t: 'bool'; v: boolean }
  | { t: 'null' }
  | { t: 'undef' }
  | { t: 'obj'; pre: string; props: ConsoleProp[]; n: number; tr: boolean }
  | { t: 'arr'; pre: string; len: number; items: ConsoleNode[]; tr: boolean }
  | { t: 'fn'; name: string }
  | { t: 'err'; name: string; msg: string; stack: string }
  | { t: 'class'; name: string }
  | { t: 'comp'; rich: RichComponent }
  | { t: 'host'; cls: string; pre: string; props?: ConsoleProp[] }

export type ConsoleKind =
  | 'log'
  | 'trace'
  | 'dir'
  | 'table'
  | 'count'
  | 'time'
  | 'timeEnd'
  | 'group'
  | 'groupEnd'
  | 'clear'
  | 'assert'
  /** DevTools REPL：回显的输入（args[0] = str 节点） */
  | 'input'
  /** DevTools REPL：结果（args[0] = 值节点或 err 节点，error 级别 = 表达式抛错） */
  | 'result'

export type ConsoleLevel = 'log' | 'info' | 'warn' | 'error' | 'debug'

/** 一条脚本 console 输出（SSE `console` 事件 / GET /api/v1/console 条目） */
export interface ConsoleEntry {
  seq: number
  /** 发射时刻 epoch 毫秒 */
  ts: number
  /** manifest 名（全局唯一；展示/过滤时经宏列表解析为完整 id `category/name`） */
  macro: string
  kind: ConsoleKind
  level: ConsoleLevel
  /** 宏目录内相对 POSIX 路径；null = 未能定位（虚拟模块等） */
  file: string | null
  line: number | null
  col: number | null
  /** group 嵌套层级 */
  depth: number
  args: ConsoleNode[]
  /** count/time 通道名 */
  label: string | null
  /** count 当前值 */
  count: number | null
  /** timeLog/timeEnd 计时（毫秒） */
  ms: number | null
  /** trace / assert 失败时的调用栈 */
  stack: string | null
}

export interface ConsoleResponse {
  entries: ConsoleEntry[]
  lastSeq: number
}

/** DevTools 控制台 REPL 请求（POST /api/v1/console/eval） */
export interface ConsoleEvalRequest {
  /** 'devtools'（缺省）= 独立会话；否则为已加载宏的 manifest 名 */
  target?: string
  expression: string
}

/** 一条 neo.net 请求记录（SSE `network` 事件 / GET /api/v1/network 条目） */
export interface NetworkEntry {
  seq: number
  /** 请求开始时刻 epoch 毫秒 */
  ts: number
  /** 大写 HTTP 方法 */
  method: string
  /** 完整 URL */
  url: string
  /** 发起请求的宏 manifest 名；null = devtools REPL 或引擎外调用 */
  initiator: string | null
  /** 发起宏的入口脚本路径；null 同 initiator */
  initiatorFile: string | null
  /** 脚本显式设置的请求头 */
  requestHeaders: Record<string, string> | null
  /** 请求体文本预览（超限截断） */
  requestBodyPreview: string | null
  /** true = 完整请求体（≤1MB）在 mod 侧保留，可经 body 端点拉取 */
  hasRequestBody: boolean
  requestBodyTruncated: boolean
  /** HTTP 状态码；null = 请求失败（连接/超时等） */
  status: number | null
  responseHeaders: Record<string, string> | null
  /** 响应体文本预览（文本类 Content-Type 才有；二进制为 null） */
  responseBodyPreview: string | null
  /** true = 完整响应体（≤1MB）在 mod 侧保留，可经 body 端点拉取 */
  hasResponseBody: boolean
  responseBodyTruncated: boolean
  /** true = 响应体为二进制，只有 size */
  responseBinary: boolean
  /** 响应体字节数；null = 请求失败 */
  size: number | null
  /** 总耗时毫秒；null = 请求失败 */
  durationMs: number | null
  /** 等待响应头阶段毫秒；null = 失败于收到响应头之前 */
  waitMs: number | null
  /** 内容下载阶段毫秒；null 同 waitMs */
  downloadMs: number | null
  /** 失败原因 "ClassName: message"；成功为 null */
  error: string | null
}

export interface NetworkResponse {
  entries: NetworkEntry[]
  lastSeq: number
}

export type MacroAction = 'enable' | 'disable' | 'start' | 'stop' | 'reload'

/** 一条宏任务（SSE `task:state` 事件 / GET /api/v1/tasks 条目） */
export interface TaskEntry {
  /** 唯一任务 id（本次游戏会话内自增） */
  id: number
  /** manifest 名 */
  macro: string
  category: MacroCategory
  status: 'running' | 'stopped'
  /** 启动方式：autostart / lifecycle / manual / reload */
  startedBy: string
  /** 激活时刻 epoch 毫秒 */
  startedAt: number
  /** 停止时刻 epoch 毫秒；0 = 运行中 */
  endedAt: number
  /** startup 触发次数 */
  triggers: number
  playerUuid: string | null
  playerName: string | null
  /** single / multi；未知为空 */
  gameType: string | null
  /** Integrated 或服务器地址；未知为空 */
  server: string | null
  mcVersion: string | null
}

export interface TasksResponse {
  active: TaskEntry[]
  history: TaskEntry[]
}

/** W2 契约：新建宏脚手架 */
export interface CreateMacroRequest {
  category: MacroCategory
  name: string
  description?: string
}

/** W2 契约：受信设备（DeviceRegistry 记录） */
export interface DeviceRecord {
  id: string
  label: string
  algo: string
  createdAt?: number
  lastSeenAt?: number
}

/** W3 契约：文件保存回传（热重载结果）。etag = 服务端给出的新 ETag（可能缺省，缺省时调用方本地计算兜底） */
export interface FileSaveResult {
  error: LocatedError | null
  etag: string | null
}

/** 宏目录根相对游戏目录的默认路径（契约 §12；core.macrosDir 可覆盖，面板按默认口径展示） */
export const MACROS_ROOT_REL = 'config/neomacros/macros'

/** W3 契约：409 冲突回传（当前内容 + etag，字段按设计文档做防御性解析） */
export interface FileConflict {
  content?: string
  etag?: string
}

export type ApiErrorCode =
  | 'unauthorized'
  | 'forbidden'
  | 'not_found'
  | 'conflict'
  | 'game_thread_timeout'
  | 'eval_timeout'
  | 'invalid_request'
  | 'timeout'
  | 'internal'

/** 统一错误（对齐服务端 {error:{code,message}}） */
export class ApiError extends Error {
  readonly status: number
  readonly code: string
  /** 409 文件冲突 / 冲突响应附带的负载 */
  readonly payload?: unknown

  constructor(status: number, code: string, message: string, payload?: unknown) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
    this.payload = payload
  }

  /** 面向用户的中文提示 */
  get label(): string {
    switch (this.code) {
      case 'unauthorized':
        return '未配对或签名验证失败'
      case 'forbidden':
        return '请求被拒绝（Host/来源/路径越界）'
      case 'not_found':
        return '资源不存在（或 mod 侧尚未实现该端点）'
      case 'conflict':
        return '内容冲突：文件已在别处被修改'
      case 'game_thread_timeout':
        return '游戏主线程无响应（5 秒超时）'
      case 'eval_timeout':
        return '表达式未在上下文循环预算内结算（30 秒超时）'
      case 'timeout':
        return '等待超时'
      case 'invalid_request':
        return '请求不合法'
      case 'internal':
        return '服务端内部错误'
      default:
        return this.message || '请求失败'
    }
  }
}

/** SSE 事件目录（§6） */
export type SseEventName =
  | 'log'
  | 'network'
  | 'macro:state'
  | 'macros:changed'
  | 'config:changed'
  | 'file:changed'
  | 'pairing:pending'
  | 'server:shutdown'

export interface MacroStateEvent {
  id: string
  enabled: boolean
  running: boolean
  error: LocatedError | null
}

/** 磁盘结构变更信号（宏文件夹/子目录/文件增删）→ 前端去抖全量刷新 */
export interface MacrosChangedEvent {
  reason: 'disk'
}

export interface FileChangedEvent {
  path: string
  by: 'web' | 'disk'
}

export interface ConfigChangedEvent {
  key: string
  value: unknown
}

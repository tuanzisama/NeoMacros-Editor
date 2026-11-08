/**
 * 控制台消息展示格式化（浏览器 DevTools 语义）：
 * %s/%d/%i/%f/%j/%o/%O 替换、%c 样式段、扁平化 stringify、count/time 文案、
 * MC 富文本调色板映射。只做展示层转换，不改 store 数据。
 */

import type { ConsoleEntry, ConsoleNode, RichComponent } from '@/types/api'

/** 毫秒数的展示口径 */
export function formatMs(ms: number): string {
  if (ms >= 1000) return `${(ms / 1000).toFixed(2)}s`
  return `${Math.round(ms * 100) / 100}ms`
}

/** 字节数的展示口径（网络面板 Size 列） */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} kB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`
}

/** 响应 Content-Type → Chrome 风格短类型（类型列；缺失回退 —） */
export function networkTypeLabel(contentType: string | null | undefined): string {
  if (!contentType) return '—'
  const ct = contentType.toLowerCase()
  if (ct.includes('json')) return 'json'
  if (ct.includes('html')) return 'html'
  if (ct.includes('javascript')) return 'js'
  if (ct.startsWith('text/css')) return 'css'
  if (ct.includes('xml')) return 'xml'
  if (ct.includes('yaml')) return 'yaml'
  if (ct.startsWith('text/')) return 'text'
  if (ct.startsWith('image/')) return 'img'
  if (ct.startsWith('audio/')) return 'audio'
  if (ct.startsWith('video/')) return 'video'
  if (ct.includes('octet-stream') || ct.startsWith('application/font')) return 'bin'
  return ct.split(';')[0]?.trim() || '—'
}

/** URL 的展示名（路径末段带查询；根路径回退主机名） */
export function networkName(url: string): string {
  try {
    const u = new URL(url)
    const path = u.pathname
    const tail = path.substring(path.lastIndexOf('/') + 1)
    const name = tail !== '' ? tail : u.hostname
    return `${name}${u.search}`
  } catch {
    return url
  }
}

/** 展示段：纯文本（可带 %c 内联样式）或一个结构化节点 */
export type DisplaySeg = { text: string; style?: string } | { node: ConsoleNode }

/** 节点的扁平文本（%s 等占位替换、搜索、title 提示用） */
export function stringifyNode(node: ConsoleNode): string {
  switch (node.t) {
    case 'str':
      return node.v
    case 'num':
    case 'bool':
      return String(node.v)
    case 'null':
      return 'null'
    case 'undef':
      return 'undefined'
    case 'fn':
      return `ƒ ${node.name}()`
    case 'arr':
      return `[${node.pre}]`
    case 'obj':
      return `{${node.pre}}`
    case 'err':
      return `${node.name}: ${node.msg}`
    case 'class':
      return `class ${node.name}`
    case 'comp':
      return flattenRich(node.rich)
    case 'host':
      return node.pre || node.cls
  }
}

export function flattenRich(rich: RichComponent): string {
  let out = rich.text
  for (const child of rich.children ?? []) out += flattenRich(child)
  return out
}

/** 一个参数是否让整条消息走「结构化渲染」而不是纯字符串拼接 */
export function isStructured(args: ConsoleNode[]): boolean {
  return args.some((n) => n.t !== 'str' && n.t !== 'num' && n.t !== 'bool')
}

/**
 * 浏览器语义的参数格式化：首个字符串含 % 占位时替换；
 * 剩余未消费的参数作为独立节点追加（空格分隔由渲染层处理）。
 */
export function formatArgs(args: ConsoleNode[]): DisplaySeg[] {
  if (args.length > 0 && args[0].t === 'str' && /%[sdifjoOc%]/.test(args[0].v)) {
    return substitute(args[0].v, args.slice(1))
  }
  return args.map((node) => ({ node }))
}

function substitute(format: string, rest: ConsoleNode[]): DisplaySeg[] {
  const segs: DisplaySeg[] = []
  let css = ''
  let buffer = ''
  let idx = 0
  const flush = () => {
    if (buffer.length > 0) {
      segs.push({ text: buffer, style: css || undefined })
      buffer = ''
    }
  }
  for (let i = 0; i < format.length; i++) {
    const ch = format[i]
    if (ch !== '%' || i + 1 >= format.length) {
      buffer += ch
      continue
    }
    const spec = format[i + 1]
    i++
    if (spec === '%') {
      buffer += '%'
      continue
    }
    const arg = rest[idx]
    if (spec === 'c') {
      flush()
      if (arg?.t === 'str') {
        css = arg.v
        idx++
      }
      continue
    }
    if (!arg) {
      buffer += `%${spec}`
      continue
    }
    idx++
    switch (spec) {
      case 's':
        buffer += stringifyNode(arg)
        break
      case 'd':
      case 'i':
        buffer += numberText(arg, true)
        break
      case 'f':
        buffer += numberText(arg, false)
        break
      case 'j':
        buffer += stringifyNode(arg)
        break
      case 'o':
      case 'O':
        buffer += stringifyNode(arg)
        break
      default:
        buffer += `%${spec}`
    }
  }
  flush()
  for (; idx < rest.length; idx++) segs.push({ node: rest[idx] })
  return segs
}

function numberText(node: ConsoleNode, integer: boolean): string {
  if (node.t !== 'num') return 'NaN'
  if (typeof node.v !== 'number') return String(node.v)
  return integer ? String(Math.trunc(node.v)) : String(node.v)
}

/** count 条目的展示文案 */
export function countText(entry: ConsoleEntry): string {
  return `${entry.label ?? 'default'}: ${entry.count ?? 0}`
}

/** time/timeLog/timeEnd 条目的展示文案 */
export function timerText(entry: ConsoleEntry): string {
  return `${entry.label ?? 'default'}: ${formatMs(entry.ms ?? 0)}`
}

// ---- MC 富文本调色板 -------------------------------------------------------

const MC_COLORS: Record<string, string> = {
  black: '#000000',
  dark_blue: '#0000AA',
  dark_green: '#00AA00',
  dark_aqua: '#00AAAA',
  dark_red: '#AA0000',
  dark_purple: '#AA00AA',
  gold: '#FFAA00',
  gray: '#AAAAAA',
  dark_gray: '#555555',
  blue: '#5555FF',
  green: '#55FF55',
  aqua: '#55FFFF',
  red: '#FF5555',
  light_purple: '#FF55FF',
  yellow: '#FFFF55',
  white: '#FFFFFF',
}

/** MC 色名 → CSS 颜色；hex 字符串直通；未知名称回退继承色 */
export function mcColor(color: string): string {
  if (color.startsWith('#')) return color
  return MC_COLORS[color] ?? ''
}

/** 一个富文本节点的内联样式 */
export function richStyle(rich: RichComponent): Record<string, string> {
  const style: Record<string, string> = {}
  const color = rich.color ? mcColor(rich.color) : ''
  if (color) style.color = color
  if (rich.bold) style['font-weight'] = '600'
  if (rich.italic) style['font-style'] = 'italic'
  const decorations: string[] = []
  if (rich.underlined) decorations.push('underline')
  if (rich.strikethrough) decorations.push('line-through')
  if (decorations.length > 0) style['text-decoration'] = decorations.join(' ')
  return style
}

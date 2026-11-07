/**
 * neomacro.yml 行级编辑（新版清单：行为统一收在 config: 块，按类型分组）。
 * 原则：已知键行内替换 / 缺键按结构追加，未知行与注释原样保留（声明即配置）。
 * 只覆盖面板需要的子集：顶层标量 + config.<section>.<field>（标量/列表），
 * 不做完整 YAML 解析——更深的未知块按「缩进回退」边界处理。
 */

/* ---- 标量渲染 ---- */

/** YAML 裸解析歧义（bool/null/数字/时间戳/特殊首字符/含 ": "/" #"）→ JSON 双引号 */
export function yamlScalar(value: string): string {
  if (value === '') return '""'
  if (
    /^(?:y|Y|yes|Yes|YES|n|N|no|No|NO|true|True|TRUE|false|False|FALSE|on|On|ON|off|Off|OFF|null|Null|NULL|~)$/.test(
      value,
    ) ||
    /^[-+]?(?:\d[\d_]*(?:\.[\d_]+)?(?:[eE][-+]?\d+)?|\.[\d_]+|0x[\da-fA-F_]+|\.inf|\.Inf|\.INF|\.nan|\.NaN|\.NAN)$/.test(
      value,
    ) ||
    /^\d{4}-\d{1,2}-\d{1,2}([T ]\d{1,2}:\d{2}(:\d{2})?)?/.test(value) ||
    /^[-?:,[\]{}#&*!|>'"%@`]/.test(value) ||
    /:\s|\s#/.test(value) ||
    /\s/.test(value)
  ) {
    return JSON.stringify(value)
  }
  return value
}

/** 键值行；含换行 → 块标量（|- 裁剪，内容整体缩进 indent+2） */
function scalarLines(indent: number, key: string, value: string): string[] {
  const pad = ' '.repeat(indent)
  if (value.includes('\n')) {
    const body = value
      .replace(/\r?\n$/, '')
      .split('\n')
      .map((l) => (l.trim() === '' ? '' : `${pad}  ${l}`))
    return [`${pad}${key}: |-`, ...body]
  }
  return [`${pad}${key}: ${yamlScalar(value)}`]
}

/* ---- 行定位 ---- */

function indentOf(line: string): number {
  let n = 0
  for (const ch of line) {
    if (ch === ' ') n++
    else if (ch === '\t') n += 2
    else break
  }
  return n
}

/** 从 from 起第一个非空非注释行 */
function firstMeaningful(lines: string[], from: number): number {
  let i = from
  while (i < lines.length) {
    const t = lines[i].trim()
    if (t !== '' && !t.startsWith('#')) return i
    i++
  }
  return lines.length
}

/** start 块（键行，缩进 indentOf(start)）的结束下标：第一个缩进 ≤ 该缩进的有效行 */
function blockEnd(lines: string[], start: number, indent: number): number {
  let i = firstMeaningful(lines, start + 1)
  while (i < lines.length && indentOf(lines[i]) > indent) i = firstMeaningful(lines, i + 1)
  return i
}

function unquote(raw: string): string {
  return raw.replace(/^["'](.*)["']$/s, '$1')
}

/** 去行尾注释（# 前须有空白；引号包裹的值整体保留） */
function stripComment(rest: string): string {
  const q = rest[0]
  if (q === '"' || q === "'") {
    for (let i = 1; i < rest.length; i++) {
      if (q === '"' && rest[i] === '\\') {
        i++
        continue
      }
      if (rest[i] === q) return rest.slice(0, i + 1)
    }
    return rest
  }
  return rest.replace(/\s+#.*$/, '').trim()
}

interface KeyHit {
  /** 键所在行下标；-1 = 不存在 */
  at: number
  /** 键行冒号后的原始文本（已 trim；块标量时为记号本身） */
  rest: string
  /** 块标量记号（|、|-、>-…）；纯标量/流式为 '' */
  mark: string
  /** 块标量首内容行（mark 为空时 = at） */
  valueAt: number
}

function findKey(lines: string[], indent: number, key: string): KeyHit {
  const pad = ' '.repeat(indent)
  const re = new RegExp(`^${pad}${key}:[ \\t]*(.*)$`)
  for (let i = 0; i < lines.length; i++) {
    const m = re.exec(lines[i])
    if (!m) continue
    const rest = m[1].trim()
    const mark = /^([|>][+-]?)(?:\s+#.*)?$/.exec(rest)
    if (mark) {
      return { at: i, rest: mark[1], mark: mark[1], valueAt: firstMeaningful(lines, i + 1) }
    }
    return { at: i, rest: stripComment(rest), mark: '', valueAt: i }
  }
  return { at: -1, rest: '', mark: '', valueAt: -1 }
}

/** 块标量内容行反折叠（| 逐行；> 空行分段折叠） */
function blockText(lines: string[], hit: KeyHit, baseIndent: number): string {
  const end = blockEnd(lines, hit.at, baseIndent)
  if (hit.valueAt >= end) return ''
  const body = lines.slice(hit.valueAt, end).map((l) => l.slice(baseIndent + 2))
  const text = hit.mark.startsWith('>')
    ? body.map((l) => l.trim()).join(' ').replace(/\s+/g, ' ')
    : body.join('\n')
  return hit.mark.endsWith('+') ? text : text.replace(/\n$/, '')
}

/* ---- 顶层读写 ---- */

/** 顶层字符串（块标量感知）；不存在返回 null */
export function readTopString(lines: string[], key: string): string | null {
  const hit = findKey(lines, 0, key)
  if (hit.at < 0) return null
  if (hit.mark) return blockText(lines, hit, 0)
  return unquote(hit.rest)
}

/** 顶层字符串；空串删行；多行转块标量 */
export function setTopString(lines: string[], key: string, value: string): void {
  const hit = findKey(lines, 0, key)
  if (value === '') {
    if (hit.at >= 0) {
      const end = hit.mark ? blockEnd(lines, hit.at, 0) : hit.at + 1
      lines.splice(hit.at, end - hit.at)
    }
    return
  }
  const out = scalarLines(0, key, value)
  if (hit.at < 0) {
    lines.push(...out)
    return
  }
  const oldEnd = hit.mark ? blockEnd(lines, hit.at, 0) : hit.at + 1
  if (out.length === 1 && !hit.mark) lines[hit.at] = out[0]
  else lines.splice(hit.at, oldEnd - hit.at, ...out)
}

/* ---- config.<section>.<field> 读写 ---- */

const MISSING_SEC = 2 // section 缺席时按标准缩进新建

interface FieldHit extends KeyHit {
  /** section 键行下标；-1 = section/config 均不存在 */
  sectionAt: number
  sectionIndent: number
}

function findConfigField(lines: string[], section: string, key: string): FieldHit {
  const miss: FieldHit = { at: -1, rest: '', mark: '', valueAt: -1, sectionAt: -1, sectionIndent: MISSING_SEC }
  const cfg = findKey(lines, 0, 'config')
  if (cfg.at < 0) return miss
  const cfgIndent = indentOf(lines[cfg.at])
  const cfgEnd = blockEnd(lines, cfg.at, cfgIndent)
  for (let si = firstMeaningful(lines, cfg.at + 1); si < cfgEnd; ) {
    const sm = new RegExp(`^(\\s+)${section}:[ \\t]*(.*)$`).exec(lines[si])
    const srest = sm ? sm[2].trim() : ''
    if (sm && (srest === '' || srest.startsWith('#')) && indentOf(lines[si]) > cfgIndent) {
      const secIndent = indentOf(lines[si])
      const secEnd = blockEnd(lines, si, secIndent)
      for (let fi = firstMeaningful(lines, si + 1); fi < secEnd; ) {
        const fm = new RegExp(`^(\\s+)${key}:[ \\t]*(.*)$`).exec(lines[fi])
        if (fm && indentOf(lines[fi]) > secIndent) {
          const raw = fm[2].trim()
          const mark = /^([|>][+-]?)(?:\s+#.*)?$/.exec(raw)
          if (mark) {
            return {
              at: fi,
              rest: mark[1],
              mark: mark[1],
              valueAt: firstMeaningful(lines, fi + 1),
              sectionAt: si,
              sectionIndent: secIndent,
            }
          }
          return {
            at: fi,
            rest: stripComment(raw),
            mark: '',
            valueAt: fi,
            sectionAt: si,
            sectionIndent: secIndent,
          }
        }
        fi = firstMeaningful(lines, fi + 1)
      }
      return { at: -1, rest: '', mark: '', valueAt: -1, sectionAt: si, sectionIndent: secIndent }
    }
    si = firstMeaningful(lines, si + 1)
  }
  return miss
}

/** config.<section>.<field> 字符串；任一层不存在返回 null */
export function readConfigString(lines: string[], section: string, key: string): string | null {
  const hit = findConfigField(lines, section, key)
  if (hit.at < 0) return null
  if (hit.mark) return blockText(lines, hit, indentOf(lines[hit.at]))
  return unquote(hit.rest)
}

/** config.<section>.<field> 列表：单标量 / 流式 [a, b] / 块式 - item 统一收集；字段缺失返回 null */
export function readConfigList(lines: string[], section: string, key: string): string[] | null {
  const hit = findConfigField(lines, section, key)
  if (hit.at < 0) return null
  if (hit.rest.startsWith('[')) {
    return hit.rest
      .replace(/^\[/, '')
      .replace(/\]$/, '')
      .split(',')
      .map((s) => unquote(s.trim()))
      .filter(Boolean)
  }
  if (hit.mark) return blockText(lines, hit, indentOf(lines[hit.at])).split('\n').filter(Boolean)
  if (hit.rest !== '') return [unquote(hit.rest)]
  // 裸键（`on:` 换行）→ 块列表
  const fieldIndent = indentOf(lines[hit.at])
  const end = blockEnd(lines, hit.at, fieldIndent)
  const items: string[] = []
  for (let i = firstMeaningful(lines, hit.at + 1); i < end; i = firstMeaningful(lines, i + 1)) {
    const m = new RegExp(`^\\s{${fieldIndent + 1},}-\\s*(.+)$`).exec(lines[i])
    if (m) items.push(unquote(stripComment(m[1].trim())))
  }
  return items
}

/**
 * 写 config.<section>.<field>。标量（含多行→块标量）、流式列表或裸布尔
 * （bool 必须裸写——引号会被清单校验按字符串拒绝）。
 * value 为 null/''/[] → 删字段；层级缺失就地按标准缩进补建。
 */
export function setConfigField(
  lines: string[],
  section: string,
  key: string,
  value: string | string[] | boolean | null,
): void {
  const empty = value === null || value === '' || (Array.isArray(value) && value.length === 0)
  const hit = findConfigField(lines, section, key)

  /** 按给定字段缩进渲染新行 */
  const render = (fieldIndent: number): string[] => {
    if (empty) return []
    const pad = ' '.repeat(fieldIndent)
    if (Array.isArray(value)) {
      return [`${pad}${key}: [${value.map(yamlScalar).join(', ')}]`]
    }
    if (typeof value === 'boolean') return [`${pad}${key}: ${value}`]
    return scalarLines(fieldIndent, key, value as string)
  }

  if (hit.at < 0) {
    if (empty) return
    if (hit.sectionAt < 0) {
      // section 也不存在 → config:（缺则建）块尾补 section + field（标准缩进 2/4）
      const cfg = findKey(lines, 0, 'config')
      const added = [`  ${section}:`, ...render(4)]
      if (cfg.at < 0) {
        lines.push('config:', ...added)
        return
      }
      lines.splice(blockEnd(lines, cfg.at, indentOf(lines[cfg.at])), 0, ...added)
      return
    }
    // section 在、字段缺 → section 块尾追加（字段缩进 = section 缩进 + 2）
    lines.splice(blockEnd(lines, hit.sectionAt, hit.sectionIndent), 0, ...render(hit.sectionIndent + 2))
    return
  }

  const fieldIndent = indentOf(lines[hit.at])
  const isBlockOld = hit.mark !== '' || hit.rest === ''
  const oldEnd = isBlockOld ? blockEnd(lines, hit.at, fieldIndent) : hit.at + 1
  const out = render(fieldIndent)
  if (out.length === 0) lines.splice(hit.at, oldEnd - hit.at)
  else if (out.length === 1 && !isBlockOld) lines[hit.at] = out[0]
  else lines.splice(hit.at, oldEnd - hit.at, ...out)
}

/** 清理删除字段后残留的空 section / 空 config: 块（section = config 块首层子键行） */
export function pruneEmptyConfig(lines: string[]): void {
  const cfg = findKey(lines, 0, 'config')
  if (cfg.at < 0) return
  const cfgIndent = indentOf(lines[cfg.at])
  const first = firstMeaningful(lines, cfg.at + 1)
  const cfgEnd = blockEnd(lines, cfg.at, cfgIndent)
  if (first >= cfgEnd) {
    // 块内只剩注释或全空 → 整块删除
    lines.splice(cfg.at, cfgEnd - cfg.at)
    return
  }
  const secIndent = indentOf(lines[first])
  for (let si = first; si < cfgEnd; ) {
    const secEnd = blockEnd(lines, si, secIndent)
    if (indentOf(lines[si]) === secIndent && firstMeaningful(lines, si + 1) >= secEnd) {
      lines.splice(si, secEnd - si)
      return pruneEmptyConfig(lines)
    }
    si = firstMeaningful(lines, si + 1)
  }
}

/** 确保 config.<section>: 存在（keypress 宏的必备块，字段清空后仍不能剪掉） */
export function ensureConfigSection(lines: string[], section: string): void {
  const cfg = findKey(lines, 0, 'config')
  if (cfg.at >= 0) {
    const cfgIndent = indentOf(lines[cfg.at])
    const cfgEnd = blockEnd(lines, cfg.at, cfgIndent)
    for (let i = firstMeaningful(lines, cfg.at + 1); i < cfgEnd; ) {
      const sm = new RegExp(`^(\\s+)${section}:[ \\t]*(?:#.*)?$`).exec(lines[i])
      if (sm && indentOf(lines[i]) > cfgIndent) return
      i = firstMeaningful(lines, i + 1)
    }
    lines.splice(cfgEnd, 0, `  ${section}:`)
    return
  }
  lines.push('config:', `  ${section}:`)
}

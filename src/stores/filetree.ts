/**
 * 文件树编辑操作：新建文件/目录、重命名、删除、复制/剪切/粘贴、拖拽复制 + W5 能力探测 + 树构建。
 * 路径口径（两套，注意区分）：
 * - `rel`：宏目录根相对（如 `lib/util.mjs`）——W4 列举与树渲染用；
 * - `full`：宏目录根全路径（如 `event/auto-welcome/lib/util.mjs`）——文件读写/删除/移动 API 用。
 */

import { reactive, ref } from 'vue'
import { deleteFile, mkdirPath, moveFile, readFile, writeFile } from '@/api/endpoints'
import { ApiError } from '@/types/api'
import type { MacroView } from '@/types/api'
import { ensureFiles, expandedIds, invalidateFiles } from './macros'
import type { MacroFiles } from './macros'
import { editor, closeTab, openFile } from './editor'

/* ---- 名称与格式 ---- */

/** 可写扩展名白名单（契约 §1.2） */
const FILE_EXT_RE = /\.(js|mjs|cjs|ya?ml|json|md|txt)$/i

/** 清单文件（受保护：禁改名/删除/剪切） */
export function isManifestPath(rel: string): boolean {
  return /(?:^|\/)neomacro\.ya?ml$/i.test(rel)
}

export function validateFileName(name: string): string {
  if (!name) return '名称不能为空'
  if (/\s/.test(name)) return '名称不能包含空格（签名路径口径）'
  if (/[\\/]/.test(name) || name === '.' || name === '..') return '名称不能包含路径分隔符'
  if (!FILE_EXT_RE.test(name)) return '扩展名不在白名单（js/mjs/cjs/yml/yaml/json/md/txt）'
  return ''
}

export function validateDirName(name: string): string {
  if (!name) return '名称不能为空'
  if (/\s/.test(name)) return '名称不能包含空格（签名路径口径）'
  if (/[\\/]/.test(name) || name === '.' || name === '..') return '名称不能包含路径分隔符'
  return ''
}

/* ---- W5 能力探测：首次 404 即置灰，成功转 ok ---- */

export type OpKey = 'delete' | 'move' | 'mkdir'

export const fileOps = reactive<Record<OpKey, 'unknown' | 'ok' | 'no'>>({
  delete: 'unknown',
  move: 'unknown',
  mkdir: 'unknown',
})

export function opAvailable(key: OpKey): boolean {
  return fileOps[key] !== 'no'
}

function markOp(key: OpKey, e: unknown): void {
  if (e instanceof ApiError && e.status === 404) fileOps[key] = 'no'
  else fileOps[key] = 'ok'
}

/* ---- 剪贴板 ---- */

export interface Clipboard {
  mode: 'copy' | 'cut'
  /** 宏根相对路径 */
  rel: string
  macroId: string
  isDir: boolean
}

export const clipboard = ref<Clipboard | null>(null)

/* ---- 路径小工具 ---- */

function parentOf(rel: string): string {
  const i = rel.lastIndexOf('/')
  return i < 0 ? '' : rel.slice(0, i)
}

function baseName(rel: string): string {
  return rel.slice(rel.lastIndexOf('/') + 1)
}

function join(dir: string, name: string): string {
  return dir ? `${dir}/${name}` : name
}

export function dirKey(macroId: string, rel: string): string {
  return `dir:${macroId}/${rel}`
}

/** 展开态键重定向（目录改名/移动后） */
function retargetDirKeys(macroId: string, fromRel: string, toRel: string): void {
  const fromPrefix = dirKey(macroId, fromRel)
  const toPrefix = dirKey(macroId, toRel)
  for (const k of [...expandedIds]) {
    if (k === fromPrefix) {
      expandedIds.delete(k)
      expandedIds.add(toPrefix)
    } else if (k.startsWith(`${fromPrefix}/`)) {
      expandedIds.delete(k)
      expandedIds.add(`${toPrefix}${k.slice(fromPrefix.length)}`)
    }
  }
}

/** 已开标签路径重定向（重命名/移动后；内容与 ETag 不变） */
function retargetTabs(fromFull: string, toFull: string, isDir: boolean): void {
  for (const t of editor.tabs) {
    if (t.path === fromFull) {
      t.path = toFull
      t.macroId = toFull.split('/').slice(0, 2).join('/')
      t.title = baseName(toFull)
      if (editor.activePath === fromFull) editor.activePath = toFull
    } else if (isDir && t.path.startsWith(`${fromFull}/`)) {
      t.path = `${toFull}${t.path.slice(fromFull.length)}`
      t.title = baseName(t.path)
    }
  }
}

/** 剪贴板同步（需求 #2）：被剪切项被删除后清板，被重命名后重定向——否则粘贴必 404 */
function syncClipboardAfterDelete(macroId: string, rel: string): void {
  const cb = clipboard.value
  if (!cb || cb.macroId !== macroId) return
  if (cb.rel === rel || cb.rel.startsWith(`${rel}/`)) clipboard.value = null
}

function syncClipboardAfterRename(macroId: string, fromRel: string, toRel: string): void {
  const cb = clipboard.value
  if (!cb || cb.macroId !== macroId) return
  if (cb.rel === fromRel) cb.rel = toRel
  else if (cb.rel.startsWith(`${fromRel}/`)) cb.rel = `${toRel}${cb.rel.slice(fromRel.length)}`
}

/* ---- 缓存刷新 ---- */

async function refreshListing(macroId: string): Promise<void> {
  invalidateFiles(macroId)
  if (expandedIds.has(macroId)) await ensureFiles(macroId)
}

/** 目标重名时追加「-copy」「-copy-2」…（基于当前已知列表；不用空格——NM1 签名路径口径） */
function dedupeTarget(targetRel: string, listing: MacroFiles): string {
  const taken = new Set([...listing.files, ...listing.dirs])
  if (!taken.has(targetRel)) return targetRel
  const dir = parentOf(targetRel)
  const base = baseName(targetRel)
  const dot = base.lastIndexOf('.')
  const stem = dot > 0 ? base.slice(0, dot) : base
  const ext = dot > 0 ? base.slice(dot) : ''
  for (let i = 1; i < 100; i++) {
    const candidate = join(dir, `${stem}-copy${i > 1 ? `-${i}` : ''}${ext}`)
    if (!taken.has(candidate)) return candidate
  }
  return targetRel
}

/* ---- 操作 ---- */

export async function createFile(macroId: string, dir: string, name: string): Promise<void> {
  const err = validateFileName(name)
  if (err) throw new Error(err)
  const rel = join(dir, name)
  const listing = await ensureFiles(macroId)
  if (listing.files.some((f) => f === rel) || listing.dirs.some((d) => d === rel)) {
    throw new Error('同名文件已存在')
  }
  await writeFile(`${macroId}/${rel}`, '', '')
  await refreshListing(macroId)
  expandedIds.add(macroId)
  if (dir) expandedIds.add(dirKey(macroId, dir))
  await openFile(`${macroId}/${rel}`, macroId)
}

export async function createDir(macroId: string, dir: string, name: string): Promise<void> {
  const err = validateDirName(name)
  if (err) throw new Error(err)
  const rel = join(dir, name)
  const listing = await ensureFiles(macroId)
  if (listing.dirs.some((d) => d === rel) || listing.files.some((f) => f === rel)) {
    throw new Error('同名目录已存在')
  }
  try {
    await mkdirPath(`${macroId}/${rel}`)
    markOp('mkdir', null)
  } catch (e) {
    markOp('mkdir', e)
    throw e
  }
  await refreshListing(macroId)
  expandedIds.add(macroId)
  if (dir) expandedIds.add(dirKey(macroId, dir))
  expandedIds.add(dirKey(macroId, rel))
}

export async function renameNode(
  macroId: string,
  rel: string,
  newName: string,
  isDir: boolean,
): Promise<void> {
  const err = isDir ? validateDirName(newName) : validateFileName(newName)
  if (err) throw new Error(err)
  if (isManifestPath(rel)) throw new Error('清单文件不可重命名')
  if (newName === baseName(rel)) return
  const toRel = join(parentOf(rel), newName)
  const fromFull = `${macroId}/${rel}`
  const toFull = `${macroId}/${toRel}`
  try {
    await moveFile(fromFull, toFull)
    markOp('move', null)
  } catch (e) {
    markOp('move', e)
    throw e
  }
  await refreshListing(macroId)
  if (isDir) retargetDirKeys(macroId, rel, toRel)
  retargetTabs(fromFull, toFull, isDir)
  syncClipboardAfterRename(macroId, rel, toRel)
}

export async function deleteNode(macroId: string, rel: string, isDir: boolean): Promise<void> {
  if (isManifestPath(rel)) throw new Error('清单文件不可删除')
  const full = `${macroId}/${rel}`
  try {
    await deleteFile(full)
    markOp('delete', null)
  } catch (e) {
    markOp('delete', e)
    throw e
  }
  await refreshListing(macroId)
  for (const t of [...editor.tabs]) {
    if (t.path === full || (isDir && t.path.startsWith(`${full}/`))) closeTab(t.path)
  }
  if (isDir) {
    const prefix = dirKey(macroId, rel)
    for (const k of [...expandedIds]) {
      if (k === prefix || k.startsWith(`${prefix}/`)) expandedIds.delete(k)
    }
  }
  syncClipboardAfterDelete(macroId, rel)
}

/** 复制到目录（拖拽复制与复制/粘贴共用；限同一宏内） */
export async function copyInto(
  macroId: string,
  relSrc: string,
  targetDir: string,
  isDir: boolean,
): Promise<void> {
  const listing = await ensureFiles(macroId)
  if (isDir) {
    if (targetDir === relSrc || targetDir.startsWith(`${relSrc}/`)) {
      throw new Error('不能复制到自身内部')
    }
    const under = listing.files.filter((f) => f.startsWith(`${relSrc}/`))
    if (under.length === 0) throw new Error('目录为空，无内容可复制')
    const toRoot = dedupeTarget(join(targetDir, baseName(relSrc)), listing)
    for (const f of under) {
      const src = await readFile(`${macroId}/${f}`)
      await writeFile(`${macroId}/${toRoot}${f.slice(relSrc.length)}`, src.text, '')
    }
  } else {
    const targetRel = dedupeTarget(join(targetDir, baseName(relSrc)), listing)
    const src = await readFile(`${macroId}/${relSrc}`)
    await writeFile(`${macroId}/${targetRel}`, src.text, '')
  }
  await refreshListing(macroId)
  expandedIds.add(macroId)
  if (targetDir) expandedIds.add(dirKey(macroId, targetDir))
}

/** 粘贴到目录（copy=客户端读写复制；cut=move 端点） */
export async function pasteInto(macroId: string, targetDir: string): Promise<void> {
  const cb = clipboard.value
  if (!cb) return
  if (cb.macroId !== macroId) throw new Error('仅支持同一宏内粘贴')
  if (cb.mode === 'cut') {
    if (cb.isDir && (targetDir === cb.rel || targetDir.startsWith(`${cb.rel}/`))) {
      throw new Error('不能移动到自身内部')
    }
    const toRel = join(targetDir, baseName(cb.rel))
    if (toRel === cb.rel) {
      clipboard.value = null
      return
    }
    const fromFull = `${cb.macroId}/${cb.rel}`
    const toFull = `${macroId}/${toRel}`
    try {
      await moveFile(fromFull, toFull)
      markOp('move', null)
    } catch (e) {
      markOp('move', e)
      throw e
    }
    clipboard.value = null
    await refreshListing(macroId)
    if (cb.isDir) retargetDirKeys(cb.macroId, cb.rel, toRel)
    retargetTabs(fromFull, toFull, cb.isDir)
  } else {
    await copyInto(macroId, cb.rel, targetDir, cb.isDir)
  }
}

/* ---- 树构建 ---- */

export interface TreeNode {
  type: 'dir' | 'file'
  name: string
  /** 宏根相对路径 */
  rel: string
  children?: TreeNode[]
}

/** files+dirs → 嵌套树（目录在前、字典序）；文件路径中的隐式父目录自动补节点（dirs 增补未就绪时兜底） */
export function buildTree(listing: MacroFiles): TreeNode[] {
  const root: TreeNode[] = []
  const dirMap = new Map<string, TreeNode>()
  const ensureDir = (rel: string): TreeNode[] => {
    let node = dirMap.get(rel)
    if (!node) {
      node = { type: 'dir', name: baseName(rel), rel, children: [] }
      dirMap.set(rel, node)
      const parent = parentOf(rel)
      const siblings = parent ? ensureDir(parent) : root
      siblings.push(node)
    }
    return node!.children!
  }
  for (const d of listing.dirs ?? []) ensureDir(d)
  for (const f of listing.files ?? []) {
    const parent = parentOf(f)
    const siblings = parent ? ensureDir(parent) : root
    siblings.push({ type: 'file', name: baseName(f), rel: f })
  }
  const sortRec = (nodes: TreeNode[]): void => {
    const rank = (n: TreeNode) => (n.type === 'file' && isManifestPath(n.rel) ? 0 : 1)
    nodes.sort((a, b) =>
      a.type === b.type
        ? rank(a) - rank(b) || a.name.localeCompare(b.name)
        : a.type === 'dir'
          ? -1
          : 1,
    )
    for (const n of nodes) if (n.children) sortRec(n.children)
  }
  sortRec(root)
  return root
}

/** 配置对话框打开（由侧栏触发，对话框组件在侧栏内渲染） */
export const configTarget = ref<MacroView | null>(null)

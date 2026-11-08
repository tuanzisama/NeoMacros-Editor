<script setup lang="ts">
/**
 * 资源管理器：宏 = 文件夹的文件树（对齐服务端 macros/<分类>/<宏名>/ 磁盘布局）。
 * 树支持子目录递归展开；宏/目录行可新建文件/文件夹；文件支持右键复制/剪切/重命名/删除
 * 与拖拽复制（限同一宏内）；宏右键含「配置」（yml 结构化表单）。W5 端点未实现时对应项置灰。
 */
import { computed, nextTick, ref, watch } from 'vue'
import {
  macros,
  hasError,
  expandedIds,
  toggleExpanded,
  filesByMacro,
  toggleEnabled,
  toggleRunning,
  reload,
} from '@/stores/macros'
import {
  buildTree,
  clipboard,
  configTarget,
  copyInto,
  createDir,
  createFile,
  deleteNode,
  dirKey,
  opAvailable,
  pasteInto,
  renameNode,
  treeSelection,
} from '@/stores/filetree'
import type { TreeNode } from '@/stores/filetree'
import { openFile, openMacro, editor } from '@/stores/editor'
import { workspace, openNewMacroWizard, askDelete, focusEditor, notify } from '@/stores/workspace'
import { CATEGORY_LABELS, LIFECYCLE_LABELS, MACROS_ROOT_REL } from '@/types/api'
import { ApiError } from '@/types/api'
import type { MacroCategory, MacroView } from '@/types/api'
import { revealPath } from '@/api/endpoints'
import { copyText } from '@/utils/clipboard'
import AppIcon from '@/components/ui/AppIcon.vue'
import ContextMenu from '@/components/ui/ContextMenu.vue'
import type { MenuItem } from '@/components/ui/ContextMenu.vue'
import AppModal from '@/components/ui/AppModal.vue'
import MacroConfigDialog from './MacroConfigDialog.vue'

/** 本组件仅在 activity 为宏分类时挂载 */
const category = computed(() => workspace.activity as MacroCategory)

/* ---- 复制路径 / 在本地打开（需求 #1/#3） ---- */

/** 节点的宏根全路径（宏目录=macroId；子节点=macroId/rel） */
function fullRel(t: MenuTarget): string {
  return t.kind === 'macro' ? t.macro.id : `${t.macro.id}/${t.rel}`
}

async function doCopyPath(t: MenuTarget, abs: boolean): Promise<void> {
  const rel = fullRel(t)
  // 绝对路径 = 磁盘宏根（state.macrosRoot）拼接相对路径；旧版 mod 未返回时回退默认口径
  const root = abs ? macros.root || `${MACROS_ROOT_REL}` : ''
  const ok = await copyText(abs ? `${root}/${rel}` : rel)
  notify(ok ? '已复制' : '复制失败', ok ? 'success' : 'error')
}

async function doReveal(t: MenuTarget): Promise<void> {
  try {
    await revealPath(fullRel(t))
  } catch (e) {
    notify(e instanceof ApiError ? e.label : String(e), 'error')
  }
}

function onSearchInput(e: Event): void {
  macros.search = (e.target as HTMLInputElement).value
}

const items = computed(() => {
  const q = macros.search.trim().toLowerCase()
  return macros.macros.filter((m) => {
    if (m.category !== category.value) return false
    if (!q) return true
    return (
      m.name.toLowerCase().includes(q) ||
      m.id.toLowerCase().includes(q) ||
      (m.key ?? '').toLowerCase().includes(q)
    )
  })
})

const isEmpty = computed(() => macros.macros.length === 0)

/* ---- 扁平化行（宏行 + 递归目录/文件行 + 内联编辑行） ---- */

type Row =
  | { kind: 'macro'; macro: MacroView }
  | { kind: 'loading' }
  | { kind: 'dir'; macro: MacroView; node: TreeNode; depth: number }
  | { kind: 'file'; macro: MacroView; node: TreeNode; depth: number }
  | { kind: 'edit'; depth: number }

type EditState =
  | { kind: 'new-file'; macroId: string; parentDir: string }
  | { kind: 'new-dir'; macroId: string; parentDir: string }
  | { kind: 'rename'; macroId: string; rel: string; isDir: boolean }

const editState = ref<EditState | null>(null)
const editValue = ref('')
const editInput = ref<HTMLInputElement | null>(null)

/** v-for 内的模板 ref 会收集为数组，用函数 ref 拿单个输入框 */
function setEditRef(el: unknown): void {
  editInput.value = el instanceof HTMLInputElement ? el : null
}

watch(editState, () => {
  if (!editState.value) return
  void nextTick(() => {
    editInput.value?.focus()
    const dot = editValue.value.lastIndexOf('.')
    // 重命名时选中主名（不含扩展名），新建时全选占位提示
    if (editState.value?.kind === 'rename' && dot > 0) editInput.value?.setSelectionRange(0, dot)
    else editInput.value?.select()
  })
})

function rowKey(row: Row): string {
  if (row.kind === 'macro') return `M:${row.macro.id}`
  if (row.kind === 'loading') return 'loading'
  if (row.kind === 'edit') return 'edit'
  if (row.kind === 'dir') return `D:${dirKey(row.macro.id, row.node.rel)}`
  return `F:${row.macro.id}/${row.node.rel}`
}

const rows = computed<Row[]>(() => {
  const out: Row[] = []
  const es = editState.value
  for (const m of items.value) {
    const macroIdx = out.length
    out.push({ kind: 'macro', macro: m })
    if (!expandedIds.has(m.id)) continue
    const listing = filesByMacro[m.id]
    if (!listing || listing.loading) {
      out.push({ kind: 'loading' })
      continue
    }
    const walk = (nodes: TreeNode[], depth: number): void => {
      for (const n of nodes) {
        // 重命名行：输入框原位替换节点行（子节点仍显示）
        if (es?.kind === 'rename' && es.macroId === m.id && es.rel === n.rel) {
          out.push({ kind: 'edit', depth })
          continue
        }
        if (n.type === 'dir') {
          out.push({ kind: 'dir', macro: m, node: n, depth })
          const newHere =
            es &&
            (es.kind === 'new-file' || es.kind === 'new-dir') &&
            es.macroId === m.id &&
            es.parentDir === n.rel
          if (newHere) out.push({ kind: 'edit', depth: depth + 1 })
          if (expandedIds.has(dirKey(m.id, n.rel))) walk(n.children ?? [], depth + 1)
        } else {
          out.push({ kind: 'file', macro: m, node: n, depth })
        }
      }
    }
    walk(buildTree(listing), 0)
    // 根级新建：输入行紧贴宏行之后（置顶子区）
    if (
      es &&
      (es.kind === 'new-file' || es.kind === 'new-dir') &&
      es.macroId === m.id &&
      es.parentDir === ''
    ) {
      out.splice(macroIdx + 1, 0, { kind: 'edit', depth: 0 })
    }
  }
  return out
})

function toggleDir(macroId: string, rel: string): void {
  clearTreeSelection()
  const k = dirKey(macroId, rel)
  if (expandedIds.has(k)) expandedIds.delete(k)
  else expandedIds.add(k)
}

function indentOf(depth: number): string {
  return `${22 + depth * 14}px`
}

function fileIcon(name: string): string {
  return /\.(yaml|yml|json)$/i.test(name) ? 'files' : 'file-code'
}

function filePath(m: MacroView, rel: string): string {
  return `${m.id}/${rel}`
}

function isActiveFile(m: MacroView, rel: string): boolean {
  return editor.activePath === filePath(m, rel)
}

/** 任何树点击都解除「任务跳转」高亮（避免高亮僵死） */
function clearTreeSelection(): void {
  if (treeSelection.value !== null) treeSelection.value = null
}

async function open(m: MacroView, rel: string): Promise<void> {
  clearTreeSelection()
  focusEditor(m.id)
  await openFile(filePath(m, rel), m.id)
}

async function openEntry(m: MacroView): Promise<void> {
  clearTreeSelection()
  focusEditor(m.id)
  await openMacro(m)
}

async function openErrorFile(m: MacroView): Promise<void> {
  if (!m.error) return
  const path = m.error.script.replace(/\\/g, '/')
  clearTreeSelection()
  focusEditor(m.id)
  await openFile(path, m.id)
}

function rowTitle(m: MacroView): string {
  const parts = [
    m.id,
    `v${m.version} · ${m.author}`,
    `生命周期：${LIFECYCLE_LABELS[m.lifecycle]}`,
    `权限：${m.permissions.length ? m.permissions.join(', ') : '无'}`,
  ]
  if (m.error) parts.push(`错误：${m.error.message}`)
  return parts.join('\n')
}

/** 按键宏第二行标签：修饰键 + 生效按键（keymapping 覆盖后的值），未绑定给占位 */
function keyTagText(m: MacroView): string {
  if (!m.key) return '未绑定'
  const mods = m.modifiers.length > 0 ? `${m.modifiers.join('+')}+` : ''
  return `${mods}${m.key}`
}

/** 事件宏第二行标签：首个事件名（超出折叠计数） */
function onTagText(on: string[]): string {
  if (on.length <= 1) return on[0] ?? ''
  return `${on[0]} +${on.length - 1}`
}

/* ---- 内联编辑 ---- */

function startEdit(
  macroId: string,
  parentDir: string,
  kind: 'new-file' | 'new-dir',
): void {
  expandedIds.add(macroId)
  if (parentDir) {
    expandedIds.add(dirKey(macroId, parentDir))
  }
  editValue.value = ''
  editState.value = { kind, macroId, parentDir }
}

function startRename(macroId: string, rel: string, isDir: boolean): void {
  editValue.value = rel.slice(rel.lastIndexOf('/') + 1)
  editState.value = { kind: 'rename', macroId, rel, isDir }
}

function cancelEdit(): void {
  editState.value = null
}

async function commitEdit(): Promise<void> {
  const es = editState.value
  if (!es) return
  const name = editValue.value.trim()
  editState.value = null
  if (!name) return
  await run(async () => {
    if (es.kind === 'new-file') await createFile(es.macroId, es.parentDir, name)
    else if (es.kind === 'new-dir') await createDir(es.macroId, es.parentDir, name)
    else await renameNode(es.macroId, es.rel, name, es.isDir)
  })
}

/* ---- 统一错误提示 ---- */

async function run(fn: () => Promise<void>): Promise<void> {
  try {
    await fn()
  } catch (e) {
    notify(e instanceof Error ? e.message : String(e), 'error')
  }
}

/* ---- 右键菜单 ---- */

type MenuTarget =
  | { kind: 'macro'; macro: MacroView }
  | { kind: 'dir'; macro: MacroView; rel: string }
  | { kind: 'file'; macro: MacroView; rel: string }

const menu = ref<{ x: number; y: number; target: MenuTarget } | null>(null)

function openMenu(e: MouseEvent, target: MenuTarget): void {
  menu.value = { x: e.clientX, y: e.clientY, target }
}

const pasteDisabled = computed(() => {
  const t = menu.value?.target
  if (!t || !clipboard.value) return true
  if (clipboard.value.macroId !== t.macro.id) return true // 限同一宏内
  return false
})

const menuItems = computed<MenuItem[]>(() => {
  const t = menu.value?.target
  if (!t) return []
  const canMove = opAvailable('move')
  const canDelete = opAvailable('delete')
  if (t.kind === 'macro') {
    const m = t.macro
    const list: MenuItem[] = [
      { id: 'config', label: '配置', icon: 'settings' },
      { id: 'toggle-enabled', label: m.enabled ? '停用' : '启用', icon: 'check' },
    ]
    if (m.category === 'services') {
      list.push({
        id: 'toggle-run',
        label: m.running ? '停止' : '启动',
        icon: m.running ? 'stop' : 'play',
      })
    }
    list.push({ id: 'reload', label: '重载', icon: 'refresh' })
    list.push(
      { id: 'copy-path', label: '复制路径', icon: 'copy' },
      { id: 'copy-abs-path', label: '复制绝对路径', icon: 'copy' },
      { id: 'reveal', label: '在本地打开', icon: 'folder' },
    )
    list.push(
      { id: 'new-file', label: '新建文件', icon: 'file-plus', separatorBefore: true },
      { id: 'new-dir', label: '新建文件夹', icon: 'folder-plus' },
      { id: 'paste', label: '粘贴', icon: 'paste', disabled: pasteDisabled.value },
    )
    list.push({ id: 'delete', label: '删除', icon: 'trash', danger: true, separatorBefore: true })
    return list
  }
  if (t.kind === 'dir') {
    return [
      { id: 'copy-path', label: '复制路径', icon: 'copy' },
      { id: 'copy-abs-path', label: '复制绝对路径', icon: 'copy' },
      { id: 'reveal', label: '在本地打开', icon: 'folder' },
      { id: 'new-file', label: '新建文件', icon: 'file-plus', separatorBefore: true },
      { id: 'new-dir', label: '新建文件夹', icon: 'folder-plus' },
      { id: 'paste', label: '粘贴', icon: 'paste', disabled: pasteDisabled.value },
      { id: 'rename', label: '重命名', icon: 'pencil', disabled: !canMove, separatorBefore: true },
      { id: 'delete', label: '删除', icon: 'trash', danger: true, disabled: !canDelete },
    ]
  }
  const manifest = /(?:^|\/)neomacro\.ya?ml$/i.test(t.rel)
  return [
    { id: 'open', label: '打开', icon: 'files' },
    { id: 'copy-path', label: '复制路径', icon: 'copy' },
    { id: 'copy-abs-path', label: '复制绝对路径', icon: 'copy' },
    { id: 'reveal', label: '在本地打开', icon: 'folder' },
    { id: 'copy', label: '复制', icon: 'copy', separatorBefore: true },
    { id: 'cut', label: '剪切', icon: 'cut', disabled: manifest },
    {
      id: 'rename',
      label: '重命名',
      icon: 'pencil',
      disabled: manifest || !canMove,
      separatorBefore: true,
    },
    { id: 'delete', label: '删除', icon: 'trash', danger: true, disabled: manifest || !canDelete },
  ]
})

const confirmTarget = ref<{ macro: MacroView; rel: string; isDir: boolean } | null>(null)

async function onMenuSelect(id: string): Promise<void> {
  const t = menu.value?.target
  if (!t) return
  const m = t.macro
  await run(async () => {
    switch (id) {
      case 'config':
        configTarget.value = m
        break
      case 'toggle-enabled': {
        const disabling = m.enabled // await 后 m 已被 SSE/upsert 更新，先捕获
        await toggleEnabled(m)
        notify(disabling ? `已停用 ${m.name}` : `已启用 ${m.name}`, 'success')
        break
      }
      case 'toggle-run': {
        const stopping = m.running
        await toggleRunning(m)
        notify(stopping ? `已停止 ${m.name}` : `已启动 ${m.name}`, 'success')
        break
      }
      case 'reload':
        await reload(m.id)
        notify(`已重载 ${m.name}`, 'success')
        break
      case 'copy-path':
      case 'copy-abs-path':
        await doCopyPath(t, id === 'copy-abs-path')
        break
      case 'reveal':
        await doReveal(t)
        break
      case 'delete':
        askDelete(m)
        break
      case 'new-file':
        startEdit(m.id, t.kind === 'dir' ? t.rel : '', 'new-file')
        break
      case 'new-dir':
        startEdit(m.id, t.kind === 'dir' ? t.rel : '', 'new-dir')
        break
      case 'paste':
        await pasteInto(m.id, t.kind === 'dir' ? t.rel : '')
        notify('已粘贴', 'success')
        break
      case 'open':
        if (t.kind === 'file') await open(m, t.rel)
        break
      case 'copy':
        if (t.kind === 'file') {
          clipboard.value = { mode: 'copy', rel: t.rel, macroId: m.id, isDir: false }
          notify('已复制', 'info')
        } else if (t.kind === 'dir') {
          clipboard.value = { mode: 'copy', rel: t.rel, macroId: m.id, isDir: true }
          notify('已复制目录', 'info')
        }
        break
      case 'cut':
        if (t.kind === 'file') {
          clipboard.value = { mode: 'cut', rel: t.rel, macroId: m.id, isDir: false }
          notify('已剪切', 'info')
        } else if (t.kind === 'dir') {
          clipboard.value = { mode: 'cut', rel: t.rel, macroId: m.id, isDir: true }
          notify('已剪切目录', 'info')
        }
        break
      case 'rename':
        if (t.kind !== 'macro') startRename(m.id, t.rel, t.kind === 'dir')
        break
    }
  })
}

/** 文件/目录的删除走确认框（宏删除仍走全局 DeleteConfirm） */
function requestTreeDelete(t: MenuTarget): void {
  if (t.kind === 'macro') {
    askDelete(t.macro)
    return
  }
  confirmTarget.value = { macro: t.macro, rel: t.rel, isDir: t.kind === 'dir' }
}

async function confirmTreeDelete(): Promise<void> {
  const t = confirmTarget.value
  if (!t) return
  confirmTarget.value = null
  await run(async () => {
    await deleteNode(t.macro.id, t.rel, t.isDir)
    notify(`已删除 ${t.rel}`, 'success')
  })
}

/* ---- 拖拽复制（限同一宏内） ---- */

interface DragPayload {
  macroId: string
  rel: string
  isDir: boolean
}

let dragPayload: DragPayload | null = null
const dragOverKey = ref<string | null>(null)

function onDragStart(e: DragEvent, m: MacroView, rel: string, isDir: boolean): void {
  dragPayload = { macroId: m.id, rel, isDir }
  e.dataTransfer?.setData('text/plain', rel)
  if (e.dataTransfer) e.dataTransfer.effectAllowed = 'copy'
}

function onDragEnd(): void {
  dragPayload = null
  dragOverKey.value = null
}

function dropTargetDir(row: Row): string | null {
  if (!dragPayload) return null
  if (row.kind === 'macro') {
    return dragPayload.macroId === row.macro.id ? '' : null
  }
  if (row.kind !== 'dir') return null
  if (dragPayload.macroId !== row.macro.id) return null
  if (dragPayload.isDir) {
    if (row.node.rel === dragPayload.rel || row.node.rel.startsWith(`${dragPayload.rel}/`)) {
      return null // 不能拖进自身/自身子目录
    }
  }
  if (row.node.rel === dragPayload.rel) return null
  return row.node.rel
}

function onDragOver(e: DragEvent, row: Row): void {
  const dir = dropTargetDir(row)
  if (dir === null) return
  e.preventDefault()
  if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy'
  dragOverKey.value = rowKey(row)
}

function onDragLeave(row: Row): void {
  if (dragOverKey.value === rowKey(row)) dragOverKey.value = null
}

async function onDrop(e: DragEvent, row: Row): Promise<void> {
  const dir = dropTargetDir(row)
  dragOverKey.value = null
  if (dir === null || !dragPayload) return
  e.preventDefault()
  const { macroId, rel, isDir } = dragPayload
  dragPayload = null
  await run(async () => {
    await copyInto(macroId, rel, dir, isDir)
    notify(`已复制到 ${dir || '宏根目录'}`, 'success')
  })
}
</script>

<template>
  <aside class="sidebar">
    <div class="sidebar-header">
      <span class="title">{{ CATEGORY_LABELS[category] }}</span>
      <button class="btn btn-primary new-btn" title="新建宏" @click="openNewMacroWizard(category)">
        <AppIcon name="plus" :size="14" />
        新建宏
      </button>
    </div>

    <div class="search-wrap">
      <AppIcon name="search" :size="14" class="search-icon" />
      <input
        class="search-input"
        placeholder="过滤：名称 / 按键 / ID"
        :value="macros.search"
        spellcheck="false"
        @input="onSearchInput"
      />
      <button
        v-if="macros.search"
        class="clear-search"
        title="清空"
        @click="macros.search = ''"
      >
        <AppIcon name="close" :size="12" />
      </button>
    </div>

    <div class="tree">
      <template v-if="!isEmpty">
        <template v-for="row in rows" :key="rowKey(row)">
          <!-- 宏根文件夹（两行：目录名 / 启禁用+按键标签） -->
          <div
            v-if="row.kind === 'macro'"
            class="folder-row macro-root"
            :class="{
              dimmed: !row.macro.enabled,
              error: hasError(row.macro),
              'drop-target': dragOverKey === rowKey(row),
            }"
            :title="rowTitle(row.macro)"
            @click="clearTreeSelection(); toggleExpanded(row.macro.id)"
            @dblclick="openEntry(row.macro)"
            @contextmenu.prevent="openMenu($event, { kind: 'macro', macro: row.macro })"
            @dragover="onDragOver($event, row)"
            @dragleave="onDragLeave(row)"
            @drop="onDrop($event, row)"
          >
            <div class="row-line">
              <AppIcon
                name="chevron"
                :size="12"
                class="chevron"
                :class="{ open: expandedIds.has(row.macro.id) }"
              />
              <AppIcon name="folder" :size="14" class="folder-icon" />
              <span class="name">{{ row.macro.name }}</span>

              <span class="row-actions" @click.stop>
                <button class="action-btn" title="新建文件" @click="startEdit(row.macro.id, '', 'new-file')">
                  <AppIcon name="file-plus" :size="13" />
                </button>
                <button class="action-btn" title="新建文件夹" @click="startEdit(row.macro.id, '', 'new-dir')">
                  <AppIcon name="folder-plus" :size="13" />
                </button>
              </span>

              <span class="badges" @click.stop>
                <span
                  v-if="row.macro.category === 'services'"
                  class="run-dot"
                  :class="{ on: row.macro.running }"
                  :title="row.macro.running ? '运行中' : '已停止'"
                />
                <span
                  v-if="hasError(row.macro)"
                  class="err-badge"
                  title="加载/运行出错，点击查看"
                  @click="openErrorFile(row.macro)"
                >
                  <AppIcon name="warn" :size="13" />
                </span>
              </span>
            </div>
            <div class="row-line tags-line" @click.stop>
              <span class="chip" :class="{ off: !row.macro.enabled }">
                {{ row.macro.enabled ? '已启用' : '已禁用' }}
              </span>
              <template v-if="row.macro.category === 'keypress'">
                <span class="chip-key" :class="{ unbound: !row.macro.key }">
                  {{ keyTagText(row.macro) }}
                </span>
              </template>
              <span
                v-else-if="row.macro.on.length > 0"
                class="chip on-chip"
                :title="row.macro.on.join(', ')"
              >
                {{ onTagText(row.macro.on) }}
              </span>
              <span
                v-for="mod in row.macro.modifiers"
                :key="mod"
                class="chip mod-chip"
              >
                {{ mod }}
              </span>
            </div>
          </div>

          <!-- 宏根读取中 -->
          <div v-else-if="row.kind === 'loading'" class="file-hint" style="margin-left: 26px">
            读取中…
          </div>

          <!-- 内联编辑行 -->
          <div
            v-else-if="row.kind === 'edit'"
            class="edit-row"
            :style="{ paddingLeft: indentOf(row.depth) }"
          >
            <input
              :ref="setEditRef"
              v-model="editValue"
              class="edit-input"
              :placeholder="editState?.kind === 'new-dir' ? '文件夹名' : '文件名（如 util.js）'"
              spellcheck="false"
              @keydown.enter.prevent="commitEdit"
              @keydown.esc.prevent="cancelEdit"
              @blur="commitEdit"
              @click.stop
            />
          </div>

          <!-- 目录行 -->
          <div
            v-else-if="row.kind === 'dir'"
            class="folder-row sub"
            :class="{ 'drop-target': dragOverKey === rowKey(row) }"
            :style="{ paddingLeft: indentOf(row.depth) }"
            :title="row.node.rel"
            draggable="true"
            @click="toggleDir(row.macro.id, row.node.rel)"
            @contextmenu.prevent="openMenu($event, { kind: 'dir', macro: row.macro, rel: row.node.rel })"
            @dragstart="onDragStart($event, row.macro, row.node.rel, true)"
            @dragend="onDragEnd"
            @dragover="onDragOver($event, row)"
            @dragleave="onDragLeave(row)"
            @drop="onDrop($event, row)"
          >
            <AppIcon
              name="chevron"
              :size="12"
              class="chevron"
              :class="{ open: expandedIds.has(dirKey(row.macro.id, row.node.rel)) }"
            />
            <AppIcon name="folder" :size="14" class="folder-icon" />
            <span class="name">{{ row.node.name }}</span>
            <span class="row-actions" @click.stop>
              <button
                class="action-btn"
                title="新建文件"
                @click="startEdit(row.macro.id, row.node.rel, 'new-file')"
              >
                <AppIcon name="file-plus" :size="13" />
              </button>
              <button
                class="action-btn"
                title="新建文件夹"
                @click="startEdit(row.macro.id, row.node.rel, 'new-dir')"
              >
                <AppIcon name="folder-plus" :size="13" />
              </button>
            </span>
          </div>

          <!-- 文件行 -->
          <div
            v-else
            class="file-row"
            :class="{
              selected:
                isActiveFile(row.macro, row.node.rel) ||
                treeSelection === filePath(row.macro, row.node.rel),
            }"
            :style="{ paddingLeft: indentOf(row.depth) }"
            :title="filePath(row.macro, row.node.rel)"
            draggable="true"
            @click="open(row.macro, row.node.rel)"
            @dragstart="onDragStart($event, row.macro, row.node.rel, false)"
            @dragend="onDragEnd"
            @contextmenu.prevent="openMenu($event, { kind: 'file', macro: row.macro, rel: row.node.rel })"
          >
            <AppIcon :name="fileIcon(row.node.name)" :size="14" class="file-icon" />
            <span class="file-name">{{ row.node.name }}</span>
          </div>
        </template>

        <div v-if="items.length === 0" class="empty-tree">
          <p>{{ macros.search ? '无匹配宏' : '暂无宏' }}</p>
          <button v-if="!macros.search" class="btn btn-primary" @click="openNewMacroWizard(category)">
            <AppIcon name="plus" :size="14" />
            新建宏
          </button>
        </div>
      </template>

      <div v-else class="empty-tree">
        <p>还没有宏。</p>
        <button class="btn btn-primary" @click="openNewMacroWizard(category)">
          <AppIcon name="plus" :size="14" />
          新建第一个宏
        </button>
      </div>
    </div>

    <ContextMenu
      v-if="menu"
      :x="menu.x"
      :y="menu.y"
      :items="menuItems"
      @select="
        (id) => {
          if (id === 'delete' && menu && menu.target.kind !== 'macro') requestTreeDelete(menu.target)
          else void onMenuSelect(id)
        }
      "
      @close="menu = null"
    />

    <MacroConfigDialog v-if="configTarget" :macro="configTarget" @close="configTarget = null" />

    <AppModal v-if="confirmTarget" title="删除" :width="420" @close="confirmTarget = null">
      <p>
        确定删除
        <b class="mono">{{ confirmTarget.isDir ? '目录' : '文件' }} {{ confirmTarget.rel }}</b> 吗？
      </p>
      <p class="danger-line">
        {{ confirmTarget.isDir ? '将递归删除目录内全部内容，' : '' }}<b>不可恢复</b>。
      </p>
      <template #footer>
        <button class="btn btn-ghost" @click="confirmTarget = null">取消</button>
        <button class="btn btn-danger" @click="confirmTreeDelete">删除</button>
      </template>
    </AppModal>
  </aside>
</template>

<style scoped>
.sidebar {
  width: var(--sidebar-w, 280px);
  flex: none;
  height: 100%;
  display: flex;
  flex-direction: column;
  background: var(--bg-sidebar);
  border-right: 1px solid var(--divider);
  min-height: 0;
  min-width: 0;
}

.sidebar-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 12px 8px;
}

.title {
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.8px;
  color: var(--text-2);
}

.new-btn {
  padding: 3px 9px;
  font-size: 12px;
}

.search-wrap {
  position: relative;
  margin: 0 10px 8px;
  display: flex;
  align-items: center;
}

.search-icon {
  position: absolute;
  left: 8px;
  color: var(--text-3);
  pointer-events: none;
}

.search-input {
  width: 100%;
  padding: 4px 24px 4px 26px;
  font-size: 12px;
}

.clear-search {
  position: absolute;
  right: 4px;
  color: var(--text-3);
  padding: 3px;
  display: inline-flex;
}

.clear-search:hover {
  color: var(--text-1);
}

.tree {
  flex: 1;
  overflow-y: auto;
  min-height: 0;
  padding-bottom: 12px;
}

/* ---- 树行 ---- */

.folder-row,
.file-row {
  display: flex;
  align-items: center;
  gap: 5px;
  margin: 1px 6px 1px 0;
  padding: 4px 8px 4px 6px;
  border-radius: var(--radius-md);
  cursor: pointer;
  user-select: none;
  transition: background var(--dur) var(--ease), opacity var(--dur) var(--ease);
}

.folder-row:hover,
.file-row:hover {
  background: var(--hover);
}

.folder-row.error {
  box-shadow: inset 2px 0 0 var(--danger);
}

.folder-row.dimmed {
  opacity: 0.55;
}

.folder-row.sub {
  padding-top: 3px;
  padding-bottom: 3px;
}

/* 宏根行：两行结构（目录名 / 启禁用+按键标签） */
.folder-row.macro-root {
  flex-direction: column;
  align-items: stretch;
  gap: 1px;
  padding-top: 3px;
  padding-bottom: 3px;
}

.folder-row.macro-root .row-line {
  display: flex;
  align-items: center;
  gap: 5px;
  min-width: 0;
}

.tags-line {
  padding-left: 23px;
  gap: 4px !important;
}

.chip {
  display: inline-flex;
  align-items: center;
  font-size: 10px;
  line-height: 1;
  padding: 2px 6px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--success) 14%, transparent);
  color: var(--success);
  white-space: nowrap;
}

.chip.off {
  background: var(--control);
  color: var(--text-3);
}

.chip.on-chip {
  background: color-mix(in srgb, var(--warning, #e8b339) 14%, transparent);
  color: var(--warning, #e8b339);
  font-family: var(--font-mono);
}

.chip.mod-chip {
  background: var(--control);
  color: var(--text-2);
  text-transform: capitalize;
}

.drop-target {
  background: var(--active) !important;
  outline: 1px dashed var(--accent);
  outline-offset: -1px;
}

.chevron {
  flex: none;
  color: var(--text-3);
  transition: transform var(--dur) var(--ease);
}

.chevron.open {
  transform: rotate(90deg);
}

.folder-icon {
  flex: none;
  color: var(--accent);
}

.name {
  flex: 1;
  min-width: 0;
  font-size: 13px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* ---- 行内按钮（新建文件/文件夹） ---- */

.row-actions {
  flex: none;
  display: none;
  align-items: center;
  gap: 2px;
}

.folder-row:hover .row-actions,
.folder-row:focus-within .row-actions {
  display: inline-flex;
}

.action-btn {
  padding: 3px;
  border-radius: var(--radius-sm);
  color: var(--text-2);
  display: inline-flex;
  transition:
    color var(--dur) var(--ease),
    background var(--dur) var(--ease);
}

.action-btn:hover {
  color: var(--text-1);
  background: var(--control);
}

.badges {
  flex: none;
  display: inline-flex;
  align-items: center;
  gap: 5px;
}

.run-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  border: 1.5px solid var(--text-3);
}

.run-dot.on {
  border-color: var(--success);
  background: var(--success);
}

.err-badge {
  color: var(--danger);
  display: inline-flex;
  cursor: pointer;
}

/* ---- 文件行 ---- */

.file-row.selected {
  background: var(--selected);
}

.file-icon {
  flex: none;
  color: var(--text-2);
}

.file-name {
  flex: 1;
  min-width: 0;
  font-size: 12.5px;
  color: var(--text-1);
  font-family: var(--font-mono);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* ---- 内联编辑 ---- */

.edit-row {
  display: flex;
  margin: 1px 6px 1px 0;
  padding: 2px 8px 2px 6px;
}

.edit-input {
  flex: 1;
  min-width: 0;
  font-size: 12.5px;
  font-family: var(--font-mono);
  padding: 2px 6px;
}

.file-hint {
  padding: 2px 8px;
  font-size: 11px;
  color: var(--text-3);
  user-select: none;
}

/* ---- 确认框 / 空态 ---- */

.mono {
  font-family: var(--font-mono);
  font-size: 12px;
  color: var(--text-1);
}

.danger-line {
  color: var(--danger);
  background: rgba(255, 92, 92, 0.08);
  border: 1px solid rgba(255, 92, 92, 0.25);
  border-radius: var(--radius-sm);
  padding: 8px 10px;
}

.empty-tree {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  padding: 48px 16px;
  color: var(--text-3);
  text-align: center;
}

.empty-tree p {
  margin: 0;
}
</style>

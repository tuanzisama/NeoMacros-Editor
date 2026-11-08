<script setup lang="ts">
/**
 * 宏「配置」= neomacro.yml 的结构化表单（声明即配置，新版 config: 块口径）。
 * 通用（入口=树选择 / 描述多行 / 版本作者）+ 类型专属：
 * 按键=键位录入（原版键名 + 修饰键）、事件=目录下拉单选、服务=lifecycle + autostart。
 * 保存：已知键行级替换，未知行/注释原样保留，缺键按结构追加（utils/manifest）。
 */
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { getEventCatalog, readFile, writeFile } from '@/api/endpoints'
import { ensureFiles, invalidateFiles, refresh } from '@/stores/macros'
import type { MacroFiles } from '@/stores/macros'
import { buildTree } from '@/stores/filetree'
import type { TreeNode } from '@/stores/filetree'
import { notify } from '@/stores/workspace'
import { KEYPRESS_EDGES, LIFECYCLE_LABELS } from '@/types/api'
import type { EventCatalogEntry, MacroView } from '@/types/api'
import { ApiError } from '@/types/api'
import {
  ensureConfigSection,
  pruneEmptyConfig,
  readConfigList,
  readConfigString,
  readTopString,
  setConfigField,
  setTopString,
} from '@/utils/manifest'
import { comboLabel, isModifierCode, modifiersOf, vanillaOf } from '@/utils/keynames'
import AppModal from '@/components/ui/AppModal.vue'
import AppIcon from '@/components/ui/AppIcon.vue'
import AppSelect, { type SelectOption } from '@/components/ui/AppSelect.vue'
import ToggleSwitch from '@/components/ui/ToggleSwitch.vue'

const props = defineProps<{ macro: MacroView }>()
const emit = defineEmits<{ close: [] }>()

const loading = ref(true)
const loadError = ref('')
const saving = ref(false)
const serverError = ref('')

/** 原始行缓存（保存时基于它做行级替换，保留未知行） */
let originalLines: string[] = []
/** 挂载时读取的 ETag（乐观并发） */
let originalEtag = ''

/* ---- 通用 ---- */

const version = ref('')
const author = ref('')
const description = ref('')
const main = ref('')

/* ---- 按键宏：键位录入 + 触发边沿 ---- */

const keyValue = ref<string | null>(null) // 原版键名（config.keypress.default-key）
const keyMods = ref<string[]>([]) // 清单 modifiers 段（ctrl/shift/alt）
const edge = ref('keypress')
const capturing = ref(false)
const pendingMods = ref<string[]>([])

/* ---- 事件宏：目录下拉单选 ---- */

const eventName = ref('')
const declaredEvents = ref<string[]>([])
const catalog = ref<EventCatalogEntry[] | null>(null) // null = 目录不可用（旧版 mod）

/* ---- 服务宏 ---- */

const serviceLifecycle = ref<string>('always')
const autostart = ref(false)

/* ---- 入口文件树选择 ---- */

const filesEntry = ref<MacroFiles | null>(null)
const mainOpen = ref(false)
const pickerRef = ref<HTMLElement | null>(null)
const pickerExpanded = ref(new Set<string>())

const EDGE_LABELS: Record<string, string> = {
  keydown: '按下（keydown）',
  keyup: '松开（keyup）',
  keypress: '键位（keypress）',
}

const SCRIPT_EXT_RE = /\.(js|mjs|cjs)$/i

onMounted(async () => {
  try {
    const file = await readFile(`${props.macro.id}/neomacro.yml`)
    originalLines = file.text.split(/\r?\n/)
    originalEtag = file.etag
    version.value = readTopString(originalLines, 'version') ?? ''
    author.value = readTopString(originalLines, 'author') ?? ''
    description.value = readTopString(originalLines, 'description') ?? ''
    main.value = readTopString(originalLines, 'main') ?? ''

    const on = readConfigString(originalLines, 'keypress', 'on')
    edge.value = on && (KEYPRESS_EDGES as readonly string[]).includes(on) ? on : 'keypress'
    keyValue.value = readConfigString(originalLines, 'keypress', 'default-key') || null
    keyMods.value = readConfigList(originalLines, 'keypress', 'modifiers') ?? []

    declaredEvents.value = readConfigList(originalLines, 'event', 'on') ?? []
    eventName.value = declaredEvents.value[0] ?? ''

    const lc = readConfigString(originalLines, 'service', 'lifecycle')
    if (lc && lc in LIFECYCLE_LABELS) serviceLifecycle.value = lc
    autostart.value = readConfigString(originalLines, 'service', 'autostart') === 'true'
  } catch (e) {
    loadError.value = e instanceof Error ? e.message : String(e)
  } finally {
    loading.value = false
  }

  if (props.macro.category === 'event') {
    try {
      const cat = await getEventCatalog()
      catalog.value = cat ? cat.events : null
    } catch {
      catalog.value = null
    }
  }
  filesEntry.value = await ensureFiles(props.macro.id)
})

/* ---- 键位录入（窗口级捕获：拦截一切按键，Esc 取消） ---- */

function onCaptureKeydown(e: KeyboardEvent): void {
  e.preventDefault()
  e.stopPropagation()
  if (e.key === 'Escape') return stopCapture()
  if (isModifierCode(e.code)) {
    pendingMods.value = modifiersOf(e)
    return
  }
  const vanilla = vanillaOf(e.code)
  if (!vanilla) return // 未识别的 code，继续等
  keyMods.value = modifiersOf(e)
  keyValue.value = vanilla
  stopCapture()
}

function onCaptureKeyup(e: KeyboardEvent): void {
  e.preventDefault()
  if (isModifierCode(e.code)) pendingMods.value = modifiersOf(e)
}

function stopCapture(): void {
  if (!capturing.value) return
  capturing.value = false
  pendingMods.value = []
  window.removeEventListener('keydown', onCaptureKeydown, true)
  window.removeEventListener('keyup', onCaptureKeyup, true)
}

function toggleCapture(): void {
  if (capturing.value) {
    stopCapture()
    return
  }
  pendingMods.value = []
  capturing.value = true
  window.addEventListener('keydown', onCaptureKeydown, true)
  window.addEventListener('keyup', onCaptureKeyup, true)
}

function clearKey(): void {
  keyValue.value = null
  keyMods.value = []
}

const captureLabel = computed(() => {
  if (capturing.value) {
    return pendingMods.value.length > 0 ? `${comboLabel(pendingMods.value, null)}+…` : '按下按键…'
  }
  return keyValue.value ? comboLabel(keyMods.value, keyValue.value) : ''
})

onBeforeUnmount(stopCapture)

/* ---- 事件目录下拉（domain 分组；已声明但目录缺失的事件保留为选项） ---- */

const groupedEvents = computed(() => {
  const known = new Set((catalog.value ?? []).map((e) => e.name))
  const list: EventCatalogEntry[] = [
    ...(catalog.value ?? []),
    ...declaredEvents.value
      .filter((n) => !known.has(n))
      .map((n) => ({ name: n, cancellable: false })),
  ]
  const groups = new Map<string, EventCatalogEntry[]>()
  for (const ev of list) {
    const i = ev.name.indexOf(':')
    const domain = i > 0 ? ev.name.slice(0, i) : '其他'
    const bucket = groups.get(domain) ?? []
    bucket.push(ev)
    groups.set(domain, bucket)
  }
  for (const bucket of groups.values()) bucket.sort((a, b) => a.name.localeCompare(b.name))
  return [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0]))
})

/* ---- AppSelect 选项 ---- */

const EDGE_OPTIONS = computed<SelectOption[]>(() =>
  KEYPRESS_EDGES.map((e) => ({ value: e, label: EDGE_LABELS[e] ?? e })),
)

const EVENT_OPTIONS = computed<SelectOption[]>(() =>
  groupedEvents.value.flatMap(([domain, list]) =>
    list.map((ev) => ({
      value: ev.name,
      label: ev.cancellable ? `${ev.name} · 可取消` : ev.name,
      group: domain,
    })),
  ),
)

const LIFECYCLE_OPTIONS = computed<SelectOption[]>(() =>
  Object.entries(LIFECYCLE_LABELS).map(([value, label]) => ({ value, label })),
)

/* ---- 入口树 ---- */

type PickerRow =
  | { kind: 'default' }
  | { kind: 'dir'; node: TreeNode; depth: number }
  | { kind: 'file'; node: TreeNode; depth: number }

const isScript = (node: TreeNode): boolean => SCRIPT_EXT_RE.test(node.name)

const pickerRows = computed<PickerRow[]>(() => {
  const listing = filesEntry.value
  if (!listing || listing.loading) return []
  const out: PickerRow[] = [{ kind: 'default' }]
  const walk = (nodes: TreeNode[], depth: number): void => {
    for (const n of nodes) {
      if (n.type === 'dir') {
        out.push({ kind: 'dir', node: n, depth })
        if (pickerExpanded.value.has(n.rel)) walk(n.children ?? [], depth + 1)
      } else {
        out.push({ kind: 'file', node: n, depth })
      }
    }
  }
  walk(buildTree(listing), 0)
  return out
})

function pickerIndent(depth: number): string {
  return `${6 + depth * 14}px`
}

function toggleMainPicker(): void {
  if (mainOpen.value) {
    mainOpen.value = false
    return
  }
  // 展开当前入口的祖先目录，选中项可见
  const parts = main.value.split('/')
  for (let i = 1; i < parts.length; i++) pickerExpanded.value.add(parts.slice(0, i).join('/'))
  mainOpen.value = true
}

function onPickerRow(row: PickerRow): void {
  if (row.kind === 'default') {
    main.value = ''
    mainOpen.value = false
  } else if (row.kind === 'dir') {
    const key = row.node.rel
    if (pickerExpanded.value.has(key)) pickerExpanded.value.delete(key)
    else pickerExpanded.value.add(key)
  } else if (isScript(row.node)) {
    main.value = row.node.rel
    mainOpen.value = false
  }
}

function fileIconOf(name: string): string {
  return SCRIPT_EXT_RE.test(name) ? 'file-code' : /\.(ya?ml|json)$/i.test(name) ? 'files' : 'file-code'
}

function onDocPointer(e: PointerEvent): void {
  if (pickerRef.value && !pickerRef.value.contains(e.target as Node)) mainOpen.value = false
}

watch(mainOpen, (open) => {
  if (open) document.addEventListener('pointerdown', onDocPointer, true)
  else document.removeEventListener('pointerdown', onDocPointer, true)
})

onBeforeUnmount(() => document.removeEventListener('pointerdown', onDocPointer, true))

/* ---- 保存 ---- */

const canSave = computed(
  () => !loading.value && !saving.value && (props.macro.category !== 'event' || eventName.value !== ''),
)

async function save(): Promise<void> {
  if (!canSave.value) return
  saving.value = true
  serverError.value = ''
  try {
    const lines = [...originalLines]
    setTopString(lines, 'version', version.value.trim())
    setTopString(lines, 'author', author.value.trim())
    setTopString(lines, 'description', description.value.trim())
    setTopString(lines, 'main', main.value.trim())
    if (props.macro.category === 'keypress') {
      setConfigField(lines, 'keypress', 'on', edge.value)
      setConfigField(lines, 'keypress', 'default-key', keyValue.value)
      setConfigField(lines, 'keypress', 'modifiers', keyMods.value.length > 0 ? keyMods.value : null)
      pruneEmptyConfig(lines)
      ensureConfigSection(lines, 'keypress') // keypress 宏的必备块，键位清空后也不能剪
    } else if (props.macro.category === 'event') {
      setConfigField(lines, 'event', 'on', eventName.value)
      pruneEmptyConfig(lines)
    } else if (props.macro.category === 'services') {
      setConfigField(lines, 'service', 'lifecycle', serviceLifecycle.value)
      setConfigField(lines, 'service', 'autostart', autostart.value) // 裸布尔（引号会被清单校验拒绝）
      pruneEmptyConfig(lines)
    }
    const result = await writeFile(
      `${props.macro.id}/neomacro.yml`,
      `${lines.join('\n').replace(/\s*$/, '\n')}`,
      originalEtag,
    )
    if (result.error) {
      notify(`已保存，但热重载报错：${result.error.message}`, 'warning')
    } else {
      notify('配置已保存并热重载', 'success')
    }
    // 入口可能变化 → 文件列表失效；树显示跟随声明
    invalidateFiles(props.macro.id)
    void refresh()
    emit('close')
  } catch (e) {
    serverError.value = e instanceof ApiError ? e.label : e instanceof Error ? e.message : String(e)
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <AppModal title="配置" :width="520" @close="emit('close')">
    <div v-if="loading" class="hint">读取中…</div>
    <div v-else-if="loadError" class="error-text">{{ loadError }}</div>
    <template v-else>
      <!-- 通用 -->
      <div class="field">
        <label>入口</label>
        <div ref="pickerRef" class="picker">
          <button class="picker-toggle" type="button" @click="toggleMainPicker">
            <AppIcon name="file-code" :size="14" class="picker-icon" />
            <span class="picker-value mono" :class="{ placeholder: !main }">{{
              main || 'index.js'
            }}</span>
            <span v-if="!main" class="def-tag">默认</span>
            <AppIcon name="chevron" :size="12" class="chevron" :class="{ open: mainOpen }" />
          </button>
          <div v-if="mainOpen" class="picker-menu">
            <button
              v-for="(row, i) in pickerRows"
              :key="i"
              type="button"
              class="picker-row"
              :class="{
                selected:
                  row.kind === 'default' ? main === '' : row.kind === 'file' && row.node.rel === main,
                disabled: row.kind === 'file' && !isScript(row.node),
                dir: row.kind === 'dir',
              }"
              :style="{ paddingLeft: row.kind === 'default' ? '6px' : pickerIndent(row.depth) }"
              @click="onPickerRow(row)"
            >
              <template v-if="row.kind === 'default'">
                <AppIcon name="file-code" :size="13" />
                <span class="name">index.js</span>
                <span class="def-tag">默认</span>
              </template>
              <template v-else-if="row.kind === 'dir'">
                <AppIcon
                  name="chevron"
                  :size="11"
                  class="chevron row-chevron"
                  :class="{ open: pickerExpanded.has(row.node.rel) }"
                />
                <AppIcon name="folder" :size="13" class="dir-icon" />
                <span class="name">{{ row.node.name }}</span>
              </template>
              <template v-else>
                <AppIcon :name="fileIconOf(row.node.name)" :size="13" class="file-icon" />
                <span class="name">{{ row.node.name }}</span>
              </template>
            </button>
            <div v-if="pickerRows.length === 1" class="picker-empty">读取中…</div>
          </div>
        </div>
      </div>
      <div class="field">
        <label>描述</label>
        <textarea
          v-model="description"
          class="desc-input"
          rows="3"
          placeholder="一句话说明用途"
          spellcheck="false"
        />
      </div>
      <div class="field-grid">
        <div class="field">
          <label>版本</label>
          <input v-model="version" placeholder="1.0.0" spellcheck="false" />
        </div>
        <div class="field">
          <label>作者</label>
          <input v-model="author" placeholder="作者" spellcheck="false" />
        </div>
      </div>

      <!-- 按键宏 -->
      <template v-if="macro.category === 'keypress'">
        <div class="field">
          <label>键位</label>
          <div class="key-capture" :class="{ capturing }" role="button" @click="toggleCapture">
            <template v-if="capturing">
              <span class="key-label pending">{{ captureLabel }}</span>
              <span class="key-side">Esc 取消</span>
            </template>
            <template v-else-if="keyValue">
              <span class="key-label mono">{{ captureLabel }}</span>
              <button class="key-clear" title="清除" @click.stop="clearKey">
                <AppIcon name="close" :size="12" />
              </button>
            </template>
            <template v-else>
              <span class="key-label placeholder">点击录入按键</span>
            </template>
          </div>
        </div>
        <div class="field">
          <label>触发边沿</label>
          <AppSelect v-model="edge" :options="EDGE_OPTIONS" />
          <span class="hint">keydown/keyup 为原始边沿（支持修饰键）；keypress 走原版键位绑定。</span>
        </div>
      </template>

      <!-- 事件宏 -->
      <template v-else-if="macro.category === 'event'">
        <div class="field">
          <label>事件</label>
          <AppSelect v-model="eventName" :options="EVENT_OPTIONS" placeholder="选择事件…" />
          <span v-if="catalog === null" class="hint">事件目录不可用（mod 未提供 /api/v1/events/catalog）</span>
          <span v-else-if="declaredEvents.length > 1" class="hint">
            原清单声明 {{ declaredEvents.length }} 个事件，保存后仅保留所选。
          </span>
        </div>
      </template>

      <!-- 服务宏 -->
      <template v-else-if="macro.category === 'services'">
        <div class="field">
          <label>生命周期</label>
          <AppSelect v-model="serviceLifecycle" :options="LIFECYCLE_OPTIONS" />
        </div>
        <div class="field row">
          <label>自启</label>
          <ToggleSwitch v-model="autostart" />
        </div>
      </template>

      <p class="hint">其余字段（name/license/permissions 等）直接在 neomacro.yml 里编辑。</p>
    </template>
    <p v-if="serverError" class="error-text">{{ serverError }}</p>
    <template #footer>
      <button class="btn btn-ghost" @click="emit('close')">取消</button>
      <button class="btn btn-primary" :disabled="!canSave" @click="save">
        {{ saving ? '保存中…' : '保存' }}
      </button>
    </template>
  </AppModal>
</template>

<style scoped>
.field {
  margin-bottom: 12px;
}

.field.row {
  display: flex;
  flex-direction: row; /* base.css 的 .field 是 column，须显式拉回行向 */
  align-items: center;
  justify-content: space-between;
}

.field label {
  display: block;
  font-size: 12px;
  color: var(--text-2);
  margin-bottom: 4px;
}

.field.row label {
  margin-bottom: 0;
}

.field-grid {
  display: flex;
  gap: 10px;
}

.field-grid .field {
  flex: 1;
  min-width: 0;
}

textarea.desc-input {
  resize: vertical;
  min-height: 56px;
  font-size: 12.5px;
  line-height: 1.5;
}

.hint {
  font-size: 11px;
  color: var(--text-3);
  margin: 8px 0 0;
}

.field .hint {
  margin-top: 4px;
}

.error-text {
  font-size: 12px;
  color: var(--danger);
  margin: 8px 0 0;
}

.mono {
  font-family: var(--font-mono);
}

/* ---- 入口树选择 ---- */

.picker {
  position: relative;
}

.picker-toggle {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  padding: 4px 8px;
  background: var(--bg-elevated);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  text-align: left;
  transition: border-color var(--dur) var(--ease);
}

.picker-toggle:hover {
  border-color: var(--border-strong);
}

.picker-icon {
  flex: none;
  color: var(--text-2);
}

.picker-value {
  flex: 1;
  min-width: 0;
  font-size: 12.5px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.picker-value.placeholder {
  color: var(--text-1);
}

.def-tag {
  flex: none;
  font-size: 10px;
  line-height: 1;
  padding: 2px 5px;
  border-radius: 999px;
  background: var(--control);
  color: var(--text-3);
}

.chevron {
  flex: none;
  color: var(--text-3);
  transition: transform var(--dur) var(--ease);
}

.chevron.open {
  transform: rotate(90deg);
}

.picker-menu {
  position: absolute;
  top: calc(100% + 4px);
  left: 0;
  right: 0;
  max-height: 240px;
  overflow-y: auto;
  padding: 4px;
  background: var(--bg-elevated);
  border: 1px solid var(--border-strong);
  border-radius: var(--radius-sm);
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
  z-index: 10;
}

.picker-row {
  display: flex;
  align-items: center;
  gap: 5px;
  width: 100%;
  padding: 3px 6px;
  border-radius: var(--radius-sm);
  text-align: left;
  font-size: 12px;
  color: var(--text-1);
}

.picker-row:hover {
  background: var(--hover);
}

.picker-row.selected {
  background: var(--selected);
}

.picker-row.disabled {
  opacity: 0.4;
}

.picker-row .name {
  flex: 1;
  min-width: 0;
  font-family: var(--font-mono);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.row-chevron {
  width: 11px;
}

.dir-icon {
  flex: none;
  color: var(--accent);
}

.file-icon {
  flex: none;
  color: var(--text-2);
}

.picker-row .file-icon {
  margin-left: 16px;
}

.picker-empty {
  padding: 8px;
  font-size: 11px;
  color: var(--text-3);
  text-align: center;
}

/* ---- 键位录入 ---- */

.key-capture {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  min-height: 28px;
  padding: 4px 8px;
  background: var(--bg-elevated);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  cursor: pointer;
  user-select: none;
  transition: border-color var(--dur) var(--ease);
}

.key-capture:hover {
  border-color: var(--border-strong);
}

.key-capture.capturing {
  border-color: var(--accent);
}

.key-label {
  font-family: var(--font-mono);
  font-size: 12.5px;
}

.key-label.placeholder {
  font-family: inherit;
  color: var(--text-3);
}

.key-label.pending {
  color: var(--accent);
}

.key-side {
  font-size: 11px;
  color: var(--text-3);
}

.key-clear {
  color: var(--text-3);
  display: inline-flex;
  padding: 2px;
  border-radius: var(--radius-sm);
}

.key-clear:hover {
  color: var(--text-1);
  background: var(--control);
}
</style>

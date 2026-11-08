<script setup lang="ts">
/**
 * DevTools 控制台（合并视图）：宿主日志 + 脚本 console 输出的单一时间线，
 * Chrome DevTools 口径——工具栏（REPL 上下文 / 宏过滤 / 级别桶下拉 / 搜索 /
 * 侧栏切换 / 清屏）、左侧级别侧栏（默认隐藏）、底部 REPL 输入行。
 * 滚动条贴底即自动滚动，离底即停（无暂停）；console.clear 清空合并视图。
 * 渲染规则见 consoleFormat.ts；结构化节点由 ConsoleMessage 递归渲染。
 */
import { ref, watch, nextTick, onMounted, computed } from 'vue'
import {
  mergedFilters,
  filteredMergedRows,
  bucketCounts,
  bucketOf,
  BUCKET_LABELS,
  clearMergedView,
  type MergedRow,
  type LevelBucket,
} from '@/stores/mergedConsole'
import { scriptConsole, entryMacroId, flattenEntry } from '@/stores/console'
import { macros } from '@/stores/macros'
import { settings } from '@/stores/settings'
import { revealInEditor } from '@/stores/editor'
import { formatArgs, countText, timerText, stringifyNode, type DisplaySeg } from './consoleFormat'
import ConsoleMessage from './ConsoleMessage.vue'
import ConsolePrompt from './ConsolePrompt.vue'
import AppIcon from '@/components/ui/AppIcon.vue'
import AppSelect, { type SelectOption } from '@/components/ui/AppSelect.vue'
import AppCheckbox from '@/components/ui/AppCheckbox.vue'
import AppPopover from '@/components/ui/AppPopover.vue'
import type { ConsoleEntry } from '@/types/api'

const scroller = ref<HTMLDivElement | null>(null)
const stickBottom = ref(true)

function onScroll(): void {
  const el = scroller.value
  if (!el) return
  stickBottom.value = el.scrollHeight - el.scrollTop - el.clientHeight < 40
}

watch(
  () => filteredMergedRows.value.length,
  async () => {
    if (!stickBottom.value) return
    await nextTick()
    const el = scroller.value
    if (el) el.scrollTop = el.scrollHeight
  },
)

onMounted(() => {
  const el = scroller.value
  if (el) el.scrollTop = el.scrollHeight
})

// ---- 工具栏 ----------------------------------------------------------------

/** REPL 目标上下文（Chrome "top ▼"）：devtools 独立会话或任一宏 */
const replTarget = ref('devtools')

/** 宏下拉选项（完整 id，稳定排序） */
const macroOptions = computed<SelectOption[]>(() =>
  macros.macros
    .map((m) => m.id)
    .sort((a, b) => a.localeCompare(b))
    .map((id) => ({ value: id, label: id })),
)

const BUCKETS: LevelBucket[] = ['verbose', 'info', 'warn', 'error']

/** 级别下拉按钮文案：全开 = 默认级别（Chrome 口径） */
const levelsLabel = computed(() => {
  const enabled = BUCKETS.filter((b) => mergedFilters.buckets[b])
  return enabled.length === BUCKETS.length
    ? '默认级别'
    : enabled.map((b) => BUCKET_LABELS[b]).join('/') || '无级别'
})

function setBucket(bucket: LevelBucket, on: boolean): void {
  mergedFilters.buckets[bucket] = on
}

// ---- 侧栏 ------------------------------------------------------------------

/** 侧栏点击：独占该桶（已独占时还原全开）；「全部」恢复全开 */
function selectBucket(bucket: LevelBucket | 'all'): void {
  if (bucket === 'all') {
    for (const b of BUCKETS) mergedFilters.buckets[b] = true
    return
  }
  const enabledCount = BUCKETS.filter((b) => mergedFilters.buckets[b]).length
  const exclusive = enabledCount === BUCKETS.length || !mergedFilters.buckets[bucket]
  for (const b of BUCKETS) mergedFilters.buckets[b] = exclusive ? b === bucket : true
}

// ---- 行渲染 ----------------------------------------------------------------

const LOG_COLORS: Record<string, string> = {
  ERROR: 'var(--danger)',
  WARN: 'var(--warning)',
  INFO: 'var(--accent)',
  DEBUG: 'var(--text-3)',
  TRACE: 'var(--text-3)',
}

const CONSOLE_COLORS: Record<string, string> = {
  error: 'var(--danger)',
  assert: 'var(--danger)',
  warn: 'var(--warning)',
  info: 'var(--accent)',
  log: 'var(--text-1)',
  debug: 'var(--text-3)',
}

function levelLabel(row: MergedRow): string {
  if (row.source === 'log') return row.entry.level.toLowerCase()
  const entry = row.entry
  return entry.kind === 'assert' ? 'assert' : entry.level
}

function levelColor(row: MergedRow): string {
  if (row.source === 'log') return LOG_COLORS[row.entry.level] ?? 'var(--text-2)'
  return CONSOLE_COLORS[levelLabel(row)] ?? 'var(--text-1)'
}

function timeOf(row: MergedRow): string {
  const d = new Date(row.ts)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}

/** 来源列：console 行显示宏 id，日志行显示 logger */
function sourceOf(row: MergedRow): string {
  return row.source === 'log' ? row.entry.logger : entryMacroId(row.entry)
}

/** 特殊 kind 的替代文案（null = 走常规 args 渲染） */
const specialText = computed(() => (entry: ConsoleEntry): string | null => {
  if (entry.kind === 'count') return countText(entry)
  if (entry.kind === 'time' || entry.kind === 'timeEnd') return timerText(entry)
  return null
})

function segments(entry: ConsoleEntry): DisplaySeg[] {
  return formatArgs(entry.args)
}

/** file:line 可跳转（当前宏文件已在面板可见时直接定位） */
function jump(entry: ConsoleEntry): void {
  if (!entry.file || entry.line === null) return
  const macroId = entryMacroId(entry)
  void revealInEditor(`${macroId}/${entry.file}`, macroId, entry.line, entry.col ?? 1)
}

// ---- table 渲染 -----------------------------------------------------------

interface TableModel {
  cols: string[]
  rows: string[][]
}

const MAX_TABLE_ROWS = 50
const MAX_TABLE_COLS = 10

/** args[0] 是数组/对象时产出简单表格模型，否则 null 退回常规渲染 */
function tableModel(entry: ConsoleEntry): TableModel | null {
  const first = entry.args[0]
  if (!first) return null
  if (first.t === 'arr') {
    const items = first.items.slice(0, MAX_TABLE_ROWS)
    if (items.every((item) => item.t === 'obj')) {
      const cols: string[] = []
      for (const item of items as Extract<ConsoleEntry['args'][number], { t: 'obj' }>[]) {
        for (const prop of item.props) {
          if (prop.k !== '' && !cols.includes(prop.k) && cols.length < MAX_TABLE_COLS) {
            cols.push(prop.k)
          }
        }
      }
      const rows = items.map((item) => {
        const obj = item as Extract<ConsoleEntry['args'][number], { t: 'obj' }>
        return cols.map((col) => {
          const prop = obj.props.find((p) => p.k === col)
          return prop ? stringifyCell(prop.v) : ''
        })
      })
      return { cols: ['(index)', ...cols], rows: rows.map((r, i) => [String(i), ...r]) }
    }
    return {
      cols: ['(index)', '值'],
      rows: items.map((item, i) => [String(i), stringifyCell(item)]),
    }
  }
  if (first.t === 'obj') {
    const props = first.props.slice(0, MAX_TABLE_ROWS)
    return {
      cols: ['(键)', '值'],
      rows: props.map((prop) => [prop.k, stringifyNode(prop.v)]),
    }
  }
  return null
}

function stringifyCell(node: ConsoleEntry['args'][number]): string {
  return stringifyNode(node)
}
</script>

<template>
  <div class="console-tab">
    <div class="tab-toolbar">
      <AppSelect
        v-model="replTarget"
        :options="[{ value: 'devtools', label: 'devtools' }, ...macroOptions]"
        class="context-select"
        title="REPL 执行上下文"
      />
      <AppSelect
        v-model="mergedFilters.macroFilter"
        :options="[{ value: '', label: '全部宏' }, ...macroOptions]"
        class="macro-select"
        title="只看某个宏"
      />
      <AppPopover align="start">
        <template #trigger>
          <button class="levels-btn" :title="`启用级别：${levelsLabel}`">
            {{ levelsLabel }} <span class="caret">▾</span>
          </button>
        </template>
        <div class="levels-list">
          <AppCheckbox
            v-for="b in BUCKETS"
            :key="b"
            :model-value="mergedFilters.buckets[b]"
            :label="BUCKET_LABELS[b]"
            @update:model-value="setBucket(b, $event)"
          >
            <span class="levels-count">{{ bucketCounts[b] }}</span>
          </AppCheckbox>
        </div>
      </AppPopover>
      <input v-model="mergedFilters.search" class="log-search" placeholder="过滤…" spellcheck="false" />
      <button
        class="tool"
        :class="{ on: settings.consoleSidebar }"
        :title="settings.consoleSidebar ? '隐藏控制台侧栏' : '显示控制台侧栏'"
        @click="settings.consoleSidebar = !settings.consoleSidebar"
      >
        <AppIcon name="sidebar" :size="13" />
      </button>
      <button class="tool" title="清屏" @click="clearMergedView">
        <AppIcon name="trash" :size="13" />
      </button>
    </div>

    <div class="console-body">
      <aside v-if="settings.consoleSidebar" class="console-aside">
        <button class="aside-row" @click="selectBucket('all')">
          <span class="aside-ic">≡</span>
          <span v-if="bucketCounts.all === 0">暂无消息</span>
          <template v-else>全部 <span class="aside-count">{{ bucketCounts.all }}</span></template>
        </button>
        <button class="aside-row" @click="selectBucket('error')">
          <span class="aside-ic err">⊗</span>
          <span v-if="bucketCounts.error === 0">无错误</span>
          <template v-else>错误 <span class="aside-count">{{ bucketCounts.error }}</span></template>
        </button>
        <button class="aside-row" @click="selectBucket('warn')">
          <span class="aside-ic warn">⚠</span>
          <span v-if="bucketCounts.warn === 0">无警告</span>
          <template v-else>警告 <span class="aside-count">{{ bucketCounts.warn }}</span></template>
        </button>
        <button class="aside-row" @click="selectBucket('info')">
          <span class="aside-ic info">ℹ</span>
          <span v-if="bucketCounts.info === 0">无信息</span>
          <template v-else>信息 <span class="aside-count">{{ bucketCounts.info }}</span></template>
        </button>
        <button class="aside-row" @click="selectBucket('verbose')">
          <span class="aside-ic verbose">♪</span>
          <span v-if="bucketCounts.verbose === 0">无详细</span>
          <template v-else>详细 <span class="aside-count">{{ bucketCounts.verbose }}</span></template>
        </button>
      </aside>

      <div ref="scroller" class="log-scroll" @scroll="onScroll">
        <div v-if="scriptConsole.error" class="log-error">控制台拉取失败：{{ scriptConsole.error }}</div>
        <div
          v-if="filteredMergedRows.length === 0 && !scriptConsole.error"
          class="log-empty"
        >
          暂无消息（宏里用 console.log 调试；宿主日志也会出现在这里）
        </div>
        <div
          v-for="row in filteredMergedRows"
          :key="`${row.source}:${row.entry.seq}`"
          class="line"
          :class="[row.source === 'console' ? `lv-${row.entry.level}` : `lv-${bucketOf(row)}`]"
        >
          <span class="time">{{ timeOf(row) }}</span>
          <span class="level" :style="{ color: levelColor(row) }">{{ levelLabel(row) }}</span>
          <span class="source" :title="sourceOf(row)">{{ sourceOf(row) }}</span>
          <span class="msg" :style="{ paddingLeft: row.source === 'console' ? row.entry.depth * 18 + 'px' : '0' }">
            <!-- REPL 输入回显：› 表达式 -->
            <template v-if="row.source === 'console' && row.entry.kind === 'input'">
              <span class="prompt-chr">›</span>
              <span class="input-text">{{ stringifyNode(row.entry.args[0]) }}</span>
            </template>
            <!-- 宿主日志行：纯文本 -->
            <template v-else-if="row.source === 'log'">
              <span class="plain">{{ row.entry.line }}</span>
            </template>
            <!-- 以下与原脚本控制台渲染一致 -->
            <template v-else-if="row.entry.kind === 'group'">
              <span class="group-title">{{ flattenEntry(row.entry) }}</span>
            </template>
            <template v-else-if="row.entry.kind === 'table' && tableModel(row.entry)">
              <table class="table">
                <thead>
                  <tr>
                    <th v-for="col in tableModel(row.entry)!.cols" :key="col">{{ col }}</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="(trow, ri) in tableModel(row.entry)!.rows" :key="ri">
                    <td v-for="(cell, ci) in trow" :key="ci">{{ cell }}</td>
                  </tr>
                </tbody>
              </table>
            </template>
            <span v-else-if="row.entry.kind === 'trace' && row.entry.stack" class="trace" :title="row.entry.stack">
              {{ flattenEntry(row.entry) }}
            </span>
            <template v-else-if="specialText(row.entry) !== null">
              <span class="special">{{ specialText(row.entry) }}</span>
            </template>
            <template v-else>
              <template v-for="(seg, i) in segments(row.entry)" :key="i">
                <span
                  v-if="'text' in seg"
                  class="seg"
                  :style="seg.style || undefined"
                >{{ seg.text }}</span>
                <template v-else>
                  <span v-if="i > 0" class="seg-gap"> </span>
                  <ConsoleMessage :node="seg.node" />
                </template>
              </template>
            </template>

            <span
              v-if="row.source === 'console' && row.entry.file && row.entry.line !== null"
              class="loc"
              :title="`${entryMacroId(row.entry)}/${row.entry.file}:${row.entry.line}`"
              @click="jump(row.entry)"
            >
              {{ row.entry.file }}:{{ row.entry.line }}
            </span>
          </span>
        </div>
      </div>
    </div>

    <ConsolePrompt :target="replTarget" />
  </div>
</template>

<style scoped>
.console-tab {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.tab-toolbar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 10px;
  border-bottom: 1px solid var(--divider);
  flex: none;
}

.context-select,
.macro-select {
  font-size: 11px;
  padding: 2px 6px;
  max-width: 180px;
}

.levels-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 11px;
  padding: 3px 8px;
  border-radius: var(--radius-sm);
  color: var(--text-2);
  white-space: nowrap;
  cursor: pointer;
}

.levels-btn:hover {
  background: var(--hover);
  color: var(--text-1);
}

.caret {
  font-size: 9px;
  color: var(--text-3);
}

.levels-list {
  display: flex;
  flex-direction: column;
  gap: 1px;
  min-width: 140px;
}

.levels-count {
  margin-left: auto;
  color: var(--text-3);
}

.log-search {
  flex: 1;
  max-width: 260px;
  font-size: 11px;
  padding: 2px 8px;
}

.tool {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 3px 7px;
  border-radius: var(--radius-sm);
  color: var(--text-2);
  font-size: 11px;
}

.tool:hover {
  background: var(--hover);
  color: var(--text-1);
}

.tool.on {
  background: var(--active);
  color: var(--accent);
}

.console-body {
  flex: 1;
  min-height: 0;
  display: flex;
}

.console-aside {
  flex: none;
  width: 170px;
  border-right: 1px solid var(--divider);
  padding: 6px 4px;
  display: flex;
  flex-direction: column;
  gap: 2px;
  overflow-y: auto;
}

.aside-row {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  font-family: var(--font-ui);
  padding: 4px 8px;
  border-radius: var(--radius-sm);
  color: var(--text-1);
  text-align: left;
}

.aside-row:hover {
  background: var(--hover);
}

.aside-ic {
  flex: none;
  width: 16px;
  text-align: center;
  color: var(--text-2);
}

.aside-ic.err {
  color: var(--danger);
}

.aside-ic.warn {
  color: var(--warning);
}

.aside-ic.info {
  color: var(--accent);
}

.aside-ic.verbose {
  color: var(--text-3);
}

.aside-count {
  color: var(--text-3);
  font-size: 11px;
}

.log-scroll {
  flex: 1;
  overflow-y: auto;
  font-family: var(--font-mono);
  font-size: 11px;
  line-height: 1.75;
  padding: 6px 0;
}

.line {
  display: flex;
  gap: 8px;
  padding: 0 12px;
  align-items: baseline;
}

.line:hover {
  background: var(--hover);
}

.line.src-console.lv-error,
.line.src-console.lv-assert {
  background: color-mix(in srgb, var(--danger) 8%, transparent);
}

.line.src-console.lv-warn {
  background: color-mix(in srgb, var(--warning) 8%, transparent);
}

.time {
  color: var(--text-3);
  flex: none;
  font-size: 10px;
  width: 56px;
  user-select: none;
}

.level {
  flex: none;
  width: 44px;
  font-weight: 600;
  user-select: none;
}

.source {
  color: var(--text-3);
  flex: none;
  max-width: 150px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  user-select: none;
}

.msg {
  flex: 1;
  min-width: 0;
  color: var(--text-1);
  white-space: pre-wrap;
  word-break: break-all;
  user-select: text;
}

.plain {
  white-space: pre-wrap;
}

.prompt-chr {
  color: var(--accent);
  font-weight: 700;
  margin-right: 6px;
  user-select: none;
}

.input-text {
  color: var(--text-1);
}

.group-title {
  font-weight: 700;
}

.seg-gap {
  display: inline-block;
  width: 6px;
}

.seg {
  white-space: pre-wrap;
}

.special {
  color: var(--text-2);
}

.trace {
  color: var(--text-2);
  cursor: help;
}

.loc {
  margin-left: 8px;
  color: var(--text-3);
  font-size: 10px;
  cursor: pointer;
  flex: none;
  user-select: none;
}

.loc:hover {
  color: var(--accent);
  text-decoration: underline;
}

.table {
  border-collapse: collapse;
  margin: 2px 0;
  font-size: 10px;
}

.table th,
.table td {
  border: 1px solid var(--divider);
  padding: 1px 8px;
  text-align: left;
}

.table th {
  color: var(--text-3);
  background: var(--bg-elevated);
  font-weight: 600;
}

.log-empty,
.log-error {
  padding: 14px;
  color: var(--text-3);
  font-family: var(--font-ui);
  font-size: 12px;
}

.log-error {
  color: var(--danger);
}
</style>

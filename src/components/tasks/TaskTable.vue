<script setup lang="ts">
/**
 * 任务管理器表格（DevTools 页签与活动栏主视图共用）。
 * 工具栏：状态过滤 + 搜索 + 列配置（settings 持久化）+ 刷新；
 * 行：名称点击跳宏配置（树中高亮 neomacro.yml）、宏文件列打开入口文件；
 * 操作列：重启（新契约端点，旧 mod 404 提示）、调试（DevTools 控制台按宏过滤）、运行中可停止。
 */
import { computed } from 'vue'
import { tasksStore, filteredTasks, durationText, stopTaskById, restartTaskById, debugTask, refreshTasks } from '@/stores/tasks'
import { macros } from '@/stores/macros'
import { openMacro } from '@/stores/editor'
import { revealMacroConfig } from '@/stores/filetree'
import { focusEditor, notify } from '@/stores/workspace'
import { settings } from '@/stores/settings'
import { CATEGORY_LABELS } from '@/types/api'
import type { TaskEntry } from '@/types/api'
import AppIcon from '@/components/ui/AppIcon.vue'
import AppSelect from '@/components/ui/AppSelect.vue'
import AppCheckbox from '@/components/ui/AppCheckbox.vue'
import AppPopover from '@/components/ui/AppPopover.vue'

/** 列定义（id 对应 settings.taskColumns 持久化） */
const COLUMNS = [
  { id: 'id', label: '任务ID' },
  { id: 'status', label: '状态' },
  { id: 'name', label: '任务名称' },
  { id: 'type', label: '宏类型' },
  { id: 'trigger', label: '触发' },
  { id: 'startedAt', label: '创建时间' },
  { id: 'duration', label: '持续时间' },
  { id: 'triggers', label: '触发次数' },
  { id: 'file', label: '宏文件' },
  { id: 'player', label: '玩家' },
  { id: 'gameType', label: '游戏类型' },
  { id: 'server', label: '服务器' },
  { id: 'startedBy', label: '启动方式' },
  { id: 'mcVersion', label: 'MC版本' },
] as const

const STATUS_OPTIONS = [
  { value: '', label: '全部状态' },
  { value: 'running', label: '运行中' },
  { value: 'stopped', label: '已停止' },
]

const visibleColumns = computed<string[]>(() => {
  const saved = settings.taskColumns
  if (!saved) return COLUMNS.map((c) => c.id)
  return COLUMNS.filter((c) => saved.includes(c.id)).map((c) => c.id)
})

function toggleColumn(id: string): void {
  const current = visibleColumns.value
  const next = current.includes(id)
    ? current.filter((c) => c !== id)
    : [...current, id]
  settings.taskColumns = next.length === COLUMNS.length ? null : next
}

function headerLabel(id: string): string {
  return COLUMNS.find((c) => c.id === id)?.label ?? id
}

/** 按键宏 → 生效按键+修饰键；事件宏 → 事件名（来自宏列表，缺失时退回 —） */
function triggerText(task: TaskEntry): string {
  const macro = macros.macros.find((m) => m.name === task.macro)
  if (!macro) return '—'
  if (macro.category === 'keypress') {
    const mods = macro.modifiers.length > 0 ? `${macro.modifiers.join('+')}+` : ''
    return `${mods}${macro.key ?? '未绑定'}`
  }
  return macro.on.join(', ') || '—'
}

function timeText(ts: number): string {
  const d = new Date(ts)
  const pad = (n: number): string => String(n).padStart(2, '0')
  const today = new Date()
  const sameDay =
    d.getFullYear() === today.getFullYear() &&
    d.getMonth() === today.getMonth() &&
    d.getDate() === today.getDate()
  const hms = `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
  return sameDay ? hms : `${d.getMonth() + 1}/${d.getDate()} ${hms}`
}

const STARTED_BY_LABELS: Record<string, string> = {
  autostart: '自动',
  lifecycle: '生命周期',
  manual: '手动',
  reload: '重载',
}

const GAME_TYPE_LABELS: Record<string, string> = {
  single: '单人',
  multi: '多人',
}

/** 任务名称 → 宏配置：跳分类路由 + 树中高亮 neomacro.yml + 配置弹窗 */
function openConfig(task: TaskEntry): void {
  void revealMacroConfig(task)
}

/** 任务宏文件 → 编辑器：打开宏入口文件（编辑面板在主区，先聚焦） */
async function openTaskMacro(task: TaskEntry): Promise<void> {
  const macro = macros.macros.find((m) => m.name === task.macro)
  focusEditor(macro?.id ?? `${task.category}/${task.macro}`)
  if (macro) {
    await openMacro(macro)
  } else {
    notify(`宏 ${task.macro} 不在宏列表中（可能加载失败）`, 'warning')
  }
}
</script>

<template>
  <div class="task-table-wrap">
    <div class="task-toolbar">
      <AppSelect
        v-model="tasksStore.statusFilter"
        :options="STATUS_OPTIONS"
        class="status-select"
        title="状态过滤"
      />
      <input
        v-model="tasksStore.search"
        class="log-search"
        placeholder="过滤：名称 / 玩家 / 服务器…"
        spellcheck="false"
      />
      <AppPopover align="end">
        <template #trigger>
          <button class="tool" title="设置展示列">
            <AppIcon name="explorer" :size="13" />
          </button>
        </template>
        <div class="columns-grid">
          <AppCheckbox
            v-for="c in COLUMNS"
            :key="c.id"
            :model-value="visibleColumns.includes(c.id)"
            :label="c.label"
            @update:model-value="toggleColumn(c.id)"
          />
        </div>
      </AppPopover>
      <button class="tool" title="刷新" @click="void refreshTasks()">
        <AppIcon name="refresh" :size="13" />
      </button>
    </div>

    <div class="task-scroller">
      <div v-if="tasksStore.error" class="task-error">任务快照拉取失败：{{ tasksStore.error }}</div>
      <table v-else-if="filteredTasks.length > 0" class="task-table">
        <thead>
          <tr>
            <th v-for="col in visibleColumns" :key="col">{{ headerLabel(col) }}</th>
            <th class="col-actions" />
          </tr>
        </thead>
        <tbody>
          <tr v-for="task in filteredTasks" :key="task.id" :class="{ stopped: task.status === 'stopped' }">
            <td v-for="col in visibleColumns" :key="col" class="cell">
              <template v-if="col === 'id'">
                <span class="task-id">#{{ task.id }}</span>
              </template>
              <template v-else-if="col === 'status'">
                <span class="status-chip" :class="task.status">
                  {{ task.status === 'running' ? '运行中' : '已停止' }}
                </span>
              </template>
              <template v-else-if="col === 'name'">
                <button class="link" :title="`打开 ${task.macro} 配置`" @click="openConfig(task)">
                  {{ task.macro }}
                </button>
              </template>
              <template v-else-if="col === 'type'">
                {{ CATEGORY_LABELS[task.category] ?? task.category }}
              </template>
              <template v-else-if="col === 'trigger'">
                <span class="trigger" :title="triggerText(task)">{{ triggerText(task) }}</span>
              </template>
              <template v-else-if="col === 'startedAt'">
                {{ timeText(task.startedAt) }}
              </template>
              <template v-else-if="col === 'duration'">
                {{ durationText(task) }}
              </template>
              <template v-else-if="col === 'triggers'">
                {{ task.triggers }}
              </template>
              <template v-else-if="col === 'file'">
                <button
                  class="link mono"
                  :title="`${task.category}/${task.macro} — 点击跳转宏编辑面板`"
                  @click="void openTaskMacro(task)"
                >
                  {{ task.category }}/{{ task.macro }}
                </button>
              </template>
              <template v-else-if="col === 'player'">
                <span class="trigger" :title="task.playerUuid ?? ''">
                  {{ task.playerName || '—' }}
                </span>
              </template>
              <template v-else-if="col === 'gameType'">
                {{ GAME_TYPE_LABELS[task.gameType ?? ''] ?? '—' }}
              </template>
              <template v-else-if="col === 'server'">
                <span class="trigger" :title="task.server ?? ''">{{ task.server || '—' }}</span>
              </template>
              <template v-else-if="col === 'startedBy'">
                {{ STARTED_BY_LABELS[task.startedBy] ?? task.startedBy }}
              </template>
              <template v-else-if="col === 'mcVersion'">
                {{ task.mcVersion || '—' }}
              </template>
            </td>
            <td class="cell col-actions">
              <button class="tool" title="调试（控制台只看该宏）" @click="debugTask(task)">
                <AppIcon name="terminal" :size="13" />
              </button>
              <button
                class="tool"
                title="重启（卸载重载宏后重新拉起）"
                @click="void restartTaskById(task.id)"
              >
                <AppIcon name="refresh" :size="13" />
              </button>
              <button
                v-if="task.status === 'running'"
                class="tool danger"
                title="停止任务"
                @click="void stopTaskById(task.id)"
              >
                <AppIcon name="stop" :size="13" />
              </button>
            </td>
          </tr>
        </tbody>
      </table>
      <div v-else class="task-empty">暂无任务（启动一个宏试试）</div>
    </div>
  </div>
</template>

<style scoped>
.task-table-wrap {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
}

.task-toolbar {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 10px;
  border-bottom: 1px solid var(--divider);
  flex: none;
}

.log-search {
  flex: 1;
  min-width: 0;
  background: var(--control);
  color: var(--text-1);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  font-size: 12px;
  padding: 3px 8px;
  outline: none;
}

.task-toolbar .tool {
  background: transparent;
  border: none;
  color: var(--text-3);
  width: 24px;
  height: 24px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: var(--radius-md);
  cursor: pointer;
}

.task-toolbar .tool:hover {
  color: var(--text-1);
  background: var(--hover);
}

.task-toolbar .tool.danger:hover {
  color: var(--on-danger);
  background: var(--danger);
}

.columns-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 2px 14px;
}

.task-scroller {
  flex: 1;
  min-height: 0;
  overflow: auto;
}

.task-error,
.task-empty {
  padding: 14px;
  font-size: 12px;
  color: var(--text-3);
}

.task-error {
  color: var(--danger);
}

.task-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 12px;
}

.task-table th {
  position: sticky;
  top: 0;
  z-index: 2;
  background: var(--bg-chrome);
  color: var(--text-3);
  text-align: left;
  font-weight: 500;
  padding: 6px 10px;
  border-bottom: 1px solid var(--divider);
  white-space: nowrap;
}

.task-table td {
  padding: 5px 10px;
  border-bottom: 1px solid var(--divider);
  color: var(--text-1);
  white-space: nowrap;
}

.task-table tr.stopped td {
  opacity: 0.55;
}

.task-table tbody tr:hover td {
  background: var(--hover);
}

.task-id {
  font-family: var(--font-mono);
  color: var(--text-2);
}

.status-chip {
  display: inline-flex;
  align-items: center;
  padding: 1px 8px;
  border-radius: 999px;
  font-size: 11px;
}

.status-chip.running {
  color: var(--success);
  background: color-mix(in srgb, var(--success) 15%, transparent);
}

.status-chip.stopped {
  color: var(--text-3);
  background: var(--control);
}

.link {
  background: none;
  border: none;
  padding: 0;
  color: var(--accent);
  cursor: pointer;
  font-size: 12px;
}

.link:hover {
  text-decoration: underline;
}

.link.mono {
  font-family: var(--font-mono);
  font-size: 11px;
}

.trigger {
  display: inline-block;
  max-width: 220px;
  overflow: hidden;
  text-overflow: ellipsis;
  vertical-align: bottom;
  color: var(--text-2);
}

.col-actions {
  width: 96px;
  text-align: center;
  white-space: nowrap;
}

.col-actions .tool {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  background: transparent;
  border: none;
  color: var(--text-3);
  border-radius: var(--radius-md);
  cursor: pointer;
  vertical-align: middle;
}

.col-actions .tool:hover {
  color: var(--text-1);
  background: var(--hover);
}

.col-actions .tool.danger:hover {
  color: var(--on-danger);
  background: var(--danger);
}
</style>

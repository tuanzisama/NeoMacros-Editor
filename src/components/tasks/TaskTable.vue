<script setup lang="ts">
/**
 * 任务管理器表格（DevTools 页签与活动栏主视图共用）。
 * 工具栏：状态过滤 + 搜索 + 列配置（settings 持久化）+ 刷新；
 * 行：宏文件列与名称可点击跳转编辑器；运行中的任务可停止。
 */
import { computed, ref } from 'vue'
import { tasksStore, filteredTasks, durationText, stopTaskById, refreshTasks } from '@/stores/tasks'
import { macros } from '@/stores/macros'
import { openMacro } from '@/stores/editor'
import { focusEditor, notify } from '@/stores/workspace'
import { settings } from '@/stores/settings'
import { CATEGORY_LABELS } from '@/types/api'
import type { TaskEntry } from '@/types/api'
import AppIcon from '@/components/ui/AppIcon.vue'

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

const visibleColumns = computed<string[]>(() => {
  const saved = settings.taskColumns
  if (!saved) return COLUMNS.map((c) => c.id)
  return COLUMNS.filter((c) => saved.includes(c.id)).map((c) => c.id)
})

const showColumns = ref(false)

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

/** 任务 → 编辑器：打开宏入口文件（编辑面板在主区，先聚焦） */
async function openTaskMacro(task: TaskEntry): Promise<void> {
  const macro = macros.macros.find((m) => m.name === task.macro)
  focusEditor()
  if (macro) {
    await openMacro(macro)
  } else {
    notify(`宏 ${task.macro} 不在宏列表中（可能加载失败）`, 'warning')
  }
}

async function stop(task: TaskEntry): Promise<void> {
  await stopTaskById(task.id)
}
</script>

<template>
  <div class="task-table-wrap">
    <div class="task-toolbar">
      <select v-model="tasksStore.statusFilter" class="status-select">
        <option value="">全部状态</option>
        <option value="running">运行中</option>
        <option value="stopped">已停止</option>
      </select>
      <input
        v-model="tasksStore.search"
        class="log-search"
        placeholder="过滤：名称 / 玩家 / 服务器…"
        spellcheck="false"
      />
      <div class="columns-anchor">
        <button class="tool" title="设置展示列" @click="showColumns = !showColumns">
          <AppIcon name="explorer" :size="13" />
        </button>
        <div v-if="showColumns" class="columns-pop">
          <label v-for="c in COLUMNS" :key="c.id" class="column-option">
            <input
              type="checkbox"
              :checked="visibleColumns.includes(c.id)"
              @change="toggleColumn(c.id)"
            />
            {{ c.label }}
          </label>
        </div>
      </div>
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
                <button class="link" :title="`打开 ${task.macro}`" @click="void openTaskMacro(task)">
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
              <button
                v-if="task.status === 'running'"
                class="tool danger"
                title="停止任务"
                @click="void stop(task)"
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

.task-toolbar select,
.log-search {
  background: var(--control);
  color: var(--text-1);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  font-size: 12px;
  padding: 3px 8px;
  outline: none;
}

.log-search {
  flex: 1;
  min-width: 0;
}

.task-toolbar .tool,
.columns-anchor .tool {
  background: transparent;
  border: none;
  color: var(--text-3);
  width: 24px;
  height: 24px;
  display: flex;
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

.columns-anchor {
  position: relative;
}

.columns-pop {
  position: absolute;
  top: 30px;
  right: 0;
  z-index: 30;
  background: var(--bg-chrome);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.35);
  padding: 8px;
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 4px 14px;
  white-space: nowrap;
}

.column-option {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: var(--text-2);
  cursor: pointer;
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
  width: 32px;
  text-align: center;
}
</style>

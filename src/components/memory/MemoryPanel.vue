<script setup lang="ts">
/**
 * 内存面板内容（DevTools「内存」页签与 /memory 主视图共用）：
 * ① JVM 堆 used/committed/max ② GraalJS 合计（脚本线程累计分配之和）
 * ③ 逐脚本累计分配（chips 多选，死脚本灰显、曲线止于死亡点）。
 * uPlot 绘制，三图十字线联动（cursor.sync）；主题切换时重建取 CSS 变量色。
 * 口径：脚本值为「线程累计分配字节」（增长/泄漏信号，非实时堆占用）。
 */
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import uPlot from 'uplot'
import 'uplot/dist/uPlot.min.css'
import { resolvedTheme } from '@/theme'
import {
  memory,
  scriptList,
  taskDead,
  clearMemoryView,
  type UplotData,
} from '@/stores/memory'
import { formatBytes } from '@/components/devtools/consoleFormat'
import AppIcon from '@/components/ui/AppIcon.vue'
import AppSelect from '@/components/ui/AppSelect.vue'

/** 三图十字线联动分组 key（uPlot cursor.sync） */
const SYNC_KEY = 'neomacros-mem'

const RANGE_OPTIONS = [
  { value: '60', label: '最近 1 分钟' },
  { value: '300', label: '最近 5 分钟' },
  { value: '900', label: '最近 15 分钟' },
  { value: '', label: '全部' },
]

const range = ref('300')
const now = ref(Date.now())
let ticker: ReturnType<typeof setInterval> | null = null

/** 脚本图显示的 taskId 集合（新脚本自动纳入，上限 8） */
const selectedScripts = ref<Set<number>>(new Set())

/** 范围过滤后的样本（暂停/全部/窗口共用一份） */
const visibleEntries = computed(() => {
  if (range.value === '') return memory.entries
  const min = now.value - Number(range.value) * 1000
  return memory.entries.filter((s) => s.ts >= min)
})

/** 供脚本 chips 渲染：taskId → 名称/分类/是否死任务 */
const chips = computed(() =>
  scriptList.value.map((s) => ({
    taskId: s.taskId,
    name: s.name,
    dead: s.taskId === 0 ? false : taskDead(s.taskId),
  })),
)

function toggleScript(taskId: number): void {
  const next = new Set(selectedScripts.value)
  if (next.has(taskId)) next.delete(taskId)
  else next.add(taskId)
  selectedScripts.value = next
}

// ---- uPlot 绘制 ----------------------------------------------------------

const jvmEl = ref<HTMLElement | null>(null)
const graalEl = ref<HTMLElement | null>(null)
const scriptsEl = ref<HTMLElement | null>(null)
let jvmChart: uPlot | null = null
let graalChart: uPlot | null = null
let scriptsChart: uPlot | null = null
let resizeObserver: ResizeObserver | null = null

/** 从主题令牌读轴/网格颜色（图表取色统一走这里） */
function themeColors(): { text: string; grid: string } {
  const cs = getComputedStyle(document.documentElement)
  return {
    text: cs.getPropertyValue('--text-3').trim() || '#888',
    grid: cs.getPropertyValue('--divider').trim() || '#333',
  }
}

/** 脚本系列调色板（按 taskId 稳定取色） */
const PALETTE = [
  '#4f9dff', '#57d98a', '#ffbe4b', '#ff5c5c', '#b48cff',
  '#4bc9ff', '#ff8bb3', '#a8d84b', '#ffa04b', '#7de8d8',
]
function scriptColor(taskId: number): string {
  return PALETTE[Math.abs(taskId) % PALETTE.length]
}

function axisOpts(): uPlot.Options['axes'] {
  const { text, grid } = themeColors()
  return [
    { stroke: text, grid: { stroke: grid, width: 1 } },
    {
      stroke: text,
      grid: { stroke: grid, width: 1 },
      size: 64,
      values: (_u: uPlot, ticks: number[]): string[] => ticks.map(formatBytes),
    },
  ]
}

function baseOpts(height: number, series: uPlot.Series[]): uPlot.Options {
  return {
    width: 600,
    height,
    cursor: { sync: { key: SYNC_KEY } },
    legend: { show: false },
    axes: axisOpts(),
    series,
  }
}

function bytesSeries(label: string, stroke: string, dash?: number[]): uPlot.Series {
  const s: uPlot.Series = { label, stroke, width: 1.5 }
  if (dash) s.dash = dash
  return s
}

function jvmSeriesData(): UplotData {
  const entries = visibleEntries.value
  return [
    entries.map((s) => s.ts / 1000),
    entries.map((s) => s.jvm.used),
    entries.map((s) => s.jvm.committed),
    entries.map((s) => (s.jvm.max > 0 ? s.jvm.max : null)),
  ]
}

function graalSeriesData(): UplotData {
  const entries = visibleEntries.value
  return [entries.map((s) => s.ts / 1000), entries.map((s) => s.graaljsAllocated)]
}

/** 脚本图数据：x = 全部样本时刻，缺采样脚本置 null（曲线自然断开/止于死亡点） */
function scriptsSeriesData(taskIds: number[]): UplotData {
  const entries = visibleEntries.value
  const ys = taskIds.map(() => [] as (number | null)[])
  for (const sample of entries) {
    const perId = new Map<number, number>()
    for (const script of sample.scripts) perId.set(script.taskId, script.bytes)
    taskIds.forEach((id, i) => ys[i].push(perId.get(id) ?? null))
  }
  return [entries.map((s) => s.ts / 1000), ...ys]
}

const JVM_COLORS = { used: '#57d98a', committed: '#4f9dff', max: '#ffbe4b' }

/** (重)建三张图：系列数量/主题/容器变化时整体重建（样本量级小，开销可忽略） */
function rebuildCharts(): void {
  if (!jvmEl.value || !graalEl.value || !scriptsEl.value) return
  jvmChart?.destroy()
  graalChart?.destroy()
  scriptsChart?.destroy()

  jvmChart = new uPlot(
    baseOpts(150, [
      {},
      bytesSeries('已用', JVM_COLORS.used),
      bytesSeries('已提交', JVM_COLORS.committed),
      bytesSeries('上限', JVM_COLORS.max, [4, 3]),
    ]),
    jvmSeriesData() as unknown as uPlot.AlignedData,
    jvmEl.value,
  )
  graalChart = new uPlot(
    baseOpts(110, [{}, bytesSeries('GraalJS 合计', '#b48cff')]),
    graalSeriesData() as unknown as uPlot.AlignedData,
    graalEl.value,
  )

  const selected = scriptList.value
    .map((s) => s.taskId)
    .filter((id) => selectedScripts.value.has(id))
    .slice(0, 10)
  scriptsChart = new uPlot(
    baseOpts(150, [
      {},
      ...selected.map((id) =>
        bytesSeries(scriptName(id), scriptColor(id), taskDead(id) ? [4, 3] : undefined),
      ),
    ]),
    scriptsSeriesData(selected) as unknown as uPlot.AlignedData,
    scriptsEl.value,
  )
}

function scriptName(taskId: number): string {
  const chip = chips.value.find((c) => c.taskId === taskId)
  return chip ? chip.name : `#${taskId}`
}

/** 数据到达/范围/选择/主题变化 → 刷新数据（系列结构变化才重建） */
function refreshData(): void {
  jvmChart?.setData(jvmSeriesData() as unknown as uPlot.AlignedData)
  graalChart?.setData(graalSeriesData() as unknown as uPlot.AlignedData)
  const selected = scriptList.value
    .map((s) => s.taskId)
    .filter((id) => selectedScripts.value.has(id))
    .slice(0, 10)
  const wanted = selected.length + 1
  if (scriptsChart && scriptsChart.series.length === wanted) {
    scriptsChart.setData(scriptsSeriesData(selected) as unknown as uPlot.AlignedData)
  } else {
    rebuildCharts()
  }
}

// 新脚本自动纳入选择（上限 8，超出由用户手动取舍）
watch(
  () => scriptList.value.map((s) => s.taskId),
  (ids) => {
    const next = new Set(selectedScripts.value)
    for (const id of ids) {
      if (next.size >= 8) break
      next.add(id)
    }
    selectedScripts.value = next
  },
  { immediate: true },
)

watch([visibleEntries, selectedScripts], refreshData, { deep: false })
watch(resolvedTheme, rebuildCharts)

onMounted(() => {
  rebuildCharts()
  resizeObserver = new ResizeObserver(() => {
    for (const [chart, el] of [
      [jvmChart, jvmEl.value],
      [graalChart, graalEl.value],
      [scriptsChart, scriptsEl.value],
    ] as const) {
      if (chart && el) chart.setSize({ width: el.clientWidth, height: chart.height })
    }
  })
  if (jvmEl.value) resizeObserver.observe(jvmEl.value)
  ticker = setInterval(() => {
    now.value = Date.now()
  }, 1000)
})

onBeforeUnmount(() => {
  if (ticker !== null) clearInterval(ticker)
  resizeObserver?.disconnect()
  jvmChart?.destroy()
  graalChart?.destroy()
  scriptsChart?.destroy()
})
</script>

<template>
  <div class="memory-panel">
    <div class="tab-toolbar">
      <AppSelect v-model="range" :options="RANGE_OPTIONS" title="时间范围" />
      <button
        class="tool"
        :class="{ active: memory.paused }"
        :title="memory.paused ? '恢复实时' : '暂停实时'"
        @click="memory.paused = !memory.paused"
      >
        <AppIcon :name="memory.paused ? 'play' : 'pause'" :size="14" />
      </button>
      <button class="tool" title="清空当前视图" @click="clearMemoryView">
        <AppIcon name="trash" :size="14" />
      </button>
      <span class="spacer" />
      <span class="hint">脚本口径 = 线程累计分配（增长/泄漏信号）</span>
    </div>

    <div v-if="memory.error" class="mem-error">{{ memory.error }}</div>

    <div class="charts">
      <section class="chart-block">
        <h3>JVM 堆（MC 实例）</h3>
        <div ref="jvmEl" class="chart-host" />
      </section>

      <section class="chart-block">
        <h3>GraalJS 合计</h3>
        <div ref="graalEl" class="chart-host" />
      </section>

      <section class="chart-block">
        <h3>脚本</h3>
        <div class="script-chips">
          <button
            v-for="chip in chips"
            :key="chip.taskId"
            class="chip script-chip"
            :class="{ selected: selectedScripts.has(chip.taskId), dead: chip.dead }"
            :style="selectedScripts.has(chip.taskId) ? { borderColor: PALETTE[chip.taskId % PALETTE.length] } : undefined"
            :title="chip.dead ? '已停止（曲线止于死亡点）' : '运行中'"
            @click="toggleScript(chip.taskId)"
          >
            {{ chip.name }}
          </button>
          <span v-if="chips.length === 0" class="hint">暂无脚本采样（连接 mod 后自动出现）</span>
        </div>
        <div ref="scriptsEl" class="chart-host" />
      </section>
    </div>
  </div>
</template>

<style scoped>
.memory-panel {
  height: 100%;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.tab-toolbar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 10px;
  border-bottom: 1px solid var(--divider);
  flex: none;
}

.spacer {
  flex: 1;
}

.hint {
  color: var(--text-3);
  font-size: 12px;
}

.mem-error {
  padding: 6px 10px;
  color: var(--danger);
  font-size: 12px;
  border-bottom: 1px solid var(--divider);
}

.charts {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 10px;
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.chart-block h3 {
  margin: 0 0 6px;
  font-size: 12px;
  font-weight: 600;
  color: var(--text-2);
}

.chart-host {
  width: 100%;
}

.script-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-bottom: 8px;
}

.script-chip {
  cursor: pointer;
  opacity: 0.55;
}

.script-chip.selected {
  opacity: 1;
  color: var(--text-1);
  border-width: 1.5px;
}

.script-chip.dead {
  text-decoration: line-through;
}
</style>

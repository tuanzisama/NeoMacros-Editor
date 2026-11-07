<script setup lang="ts">
/**
 * 网络面板（Chrome DevTools Network 语义）：neo.net 请求列表 + 标签页详情。
 * 工具栏：状态筛选 + 搜索 + 暂停捕获 + 清空视图；点击行在下方展开详情
 * （Headers / Payload / Response / Initiator / Timing，Chrome 口径），Esc
 * 或再点行关闭。≤1MB 的请求/响应体在 mod 侧保留：按需拉取全量、下载文件，
 * 图片内联渲染。列表新行置底、近底部自动跟随；过滤与详情标签存于
 * network store，切标签（组件重挂载）后保留。
 */
import { computed, nextTick, onMounted, onUnmounted, reactive, ref, watch } from 'vue'
import {
  network,
  filteredRequests,
  clearNetworkView,
  isFailed,
  type DetailTab,
  type NetworkRow,
  type StatusBucket,
} from '@/stores/network'
import { resolveMacroId } from '@/stores/console'
import { getNetworkBody } from '@/api/endpoints'
import { formatMs, formatBytes, networkTypeLabel, networkName } from './consoleFormat'
import AppIcon from '@/components/ui/AppIcon.vue'

const STATUS_OPTIONS: { value: StatusBucket; label: string }[] = [
  { value: '', label: '全部' },
  { value: '2', label: '2xx 成功' },
  { value: '3', label: '3xx 重定向' },
  { value: '4', label: '4xx 客户端错误' },
  { value: '5', label: '5xx 服务端错误' },
  { value: 'failed', label: '失败' },
]

const DETAIL_TABS: { id: DetailTab; label: string }[] = [
  { id: 'headers', label: 'Headers' },
  { id: 'payload', label: 'Payload' },
  { id: 'response', label: 'Response' },
  { id: 'initiator', label: 'Initiator' },
  { id: 'timing', label: 'Timing' },
]

/** 选中详情的条目 seq；null = 详情关闭 */
const selectedSeq = ref<number | null>(null)

const selected = computed<NetworkRow | null>(
  () => network.entries.find((e) => e.seq === selectedSeq.value) ?? null,
)

function toggleDetail(row: NetworkRow): void {
  selectedSeq.value = selectedSeq.value === row.seq ? null : row.seq
}

function closeDetail(): void {
  selectedSeq.value = null
}

/* ---- 详情内容加载（完整请求/响应体、图片 blob URL） ---- */

interface BodyView {
  state: 'idle' | 'loading' | 'loaded' | 'error'
  content?: ArrayBuffer
  objectUrl?: string
  error?: string
}

const bodyViews = reactive<Record<'request' | 'response', BodyView>>({
  request: { state: 'idle' },
  response: { state: 'idle' },
})

/** Headers 标签的 Raw 视图开关（随选中行重置） */
const rawResponseHeaders = ref(false)
const rawRequestHeaders = ref(false)

/** 选择行变化：重置加载态并回收图片 blob URL */
watch(selectedSeq, () => {
  for (const side of ['request', 'response'] as const) {
    if (bodyViews[side].objectUrl) URL.revokeObjectURL(bodyViews[side].objectUrl!)
  }
  bodyViews.request = { state: 'idle' }
  bodyViews.response = { state: 'idle' }
  rawResponseHeaders.value = false
  rawRequestHeaders.value = false
})

async function ensureBody(side: 'request' | 'response'): Promise<void> {
  const view = bodyViews[side]
  const row = selected.value
  if (!row || view.state === 'loading' || view.state === 'loaded') return
  view.state = 'loading'
  view.error = undefined
  try {
    const res = await getNetworkBody(row.seq, side)
    view.content = res.bytes
    view.state = 'loaded'
    if (side === 'response' && isImage(row)) {
      view.objectUrl = URL.createObjectURL(new Blob([res.bytes], { type: res.contentType }))
    }
  } catch (e) {
    view.state = 'error'
    view.error = e instanceof Error ? e.message : String(e)
  }
}

/** Response 标签打开时预取（文本/图片都需要）；Payload 同理按需 */
watch(
  [selected, () => network.detailTab],
  ([row, tab]) => {
    if (!row) return
    if (tab === 'response' && (row.hasResponseBody || isImage(row))) void ensureBody('response')
    if (tab === 'payload' && row.hasRequestBody) void ensureBody('request')
  },
  { immediate: true },
)

function isImage(row: NetworkRow): boolean {
  return (row.responseHeaders?.['content-type'] ?? '').toLowerCase().startsWith('image/')
}

function fullText(side: 'request' | 'response'): string {
  const content = bodyViews[side].content
  return content ? new TextDecoder().decode(content) : ''
}

/** 下载保留的 body（未加载则先拉取）；文件名取 URL 末段并按类型补扩展名 */
async function downloadBody(side: 'request' | 'response'): Promise<void> {
  const row = selected.value
  if (!row) return
  await ensureBody(side)
  const content = bodyViews[side].content
  if (!content) return
  const type =
    side === 'response'
      ? row.responseHeaders?.['content-type'] ?? 'application/octet-stream'
      : row.requestHeaders?.['content-type'] ?? 'text/plain'
  const blob = new Blob([content], { type })
  const filename = bodyFilename(row, side, type)
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()
  URL.revokeObjectURL(url)
}

function bodyFilename(row: NetworkRow, side: 'request' | 'response', contentType: string): string {
  const path = row.url.split('?')[0] ?? ''
  const slash = path.lastIndexOf('/')
  let name = slash >= 0 ? path.slice(slash + 1) : path
  if (!name) name = `${side}-${row.seq}`
  if (!name.includes('.')) {
    const ct = contentType.toLowerCase()
    const ext = ct.includes('json') ? 'json' : ct.startsWith('text/') ? 'txt'
      : ct.includes('png') ? 'png' : ct.includes('jpeg') ? 'jpg'
      : ct.includes('gif') ? 'gif' : ct.includes('webp') ? 'webp' : 'bin'
    name = `${name}.${ext}`
  }
  return name
}

/* ---- 展示辅助 ---- */

function statusClass(row: NetworkRow): string {
  if (isFailed(row)) return 'failed'
  const status = row.status ?? 0
  if (status >= 500) return 's5'
  if (status >= 400) return 's4'
  if (status >= 300) return 's3'
  return 's2'
}

function statusText(row: NetworkRow): string {
  return row.status != null ? String(row.status) : '(失败)'
}

function typeText(row: NetworkRow): string {
  return networkTypeLabel(row.responseHeaders?.['content-type'])
}

function sizeText(row: NetworkRow): string {
  return row.size != null ? formatBytes(row.size) : '—'
}

function timeText(row: NetworkRow): string {
  return row.durationMs != null ? formatMs(row.durationMs) : '—'
}

function initiatorText(row: NetworkRow): string {
  return row.initiator ? resolveMacroId(row.initiator) : '—'
}

function timeOf(row: NetworkRow): string {
  const d = new Date(row.ts)
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

function headerPairs(headers: Record<string, string> | null): [string, string][] {
  if (!headers) return []
  return Object.entries(headers)
}

/** Raw 视图：name: value 逐行（Chrome 同款） */
function rawHeaders(headers: Record<string, string> | null): string {
  return headerPairs(headers)
    .map(([k, v]) => `${k}: ${v}`)
    .join('\n')
}

/** URL 查询参数对（解析失败回退空） */
const queryParams = computed<[string, string][]>(() => {
  if (!selected.value) return []
  try {
    return [...new URL(selected.value.url).searchParams.entries()]
  } catch {
    return []
  }
})

/* ---- Timing 瀑布条 ---- */

function barWidth(partMs: number | null, totalMs: number | null): string {
  if (partMs == null || totalMs == null || totalMs <= 0) return '0%'
  return `${Math.max(2, Math.min(100, (partMs / totalMs) * 100))}%`
}

function barOffset(startMs: number | null, totalMs: number | null): string {
  if (startMs == null || totalMs == null || totalMs <= 0) return '0%'
  return `${Math.min(98, (startMs / totalMs) * 100)}%`
}

/* ---- 分组折叠（Headers 标签，Chrome 默认展开） ---- */

const showGeneral = ref(true)
const showResponseHeaders = ref(true)
const showRequestHeaders = ref(true)

/* ---- 列表跟随：新行置底，近底部时自动滚动 ---- */

const scroller = ref<HTMLElement | null>(null)
const stick = ref(true)

function onScroll(): void {
  const el = scroller.value
  if (!el) return
  stick.value = el.scrollTop + el.clientHeight >= el.scrollHeight - 40
}

watch(
  () => filteredRequests.value.length,
  async () => {
    if (!stick.value) return
    await nextTick()
    const el = scroller.value
    if (el) el.scrollTop = el.scrollHeight
  },
)

onMounted(() => document.addEventListener('keydown', onKeydown))
onUnmounted(() => {
  document.removeEventListener('keydown', onKeydown)
  if (bodyViews.response.objectUrl) URL.revokeObjectURL(bodyViews.response.objectUrl)
})

function onKeydown(e: KeyboardEvent): void {
  if (e.key === 'Escape') closeDetail()
}

function togglePause(): void {
  network.paused = !network.paused
}
</script>

<template>
  <div class="network-tab">
    <div class="tab-toolbar">
      <select v-model="network.statusFilter" class="net-select">
        <option v-for="opt in STATUS_OPTIONS" :key="opt.value" :value="opt.value">
          {{ opt.label }}
        </option>
      </select>
      <input
        v-model="network.search"
        class="log-search"
        placeholder="过滤：URL / 方法 / 发起者 / 错误…"
        spellcheck="false"
      />
      <button
        class="tool"
        :class="{ recording: !network.paused }"
        :title="network.paused ? '继续捕获' : '暂停捕获'"
        @click="togglePause"
      >
        <AppIcon :name="network.paused ? 'play' : 'pause'" :size="13" />
      </button>
      <button class="tool" title="清空视图" @click="clearNetworkView()">
        <AppIcon name="trash" :size="13" />
      </button>
    </div>

    <div v-if="network.error" class="net-error">请求记录回放失败：{{ network.error }}</div>

    <div class="net-main" :class="{ 'with-detail': selected }">
      <div ref="scroller" class="net-scroll" @scroll="onScroll">
        <table v-if="filteredRequests.length > 0" class="net-table">
          <thead>
            <tr>
              <th class="col-name">名称</th>
              <th class="col-method">方法</th>
              <th class="col-status">状态</th>
              <th class="col-type">类型</th>
              <th class="col-size">大小</th>
              <th class="col-time">耗时</th>
              <th class="col-initiator">发起者</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="row in filteredRequests"
              :key="row.seq"
              :class="{ selected: row.seq === selectedSeq, failed: isFailed(row) }"
              :title="row.url"
              @click="toggleDetail(row)"
            >
              <td class="col-name">
                <span class="name-text">{{ networkName(row.url) }}</span>
              </td>
              <td class="col-method">{{ row.method }}</td>
              <td class="col-status"><span :class="statusClass(row)">{{ statusText(row) }}</span></td>
              <td class="col-type">{{ typeText(row) }}</td>
              <td class="col-size">{{ sizeText(row) }}</td>
              <td class="col-time">{{ timeText(row) }}</td>
              <td class="col-initiator">
                <span class="initiator-text">{{ initiatorText(row) }}</span>
              </td>
            </tr>
          </tbody>
        </table>
        <div v-else class="net-empty">
          {{ network.paused ? '捕获已暂停' : '暂无请求记录（宏里的 neo.net 调用会出现在这里）' }}
        </div>
      </div>

      <div v-if="selected" class="net-detail">
        <div class="detail-tabs">
          <button
            v-for="tab in DETAIL_TABS"
            :key="tab.id"
            class="detail-tab"
            :class="{ active: network.detailTab === tab.id }"
            @click="network.detailTab = tab.id"
          >
            {{ tab.label }}
          </button>
          <span class="detail-spacer" />
          <button class="tool" title="关闭详情 (Esc)" @click="closeDetail">
            <AppIcon name="close" :size="13" />
          </button>
        </div>

        <div class="detail-scroll">
          <!-- ============ Headers ============ -->
          <template v-if="network.detailTab === 'headers'">
            <section class="detail-section">
              <button class="group-head" @click="showGeneral = !showGeneral">
                <span class="caret" :class="{ closed: !showGeneral }">▾</span> General
              </button>
              <div v-if="showGeneral" class="group-body">
                <div class="kv"><span class="k">Request URL</span><span class="v mono break">{{ selected.url }}</span></div>
                <div class="kv"><span class="k">Request Method</span><span class="v">{{ selected.method }}</span></div>
                <div class="kv">
                  <span class="k">Status Code</span>
                  <span class="v"><span class="status-dot" :class="statusClass(selected)" /> {{ statusText(selected) }}</span>
                </div>
                <div class="kv"><span class="k">开始时间</span><span class="v mono">{{ timeOf(selected) }}</span></div>
                <div class="kv"><span class="k">耗时</span><span class="v mono">{{ timeText(selected) }}</span></div>
                <div class="kv"><span class="k">大小</span><span class="v mono">{{ sizeText(selected) }}</span></div>
                <div class="kv"><span class="k">发起者</span><span class="v">{{ initiatorText(selected) }}</span></div>
                <div v-if="selected.error" class="kv">
                  <span class="k">错误</span><span class="v error-text">{{ selected.error }}</span>
                </div>
              </div>
            </section>

            <section class="detail-section">
              <div class="group-head-row">
                <button class="group-head" @click="showResponseHeaders = !showResponseHeaders">
                  <span class="caret" :class="{ closed: !showResponseHeaders }">▾</span> Response headers
                </button>
                <label class="raw-toggle">
                  <input v-model="rawResponseHeaders" type="checkbox" /> Raw
                </label>
              </div>
              <template v-if="showResponseHeaders">
                <pre v-if="rawResponseHeaders" class="raw-headers">{{ rawHeaders(selected.responseHeaders) || '（无响应标头）' }}</pre>
                <div v-else-if="headerPairs(selected.responseHeaders).length > 0" class="group-body">
                  <div v-for="[k, v] in headerPairs(selected.responseHeaders)" :key="k" class="kv">
                    <span class="k mono">{{ k }}</span><span class="v mono break">{{ v }}</span>
                  </div>
                </div>
                <div v-else class="group-body detail-none">（无响应标头）</div>
              </template>
            </section>

            <section class="detail-section">
              <div class="group-head-row">
                <button class="group-head" @click="showRequestHeaders = !showRequestHeaders">
                  <span class="caret" :class="{ closed: !showRequestHeaders }">▾</span> Request headers
                </button>
                <label class="raw-toggle">
                  <input v-model="rawRequestHeaders" type="checkbox" /> Raw
                </label>
              </div>
              <template v-if="showRequestHeaders">
                <pre v-if="rawRequestHeaders" class="raw-headers">{{ rawHeaders(selected.requestHeaders) || '（脚本未设置请求头）' }}</pre>
                <div v-else-if="headerPairs(selected.requestHeaders).length > 0" class="group-body">
                  <div v-for="[k, v] in headerPairs(selected.requestHeaders)" :key="k" class="kv">
                    <span class="k mono">{{ k }}</span><span class="v mono break">{{ v }}</span>
                  </div>
                </div>
                <div v-else class="group-body detail-none">（脚本未设置请求头）</div>
              </template>
            </section>
          </template>

          <!-- ============ Payload ============ -->
          <template v-else-if="network.detailTab === 'payload'">
            <section v-if="queryParams.length > 0" class="detail-section">
              <div class="group-head-row"><span class="group-head static">查询字符串参数</span></div>
              <div class="group-body">
                <div v-for="[k, v] in queryParams" :key="k + v" class="kv">
                  <span class="k mono">{{ k }}</span><span class="v mono break">{{ v }}</span>
                </div>
              </div>
            </section>
            <section v-if="selected.requestBodyPreview != null || selected.hasRequestBody" class="detail-section">
              <div class="group-head-row">
                <span class="group-head static">请求体</span>
                <span class="group-actions">
                  <button
                    v-if="selected.hasRequestBody"
                    class="link-btn"
                    @click="void ensureBody('request')"
                  >
                    {{ bodyViews.request.state === 'loaded' ? '重新加载' : '查看完整内容' }}
                  </button>
                  <button v-if="selected.hasRequestBody" class="link-btn" @click="void downloadBody('request')">
                    下载
                  </button>
                </span>
              </div>
              <div class="group-body">
                <div v-if="bodyViews.request.state === 'error'" class="fetch-error">{{ bodyViews.request.error }}</div>
                <pre v-if="bodyViews.request.state === 'loaded'" class="body-preview">{{ fullText('request') }}</pre>
                <pre v-else class="body-preview">{{ selected.requestBodyPreview ?? '' }}<span v-if="selected.requestBodyTruncated" class="truncated-hint-inline"> …</span></pre>
                <div v-if="selected.requestBodyTruncated" class="truncated-hint">请求体预览截断至前 4 KB</div>
              </div>
            </section>
            <div v-if="queryParams.length === 0 && selected.requestBodyPreview == null && !selected.hasRequestBody" class="detail-none">
              此请求没有载荷
            </div>
          </template>

          <!-- ============ Response ============ -->
          <template v-else-if="network.detailTab === 'response'">
            <section class="detail-section">
              <div class="group-head-row">
                <span class="group-head static">响应体</span>
                <span class="group-actions">
                  <button
                    v-if="selected.hasResponseBody && !isImage(selected)"
                    class="link-btn"
                    @click="void ensureBody('response')"
                  >
                    {{ bodyViews.response.state === 'loaded' ? '重新加载' : '查看完整内容' }}
                  </button>
                  <button v-if="selected.hasResponseBody" class="link-btn" @click="void downloadBody('response')">
                    下载
                  </button>
                </span>
              </div>
              <div class="group-body">
                <div v-if="bodyViews.response.state === 'loading'" class="detail-none">加载中…</div>
                <div v-else-if="bodyViews.response.state === 'error'" class="fetch-error">
                  {{ bodyViews.response.error }}
                </div>
                <template v-else>
                  <img
                    v-if="bodyViews.response.objectUrl"
                    class="img-preview"
                    :src="bodyViews.response.objectUrl"
                    alt="响应图片预览"
                  />
                  <template v-else-if="selected.responseBinary">
                    <div class="detail-none">二进制响应，共 {{ formatBytes(selected.size ?? 0) }}<span v-if="!selected.hasResponseBody">（超过 1 MB 未保留完整内容）</span></div>
                  </template>
                  <template v-else-if="bodyViews.response.state === 'loaded'">
                    <div v-if="fullText('response').length > 200_000" class="truncated-hint">
                      内容较大（{{ formatBytes(bodyViews.response.content?.byteLength ?? 0) }}），渲染可能略有延迟
                    </div>
                    <pre class="body-preview">{{ fullText('response') }}</pre>
                  </template>
                  <template v-else-if="selected.responseBodyPreview != null">
                    <pre class="body-preview">{{ selected.responseBodyPreview }}</pre>
                    <div v-if="selected.hasResponseBody" class="truncated-hint">仅显示前 4 KB，点「查看完整内容」拉取全部（≤1 MB）</div>
                    <div v-else-if="selected.size != null && selected.size > 1024 * 1024" class="truncated-hint">超过 1 MB，未保留完整内容</div>
                  </template>
                  <div v-else-if="selected.status == null" class="detail-none">（请求失败，无响应体）</div>
                  <div v-else class="detail-none">（无响应体）</div>
                </template>
              </div>
            </section>
          </template>

          <!-- ============ Initiator ============ -->
          <template v-else-if="network.detailTab === 'initiator'">
            <section class="detail-section">
              <div class="group-body">
                <div class="kv"><span class="k">发起宏</span><span class="v">{{ initiatorText(selected) }}</span></div>
                <div class="kv"><span class="k">入口脚本</span><span class="v mono break">{{ selected.initiatorFile || '—' }}</span></div>
                <div v-if="!selected.initiator" class="detail-none" style="margin-top: 8px">
                  无宏归属：这次调用来自 DevTools REPL 或引擎外部
                </div>
              </div>
            </section>
          </template>

          <!-- ============ Timing ============ -->
          <template v-else>
            <section class="detail-section">
              <div class="group-body timing">
                <div class="kv"><span class="k">Queued at</span><span class="v mono">{{ timeOf(selected) }}</span></div>
                <template v-if="selected.waitMs != null || selected.downloadMs != null">
                  <div class="timing-row">
                    <span class="timing-label">等待服务器响应</span>
                    <span class="timing-track">
                      <span
                        class="timing-bar wait"
                        :style="{ width: barWidth(selected.waitMs, selected.durationMs) }"
                      />
                    </span>
                    <span class="timing-value">{{ selected.waitMs != null ? formatMs(selected.waitMs) : '—' }}</span>
                  </div>
                  <div class="timing-row">
                    <span class="timing-label">内容下载</span>
                    <span class="timing-track">
                      <span
                        class="timing-bar download"
                        :style="{
                          width: barWidth(selected.downloadMs, selected.durationMs),
                          marginLeft: barOffset(selected.waitMs, selected.durationMs),
                        }"
                      />
                    </span>
                    <span class="timing-value">{{ selected.downloadMs != null ? formatMs(selected.downloadMs) : '—' }}</span>
                  </div>
                </template>
                <div v-else-if="selected.status == null" class="timing-row">
                  <span class="timing-label">连接失败</span>
                  <span class="timing-track"><span class="timing-bar fail" style="width: 100%" /></span>
                  <span class="timing-value">{{ timeText(selected) }}</span>
                </div>
                <div v-else class="timing-row">
                  <span class="timing-label">总耗时</span>
                  <span class="timing-track"><span class="timing-bar total" style="width: 100%" /></span>
                  <span class="timing-value">{{ timeText(selected) }}</span>
                </div>
                <div class="timing-total">总计 <b>{{ timeText(selected) }}</b></div>
              </div>
            </section>
          </template>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.network-tab {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
}

.tab-toolbar {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 10px;
  border-bottom: 1px solid var(--divider);
  flex: none;
}

.net-select,
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

.tab-toolbar .tool {
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

.tab-toolbar .tool:hover {
  color: var(--text-1);
  background: var(--hover);
}

/* 录制中 = 高亮（Chrome 录制点语义）；暂停 = 灰 */
.tab-toolbar .tool.recording {
  color: var(--accent);
}

.net-error {
  padding: 8px 14px;
  font-size: 12px;
  color: var(--danger);
  flex: none;
}

.net-main {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
}

.net-scroll {
  flex: 1;
  min-height: 0;
  overflow: auto;
}

.net-main.with-detail .net-scroll {
  flex: 0 1 auto;
  max-height: 45%;
}

.net-empty {
  padding: 14px;
  font-size: 12px;
  color: var(--text-3);
}

.net-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 11px;
  font-family: var(--font-mono);
}

.net-table th {
  position: sticky;
  top: 0;
  z-index: 2;
  background: var(--bg-chrome);
  color: var(--text-3);
  text-align: left;
  font-weight: 500;
  padding: 5px 10px;
  border-bottom: 1px solid var(--divider);
  white-space: nowrap;
}

.net-table td {
  padding: 4px 10px;
  border-bottom: 1px solid var(--divider);
  color: var(--text-1);
  white-space: nowrap;
}

.net-table tbody tr {
  cursor: pointer;
}

.net-table tbody tr:hover td {
  background: var(--hover);
}

.net-table tbody tr.selected td {
  background: color-mix(in srgb, var(--accent) 16%, transparent);
}

.col-name {
  min-width: 220px;
  max-width: 0;
  width: 42%;
}

.name-text {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
}

.col-method {
  width: 56px;
  color: var(--text-2);
}

.col-status {
  width: 58px;
}

.col-status .failed,
.col-status .s4,
.col-status .s5 {
  color: var(--danger);
}

.col-status .s3 {
  color: var(--warning);
}

.col-type {
  width: 64px;
  color: var(--text-2);
}

.col-size,
.col-time {
  width: 72px;
  color: var(--text-2);
  text-align: right;
}

.col-initiator {
  width: 140px;
  color: var(--text-2);
}

.initiator-text {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
}

.net-table tbody tr.failed .name-text {
  color: var(--text-3);
}

/* ---- 详情面板（Chrome 风格标签页） ---- */

.net-detail {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  border-top: 1px solid var(--divider);
  background: var(--bg-elevated-2, var(--bg-chrome));
}

.detail-tabs {
  display: flex;
  align-items: center;
  gap: 2px;
  padding: 0 8px;
  border-bottom: 1px solid var(--divider);
  flex: none;
}

.detail-tab {
  background: transparent;
  border: none;
  border-bottom: 2px solid transparent;
  color: var(--text-2);
  font-size: 12px;
  padding: 7px 10px 5px;
  cursor: pointer;
}

.detail-tab:hover {
  color: var(--text-1);
}

.detail-tab.active {
  color: var(--accent);
  border-bottom-color: var(--accent);
}

.detail-spacer {
  flex: 1;
}

.detail-tabs .tool {
  background: transparent;
  border: none;
  color: var(--text-3);
  width: 22px;
  height: 22px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: var(--radius-md);
  cursor: pointer;
  flex: none;
}

.detail-tabs .tool:hover {
  color: var(--text-1);
  background: var(--hover);
}

.detail-scroll {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: 8px 12px 12px;
}

.detail-section {
  margin-bottom: 12px;
}

.group-head {
  display: flex;
  align-items: center;
  gap: 5px;
  background: transparent;
  border: none;
  padding: 2px 0;
  font-size: 12px;
  font-weight: 600;
  color: var(--text-1);
  cursor: pointer;
}

.group-head.static {
  cursor: default;
}

.caret {
  color: var(--text-3);
  font-size: 10px;
  transition: transform 0.12s;
}

.caret.closed {
  transform: rotate(-90deg);
}

.group-head-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.group-actions {
  display: flex;
  gap: 10px;
}

.group-body {
  padding: 4px 0 0 14px;
}

.raw-toggle {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 11px;
  color: var(--text-3);
  cursor: pointer;
  user-select: none;
}

.raw-headers {
  margin: 4px 0 0 14px;
  padding: 8px;
  background: var(--control);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  font-family: var(--font-mono);
  font-size: 11px;
  line-height: 1.6;
  color: var(--text-1);
  white-space: pre-wrap;
  word-break: break-all;
  max-height: 180px;
  overflow: auto;
}

.kv {
  display: flex;
  gap: 10px;
  font-size: 11px;
  padding: 1px 0;
}

.kv .k {
  flex: none;
  width: 160px;
  color: var(--text-3);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.kv .v {
  color: var(--text-1);
  min-width: 0;
}

.mono {
  font-family: var(--font-mono);
}

.break {
  word-break: break-all;
  white-space: pre-wrap;
}

.error-text,
.fetch-error {
  color: var(--danger);
}

.status-dot {
  display: inline-block;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  margin-right: 4px;
  vertical-align: baseline;
}

.status-dot.s2 {
  background: var(--success);
}

.status-dot.s3 {
  background: var(--warning);
}

.status-dot.s4,
.status-dot.s5,
.status-dot.failed {
  background: var(--danger);
}

.link-btn {
  background: transparent;
  border: none;
  padding: 0;
  color: var(--accent);
  font-size: 11px;
  cursor: pointer;
}

.link-btn:hover {
  text-decoration: underline;
}

.detail-none {
  font-size: 11px;
  color: var(--text-3);
}

.truncated-hint {
  font-size: 11px;
  color: var(--warning);
  margin-top: 4px;
}

.truncated-hint-inline {
  color: var(--warning);
}

.img-preview {
  max-width: 100%;
  max-height: 240px;
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  background: repeating-conic-gradient(
    color-mix(in srgb, var(--text-3) 12%, transparent) 0 25%,
    transparent 0 50%
  );
  background-size: 16px 16px;
}

.body-preview {
  margin: 0;
  padding: 8px;
  background: var(--control);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  font-family: var(--font-mono);
  font-size: 11px;
  line-height: 1.5;
  color: var(--text-1);
  white-space: pre-wrap;
  word-break: break-all;
  max-height: 240px;
  overflow: auto;
}

/* Timing 瀑布 */

.timing {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.timing-row {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 11px;
}

.timing-label {
  flex: none;
  width: 150px;
  color: var(--text-2);
}

.timing-track {
  flex: 1;
  height: 12px;
  background: var(--control);
  border-radius: 3px;
  overflow: hidden;
  display: block;
}

.timing-bar {
  display: block;
  height: 100%;
  border-radius: 3px;
}

.timing-bar.wait {
  background: var(--success);
}

.timing-bar.download {
  background: var(--accent);
}

.timing-bar.fail {
  background: var(--danger);
}

.timing-bar.total {
  background: var(--text-3);
}

.timing-value {
  flex: none;
  width: 64px;
  text-align: right;
  color: var(--text-1);
  font-family: var(--font-mono);
}

.timing-total {
  font-size: 11px;
  color: var(--text-2);
  border-top: 1px solid var(--divider);
  padding-top: 6px;
}

.timing-total b {
  color: var(--text-1);
  font-family: var(--font-mono);
}
</style>

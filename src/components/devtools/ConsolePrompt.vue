<script setup lang="ts">
/**
 * DevTools 控制台 REPL 输入行（Chrome 口径）：Enter 执行 / Shift+Enter 换行 /
 * ↑↓ 历史导航（本地持久化，最近 100 条）。执行结果由 mod 端写入控制台环，
 * 经 SSE/回放进入时间线，这里只负责发请求；target=devtools 且 404 视为
 * 旧版 mod 无 eval 端点，禁用输入行并提示。
 */
import { ref, watch, onMounted, nextTick } from 'vue'
import { evalConsole } from '@/api/endpoints'
import { ApiError } from '@/types/api'

const props = defineProps<{ target: string }>()

const text = ref('')
const busy = ref(false)
const unsupported = ref(false)
const errorMsg = ref('')

const HISTORY_KEY = 'neomacros-console-history-v1'
const HISTORY_MAX = 100
const history = ref<string[]>(loadHistory())
/** -1 = 草稿态（不在历史浏览中） */
const historyIndex = ref(-1)
const draft = ref('')

function loadHistory(): string[] {
  try {
    const raw = localStorage.getItem(HISTORY_KEY)
    const parsed = raw ? (JSON.parse(raw) as unknown) : []
    return Array.isArray(parsed)
      ? parsed.filter((x): x is string => typeof x === 'string').slice(-HISTORY_MAX)
      : []
  } catch {
    return []
  }
}

/** 去重后追加到末尾（最新在末尾）并持久化 */
function saveHistory(entry: string): void {
  history.value = [...history.value.filter((h) => h !== entry), entry].slice(-HISTORY_MAX)
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(history.value))
  } catch {
    /* 忽略持久化失败 */
  }
}

async function submit(): Promise<void> {
  const expression = text.value.trim()
  if (!expression || busy.value || unsupported.value) return
  busy.value = true
  errorMsg.value = ''
  saveHistory(expression)
  try {
    await evalConsole({ target: props.target, expression })
    text.value = ''
    draft.value = ''
    historyIndex.value = -1
  } catch (e) {
    if (e instanceof ApiError && e.status === 404 && props.target === 'devtools') {
      // devtools 目标在真实实现里不可能合法 404：只能是没有 eval 端点的旧 mod
      unsupported.value = true
    } else if (e instanceof ApiError && e.status === 404) {
      errorMsg.value = `目标宏未加载：${props.target}`
    } else if (e instanceof ApiError) {
      errorMsg.value = e.label
    } else {
      errorMsg.value = e instanceof Error ? e.message : String(e)
    }
  } finally {
    busy.value = false
    autoGrow()
  }
}

function onKeydown(e: KeyboardEvent): void {
  if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
    e.preventDefault()
    void submit()
    return
  }
  // 历史导航仅在单行态生效（多行编辑时 ↑↓ 移动光标）
  if (e.key === 'ArrowUp' && !text.value.includes('\n')) {
    if (history.value.length === 0) return
    e.preventDefault()
    if (historyIndex.value === -1) {
      draft.value = text.value
      historyIndex.value = history.value.length - 1
    } else if (historyIndex.value > 0) {
      historyIndex.value--
    }
    text.value = history.value[historyIndex.value] ?? ''
    moveCaretEnd()
    return
  }
  if (e.key === 'ArrowDown' && !text.value.includes('\n')) {
    if (historyIndex.value === -1) return
    e.preventDefault()
    historyIndex.value++
    if (historyIndex.value >= history.value.length) {
      historyIndex.value = -1
      text.value = draft.value
    } else {
      text.value = history.value[historyIndex.value] ?? ''
    }
    moveCaretEnd()
  }
}

const area = ref<HTMLTextAreaElement | null>(null)

function moveCaretEnd(): void {
  void nextTick(() => {
    const el = area.value
    if (el) el.selectionStart = el.selectionEnd = el.value.length
  })
}

function autoGrow(): void {
  const el = area.value
  if (!el) return
  el.style.height = 'auto'
  el.style.height = `${Math.min(el.scrollHeight, 120)}px`
}

watch(text, autoGrow)

onMounted(autoGrow)
</script>

<template>
  <div class="prompt" :class="{ busy }">
    <span class="prompt-chr">›</span>
    <textarea
      ref="area"
      v-model="text"
      class="prompt-input"
      rows="1"
      spellcheck="false"
      :disabled="unsupported"
      :placeholder="unsupported
        ? '当前 mod 版本不支持 REPL（需更新 mod）'
        : '执行表达式：Enter 运行，Shift+Enter 换行'"
      @keydown="onKeydown"
    />
    <span v-if="busy" class="prompt-state">运行中…</span>
  </div>
  <div v-if="errorMsg" class="prompt-error">{{ errorMsg }}</div>
</template>

<style scoped>
.prompt {
  flex: none;
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 5px 12px;
  border-top: 1px solid var(--divider);
  background: var(--bg-elevated);
}

.prompt.busy {
  opacity: 0.7;
}

.prompt-chr {
  flex: none;
  color: var(--accent);
  font-family: var(--font-mono);
  font-size: 12px;
  font-weight: 700;
  line-height: 1.6;
  user-select: none;
}

.prompt-input {
  flex: 1;
  min-width: 0;
  background: transparent;
  border: none;
  outline: none;
  resize: none;
  color: var(--text-1);
  font-family: var(--font-mono);
  font-size: 11px;
  line-height: 1.6;
  padding: 0;
  max-height: 120px;
}

.prompt-input::placeholder {
  color: var(--text-3);
  font-family: var(--font-ui);
}

.prompt-state {
  flex: none;
  color: var(--text-3);
  font-size: 11px;
  font-family: var(--font-ui);
}

.prompt-error {
  flex: none;
  padding: 3px 12px 5px 26px;
  color: var(--danger);
  font-size: 11px;
  font-family: var(--font-ui);
  border-top: 1px dashed var(--divider);
  white-space: pre-wrap;
  word-break: break-all;
}
</style>

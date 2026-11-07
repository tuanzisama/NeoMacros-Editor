<script setup lang="ts">
/**
 * 宏「配置」= neomacro.yml 的结构化表单（声明即配置）。
 * 通用字段（生命周期/描述/入口）+ 类型专属（按键=key、事件=events 列表、服务=autostart）。
 * 保存：行级替换已知键，未知行/注释原样保留，缺键追加末尾。
 */
import { computed, onMounted, ref } from 'vue'
import { readFile, writeFile } from '@/api/endpoints'
import { invalidateFiles, refresh } from '@/stores/macros'
import { notify } from '@/stores/workspace'
import { LIFECYCLE_LABELS } from '@/types/api'
import type { Lifecycle, MacroView } from '@/types/api'
import AppModal from '@/components/ui/AppModal.vue'
import ToggleSwitch from '@/components/ui/ToggleSwitch.vue'

const props = defineProps<{ macro: MacroView }>()
const emit = defineEmits<{ close: [] }>()

const loading = ref(true)
const loadError = ref('')
const saving = ref(false)
const serverError = ref('')

const lifecycle = ref<Lifecycle>('manual')
const description = ref('')
const main = ref('')
const key = ref('')
const eventsText = ref('') // 每行一个事件
const autostart = ref(false)

/** 原始行缓存（保存时基于它做行级替换，保留未知行） */
let originalLines: string[] = []
/** 挂载时读取的 ETag（乐观并发；yml 必已存在，不能用空占位） */
let originalEtag = ''

const TYPE_HINTS: Record<string, string> = {
  key: '键位，如 LAlt+X',
  main: '入口脚本，缺省 index.js',
}

function parseScalar(lines: string[], name: string): string | null {
  const re = new RegExp(`^\\s*${name}:\\s*(.*)$`)
  for (const line of lines) {
    const m = re.exec(line)
    if (m) return m[1].replace(/^["']|["']$/g, '').trim()
  }
  return null
}

/** events: 块 → 逐行字符串列表（`- item`） */
function parseEvents(lines: string[]): string[] | null {
  const start = lines.findIndex((l) => /^\s*events:\s*(#.*)?$/.test(l))
  if (start < 0) return null
  const items: string[] = []
  for (let i = start + 1; i < lines.length; i++) {
    const m = /^\s+-\s*(.+)$/.exec(lines[i])
    if (!m) break
    items.push(m[1].replace(/^["']|["']$/g, '').trim())
  }
  return items
}

onMounted(async () => {
  try {
    const file = await readFile(`${props.macro.id}/neomacro.yml`)
    originalLines = file.text.split(/\r?\n/)
    originalEtag = file.etag
    const lc = parseScalar(originalLines, 'lifecycle') as Lifecycle | null
    if (lc && lc in LIFECYCLE_LABELS) lifecycle.value = lc
    description.value = parseScalar(originalLines, 'description') ?? ''
    main.value = parseScalar(originalLines, 'main') ?? ''
    key.value = parseScalar(originalLines, 'key') ?? ''
    autostart.value = parseScalar(originalLines, 'autostart') === 'true'
    const events = parseEvents(originalLines)
    if (events) eventsText.value = events.join('\n')
  } catch (e) {
    loadError.value = e instanceof Error ? e.message : String(e)
  } finally {
    loading.value = false
  }
})

function replaceScalar(lines: string[], name: string, value: string): void {
  const re = new RegExp(`^(\\s*${name}:).*$`)
  for (let i = 0; i < lines.length; i++) {
    if (re.test(lines[i])) {
      lines[i] = lines[i].replace(re, `$1 ${value}`)
      return
    }
  }
  // 原文件无此键且值为空 → 不追加空键
  if (!value) return
  lines.push(`${name}: ${value}`)
}

function replaceEvents(lines: string[], items: string[]): void {
  const start = lines.findIndex((l) => /^\s*events:\s*(#.*)?$/.test(l))
  const block = items.length > 0 ? ['events:', ...items.map((i) => `  - ${i}`)] : []
  if (start < 0) {
    if (block.length > 0) lines.push(...block)
    return
  }
  let end = start + 1
  while (end < lines.length && /^\s+-\s/.test(lines[end])) end++
  lines.splice(start, end - start, ...block)
}

const canSave = computed(() => !loading.value && !saving.value)

async function save(): Promise<void> {
  if (!canSave.value) return
  saving.value = true
  serverError.value = ''
  try {
    const lines = [...originalLines]
    replaceScalar(lines, 'lifecycle', lifecycle.value)
    replaceScalar(lines, 'description', description.value.trim())
    replaceScalar(lines, 'main', main.value.trim())
    if (props.macro.category === 'keypress') {
      replaceScalar(lines, 'key', key.value.trim())
    } else if (props.macro.category === 'event') {
      replaceEvents(
        lines,
        eventsText.value
          .split(/\r?\n/)
          .map((s) => s.trim())
          .filter(Boolean),
      )
    } else if (props.macro.category === 'services') {
      replaceScalar(lines, 'autostart', autostart.value ? 'true' : 'false')
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
    serverError.value = e instanceof Error ? e.message : String(e)
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <AppModal title="配置" :width="460" @close="emit('close')">
    <div v-if="loading" class="hint">读取中…</div>
    <div v-else-if="loadError" class="error-text">{{ loadError }}</div>
    <template v-else>
      <div class="field">
        <label>生命周期</label>
        <select v-model="lifecycle" class="input">
          <option value="always">{{ LIFECYCLE_LABELS.always }}</option>
          <option value="world">{{ LIFECYCLE_LABELS.world }}</option>
          <option value="manual">{{ LIFECYCLE_LABELS.manual }}</option>
        </select>
      </div>
      <div class="field">
        <label>描述</label>
        <input v-model="description" class="input" placeholder="一句话说明用途" spellcheck="false" />
      </div>
      <div class="field">
        <label>入口</label>
        <input v-model="main" class="input mono" :placeholder="TYPE_HINTS.main" spellcheck="false" />
      </div>

      <template v-if="macro.category === 'keypress'">
        <div class="field">
          <label>键位</label>
          <input v-model="key" class="input mono" :placeholder="TYPE_HINTS.key" spellcheck="false" />
        </div>
      </template>
      <template v-else-if="macro.category === 'event'">
        <div class="field">
          <label>事件（每行一个）</label>
          <textarea
            v-model="eventsText"
            class="input mono"
            rows="4"
            placeholder="client:join_world"
            spellcheck="false"
          />
        </div>
      </template>
      <template v-else-if="macro.category === 'services'">
        <div class="field row">
          <label>自启</label>
          <ToggleSwitch v-model="autostart" />
        </div>
      </template>

      <p class="hint">其余字段（version/author 等）直接在 neomacro.yml 里编辑。</p>
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

.hint {
  font-size: 11px;
  color: var(--text-3);
  margin: 8px 0 0;
}

.error-text {
  font-size: 12px;
  color: var(--danger);
  margin: 8px 0 0;
}

.mono {
  font-family: var(--font-mono);
}
</style>

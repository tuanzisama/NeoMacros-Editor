<script setup lang="ts">
/**
 * 下拉选择（reka-ui Select 无头原语 + 既有令牌造型）。
 * options：{ value, label, disabled?, group? }（group 非空归入分组，组按首现顺序）。
 * SelectItem 不接受空串 value：'' 在内部映射为哨兵，对外 v-model 仍是 ''。
 */
import { computed } from 'vue'
import {
  SelectRoot,
  SelectTrigger,
  SelectValue,
  SelectPortal,
  SelectContent,
  SelectViewport,
  SelectItem,
  SelectItemText,
  SelectItemIndicator,
  SelectGroup,
  SelectLabel,
} from 'reka-ui'
import AppIcon from './AppIcon.vue'

export interface SelectOption {
  value: string
  label: string
  disabled?: boolean
  /** 分组标题（如事件选择按域分组）；缺省为无组区 */
  group?: string
}

const props = withDefaults(
  defineProps<{
    modelValue: string
    options: SelectOption[]
    placeholder?: string
    disabled?: boolean
  }>(),
  { placeholder: '', disabled: false },
)

// SelectRoot 不渲染宿主节点：透传属性（class/title 等）落到触发按钮上
defineOptions({ inheritAttrs: false })

const emit = defineEmits<{ 'update:modelValue': [value: string] }>()

const EMPTY = '\u0000empty'
function toInner(v: string): string {
  return v === '' ? EMPTY : v
}
function toOuter(v: string): string {
  return v === EMPTY ? '' : v
}

const inner = computed<string>({
  get: () => toInner(props.modelValue),
  set: (v) => emit('update:modelValue', toOuter(v)),
})

/** 分组渲染模型：无组区在前，组按首现顺序 */
const groups = computed<{ name: string | null; items: SelectOption[] }[]>(() => {
  const out: { name: string | null; items: SelectOption[] }[] = []
  for (const o of props.options) {
    const name = o.group ?? null
    const g = out.find((x) => x.name === name)
    if (g) g.items.push(o)
    else out.push({ name, items: [o] })
  }
  return out
})

const selectedLabel = computed(
  () => props.options.find((o) => o.value === props.modelValue)?.label ?? '',
)
</script>

<template>
  <SelectRoot v-model="inner" :disabled="disabled">
    <SelectTrigger class="app-select" :title="selectedLabel || placeholder" v-bind="$attrs">
      <SelectValue :placeholder="placeholder" />
      <AppIcon name="chevron" :size="12" class="app-select-caret" />
    </SelectTrigger>
    <SelectPortal>
      <SelectContent class="app-select-content" position="popper" :side-offset="4" :avoid-collisions="true">
        <SelectViewport class="app-select-viewport">
          <template v-for="g in groups" :key="g.name ?? ''">
            <SelectGroup v-if="g.name">
              <SelectLabel class="app-select-group-label">{{ g.name }}</SelectLabel>
              <SelectItem
                v-for="o in g.items"
                :key="o.value"
                class="app-select-item"
                :value="toInner(o.value)"
                :disabled="o.disabled"
              >
                <SelectItemText>{{ o.label }}</SelectItemText>
                <SelectItemIndicator class="app-select-check">✓</SelectItemIndicator>
              </SelectItem>
            </SelectGroup>
            <template v-else>
              <SelectItem
                v-for="o in g.items"
                :key="o.value"
                class="app-select-item"
                :value="toInner(o.value)"
                :disabled="o.disabled"
              >
                <SelectItemText>{{ o.label }}</SelectItemText>
                <SelectItemIndicator class="app-select-check">✓</SelectItemIndicator>
              </SelectItem>
            </template>
          </template>
        </SelectViewport>
      </SelectContent>
    </SelectPortal>
  </SelectRoot>
</template>

<style scoped>
.app-select {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  background: var(--control);
  color: var(--text-1);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  font-size: 12px;
  padding: 3px 8px;
  min-height: 24px;
  cursor: pointer;
  transition: border-color var(--dur) var(--ease), background var(--dur) var(--ease);
}

.app-select:hover {
  background: var(--control-hover);
}

.app-select:focus-visible {
  border-color: var(--accent);
  outline: none;
}

.app-select[data-disabled] {
  opacity: 0.45;
  cursor: not-allowed;
}

.app-select-caret {
  color: var(--text-3);
  transform: rotate(90deg);
  flex: none;
}
</style>

<style>
/* 下拉内容经 Portal 挂 body，scoped 属性传不到 teleported 元素 → 全局块。
   z-index 需压过 sticky 表头(2)/模态(100)，低于右键菜单(1000) */
.app-select-content {
  z-index: 500;
  min-width: var(--reka-select-trigger-width);
  background: var(--bg-elevated-2);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.35);
  overflow: hidden;
}

.app-select-viewport {
  padding: 4px;
  max-height: var(--reka-select-content-available-height);
  overflow-y: auto;
}

.app-select-group-label {
  padding: 4px 8px 2px;
  font-size: 10px;
  color: var(--text-3);
}

.app-select-item {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  color: var(--text-1);
  padding: 4px 8px;
  border-radius: var(--radius-sm);
  cursor: pointer;
  user-select: none;
  outline: none;
}

.app-select-item[data-highlighted] {
  background: var(--hover);
}

.app-select-item[data-disabled] {
  opacity: 0.45;
  cursor: not-allowed;
}

.app-select-item[data-state='checked'] {
  color: var(--accent);
}

.app-select-check {
  margin-left: auto;
  font-size: 10px;
}
</style>

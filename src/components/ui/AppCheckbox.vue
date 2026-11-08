<script setup lang="ts">
/**
 * 复选框（reka-ui Checkbox 无头原语 + 既有令牌造型）。
 * 单按钮行：方框 + 文本（label 或插槽），点击任意处切换，键盘空格可达。
 */
import { CheckboxRoot, CheckboxIndicator } from 'reka-ui'

const props = withDefaults(
  defineProps<{
    modelValue: boolean
    label?: string
    disabled?: boolean
  }>(),
  { label: '', disabled: false },
)

const emit = defineEmits<{ 'update:modelValue': [value: boolean] }>()

function onChange(v: unknown): void {
  emit('update:modelValue', v === true)
}
</script>

<template>
  <CheckboxRoot
    class="app-checkbox"
    :model-value="props.modelValue"
    :disabled="props.disabled"
    @update:model-value="onChange"
  >
    <span class="app-checkbox-box">
      <CheckboxIndicator class="app-checkbox-ind">✓</CheckboxIndicator>
    </span>
    <span v-if="label" class="app-checkbox-text">{{ label }}</span>
    <slot />
  </CheckboxRoot>
</template>

<style scoped>
.app-checkbox {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  font-size: 12px;
  color: var(--text-2);
  padding: 3px 4px;
  border-radius: var(--radius-sm);
  cursor: pointer;
  user-select: none;
  text-align: left;
  outline: none;
}

.app-checkbox:hover {
  background: var(--hover);
}

.app-checkbox:focus-visible {
  box-shadow: 0 0 0 1px var(--accent);
}

.app-checkbox[data-disabled] {
  opacity: 0.45;
  cursor: not-allowed;
}

.app-checkbox-box {
  flex: none;
  width: 13px;
  height: 13px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: var(--bg-elevated);
  border: 1px solid var(--border);
  border-radius: 3px;
  transition: border-color var(--dur) var(--ease), background var(--dur) var(--ease);
}

.app-checkbox:hover .app-checkbox-box {
  border-color: var(--border-strong, var(--border));
}

.app-checkbox[data-state='checked'] .app-checkbox-box {
  background: var(--accent);
  border-color: var(--accent);
}

.app-checkbox-ind {
  color: var(--on-accent);
  font-size: 10px;
  line-height: 1;
}

.app-checkbox-text {
  white-space: nowrap;
}
</style>

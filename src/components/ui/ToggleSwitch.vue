<script setup lang="ts">
/** 行内开关（enabled=持久意图）。reka-ui Switch 无头原语，外观不变、键盘可达。 */
import { SwitchRoot, SwitchThumb } from 'reka-ui'

const props = defineProps<{ modelValue: boolean; disabled?: boolean; title?: string }>()
const emit = defineEmits<{ 'update:modelValue': [value: boolean] }>()

function onChange(v: unknown): void {
  emit('update:modelValue', v === true)
}
</script>

<template>
  <SwitchRoot
    class="switch"
    :class="{ on: props.modelValue }"
    :model-value="props.modelValue"
    :disabled="props.disabled"
    :title="props.title"
    @update:model-value="onChange"
  >
    <SwitchThumb class="knob" />
  </SwitchRoot>
</template>

<style scoped>
.switch {
  width: 28px;
  height: 16px;
  border-radius: 8px;
  background: var(--control);
  position: relative;
  transition: background var(--dur) var(--ease);
  flex: none;
  cursor: pointer;
}

.switch:hover:not(:disabled) {
  background: var(--control-hover);
}

.switch:focus-visible {
  box-shadow: 0 0 0 1px var(--accent);
}

.switch.on {
  background: var(--accent);
}

.switch:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.knob {
  position: absolute;
  top: 2px;
  left: 2px;
  width: 12px;
  height: 12px;
  border-radius: 50%;
  background: #e8edf5;
  transition: transform var(--dur) var(--ease);
}

.switch.on .knob {
  transform: translateX(12px);
  background: var(--on-accent);
}
</style>

<script setup lang="ts">
/** 行内开关（enabled=持久意图）。 */
const props = defineProps<{ modelValue: boolean; disabled?: boolean; title?: string }>()
const emit = defineEmits<{ 'update:modelValue': [value: boolean] }>()
</script>

<template>
  <button
    class="switch"
    :class="{ on: props.modelValue, disabled: props.disabled }"
    :title="props.title"
    :disabled="props.disabled"
    role="switch"
    :aria-checked="props.modelValue"
    @click.stop="emit('update:modelValue', !props.modelValue)"
  >
    <span class="knob" />
  </button>
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
}

.switch:hover:not(.disabled) {
  background: var(--control-hover);
}

.switch.on {
  background: var(--accent);
}

.switch.disabled {
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

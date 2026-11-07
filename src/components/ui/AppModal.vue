<script setup lang="ts">
/** 同屏模态卡片：背景压暗 + 居中 + Esc 关闭（输入路由顶栈优先）。 */
import AppIcon from '@/components/ui/AppIcon.vue'

const props = defineProps<{ title: string; width?: number }>()
const emit = defineEmits<{ close: [] }>()

function onKeydown(e: KeyboardEvent): void {
  if (e.key === 'Escape') emit('close')
}
</script>

<template>
  <div class="modal-backdrop" @keydown="onKeydown" @click.self="emit('close')">
    <div
      class="modal-card"
      :style="{ minWidth: (props.width ?? 420) + 'px', maxWidth: '92vw' }"
      tabindex="-1"
    >
      <div class="modal-header">
        <span>{{ props.title }}</span>
        <button class="btn-ghost close-btn" title="关闭" @click="emit('close')">
          <AppIcon name="close" />
        </button>
      </div>
      <div class="modal-body">
        <slot />
      </div>
      <div v-if="$slots.footer" class="modal-footer">
        <slot name="footer" />
      </div>
    </div>
  </div>
</template>

<style scoped>
.close-btn {
  padding: 4px;
  border-radius: var(--radius-sm);
  display: inline-flex;
}

.close-btn:hover {
  color: var(--text-1);
}
</style>

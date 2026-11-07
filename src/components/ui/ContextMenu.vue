<script setup lang="ts">
/** VS Code 式右键上下文菜单：Teleport 挂 body，视口边缘翻转，外点/Esc/滚动关闭。 */
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import AppIcon from './AppIcon.vue'

export interface MenuItem {
  id: string
  label: string
  icon?: string
  danger?: boolean
  /** 置灰不可点（如 mod 侧端点未实现） */
  disabled?: boolean
  /** 渲染在该项之前的分隔线 */
  separatorBefore?: boolean
}

const props = defineProps<{ x: number; y: number; items: MenuItem[] }>()
const emit = defineEmits<{ select: [id: string]; close: [] }>()

const el = ref<HTMLElement | null>(null)
const pos = ref({ x: props.x, y: props.y })

function place(): void {
  const w = el.value?.offsetWidth ?? 160
  const h = el.value?.offsetHeight ?? 100
  pos.value = {
    x: Math.max(4, Math.min(props.x, window.innerWidth - w - 8)),
    y: Math.max(4, Math.min(props.y, window.innerHeight - h - 8)),
  }
}

function close(): void {
  emit('close')
}

function pick(item: MenuItem): void {
  if (item.disabled) return
  emit('select', item.id)
  close()
}

function onDocPointerDown(e: PointerEvent): void {
  if (el.value && !el.value.contains(e.target as Node)) close()
}

function onKey(e: KeyboardEvent): void {
  if (e.key === 'Escape') close()
}

onMounted(() => {
  place()
  document.addEventListener('pointerdown', onDocPointerDown, true)
  document.addEventListener('keydown', onKey, true)
  // 捕获阶段拦滚动：树滚动后菜单定位即失义
  document.addEventListener('scroll', close, true)
  window.addEventListener('resize', close)
})

onBeforeUnmount(() => {
  document.removeEventListener('pointerdown', onDocPointerDown, true)
  document.removeEventListener('keydown', onKey, true)
  document.removeEventListener('scroll', close, true)
  window.removeEventListener('resize', close)
})

watch(() => [props.x, props.y], place)
</script>

<template>
  <Teleport to="body">
    <div ref="el" class="ctx-menu" :style="{ left: `${pos.x}px`, top: `${pos.y}px` }">
      <template v-for="item in items" :key="item.id">
        <div v-if="item.separatorBefore" class="sep" />
        <button
          class="item"
          :class="{ danger: item.danger, disabled: item.disabled }"
          :title="item.disabled ? 'mod 侧端点未实现' : undefined"
          @click="pick(item)"
        >
          <AppIcon v-if="item.icon" :name="item.icon" :size="14" />
          <span>{{ item.label }}</span>
        </button>
      </template>
    </div>
  </Teleport>
</template>

<style scoped>
.ctx-menu {
  position: fixed;
  z-index: 1000;
  min-width: 160px;
  padding: 4px;
  background: var(--bg-elevated-2);
  border: 1px solid var(--border-strong);
  border-radius: var(--radius-md);
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.35);
}

.item {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 10px;
  font-size: 13px;
  color: var(--text-1);
  text-align: left;
  border-radius: var(--radius-sm);
  transition: background var(--dur) var(--ease);
}

.item:hover {
  background: var(--hover);
}

.item.danger:hover {
  color: var(--danger);
}

.item.disabled {
  color: var(--text-3);
  cursor: default;
}

.item.disabled:hover {
  background: transparent;
}

.sep {
  height: 1px;
  margin: 4px 6px;
  background: var(--divider);
}
</style>

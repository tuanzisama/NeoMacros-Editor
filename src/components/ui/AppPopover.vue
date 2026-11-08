<script setup lang="ts">
/**
 * 浮层（reka-ui Popover 无头原语 + 既有令牌造型）：外部点击 / Esc 关闭、焦点管理。
 * 默认插槽为浮层内容；#trigger 插槽为触发按钮（as-child 透传，样式由调用方定）。
 */
import { PopoverRoot, PopoverTrigger, PopoverPortal, PopoverContent } from 'reka-ui'

withDefaults(
  defineProps<{
    /** 弹出方位（浮层一般挂在工具栏按钮下方） */
    side?: 'top' | 'bottom' | 'left' | 'right'
    align?: 'start' | 'center' | 'end'
  }>(),
  { side: 'bottom', align: 'end' },
)

// PopoverRoot 不渲染宿主节点，调用方可传 class/title 落到浮层内容上
defineOptions({ inheritAttrs: false })
</script>

<template>
  <PopoverRoot>
    <PopoverTrigger as-child>
      <slot name="trigger" />
    </PopoverTrigger>
    <PopoverPortal>
      <PopoverContent
        class="app-popover"
        :side="side"
        :align="align"
        :side-offset="6"
        :avoid-collisions="true"
        v-bind="$attrs"
      >
        <slot />
      </PopoverContent>
    </PopoverPortal>
  </PopoverRoot>
</template>

<style scoped>
/* 触发按钮样式由调用方定，这里只管浮层本体（内容经 Portal 挂 body，
   scoped 属性传不到 teleported 元素 → 浮层样式必须放全局块，见下方） */
</style>

<style>
/* 全局（Portal 内容）：z-index 需压过 sticky 表头(2)/模态(100)，低于右键菜单(1000) */
.app-popover {
  z-index: 500;
  background: var(--bg-elevated-2);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.35);
  padding: 8px;
  white-space: nowrap;
}
</style>

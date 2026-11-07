<script setup lang="ts">
/**
 * MC 富文本节点的展示层递归：样式（颜色/粗斜体/下划线删除线）映射为内联
 * CSS，children 递归渲染为嵌套 span 树。
 */
import { computed, h, type PropType, type VNode } from 'vue'
import type { RichComponent } from '@/types/api'
import { richStyle } from './consoleFormat'

const props = defineProps({
  rich: { type: Object as PropType<RichComponent>, required: true },
})

function renderRich(rich: RichComponent): VNode {
  const children = (rich.children ?? []).map((child) => renderRich(child))
  return h('span', { style: richStyle(rich) }, [rich.text, ...children])
}

const tree = computed(() => renderRich(props.rich))
</script>

<template>
  <component :is="tree" />
</template>

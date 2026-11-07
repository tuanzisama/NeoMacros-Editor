<script setup lang="ts">
/**
 * 控制台单个结构化节点的渲染：可展开的对象/数组/错误栈/宿主对象、
 * MC 富文本组件、Class/函数等。模板自引用递归渲染嵌套节点。
 */
import { ref, computed } from 'vue'
import AppIcon from '@/components/ui/AppIcon.vue'
import RichSpan from './RichSpan.vue'
import { stringifyNode } from './consoleFormat'
import type { ConsoleNode } from '@/types/api'

const props = defineProps<{
  node: ConsoleNode
  /** 嵌套在父节点内展示（字符串加引号） */
  nested?: boolean
}>()

const open = ref(false)

const expandable = computed(() => {
  const node = props.node
  if (node.t === 'obj') return node.props.length > 0
  if (node.t === 'arr') return node.items.length > 0
  if (node.t === 'err') return node.stack.length > 0
  if (node.t === 'host') return (node.props?.length ?? 0) > 0
  return false
})

function toggle(): void {
  if (expandable.value) open.value = !open.value
}

const preview = computed(() => {
  const node = props.node
  switch (node.t) {
    case 'obj':
      return `{${node.pre}}${node.tr ? '…' : ''}`
    case 'arr':
      return `[${node.pre}]${node.tr ? '…' : ''}`
    case 'host':
      return node.pre || node.cls
    default:
      return ''
  }
})

const strText = computed(() =>
  props.node.t === 'str' ? (props.nested ? JSON.stringify(props.node.v) : props.node.v) : '',
)
</script>

<template>
  <!-- 标量 -->
  <span v-if="node.t === 'str'" class="n-str">{{ strText }}</span>
  <span v-else-if="node.t === 'num'" class="n-num">{{ node.v }}</span>
  <span v-else-if="node.t === 'bool'" class="n-bool">{{ node.v }}</span>
  <span v-else-if="node.t === 'null'" class="n-null">null</span>
  <span v-else-if="node.t === 'undef'" class="n-null">undefined</span>

  <!-- 函数 / Class -->
  <span v-else-if="node.t === 'fn'" class="n-fn" :title="node.name">ƒ {{ node.name }}()</span>
  <span v-else-if="node.t === 'class'" class="n-class" :title="node.name">
    <span class="kw">class</span> {{ node.name }}
  </span>

  <!-- MC 富文本组件 -->
  <RichSpan v-else-if="node.t === 'comp'" :rich="node.rich" />

  <!-- 错误：红字 + 可展开调用栈 -->
  <span v-else-if="node.t === 'err'" class="n-err">
    <span v-if="expandable" class="tw" @click="toggle">
      <AppIcon name="chevron" :size="11" :class="{ rotated: open }" />
    </span>
    <span :title="node.stack">{{ node.name }}: {{ node.msg }}</span>
    <pre v-if="open && node.stack" class="stack">{{ node.stack }}</pre>
  </span>

  <!-- 对象 / 数组 / 宿主对象：预览 + 可展开成员 -->
  <span v-else class="n-obj">
    <span v-if="expandable" class="tw" @click="toggle">
      <AppIcon name="chevron" :size="11" :class="{ rotated: open }" />
    </span>
    <span :title="stringifyNode(node)">{{ preview }}</span>
    <span v-if="open && node.t === 'obj'" class="members">
      <span v-for="prop in node.props" :key="prop.k" class="member">
        <span class="k">{{ prop.k }}:</span>
        <ConsoleMessage :node="prop.v" nested />
      </span>
      <span v-if="node.tr" class="more">… 共 {{ node.n }} 个属性</span>
    </span>
    <span v-if="open && node.t === 'arr'" class="members">
      <span v-for="(item, i) in node.items" :key="i" class="member">
        <span class="k">{{ i }}:</span>
        <ConsoleMessage :node="item" nested />
      </span>
      <span v-if="node.tr" class="more">… 共 {{ node.len }} 项</span>
    </span>
    <span v-if="open && node.t === 'host' && node.props" class="members">
      <span v-for="prop in node.props" :key="prop.k" class="member">
        <span class="k">{{ prop.k }}:</span>
        <ConsoleMessage :node="prop.v" nested />
      </span>
    </span>
  </span>
</template>

<style scoped>
.n-str {
  color: var(--text-1);
  white-space: pre-wrap;
  word-break: break-all;
}

.n-num {
  color: var(--accent);
}

.n-bool {
  color: var(--accent);
}

.n-null {
  color: var(--text-3);
  font-style: italic;
}

.n-fn {
  color: var(--warning);
}

.n-class {
  color: var(--text-2);
}

.kw {
  color: var(--text-3);
  font-style: italic;
}

.n-err {
  color: var(--danger);
  white-space: pre-wrap;
  word-break: break-all;
}

.n-obj {
  color: var(--text-2);
}

.tw {
  display: inline-flex;
  align-items: center;
  cursor: pointer;
  color: var(--text-3);
  margin-right: 2px;
}

.tw:hover {
  color: var(--text-1);
}

.rotated {
  transform: rotate(90deg);
}

.members {
  display: block;
  padding-left: 18px;
}

.member {
  display: block;
}

.k {
  color: var(--text-3);
  margin-right: 4px;
}

.more {
  color: var(--text-3);
  font-style: italic;
}

.stack {
  display: block;
  margin: 2px 0 0 14px;
  padding: 4px 8px;
  color: var(--text-3);
  white-space: pre-wrap;
  word-break: break-all;
  background: var(--bg-elevated);
  border-left: 2px solid var(--divider);
  user-select: text;
}
</style>

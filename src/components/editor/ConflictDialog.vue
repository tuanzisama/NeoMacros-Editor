<script setup lang="ts">
/** 409 冲突流：文件已在别处被修改 → 对比/覆盖/取回（设计文档 §8 规则 2）。 */
import { computed } from 'vue'
import type { EditorTab } from '@/stores/editor'
import { resolveConflict, dismissConflict } from '@/stores/editor'
import AppModal from '@/components/ui/AppModal.vue'

const props = defineProps<{ tab: EditorTab }>()

function preview(text: string): string {
  return text.split('\n').slice(0, 8).join('\n') || '（空）'
}

const serverPreview = computed(() => preview(props.tab.conflict?.serverContent ?? ''))
const minePreview = computed(() => preview(props.tab.buffer))
</script>

<template>
  <AppModal title="文件冲突" :width="560" @close="dismissConflict(props.tab.path)">
    <p class="lead">
      「{{ props.tab.title }}」已被其他地方修改（游戏内编辑器、另一台设备或直接改文件）。
      你的缓冲内容与服务端不一致。
    </p>
    <div class="diff-hint">
      <div class="col">
        <div class="col-head">服务端当前内容（前 8 行）</div>
        <pre>{{ serverPreview }}</pre>
      </div>
      <div class="col">
        <div class="col-head mine">我的未保存缓冲（前 8 行）</div>
        <pre>{{ minePreview }}</pre>
      </div>
    </div>
    <template #footer>
      <button class="btn btn-ghost" @click="dismissConflict(props.tab.path)">取消</button>
      <button class="btn" @click="resolveConflict(props.tab.path, 'takeServer')">
        取服务端内容
      </button>
      <button class="btn btn-primary" @click="resolveConflict(props.tab.path, 'overwrite')">
        以我的内容覆盖
      </button>
    </template>
  </AppModal>
</template>

<style scoped>
.lead {
  margin: 0 0 12px;
  line-height: 1.7;
  color: var(--text-2);
}

.diff-hint {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
}

/* grid 子项必须允许收缩到 0，长代码行才会走 pre 内滚动而不是撑爆弹窗 */
.col {
  min-width: 0;
}

.col-head {
  font-size: 11px;
  color: var(--text-3);
  padding-bottom: 4px;
  border-bottom: 1px solid var(--divider);
  margin-bottom: 6px;
}

.col-head.mine {
  color: var(--accent);
}

pre {
  margin: 0;
  font-family: var(--font-mono);
  font-size: 11px;
  line-height: 1.6;
  background: var(--bg-app);
  border: 1px solid var(--divider);
  border-radius: var(--radius-sm);
  padding: 8px;
  overflow: auto;
  max-height: 180px;
  white-space: pre;
  word-break: normal;
  user-select: text;
}
</style>

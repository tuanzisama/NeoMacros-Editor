<script setup lang="ts">
/** 删除确认（§5.3）：红色警示 + 不可恢复说明。 */
import { ref, computed } from 'vue'
import { remove } from '@/stores/macros'
import { workspace, notify } from '@/stores/workspace'
import { editor, closeTab } from '@/stores/editor'
import AppModal from '@/components/ui/AppModal.vue'

const deleting = ref(false)
const serverError = ref('')

const target = computed(() => workspace.deleteTarget)

function close(): void {
  workspace.deleteTarget = null
}

async function doDelete(): Promise<void> {
  const macro = target.value
  if (!macro) return
  deleting.value = true
  serverError.value = ''
  try {
    await remove(macro.id)
    // 关闭该宏的所有已打开标签
    for (const tab of editor.tabs.filter((t) => t.macroId === macro.id)) {
      closeTab(tab.path)
    }
    notify(`已删除 ${macro.id}`, 'success')
    close()
  } catch (e) {
    serverError.value = e instanceof Error ? e.message : String(e)
  } finally {
    deleting.value = false
  }
}
</script>

<template>
  <AppModal title="删除宏" :width="440" @close="close">
    <p>
      确定删除宏 <b class="mono">{{ target?.id }}</b> 吗？
    </p>
    <p class="danger-line">
      将删除整个宏目录，包含清单与脚本，<b>不可恢复</b>。运行中的服务会被停止。
    </p>
    <p v-if="serverError" class="error-text">{{ serverError }}</p>
    <template #footer>
      <button class="btn btn-ghost" @click="close">取消</button>
      <button class="btn btn-danger" :disabled="deleting" @click="doDelete">
        {{ deleting ? '删除中…' : '删除' }}
      </button>
    </template>
  </AppModal>
</template>

<style scoped>
p {
  margin: 0 0 10px;
  line-height: 1.7;
}

.mono {
  font-family: var(--font-mono);
  font-size: 12px;
  color: var(--text-1);
}

.danger-line {
  color: var(--danger);
  background: rgba(255, 92, 92, 0.08);
  border: 1px solid rgba(255, 92, 92, 0.25);
  border-radius: var(--radius-sm);
  padding: 8px 10px;
}
</style>

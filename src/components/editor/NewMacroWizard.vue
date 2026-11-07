<script setup lang="ts">
/** 新建宏向导（§5.4）：名称实时校验 + 类型三选 + 可选描述 → 服务端脚手架 → 直达编辑器。 */
import { ref, computed } from 'vue'
import { createNew, validateName } from '@/stores/macros'
import { openMacro } from '@/stores/editor'
import { workspace, notify } from '@/stores/workspace'
import { MACRO_CATEGORIES, CATEGORY_LABELS } from '@/types/api'
import type { MacroCategory } from '@/types/api'
import AppModal from '@/components/ui/AppModal.vue'
import AppIcon from '@/components/ui/AppIcon.vue'

const TYPE_HINTS: Record<MacroCategory, string> = {
  keypress: '按键触发，可绑定键位',
  event: '订阅游戏事件自动执行',
  services: '常驻后台服务，可启停',
}

const name = ref('')
// 从分类侧栏打开时预设类型（仍可改）
const category = ref<MacroCategory>(workspace.presetCategory ?? 'keypress')
const description = ref('')
const submitting = ref(false)
const serverError = ref('')

const nameError = computed(() => validateName(name.value.trim()))

const canSubmit = computed(() => name.value.trim().length > 0 && !nameError.value && !submitting.value)

function close(): void {
  workspace.showNewMacro = false
}

async function submit(): Promise<void> {
  if (!canSubmit.value) return
  submitting.value = true
  serverError.value = ''
  try {
    const view = await createNew({
      category: category.value,
      name: name.value.trim(),
      description: description.value.trim() || undefined,
    })
    close()
    notify(`已创建 ${view.id}`, 'success')
    await openMacro(view)
  } catch (e) {
    serverError.value = e instanceof Error ? e.message : String(e)
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <AppModal title="新建宏" :width="480" @close="close">
    <div class="field">
      <label>名称</label>
      <input
        v-model="name"
        placeholder="如 shop-reporter"
        spellcheck="false"
        autofocus
        @keydown.enter="submit"
      />
      <span v-if="nameError" class="error-text">{{ nameError }}</span>
      <span v-else class="hint">字母、数字、下划线和连字符；跨分类唯一。将创建 &lt;分类&gt;/{{ name.trim() || '名称' }}/ 目录。</span>
    </div>

    <div class="field">
      <label>类型</label>
      <div class="type-grid">
        <button
          v-for="c in MACRO_CATEGORIES"
          :key="c"
          class="type-card"
          :class="{ selected: category === c }"
          type="button"
          @click="category = c"
        >
          <AppIcon :name="c === 'keypress' ? 'key' : c === 'event' ? 'bolt' : 'settings'" :size="16" />
          <span class="type-name">{{ CATEGORY_LABELS[c] }}宏</span>
          <span class="type-hint">{{ TYPE_HINTS[c] }}</span>
        </button>
      </div>
    </div>

    <div class="field">
      <label>描述（可选）</label>
      <input v-model="description" placeholder="一句话说明用途" @keydown.enter="submit" />
    </div>

    <p v-if="serverError" class="error-text">{{ serverError }}</p>

    <template #footer>
      <button class="btn btn-ghost" @click="close">取消</button>
      <button class="btn btn-primary" :disabled="!canSubmit" @click="submit">
        {{ submitting ? '创建中…' : '创建并编辑' }}
      </button>
    </template>
  </AppModal>
</template>

<style scoped>
.type-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 8px;
}

.type-card {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 4px;
  padding: 10px;
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  background: var(--bg-app);
  text-align: left;
  transition:
    border-color var(--dur) var(--ease),
    background var(--dur) var(--ease);
}

.type-card:hover {
  border-color: var(--border-strong);
}

.type-card.selected {
  border-color: var(--accent);
  background: var(--active);
}

.type-card svg {
  color: var(--accent);
}

.type-name {
  font-size: 13px;
  font-weight: 600;
}

.type-hint {
  font-size: 11px;
  color: var(--text-3);
  line-height: 1.5;
}
</style>

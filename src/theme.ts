/**
 * 主题解析与应用：dark / light / auto（跟随系统）。
 * initTheme() 在 main.ts 挂载前调用（配合 index.html 内联启蒙脚本避免首帧闪烁）。
 */

import { computed, ref, watchEffect } from 'vue'
import { settings } from '@/stores/settings'

const media = window.matchMedia('(prefers-color-scheme: dark)')
const prefersDark = ref(media.matches)

media.addEventListener('change', (e) => {
  prefersDark.value = e.matches
})

/** 最终生效主题（auto 已解析） */
export const resolvedTheme = computed<'dark' | 'light'>(() => {
  if (settings.theme === 'auto') return prefersDark.value ? 'dark' : 'light'
  return settings.theme
})

export function initTheme(): void {
  watchEffect(() => {
    document.documentElement.dataset.theme = resolvedTheme.value
  })
}

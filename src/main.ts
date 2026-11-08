import { createApp } from 'vue'
import '@/styles/base.css'
import App from './App.vue'
import { initTheme } from '@/theme'
import { router } from '@/router'

initTheme()
// app.use 先触发首次导航，落定（含守卫重定向）后再挂载，避免守卫闪烁
const app = createApp(App)
app.use(router)
void router.isReady().then(() => app.mount('#app'))

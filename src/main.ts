import { createApp } from 'vue'
import '@/styles/base.css'
import App from './App.vue'
import { initTheme } from '@/theme'

initTheme()
createApp(App).mount('#app')

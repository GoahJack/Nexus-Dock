import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@renderer/shared/theme.css'
import '@renderer/shared/ui.css'
import './settings.css'
import { SettingsApp } from './SettingsApp'

const container = document.getElementById('root')
if (!container) throw new Error('设置窗口缺少 #root 挂载点')

createRoot(container).render(
  <StrictMode>
    <SettingsApp />
  </StrictMode>
)

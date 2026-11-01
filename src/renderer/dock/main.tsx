import { createRoot } from 'react-dom/client'
import '../shared/theme.css'
import '../shared/ui.css'
import './dock.css'
import { Dock } from './Dock'
import { ErrorBoundary } from '../shared/ErrorBoundary'

const container = document.getElementById('root')
if (!container) throw new Error('[dock] 未找到 #root 容器')

// v1.5：渲染异常不再让 Dock 变成永久空白的透明窗
createRoot(container).render(
  <ErrorBoundary name="Dock">
    <Dock />
  </ErrorBoundary>
)

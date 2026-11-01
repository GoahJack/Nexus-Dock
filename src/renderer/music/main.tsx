import { createRoot } from 'react-dom/client'
import '../shared/theme.css'
import '../shared/ui.css'
import './music.css'
import { MusicCard } from './MusicCard'
import { ErrorBoundary } from '../shared/ErrorBoundary'

const container = document.getElementById('root')
if (container) {
  // v1.5：渲染异常不再让音乐卡片变成一块不可用的透明区域
  createRoot(container).render(
    <ErrorBoundary name="音乐卡片">
      <MusicCard />
    </ErrorBoundary>
  )
}

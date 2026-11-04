import { createRoot } from 'react-dom/client'
import '../shared/theme.css'
import '../shared/ui.css'
import './wordstudy.css'
import { WordStudyCard } from './WordStudyCard'
import { ErrorBoundary } from '../shared/ErrorBoundary'

const container = document.getElementById('root')
if (container) {
  // 渲染异常不再让透明卡片变成一块不可用的隐形区域（与 Dock / 音乐卡片一致）
  createRoot(container).render(
    <ErrorBoundary name="英语单词学习">
      <WordStudyCard />
    </ErrorBoundary>
  )
}

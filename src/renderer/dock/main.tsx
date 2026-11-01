import { createRoot } from 'react-dom/client'
import '../shared/theme.css'
import '../shared/ui.css'
import './dock.css'
import { Dock } from './Dock'

const container = document.getElementById('root')
if (!container) throw new Error('[dock] 未找到 #root 容器')

createRoot(container).render(<Dock />)

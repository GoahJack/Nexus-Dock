import { createRoot } from 'react-dom/client'
import '../shared/theme.css'
import '../shared/ui.css'
import './music.css'
import { MusicCard } from './MusicCard'

const container = document.getElementById('root')
if (container) {
  createRoot(container).render(<MusicCard />)
}

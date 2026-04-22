import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import PublicApp from './PublicApp'
import './styles.public.css'

const rootElement = document.getElementById('root')

if (rootElement === null) {
  throw new Error('Root element (#root) が見つかりません。')
}

createRoot(rootElement).render(
  <StrictMode>
    <BrowserRouter
      future={{
        v7_startTransition: true,
        v7_relativeSplatPath: true,
      }}
    >
      <PublicApp />
    </BrowserRouter>
  </StrictMode>,
)

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { bootstrapDevelopmentAccessJwt } from './api/client'
import App from './App'
import './styles.css'

const rootElement = document.getElementById('root')

if (rootElement === null) {
  throw new Error('Root element (#root) が見つかりません。')
}

async function bootstrapAndRender(): Promise<void> {
  try {
    await bootstrapDevelopmentAccessJwt()
  } catch (error) {
    console.error('開発用Access JWTの自動取得に失敗しました。', error)
  }

  createRoot(rootElement).render(
    <StrictMode>
      <BrowserRouter
        future={{
          v7_startTransition: true,
          v7_relativeSplatPath: true,
        }}
      >
        <App />
      </BrowserRouter>
    </StrictMode>,
  )
}

void bootstrapAndRender()

import { Link, Route, Routes } from 'react-router-dom'

function Home() {
  return (
    <main className="page">
      <h1>週末カメラ</h1>
      <p>React + DjangoRestFramework の新構成プロジェクトです。</p>
    </main>
  )
}

function NotFound() {
  return (
    <main className="page">
      <h1>404</h1>
      <p>ページが見つかりませんでした。</p>
      <Link to="/">トップへ戻る</Link>
    </main>
  )
}

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="*" element={<NotFound />} />
    </Routes>
  )
}

import { Link, Route, Routes } from 'react-router-dom'

function Home() {
  return (
    <main className="page">
      <h1>週末カメラ</h1>
      <p>
        ご覧いただきありがとうございます。
        <br />
        現在、週末カメラは新サイトへ移行作業中です。
        <br />
        ご不便をおかけしますが、再開まで今しばらくお待ちください。
        <br />
        再開は5月中を予定しています。
        <br />
        <br />
        お問い合わせは以下のメールアドレスより受け付けております。
        <br />
        <br />
        syumatsu.camera[*]gmail.com
        <br />
        <br />
        *を@に置き換えてください。
      </p>
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

import { Route, Routes } from 'react-router-dom'
import {
  PublicArticleDetailPage,
  PublicCategoryArticlesPage,
  PublicContactPage,
  PublicHomePage,
  PublicLayout,
  PublicNewestArticlesPage,
  PublicNotFoundPage,
  PublicPopularArticlesPage,
  PublicSearchPage,
  PublicServerErrorPage,
  PublicTagArticlesPage,
} from './features/public/PublicPages'

export default function PublicApp() {
  return (
    <Routes>
      <Route element={<PublicLayout />}>
        <Route path="/" element={<PublicHomePage />} />
        <Route path="/articles/new" element={<PublicNewestArticlesPage />} />
        <Route path="/articles/popular" element={<PublicPopularArticlesPage />} />
        <Route
          path="/articles/:categorySlug/:articleSlug"
          element={<PublicArticleDetailPage />}
        />
        <Route path="/category/:categorySlug" element={<PublicCategoryArticlesPage />} />
        <Route path="/tag/:tagSlug" element={<PublicTagArticlesPage />} />
        <Route path="/search" element={<PublicSearchPage />} />
        <Route path="/contact" element={<PublicContactPage />} />
        <Route path="/error/404" element={<PublicNotFoundPage />} />
        <Route path="/error/500" element={<PublicServerErrorPage />} />
        <Route path="*" element={<PublicNotFoundPage />} />
      </Route>
    </Routes>
  )
}

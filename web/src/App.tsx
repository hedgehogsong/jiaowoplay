import { Route, Routes } from 'react-router-dom';
import SiteFooter from './components/SiteFooter.js';
import RequireAdmin from './components/admin/RequireAdmin.js';
import GameLobbyPage from './pages/GameLobbyPage.js';
import NotFoundPage from './pages/NotFoundPage.js';
import PlatformHomePage from './pages/PlatformHomePage.js';
import RoomPage from './pages/RoomPage.js';
import AdminGamePage from './pages/admin/AdminGamePage.js';
import AdminHomePage from './pages/admin/AdminHomePage.js';

export default function App() {
  return (
    <div className="app-shell">
      <Routes>
        <Route path="/" element={<PlatformHomePage />} />
        {/* 游戏大厅由 games/registry.ts 驱动：加一款游戏只需在注册表里加一条 */}
        <Route path="/play/:slug" element={<GameLobbyPage />} />
        <Route path="/room/:code" element={<RoomPage />} />
        {/* 后台路由统一由 RequireAdmin 守卫：本地无 Token 直接退回首页 */}
        <Route
          path="/admin"
          element={
            <RequireAdmin>
              <AdminHomePage />
            </RequireAdmin>
          }
        />
        <Route
          path="/admin/game/:slug"
          element={
            <RequireAdmin>
              <AdminGamePage />
            </RequireAdmin>
          }
        />
        <Route path="*" element={<NotFoundPage />} />
      </Routes>
      <SiteFooter />
    </div>
  );
}

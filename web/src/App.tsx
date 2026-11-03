import { Route, Routes } from 'react-router-dom';
import SiteFooter from './components/SiteFooter.js';
import GameLobbyPage from './pages/GameLobbyPage.js';
import NotFoundPage from './pages/NotFoundPage.js';
import PlatformHomePage from './pages/PlatformHomePage.js';
import RoomPage from './pages/RoomPage.js';

export default function App() {
  return (
    <div className="app-shell">
      <Routes>
        <Route path="/" element={<PlatformHomePage />} />
        {/* 游戏大厅由 games/registry.ts 驱动：加一款游戏只需在注册表里加一条 */}
        <Route path="/play/:slug" element={<GameLobbyPage />} />
        <Route path="/room/:code" element={<RoomPage />} />
        <Route path="*" element={<NotFoundPage />} />
      </Routes>
      <SiteFooter />
    </div>
  );
}

import { Route, Routes } from 'react-router-dom';
import HomePage from './pages/HomePage.js';
import NotFoundPage from './pages/NotFoundPage.js';
import RoomPage from './pages/RoomPage.js';

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<HomePage />} />
      <Route path="/room/:code" element={<RoomPage />} />
      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  );
}

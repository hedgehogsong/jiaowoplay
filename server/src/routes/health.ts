import { Router } from 'express';
import type { RoomManager } from '../rooms/RoomManager.js';

export function createHealthRouter(manager: RoomManager, dbReady: boolean): Router {
  const router = Router();

  router.get('/', (_req, res) => {
    const stats = manager.stats();
    res.json({
      status: 'ok',
      database: dbReady ? 'ok' : 'unavailable',
      uptimeSeconds: Math.round(process.uptime()),
      rooms: stats.rooms,
      players: stats.players,
      roomsPlaying: stats.playing,
      timestamp: Date.now(),
    });
  });

  return router;
}

import type { Server } from 'socket.io';
import type { ClientToServerEvents, ServerToClientEvents } from '@jiaowoplay/shared';
import { projectRoomState } from '../rooms/projection.js';
import type { GameRoom, RoomNotifier, ServerEvent } from '../rooms/Room.js';

interface SocketData {
  playerId?: string;
}

type TypedServer = Server<ClientToServerEvents, ServerToClientEvents>;

/** 把房间内部事件翻译成 Socket.IO 广播，并对每个观察者做视角裁剪 */
export function createNotifierFor(io: TypedServer, room: GameRoom): RoomNotifier {
  const roomName = room.code;

  const socketsInRoom = (): string[] => {
    const entry = io.sockets.adapter.rooms.get(roomName);
    return entry ? [...entry] : [];
  };

  return {
    broadcastState(): void {
      for (const socketId of socketsInRoom()) {
        const socket = io.sockets.sockets.get(socketId);
        if (!socket) continue;
        const playerId = (socket.data as SocketData).playerId ?? null;
        socket.emit('roomState', projectRoomState(room, playerId));
      }
    },
    broadcast<E extends ServerEvent>(event: E, ...args: Parameters<ServerToClientEvents[E]>): void {
      const target = io.to(roomName) as unknown as {
        emit: (name: string, ...data: unknown[]) => void;
      };
      target.emit(event as string, ...args);
    },
    sendToPlayer<E extends ServerEvent>(
      playerId: string,
      event: E,
      ...args: Parameters<ServerToClientEvents[E]>
    ): void {
      for (const socketId of socketsInRoom()) {
        const socket = io.sockets.sockets.get(socketId);
        if ((socket?.data as SocketData | undefined)?.playerId !== playerId) continue;
        const target = socket as unknown as { emit: (name: string, ...data: unknown[]) => void };
        target.emit(event as string, ...args);
      }
    },
  };
}

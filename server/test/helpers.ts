import type { RoomSettings } from '@jiaowoplay/shared';
import { GameRoom, type RoomNotifier, type ServerEvent } from '../src/rooms/Room.js';
import type { Player, RoomData } from '../src/domain/types.js';
import { sameWordGame } from '../src/games/sameword/index.js';
import { newId } from '../src/domain/ids.js';

export interface RecordedEvent {
  kind: 'broadcast' | 'state' | 'send';
  event?: ServerEvent;
  payload?: unknown;
  playerId?: string;
}

export function createFakeNotifier(log: RecordedEvent[]): RoomNotifier {
  return {
    broadcastState() {
      log.push({ kind: 'state' });
    },
    broadcast(event, payload) {
      log.push({ kind: 'broadcast', event, payload });
    },
    sendToPlayer(playerId, event, payload) {
      log.push({ kind: 'send', playerId, event, payload });
    },
  };
}

export function makePlayer(
  roomId: string,
  nickname: string,
  isHost: boolean,
  joinedAt: number,
): Player {
  return {
    id: newId('pl'),
    roomId,
    nickname,
    reconnectToken: `token-${nickname}-${joinedAt}`,
    isHost,
    isOnline: true,
    isActive: false,
    socketId: null,
    joinedAt,
    lastSeenAt: joinedAt,
    offlineSince: null,
  };
}

export interface TestRoomOptions {
  nicknames?: string[];
  settings?: Partial<RoomSettings>;
}

export interface TestRoom {
  room: GameRoom;
  events: RecordedEvent[];
  players: Player[];
  host: Player;
  byNickname: (nickname: string) => Player;
  eventsOf: (event: ServerEvent) => RecordedEvent[];
}

export function createTestRoom(options: TestRoomOptions = {}): TestRoom {
  const nicknames = options.nicknames ?? ['甲', '乙'];
  const now = Date.now();
  const data: RoomData = {
    id: newId('rm'),
    code: 'TEST01',
    hostPlayerId: '',
    status: 'WAITING',
    gameType: 'sameword',
    settings: {
      ...sameWordGame.defaultSettings(),
      ...options.settings,
    },
    createdAt: now,
    lastActivityAt: now,
    emptySince: null,
    players: new Map(),
    session: null,
  };

  const events: RecordedEvent[] = [];
  const room = new GameRoom(data, {
    game: sameWordGame,
    history: null,
    notifier: createFakeNotifier(events),
  });

  const players: Player[] = [];
  nicknames.forEach((nickname, index) => {
    const player = makePlayer(data.id, nickname, index === 0, now + index);
    if (index === 0) data.hostPlayerId = player.id;
    players.push(player);
    room.addPlayer(player);
  });

  const host = players[0];
  if (!host) throw new Error('测试房间至少需要一名玩家');

  return {
    room,
    events,
    players,
    host,
    byNickname: (nickname: string) => {
      const found = players.find((player) => player.nickname === nickname);
      if (!found) throw new Error(`未找到测试玩家：${nickname}`);
      return found;
    },
    eventsOf: (event: ServerEvent) => events.filter((item) => item.event === event),
  };
}

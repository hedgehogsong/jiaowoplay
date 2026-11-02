import type { GameType } from '@jiaowoplay/shared';
import { AppError, ErrorCode } from '../domain/errors.js';
import type { GameDefinition } from './Game.js';
import { sameWordGame } from './sameword/index.js';

const registry = new Map<GameType, GameDefinition>();

export function registerGame(game: GameDefinition): void {
  registry.set(game.type, game);
}

export function getGame(type: GameType): GameDefinition {
  const game = registry.get(type);
  if (!game) {
    throw new AppError(ErrorCode.INVALID_PAYLOAD, `未注册的游戏类型：${type}`);
  }
  return game;
}

export function listGames(): { type: GameType; label: string; description: string; minPlayers: number; maxPlayers: number }[] {
  return [...registry.values()].map((game) => ({
    type: game.type,
    label: game.label,
    description: game.description,
    minPlayers: game.minPlayers,
    maxPlayers: game.maxPlayers,
  }));
}

registerGame(sameWordGame);

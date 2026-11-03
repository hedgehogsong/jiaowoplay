import type { ComponentType } from 'react';
import type { GameType, RoomStateView } from '@jiaowoplay/shared';
import SameWordPanel from '../components/games/sameword/GamePanel.js';

/**
 * 房间页下发给具体游戏面板的统一契约。
 * 新游戏如果交互形态不同（选牌、答题等），在这里扩展入参即可，
 * RoomPage 不需要知道任何具体游戏的细节。
 */
export interface GamePanelProps {
  room: RoomStateView;
  selfId: string | null;
  serverOffset: number;
  busy: boolean;
  title: string;
  onSubmit: (value: string) => Promise<void>;
}

export interface GameEntry {
  /** URL 片段：/play/<slug> */
  slug: string;
  /** 与后端协议、房间数据里的 gameType 对应 */
  gameType: GameType;
  name: string;
  /** 卡片上的单字标识 */
  mark: string;
  tagline: string;
  summary: string;
  rules: string[];
  players: string;
  duration: string;
  accent: string;
  panel: ComponentType<GamePanelProps>;
}

/** 新增游戏：在这里加一条，并在 App.tsx 之外不需要改任何路由代码。 */
export const GAMES: GameEntry[] = [
  {
    slug: 'same-word',
    gameType: 'sameword',
    name: '同词相『交』',
    mark: '同',
    tagline: '各自写一个词，全员撞上同一个词就算相遇成功',
    summary:
      '每轮所有人各自提交一个词，提交前互相看不到，全员提交后统一揭晓。' +
      '第一轮自由输入，之后你的词还要能同时关联上一轮揭晓的所有词。',
    rules: [
      '房主开局后，房间内所有在线玩家进入第一轮。',
      '每轮每人提交一个词，提交前看不到别人的，全员提交后统一揭晓。',
      '第一轮自由输入；之后你的词要同时关联上一轮揭晓的所有词。',
      '所有人写出完全相同的词（去首尾空格后比较）即全员相遇，本局胜利。',
      '只有部分人同词时不算胜利，但会记录「局部相遇」并进入下一轮。',
      '超时未提交视为弃权；可判定人数不足 2 人或轮次用尽则平局。',
    ],
    players: '2-8 人一局',
    duration: '每轮 120 秒',
    accent: '#7c6cff',
    panel: SameWordPanel,
  },
];

export function gamePath(entry: GameEntry): string {
  return `/play/${entry.slug}`;
}

export function findGameBySlug(slug: string | undefined): GameEntry | null {
  if (!slug) return null;
  const wanted = slug.trim().toLowerCase();
  return GAMES.find((entry) => entry.slug.toLowerCase() === wanted) ?? null;
}

export function findGameByType(gameType: GameType | string | undefined): GameEntry | null {
  if (!gameType) return null;
  return GAMES.find((entry) => entry.gameType === gameType) ?? null;
}

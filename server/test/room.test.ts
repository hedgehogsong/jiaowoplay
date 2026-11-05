import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppError } from '../src/domain/errors.js';
import { defaultSettings } from '../src/domain/validation.js';
import { projectRoomState } from '../src/rooms/projection.js';
import {
  DEFAULT_REVEAL_DURATION_MS,
  EMPTY_ROOM_TTL_MS,
  HOST_OFFLINE_GRACE_MS,
  PLAYER_OFFLINE_GRACE_MS,
} from '@jiaowoplay/shared';
import {
  createTestRoom,
  makePlayer,
  recordingHistory,
  type AbandonCall,
  type TestRoom,
} from './helpers.js';

const FAST_SETTINGS = {
  maxRounds: 3,
  submitTimeoutMs: 5_000,
  revealDurationMs: 1_000,
  winMode: 'ALL_SAME' as const,
};

/** 断言调用抛出指定 code 的 AppError */
function expectErrorCode(run: () => unknown, code: string): void {
  try {
    run();
  } catch (error) {
    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).code).toBe(code);
    return;
  }
  throw new Error(`期望抛出 ${code}，但调用没有失败`);
}

function lastRoundOf(ctx: TestRoom) {
  const session = ctx.room.data.session;
  if (!session) throw new Error('缺少对局');
  const round = session.rounds[session.rounds.length - 1];
  if (!round) throw new Error('缺少轮次');
  return round;
}

let ctx: TestRoom;

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  ctx?.room.dispose();
  vi.useRealTimers();
});

describe('开局校验', () => {
  it('非房主不能开始游戏', () => {
    ctx = createTestRoom({ nicknames: ['房主', '路人'] });
    const guest = ctx.byNickname('路人');
    expectErrorCode(() => ctx.room.startGame(guest.id), 'NOT_HOST');
  });

  it('在线人数不足 2 人不能开始', () => {
    ctx = createTestRoom({ nicknames: ['孤单'] });
    expect(() => ctx.room.startGame(ctx.host.id)).toThrowError(/至少需要 2 名在线玩家/);
  });

  it('离线玩家不计入可开始人数', () => {
    ctx = createTestRoom({ nicknames: ['房主', '掉线'] });
    ctx.room.setOnline(ctx.byNickname('掉线').id, false, null);
    expect(() => ctx.room.startGame(ctx.host.id)).toThrowError(/至少需要 2 名在线玩家/);
  });

  it('开局后所有在线玩家进入活跃名单', () => {
    ctx = createTestRoom({ nicknames: ['房主', '乙', '丙'] });
    ctx.room.startGame(ctx.host.id);
    expect(ctx.room.data.status).toBe('PLAYING');
    expect(ctx.room.data.session?.activePlayerIds.size).toBe(3);
    expect(ctx.room.data.session?.currentRound).toBe(1);
  });

  it('开局后加入的玩家不参与当前对局', () => {
    ctx = createTestRoom({ nicknames: ['房主', '乙'] });
    ctx.room.startGame(ctx.host.id);

    const latecomer = makePlayer(ctx.room.data.id, '丙', false, Date.now() + 10);
    ctx.room.addPlayer(latecomer);

    expect(ctx.room.data.session?.activePlayerIds.has(latecomer.id)).toBe(false);
    expect(latecomer.isActive).toBe(false);
    expect(projectRoomState(ctx.room, latecomer.id).players.find((p) => p.nickname === '丙'))
      .toMatchObject({ isActive: false });
  });
});

describe('提交与揭晓', () => {
  beforeEach(() => {
    ctx = createTestRoom({ nicknames: ['房主', '乙'], settings: FAST_SETTINGS });
    ctx.room.startGame(ctx.host.id);
  });

  it('提交后广播已提交人数但不泄露词', () => {
    ctx.room.submitWord(ctx.host.id, '月亮');
    const accepted = ctx.eventsOf('submissionAccepted');
    expect(accepted).toHaveLength(1);
    expect(accepted[0]?.payload).toMatchObject({ submittedCount: 1, activeCount: 2 });
    expect(JSON.stringify(accepted[0]?.payload)).not.toContain('月亮');

    const state = projectRoomState(ctx.room, ctx.byNickname('乙').id);
    const round = state.game?.rounds[0];
    expect(round?.submissions).toBeNull();
    expect(state.players.find((p) => p.nickname === '房主')?.hasSubmitted).toBe(true);
  });

  it('重复提交被拒绝', () => {
    ctx.room.submitWord(ctx.host.id, '月亮');
    expectErrorCode(() => ctx.room.submitWord(ctx.host.id, '太阳'), 'ALREADY_SUBMITTED');
  });

  it('非活跃玩家不能提交', () => {
    ctx.room.dispose();
    ctx = createTestRoom({ nicknames: ['房主', '乙', '丙'], settings: FAST_SETTINGS });
    ctx.room.startGame(ctx.host.id);
    ctx.room.removePlayer(ctx.byNickname('丙').id, 'left');

    const joiner = makePlayer(ctx.room.data.id, '丁', false, Date.now() + 10);
    ctx.room.addPlayer(joiner);

    expect(ctx.room.data.status).toBe('PLAYING');
    expectErrorCode(() => ctx.room.submitWord(joiner.id, '星星'), 'NOT_ACTIVE_PLAYER');
  });

  it('全员提交后立即揭晓，并在展示时长后进入下一轮', () => {
    ctx.room.submitWord(ctx.host.id, '月亮');
    ctx.room.submitWord(ctx.byNickname('乙').id, '太阳');

    const round = lastRoundOf(ctx);
    expect(round.status).toBe('REVEALED');
    expect(round.allSame).toBe(false);
    expect(ctx.room.data.session?.phase).toBe('ROUND_REVEAL');
    expect(ctx.eventsOf('roundRevealed')).toHaveLength(1);

    vi.advanceTimersByTime(FAST_SETTINGS.revealDurationMs);

    expect(ctx.room.data.session?.currentRound).toBe(2);
    const started = ctx.eventsOf('roundStarted').at(-1);
    expect(started?.payload).toMatchObject({ roundNumber: 2, previousWords: ['月亮', '太阳'] });
  });

  it('超时未提交者标记弃权', () => {
    ctx.room.submitWord(ctx.host.id, '月亮');
    vi.advanceTimersByTime(FAST_SETTINGS.submitTimeoutMs);

    const round = lastRoundOf(ctx);
    expect(round.status).toBe('REVEALED');
    const abstained = round.submissions.get(ctx.byNickname('乙').id);
    expect(abstained?.isTimeout).toBe(true);
    expect(abstained?.word).toBeNull();
  });

  it('两人同词即结束并给出胜者与总轮次', () => {
    ctx.room.submitWord(ctx.host.id, '  月亮  ');
    ctx.room.submitWord(ctx.byNickname('乙').id, '月亮');

    expect(lastRoundOf(ctx).allSame).toBe(true);
    expect(ctx.room.data.status).toBe('PLAYING');

    vi.advanceTimersByTime(FAST_SETTINGS.revealDurationMs);

    expect(ctx.room.data.status).toBe('ENDED');
    expect(ctx.room.data.session?.outcome).toBe('ALL_MET');
    expect(ctx.room.data.session?.winnerPlayerIds).toHaveLength(2);
    const ended = ctx.eventsOf('gameEnded').at(-1);
    expect(ended?.payload).toMatchObject({ outcome: 'ALL_MET', totalRounds: 1 });
  });

  it('多人局部同词不结束但记录局部相遇', () => {
    ctx.room.dispose();
    ctx = createTestRoom({ nicknames: ['房主', '乙', '丙'], settings: FAST_SETTINGS });
    ctx.room.startGame(ctx.host.id);
    ctx.room.submitWord(ctx.host.id, '猫');
    ctx.room.submitWord(ctx.byNickname('乙').id, '猫');
    ctx.room.submitWord(ctx.byNickname('丙').id, '狗');

    const round = lastRoundOf(ctx);
    expect(round.allSame).toBe(false);
    expect(round.partialMeetings).toHaveLength(1);
    expect(round.partialMeetings[0]?.nicknames).toEqual(['房主', '乙']);

    vi.advanceTimersByTime(FAST_SETTINGS.revealDurationMs);
    expect(ctx.room.data.status).toBe('PLAYING');
    expect(ctx.room.data.session?.currentRound).toBe(2);
  });

  it('可判定人数不足时本局以人数不足结束', () => {
    ctx.room.submitWord(ctx.host.id, '月亮');
    vi.advanceTimersByTime(FAST_SETTINGS.submitTimeoutMs);
    vi.advanceTimersByTime(FAST_SETTINGS.revealDurationMs);

    expect(ctx.room.data.status).toBe('ENDED');
    expect(ctx.room.data.session?.outcome).toBe('INSUFFICIENT_PLAYERS');
  });

  it('达到轮次上限仍无人同词则平局', () => {
    const words = ['甲词', '乙词', '丙词'];
    words.forEach((_, index) => {
      ctx.room.submitWord(ctx.host.id, `词${index}-A`);
      ctx.room.submitWord(ctx.byNickname('乙').id, `词${index}-B`);
      vi.advanceTimersByTime(FAST_SETTINGS.revealDurationMs);
    });

    expect(ctx.room.data.session?.currentRound).toBe(3);
    expect(ctx.room.data.status).toBe('ENDED');
    expect(ctx.room.data.session?.outcome).toBe('ROUND_LIMIT');
  });

  it('房主可强制结束本局', () => {
    ctx.room.submitWord(ctx.host.id, '月亮');
    ctx.room.forceEndGame(ctx.host.id);
    expect(ctx.room.data.status).toBe('ENDED');
    expect(ctx.room.data.session?.outcome).toBe('HOST_ENDED');
  });

  it('房主可手动跳过揭晓等待进入下一轮', () => {
    ctx.room.submitWord(ctx.host.id, '月亮');
    ctx.room.submitWord(ctx.byNickname('乙').id, '太阳');
    const result = ctx.room.nextRound(ctx.host.id);
    expect(result.roundNumber).toBe(2);
    expect(lastRoundOf(ctx).previousWords).toEqual(['月亮', '太阳']);
  });
});

describe('再来一局', () => {
  it('保留成员并重置轮次', () => {
    ctx = createTestRoom({ nicknames: ['房主', '乙'], settings: FAST_SETTINGS });
    ctx.room.startGame(ctx.host.id);
    ctx.room.submitWord(ctx.host.id, '月亮');
    ctx.room.submitWord(ctx.byNickname('乙').id, '月亮');
    vi.advanceTimersByTime(FAST_SETTINGS.revealDurationMs);
    expect(ctx.room.data.session?.outcome).toBe('ALL_MET');

    const before = ctx.room.data.players.size;
    const previousSessionId = ctx.room.data.session?.id;
    const restarted = ctx.room.restartGame(ctx.host.id);

    expect(ctx.room.data.players.size).toBe(before);
    expect(ctx.room.data.status).toBe('PLAYING');
    expect(restarted.sessionId).not.toBe(previousSessionId);
    expect(ctx.room.data.session?.id).toBe(restarted.sessionId);
    expect(ctx.room.data.session?.currentRound).toBe(1);
    expect(ctx.room.data.session?.rounds).toHaveLength(1);
    expect(ctx.room.data.session?.outcome).toBeNull();
  });

  it('进行中来一局会先按房主结束处理', () => {
    ctx = createTestRoom({ nicknames: ['房主', '乙'], settings: FAST_SETTINGS });
    ctx.room.startGame(ctx.host.id);
    ctx.room.restartGame(ctx.host.id);
    expect(ctx.room.data.status).toBe('PLAYING');
    expect(ctx.room.data.session?.currentRound).toBe(1);
  });
});

describe('离开与房主转移', () => {
  it('房主离开后转移给最早加入且在线的成员', () => {
    ctx = createTestRoom({ nicknames: ['房主', '乙', '丙'] });
    const yi = ctx.byNickname('乙');
    ctx.room.removePlayer(ctx.host.id, 'left');
    expect(ctx.room.data.hostPlayerId).toBe(yi.id);
    expect(ctx.room.getPlayer(yi.id)?.isHost).toBe(true);
    expect(ctx.eventsOf('hostTransferred').at(-1)?.payload).toMatchObject({
      nickname: '乙',
    });
  });

  it('房主掉线超过宽限期后转移', () => {
    ctx = createTestRoom({ nicknames: ['房主', '乙'] });
    const yi = ctx.byNickname('乙');
    ctx.room.setOnline(ctx.host.id, false, null);
    ctx.room.sweep(Date.now() + HOST_OFFLINE_GRACE_MS - 1);
    expect(ctx.room.data.hostPlayerId).toBe(ctx.host.id);
    ctx.room.sweep(Date.now() + HOST_OFFLINE_GRACE_MS + 1);
    expect(ctx.room.data.hostPlayerId).toBe(yi.id);
  });

  it('活跃玩家中途离开会让对局因人数不足结束', () => {
    ctx = createTestRoom({ nicknames: ['房主', '乙'], settings: FAST_SETTINGS });
    ctx.room.startGame(ctx.host.id);
    ctx.room.removePlayer(ctx.byNickname('乙').id, 'left');
    expect(ctx.room.data.status).toBe('ENDED');
    expect(ctx.room.data.session?.outcome).toBe('INSUFFICIENT_PLAYERS');
  });

  it('离开会撤回其本轮未揭晓的提交', () => {
    ctx = createTestRoom({ nicknames: ['房主', '乙', '丙'], settings: FAST_SETTINGS });
    ctx.room.startGame(ctx.host.id);
    ctx.room.submitWord(ctx.byNickname('丙').id, '苹果');
    ctx.room.removePlayer(ctx.byNickname('丙').id, 'left');
    expect(lastRoundOf(ctx).submissions.has(ctx.byNickname('丙').id)).toBe(false);
  });

  it('房间内昵称必须唯一', () => {
    ctx = createTestRoom({ nicknames: ['房主', '乙'] });
    expect(() => ctx.room.renamePlayer(ctx.byNickname('乙').id, '房主')).toThrowError(
      /已有玩家使用该昵称/,
    );
  });
});

describe('房间回收', () => {
  it('空房间超过保留期后被回收', () => {
    ctx = createTestRoom({ nicknames: ['房主', '乙'] });
    ctx.room.removePlayer(ctx.host.id, 'left');
    ctx.room.removePlayer(ctx.byNickname('乙').id, 'left');
    const now = Date.now();
    expect(ctx.room.sweep(now + EMPTY_ROOM_TTL_MS - 1)).toBe(false);
    expect(ctx.room.sweep(now + EMPTY_ROOM_TTL_MS + 1)).toBe(true);
  });

  it('全员掉线超过宽限期后被回收', () => {
    ctx = createTestRoom({ nicknames: ['房主', '乙'] });
    ctx.room.setOnline(ctx.host.id, false, null);
    ctx.room.setOnline(ctx.byNickname('乙').id, false, null);
    const now = Date.now();
    expect(ctx.room.sweep(now + PLAYER_OFFLINE_GRACE_MS - 1)).toBe(false);
    expect(ctx.room.sweep(now + PLAYER_OFFLINE_GRACE_MS + 1)).toBe(true);
  });

  it('仍有在线成员时不回收', () => {
    ctx = createTestRoom({ nicknames: ['房主', '乙'] });
    ctx.room.setOnline(ctx.byNickname('乙').id, false, null);
    expect(ctx.room.sweep(Date.now() + PLAYER_OFFLINE_GRACE_MS * 2)).toBe(false);
  });
});

describe('开发者标识', () => {
  it('昵称命中开发者名单时，投影与加入广播都带 isDeveloper', () => {
    ctx = createTestRoom({ nicknames: ['hedgehogsong', '乙'] });
    const dev = ctx.byNickname('hedgehogsong');

    const state = projectRoomState(ctx.room, dev.id);
    expect(state.players.find((player) => player.id === dev.id)?.isDeveloper).toBe(true);
    expect(state.players.find((player) => player.nickname === '乙')?.isDeveloper).toBe(false);

    const joined = ctx.eventsOf('playerJoined')[0];
    const payload = joined?.payload as { player: { nickname: string; isDeveloper: boolean } };
    expect(payload.player.isDeveloper).toBe(true);
  });

  it('大小写不同同样识别，与房间内昵称唯一性判定一致', () => {
    ctx = createTestRoom({ nicknames: ['HedgehogSong'] });
    expect(projectRoomState(ctx.room, ctx.host.id).players[0]?.isDeveloper).toBe(true);
  });

  it('普通玩家不会被误标', () => {
    ctx = createTestRoom({ nicknames: ['普通玩家甲'] });
    expect(projectRoomState(ctx.room, ctx.host.id).players[0]?.isDeveloper).toBe(false);
  });
});

describe('揭晓展示时长', () => {
  it('默认配置就是 5 秒', () => {
    expect(defaultSettings().revealDurationMs).toBe(DEFAULT_REVEAL_DURATION_MS);
    expect(DEFAULT_REVEAL_DURATION_MS).toBe(5_000);
  });

  it('揭晓后满 5 秒自动进入下一轮，第 4.999 秒仍在当前轮', () => {
    ctx = createTestRoom({ nicknames: ['甲一', '乙二'] });
    ctx.room.startGame(ctx.host.id);
    ctx.room.submitWord(ctx.host.id, '月亮');
    ctx.room.submitWord(ctx.byNickname('乙二').id, '太阳');

    expect(ctx.room.data.session?.currentRound).toBe(1);
    vi.advanceTimersByTime(DEFAULT_REVEAL_DURATION_MS - 1);
    expect(ctx.room.data.session?.currentRound).toBe(1);
    vi.advanceTimersByTime(2);
    expect(ctx.room.data.session?.currentRound).toBe(2);
  });
});

describe('房间销毁的流局收尾', () => {
  it('dispose 把未结束的对局标记为流局并写库', () => {
    const calls: AbandonCall[] = [];
    ctx = createTestRoom({ nicknames: ['房主大人', '路人甲'], history: recordingHistory(calls) });
    ctx.room.startGame(ctx.host.id);
    const session = ctx.room.data.session;
    if (!session) throw new Error('缺少对局');

    ctx.room.dispose();

    expect(calls).toEqual([{ id: session.id, currentRound: 1, reason: 'room_reclaimed' }]);
    expect(session.outcome).toBe('ABANDONED');
    expect(session.phase).toBe('FINISHED');
    expect(session.endedAt).not.toBeNull();
    expect(session.winnerPlayerIds).toEqual([]);
    expect(session.rounds[0]?.status).toBe('ABANDONED');
    expect(ctx.room.data.status).toBe('ENDED');
    expect(ctx.players.every((player) => !player.isActive)).toBe(true);
  });

  it('已经判定胜负的对局不会被 dispose 覆盖', () => {
    const calls: AbandonCall[] = [];
    ctx = createTestRoom({ nicknames: ['房主大人', '路人甲'], history: recordingHistory(calls) });
    ctx.room.startGame(ctx.host.id);
    ctx.room.forceEndGame(ctx.host.id);

    ctx.room.dispose();

    expect(calls).toEqual([]);
    expect(ctx.room.data.session?.outcome).toBe('HOST_ENDED');
  });

  it('重复 dispose 只收尾一次', () => {
    const calls: AbandonCall[] = [];
    ctx = createTestRoom({ nicknames: ['房主大人', '路人甲'], history: recordingHistory(calls) });
    ctx.room.startGame(ctx.host.id);

    ctx.room.dispose();
    ctx.room.dispose();

    expect(calls).toHaveLength(1);
  });

  it('没有历史库时 dispose 只改内存不抛错', () => {
    ctx = createTestRoom({ nicknames: ['房主大人', '路人甲'] });
    ctx.room.startGame(ctx.host.id);

    expect(() => ctx.room.dispose()).not.toThrow();
    expect(ctx.room.data.session?.outcome).toBe('ABANDONED');
  });
});

describe('房主转移不刷屏', () => {
  it('全员离线时反复巡检不会重复转移给同一个人', () => {
    ctx = createTestRoom({ nicknames: ['房主大人', '路人甲'] });
    for (const player of ctx.players) ctx.room.setOnline(player.id, false, null);
    const before = ctx.eventsOf('hostTransferred').length;

    // 30 秒宽限过后，回收还要等满 90 秒；这段窗口内每 5 秒巡检一次
    vi.advanceTimersByTime(HOST_OFFLINE_GRACE_MS);
    const now = Date.now();
    for (let i = 0; i < 6; i += 1) expect(ctx.room.sweep(now + i * 5_000)).toBe(false);

    expect(ctx.eventsOf('hostTransferred')).toHaveLength(before);
    expect(ctx.host.isHost).toBe(true);
    expect(ctx.room.data.hostPlayerId).toBe(ctx.host.id);
  });

  it('房主离开房间后仍然正常转移并广播一次', () => {
    ctx = createTestRoom({ nicknames: ['房主大人', '路人甲'] });
    ctx.room.removePlayer(ctx.host.id, 'left');

    expect(ctx.eventsOf('hostTransferred')).toHaveLength(1);
    expect(ctx.byNickname('路人甲').isHost).toBe(true);
  });

  it('房主标志漂移时静默校正，不广播', () => {
    ctx = createTestRoom({ nicknames: ['房主大人', '路人甲'] });
    ctx.host.isHost = false;
    for (const player of ctx.players) ctx.room.setOnline(player.id, false, null);

    vi.advanceTimersByTime(HOST_OFFLINE_GRACE_MS);
    ctx.room.sweep(Date.now());

    expect(ctx.eventsOf('hostTransferred')).toHaveLength(0);
    expect(ctx.host.isHost).toBe(true);
  });
});

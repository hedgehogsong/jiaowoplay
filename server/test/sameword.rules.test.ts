import { describe, expect, it } from 'vitest';
import {
  collectPreviousWords,
  evaluateAfterRound,
  groupByWord,
  judgeRound,
  normalizeWordForJudgement,
} from '../src/games/sameword/rules.js';
import type { RoundSubmissionInput } from '../src/games/Game.js';
import { defaultSettings } from '../src/domain/validation.js';

function sub(
  playerId: string,
  word: string | null,
  options: { isTimeout?: boolean; nickname?: string } = {},
): RoundSubmissionInput {
  return {
    playerId,
    nickname: options.nickname ?? `玩家${playerId}`,
    word,
    isTimeout: options.isTimeout ?? false,
  };
}

describe('normalizeWordForJudgement', () => {
  it('只去首尾空格，保留词内空格', () => {
    expect(normalizeWordForJudgement('  苹果 树  ')).toBe('苹果 树');
  });
});

describe('judgeRound', () => {
  it('两人同词判定为全员相遇', () => {
    const judgement = judgeRound([sub('p1', '月亮'), sub('p2', '月亮')]);
    expect(judgement.eligibleCount).toBe(2);
    expect(judgement.allSame).toBe(true);
    expect(judgement.partialMeetings).toEqual([]);
  });

  it('比较前去除首尾空格', () => {
    const judgement = judgeRound([sub('p1', '  月亮'), sub('p2', '月亮  ')]);
    expect(judgement.allSame).toBe(true);
  });

  it('多人全员同词判定为胜利', () => {
    const judgement = judgeRound([
      sub('p1', '海'),
      sub('p2', '海'),
      sub('p3', '海'),
      sub('p4', '海'),
    ]);
    expect(judgement.allSame).toBe(true);
    expect(judgement.eligibleCount).toBe(4);
  });

  it('部分同词时不算胜利，并记录局部相遇', () => {
    const judgement = judgeRound([
      sub('p1', '猫', { nickname: '小明' }),
      sub('p2', '猫', { nickname: '小红' }),
      sub('p3', '狗', { nickname: '小刚' }),
    ]);
    expect(judgement.allSame).toBe(false);
    expect(judgement.partialMeetings).toHaveLength(1);
    expect(judgement.partialMeetings[0]).toMatchObject({
      word: '猫',
      nicknames: ['小明', '小红'],
    });
  });

  it('完全不同时没有局部相遇', () => {
    const judgement = judgeRound([sub('p1', '猫'), sub('p2', '狗'), sub('p3', '鱼')]);
    expect(judgement.allSame).toBe(false);
    expect(judgement.partialMeetings).toEqual([]);
    expect(judgement.groups).toHaveLength(3);
  });

  it('弃权者不参与判定', () => {
    const judgement = judgeRound([
      sub('p1', '猫'),
      sub('p2', '猫'),
      sub('p3', null, { isTimeout: true }),
    ]);
    expect(judgement.eligibleCount).toBe(2);
    expect(judgement.allSame).toBe(true);
  });

  it('单人提交不算全员相遇', () => {
    const judgement = judgeRound([
      sub('p1', '猫'),
      sub('p2', null, { isTimeout: true }),
    ]);
    expect(judgement.eligibleCount).toBe(1);
    expect(judgement.allSame).toBe(false);
  });

  it('分组保持提交顺序', () => {
    const groups = [...groupByWord([sub('p1', 'A'), sub('p2', 'B'), sub('p3', 'A')]).entries()];
    expect(groups.map(([word]) => word)).toEqual(['A', 'B']);
  });
});

describe('evaluateAfterRound', () => {
  const settings = defaultSettings();

  it('全员同词 → ALL_MET 并给出胜者', () => {
    const result = evaluateAfterRound({
      judgement: judgeRound([sub('p1', 'x'), sub('p2', 'x')]),
      roundNumber: 3,
      settings,
    });
    expect(result).toEqual({ outcome: 'ALL_MET', winnerPlayerIds: ['p1', 'p2'] });
  });

  it('可判定人数不足 2 → INSUFFICIENT_PLAYERS', () => {
    const result = evaluateAfterRound({
      judgement: judgeRound([sub('p1', 'x'), sub('p2', null, { isTimeout: true })]),
      roundNumber: 1,
      settings,
    });
    expect(result?.outcome).toBe('INSUFFICIENT_PLAYERS');
    expect(result?.winnerPlayerIds).toEqual([]);
  });

  it('局部同词且未到上限 → 继续', () => {
    const result = evaluateAfterRound({
      judgement: judgeRound([sub('p1', 'x'), sub('p2', 'x'), sub('p3', 'y')]),
      roundNumber: 5,
      settings: { ...settings, maxRounds: 20 },
    });
    expect(result).toBeNull();
  });

  it('达到轮次上限仍无人同词 → ROUND_LIMIT', () => {
    const result = evaluateAfterRound({
      judgement: judgeRound([sub('p1', 'x'), sub('p2', 'y')]),
      roundNumber: 20,
      settings,
    });
    expect(result).toEqual({ outcome: 'ROUND_LIMIT', winnerPlayerIds: [] });
  });

  it('上限优先于继续：最后一轮全员同词仍是 ALL_MET', () => {
    const result = evaluateAfterRound({
      judgement: judgeRound([sub('p1', 'x'), sub('p2', 'x')]),
      roundNumber: 20,
      settings,
    });
    expect(result?.outcome).toBe('ALL_MET');
  });
});

describe('collectPreviousWords', () => {
  it('去重并保留首次出现顺序，忽略弃权', () => {
    const words = collectPreviousWords([
      sub('p1', '苹果'),
      sub('p2', '香蕉'),
      sub('p3', '苹果'),
      sub('p4', null, { isTimeout: true }),
    ]);
    expect(words).toEqual(['苹果', '香蕉']);
  });
});

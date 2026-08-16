import { describe, it, expect } from 'vitest';
import type { Reveal } from '@poker/engine';
import { createCard, Rank, Suit } from '@poker/engine';
import { revealPills } from '../components/game/revealPanel.js';

const lv = (s: string, i: number) => createCard(s as any, Rank.Two, i); // 级牌（level 2）
const cur = (playerIndex: number, suit: string | null, strength: number): Reveal =>
  ({ playerIndex, suit: suit as any, strength });
const pill = (pills: ReturnType<typeof revealPills>, label: string) =>
  pills.find(p => p.label === label)!;

describe('revealPills — 无人亮主（只能单张亮，不直接亮一对）', () => {
  it('手牌无级牌 → 全部灰色（1 个图标）', () => {
    const pills = revealPills([], 2, null, 0);
    for (const s of ['♠', '♥', '♣', '♦']) {
      expect(pill(pills, s).available).toBe(false);
      expect(pill(pills, s).icons).toBe(1);
    }
  });

  it('手牌 1 张♠级牌 → ♠ 可用 1 图标（单张亮），其余灰', () => {
    const pills = revealPills([lv('S', 0)], 2, null, 0);
    const spade = pill(pills, '♠');
    expect(spade.available).toBe(true);
    expect(spade.icons).toBe(1);
    expect(spade.strength).toBe(1);
    expect(pill(pills, '♥').available).toBe(false);
  });

  it('手牌对♠ → 只显示 1 个图标（先单张亮，不直接亮一对）', () => {
    const pills = revealPills([lv('S', 0), lv('S', 1)], 2, null, 0);
    const spade = pill(pills, '♠');
    expect(spade.available).toBe(true);
    expect(spade.icons).toBe(1);
    expect(spade.strength).toBe(1);
  });
});

describe('revealPills — 自保（自己单张主 → 2 图标可自保）', () => {
  it('自己亮单张♠、手里还有对 → ♠ 可用 2 图标（自保成对）', () => {
    const pills = revealPills([lv('S', 0), lv('S', 1)], 2, cur(0, 'S', 1), 0);
    const spade = pill(pills, '♠');
    expect(spade.available).toBe(true);
    expect(spade.icons).toBe(2);
    expect(spade.strength).toBe(2);
  });

  it('自己亮单张♠、手里只有 1 张 → ♠ 灰（无法自保）；当前主是单张 → 灰框 2 图标', () => {
    const pills = revealPills([lv('S', 0)], 2, cur(0, 'S', 1), 0);
    expect(pill(pills, '♠').available).toBe(false);
    expect(pill(pills, '♠').icons).toBe(2); // 主是单张 → 灰框 2 图标
    expect(pill(pills, '♥').icons).toBe(2);
  });
});

describe('revealPills — 反主（他人已亮）', () => {
  it('他人亮单张♠ + 自己对♥ → ♥ 可用 2 图标（对子反）', () => {
    const pills = revealPills([lv('H', 0), lv('H', 1)], 2, cur(2, 'S', 1), 0);
    const heart = pill(pills, '♥');
    expect(heart.available).toBe(true);
    expect(heart.icons).toBe(2);
    expect(heart.strength).toBe(2);
  });

  it('他人亮对♠（strength 2）+ 自己对♥ → ♥ 灰（对子反不了对子）；有人亮过 → 灰框 2 图标', () => {
    const pills = revealPills([lv('H', 0), lv('H', 1)], 2, cur(2, 'S', 2), 0);
    expect(pill(pills, '♥').available).toBe(false);
    expect(pill(pills, '♥').icons).toBe(2);
  });

  it('他人亮单张 + 自己只有 1 张该花色 → 灰（单张反不了单张）', () => {
    const pills = revealPills([lv('H', 0)], 2, cur(2, 'S', 1), 0);
    expect(pill(pills, '♥').available).toBe(false);
  });

  it('他人亮无主（strength 3）→ 有主花色全部灰；无主 4 > 3 可反', () => {
    const pills = revealPills(
      [lv('H', 0), lv('H', 1),
       createCard('J' as any, Rank.BigJoker, 0), createCard('J' as any, Rank.BigJoker, 1)],
      2, cur(2, null, 3), 0,
    );
    expect(pill(pills, '♥').available).toBe(false);
    expect(pill(pills, 'NT').available).toBe(true);
    expect(pill(pills, 'NT').icons).toBe(1); // 无主恒 1 个图标（只有两个字母）
  });
});

describe('revealPills — 无主（NT/nt）', () => {
  it('对大王 → NT 可用（红）；对小王 → nt 可用（黑）；没人亮过 → 一律 1 图标', () => {
    const pills = revealPills(
      [createCard('J' as any, Rank.BigJoker, 0), createCard('J' as any, Rank.BigJoker, 1),
       createCard('J' as any, Rank.SmallJoker, 0), createCard('J' as any, Rank.SmallJoker, 1)],
      2, null, 0,
    );
    expect(pill(pills, 'NT').available).toBe(true);
    expect(pill(pills, 'NT').icons).toBe(1);
    expect(pill(pills, 'NT').red).toBe(true);
    expect(pill(pills, 'nt').available).toBe(true);
    expect(pill(pills, 'nt').icons).toBe(1);
  });

  it('单张大王 → NT 灰（无主需对王）；无人亮 → 灰框 1 图标', () => {
    const pills = revealPills([createCard('J' as any, Rank.BigJoker, 0)], 2, null, 0);
    expect(pill(pills, 'NT').available).toBe(false);
    expect(pill(pills, 'NT').icons).toBe(1);
  });

  it('自己已亮对小王无主 → NT 灰（禁止自反）', () => {
    const pills = revealPills(
      [createCard('J' as any, Rank.BigJoker, 0), createCard('J' as any, Rank.BigJoker, 1)], 2, cur(0, null, 3), 0,
    );
    expect(pill(pills, 'NT').available).toBe(false);
    expect(pill(pills, 'nt').available).toBe(false);
  });
});

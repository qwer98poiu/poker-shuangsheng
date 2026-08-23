import { describe, it, expect } from 'vitest';
import { createCard, Suit } from '@poker/engine';
import type { Card, Reveal } from '@poker/engine';
import { decideAutoGrabDealer } from '../store/autoGrabDealer.js';

const c = (s: string, r: number, i: number): Card => createCard(s as any, r as any, i);
const rev = (playerIndex: number, suit: Suit | null, strength: number): Reveal =>
  ({ playerIndex, suit, strength });
const S = Suit.Spades, H = Suit.Hearts;

describe('decideAutoGrabDealer — 首局自动抢庄决策', () => {
  it('无人亮主 + 有级牌 → 亮枚举序第一门（SHCD）', () => {
    // 同时有 ♥2 和 ♠2 → 引擎枚举序 S 在前
    const hand = [c('H', 2, 0), c('S', 2, 1), c('D', 5, 2)];
    expect(decideAutoGrabDealer(hand, null, 0, 2)).toEqual({ action: 'reveal', suit: 'S' });
  });

  it('无人亮主 + 无级牌无王 → idle', () => {
    const hand = [c('H', 3, 0), c('D', 10, 1)];
    expect(decideAutoGrabDealer(hand, null, 0, 2)).toEqual({ action: 'idle' });
  });

  it('自亮单张后同门仍有级牌对 → 自保（再亮同花色）', () => {
    // 已亮 ♠ 单张（strength 1），手里还有 ♠22 → 巩固成对
    const hand = [c('S', 2, 0), c('S', 2, 1)];
    expect(decideAutoGrabDealer(hand, rev(0, S, 1), 0, 2))
      .toEqual({ action: 'reveal', suit: 'S' });
  });

  it('自亮单张后无同门对 → idle', () => {
    const hand = [c('S', 2, 0), c('H', 5, 1)];
    expect(decideAutoGrabDealer(hand, rev(0, S, 1), 0, 2)).toEqual({ action: 'idle' });
  });

  it('他人亮单张级牌，我有对级牌 → 反主', () => {
    const hand = [c('H', 2, 0), c('H', 2, 1)];
    expect(decideAutoGrabDealer(hand, rev(1, S, 1), 0, 2))
      .toEqual({ action: 'reveal', suit: 'H' });
  });

  it('他人亮对级牌（strength 2），我只有单张 → 压不过，idle', () => {
    const hand = [c('H', 2, 0)];
    expect(decideAutoGrabDealer(hand, rev(1, S, 2), 0, 2)).toEqual({ action: 'idle' });
  });

  it('有对大王 → 永远 idle（无主够强，玩家自行决定），即使同时有级牌', () => {
    const hand = [c('J', 16, 0), c('J', 16, 1), c('S', 2, 2), c('S', 2, 3)];
    expect(decideAutoGrabDealer(hand, null, 0, 2)).toEqual({ action: 'idle' });
    expect(decideAutoGrabDealer(hand, rev(1, S, 1), 0, 2)).toEqual({ action: 'idle' });
  });

  it('有对小王 → 同样 idle', () => {
    const hand = [c('J', 15, 0), c('J', 15, 1)];
    expect(decideAutoGrabDealer(hand, null, 0, 2)).toEqual({ action: 'idle' });
  });

  it('他人亮无主（strength 3/4）→ 花色压不过，idle', () => {
    const hand = [c('S', 2, 0), c('S', 2, 1)];
    expect(decideAutoGrabDealer(hand, rev(1, null, 3), 0, 2)).toEqual({ action: 'idle' });
    expect(decideAutoGrabDealer(hand, rev(1, null, 4), 0, 2)).toEqual({ action: 'idle' });
  });

  it('他人自亮的对（strength 2）我有对级牌可反（同力量不同玩家 → 严格更高才反，2 不压 2）', () => {
    // canOverride：不同玩家需 strength 严格更高 → 对级牌(2) 不能反 对级牌(2)
    const hand = [c('H', 2, 0), c('H', 2, 1)];
    expect(decideAutoGrabDealer(hand, rev(1, S, 2), 0, 2)).toEqual({ action: 'idle' });
  });

  it('非本家的单张记录不触发自保分支（playerIndex 区分）', () => {
    // currentReveal 是别人的 ♠1，我只有单张 ♠2 → 反不了（1 不压 1）→ idle
    const hand = [c('S', 2, 0)];
    expect(decideAutoGrabDealer(hand, rev(1, S, 1), 0, 2)).toEqual({ action: 'idle' });
  });
});

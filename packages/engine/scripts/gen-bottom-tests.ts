/**
 * 扣底随机场景生成器（仅供开发：tsx 运行，不进 tsc/vitest）。
 *
 * 用法：
 *   npx tsx scripts/gen-bottom-tests.ts [seedCount] [--blocks] [--limit N]
 *
 * seedCount 默认为 1（上限 1000）。每个种子：seededShuffle(createFullDeck(), seed)
 * → dealFromDeck → 四家各 25 张 + 底 8 = 4 个 33 张庄家手牌；每家 × 65 种主牌
 * 配置（级 2..14 × {S,H,C,D,无主}）跑 aiChooseBottomCardsDetailed。
 * 每个 (种子, 庄家, 配置) 归类为“细分场景”键（模式 × 主牌档 × 扣绝门数与总分 ×
 * 填充最深桶），同键去重取代表；输出候选清单与分组统计，供人工审核后转写为
 * ai-bottom-strategy-random.test.ts 的 golden 断言。
 */
import {
  createFullDeck,
  seededShuffle,
  isTrump,
} from '../src/model.js';
import { dealFromDeck } from '../src/dealing/index.js';
import {
  Suit,
  SUIT_ORDER,
  Rank,
  rankLabel,
  suitLabel,
  cardPointsFromRank,
} from '../src/types.js';
import type { Card, CardSuit, TrumpDeclaration } from '../src/types.js';
import {
  aiChooseBottomCardsDetailed,
  type BottomChoiceDetail,
} from '../src/ai/bottom-strategy.js';
import { computeOffSuitControls } from '../src/ai/bottom-controls.js';

// ---- 主牌配置枚举 ----

interface TrumpCase {
  level: number;
  trumpSuit: Suit | null;
  /** 亮主展示，如 2C / 10无主。 */
  tag: string;
}

function buildConfigs(): TrumpCase[] {
  const out: TrumpCase[] = [];
  const suits: (Suit | null)[] = [Suit.Spades, Suit.Hearts, Suit.Clubs, Suit.Diamonds, null];
  for (let level = 2; level <= 14; level++) {
    for (const suit of suits) {
      out.push({
        level,
        trumpSuit: suit,
        tag: suit === null ? `${rankLabel(level as Rank)}NT` : `${rankLabel(level as Rank)}${suit}`,
      });
    }
  }
  return out;
}

const ALL_CONFIGS = buildConfigs();

// ---- 展示辅助 ----

const SUIT_NAME: Record<string, string> = {
  [Suit.Spades]: '黑桃', [Suit.Hearts]: '红桃', [Suit.Clubs]: '草花', [Suit.Diamonds]: '方块',
};

function suitIdx(s: CardSuit): number {
  const i = SUIT_ORDER.indexOf(s as Suit);
  return i >= 0 ? i : 99;
}

/** 单张牌紧凑记法：♠A / JOKER / joker。 */
function cardToken(c: Card): string {
  if (c.isJoker) return rankLabel(c.rank);
  return suitLabel(c.suit) + rankLabel(c.rank);
}

function sortRankDesc(a: Card, b: Card): number {
  return b.rank - a.rank;
}

interface HandRow {
  title: string;
  cards: Card[];
}

/**
 * 手牌行：常主（王 + 级牌，主级牌大于副级牌、副级牌按 SHCD）→ 有主时主花色行 →
 * 其余副牌按 SHCD。行内从大到小。
 */
function handRows(hand: Card[], cfg: TrumpDeclaration): HandRow[] {
  const rows: HandRow[] = [];
  const jokers = hand.filter(c => c.isJoker).sort(sortRankDesc);
  const levelCards = hand
    .filter(c => !c.isJoker && c.rank === cfg.level)
    .sort((a, b) => {
      // 主级牌（主牌花色的级牌）在前；其余级牌按 SHCD。
      const ka = cfg.trumpSuit !== null && a.suit === cfg.trumpSuit ? 0 : 1;
      const kb = cfg.trumpSuit !== null && b.suit === cfg.trumpSuit ? 0 : 1;
      if (ka !== kb) return ka - kb;
      return suitIdx(a.suit) - suitIdx(b.suit);
    });
  rows.push({ title: '常主', cards: [...jokers, ...levelCards] });

  if (cfg.trumpSuit !== null) {
    const main = hand
      .filter(c => !c.isJoker && c.suit === cfg.trumpSuit && c.rank !== cfg.level)
      .sort(sortRankDesc);
    rows.push({ title: `主${SUIT_NAME[cfg.trumpSuit]}`, cards: main });
  }

  for (const suit of SUIT_ORDER) {
    if (suit === cfg.trumpSuit) continue;
    const off = hand
      .filter(c => !c.isJoker && c.suit === suit && c.rank !== cfg.level)
      .sort(sortRankDesc);
    rows.push({ title: SUIT_NAME[suit], cards: off });
  }
  return rows.filter(r => r.cards.length > 0);
}

function printRows(rows: HandRow[]): string[] {
  return rows.map(r => `${r.title}：${r.cards.map(cardToken).join(' ')}`);
}

// ---- 场景分类 ----

const SUITED_BAND = (m: number): string => (m <= 8 ? '<=8张' : m === 9 ? '9张' : '>=10张');
const NT_BAND = (m: number): string => (m < 3 ? '<3张' : '>=3张');

/** 有主 ⑤ 桶名（1..8）。 */
const SUITED_BUCKET_NAMES: Record<number, string> = {
  1: '副牌非分单牌', 2: '副牌非分对牌', 3: '副牌分单牌', 4: '副牌分对牌',
  5: '主牌A以下非分单牌', 6: '拆副牌分对', 7: 'tier1', 8: '其他主牌',
};
/** 无主 ⑧ 桶名（1..9）。 */
const NT_BUCKET_NAMES: Record<number, string> = {
  1: '非长非分非控单牌', 2: '非长非分非控对牌', 3: '长花色非分单牌',
  4: '长花色非分对牌', 5: '非长tier2对牌', 6: '长tier2对牌',
  7: '分单牌', 8: '分对牌', 9: 'tier1拆对',
};

function sceneKey(d: BottomChoiceDetail): string {
  const mode = d.mode === 'suited' ? '有主花色' : 'NT';
  const band = d.mode === 'suited' ? SUITED_BAND(d.mainCount) : NT_BAND(d.mainCount);
  const voidSeg = d.voids.length > 0
    ? `扣绝${d.voids.length}门${d.voids.reduce((s, v) => s + v.points, 0)}分`
    : '无扣绝';
  const names = d.mode === 'suited' ? SUITED_BUCKET_NAMES : NT_BUCKET_NAMES;
  const fillSeg = d.fillBuckets.length > 0
    ? `填充至${names[d.fillBuckets[d.fillBuckets.length - 1]]}`
    : '无填充';
  return [mode, band, voidSeg, fillSeg].join('、');
}

// ---- 决策展示 ----

function displayDiscard(discard: Card[], cfg: TrumpDeclaration): string {
  const sorted = [...discard].sort((a, b) => {
    const ta = isTrump(a, cfg) ? 0 : 1;
    const tb = isTrump(b, cfg) ? 0 : 1;
    if (ta !== tb) return ta - tb;
    if (ta === 0) {
      // 主牌内部：级牌/王不可能出现，同为主花色 → 按有效大小从大到小。
      return b.rank - a.rank;
    }
    const sa = suitIdx(a.suit);
    const sb = suitIdx(b.suit);
    if (sa !== sb) return sa - sb;
    return b.rank - a.rank;
  });
  const pts = discard.reduce((s, c) => s + cardPointsFromRank(c.rank), 0);
  return `${sorted.map(cardToken).join(' ')}，共${pts}分`;
}

interface RunInstance {
  seed: number;
  seat: number; // 庄家 P0..P3
  cfg: TrumpCase;
  bankerHand: Card[];
}

function printBlock(
  idx: number,
  inst: RunInstance,
  d: BottomChoiceDetail,
  groupCount: number,
): void {
  const cfg: TrumpDeclaration = { declarerIndex: 0, trumpSuit: inst.cfg.trumpSuit, level: inst.cfg.level };
  const out: string[] = [];
  out.push(`${idx}（种子${inst.seed} · 庄家P${inst.seat} · 同场景${groupCount}次）`);
  out.push(`亮主：${inst.cfg.tag}`);
  out.push(...printRows(handRows(inst.bankerHand, cfg)));
  out.push(`主牌${d.mainCount}张`);
  // 控制张 / 分数：副牌逐门（tier1+tier2 张数、全门总分）。
  const infos = computeOffSuitControls(inst.bankerHand, cfg);
  const ctrlParts = infos.map(i => {
    const t1 = i.tier1.length;
    const t2 = i.tier2.length;
    const v = t2 > 0 ? `${t1}+${t2}` : t1 > 0 ? `${t1}` : '0';
    return `${SUIT_NAME[i.suit]}${v}`;
  });
  out.push(`控制张：${ctrlParts.join('、')}`);
  const scoreParts = infos.map(i => {
    const pts = i.cards.reduce((s, c) => s + cardPointsFromRank(c.rank), 0);
    return `${SUIT_NAME[i.suit]}${pts}`;
  });
  out.push(`分数：${scoreParts.join('、')}`);
  out.push(`扣底：${displayDiscard(d.discard, cfg)}`);
  out.push('扣底后手牌：');
  out.push(...printRows(handRows(d.keep, cfg)));
  out.push(`细分场景：${sceneKey(d)}`);
  console.log(out.join('\n'));
}

// ---- 主流程 ----

interface GroupStat {
  label: string;
  count: number;
  inst: RunInstance; // 首个出现的代表
  detail: BottomChoiceDetail;
}

function run(seedCount: number, printBlocks: boolean, limit: number): void {
  const groups = new Map<string, GroupStat>();
  let total = 0;
  let totalSuited = 0;
  let totalNT = 0;

  const bandOrderOf = (label: string): number => {
    if (label.startsWith('有主花色')) return 0;
    return 1;
  };

  for (let seed = 0; seed < seedCount; seed++) {
    const deck = seededShuffle(createFullDeck(), seed);
    const { hands, bottom } = dealFromDeck(deck);
    for (let seat = 0; seat < 4; seat++) {
      const bankerHand = [...hands[seat], ...bottom];
      for (const cfg of ALL_CONFIGS) {
        const config: TrumpDeclaration = {
          declarerIndex: 0,
          trumpSuit: cfg.trumpSuit,
          level: cfg.level,
        };
        const d = aiChooseBottomCardsDetailed(bankerHand, config);
        const label = sceneKey(d);
        total++;
        if (d.mode === 'suited') totalSuited++;
        else totalNT++;
        const g = groups.get(label);
        if (g) g.count++;
        else {
          groups.set(label, { label, count: 1, inst: { seed, seat, cfg, bankerHand }, detail: d });
        }
      }
    }
  }

  console.log(`==== 扣底随机场景报告（种子 0..${seedCount - 1}，${total} 次决策）====`);
  console.log(`有主 ${totalSuited} 次 · NT ${totalNT} 次 · 细分场景 ${groups.size} 组\n`);

  const sorted = [...groups.values()].sort((a, b) => {
    const mo = bandOrderOf(a.label) - bandOrderOf(b.label);
    if (mo !== 0) return mo;
    if (b.count !== a.count) return b.count - a.count;
    return a.label < b.label ? -1 : 1;
  });

  let shown = 0;
  if (printBlocks) {
    for (const g of sorted) {
      if (shown >= limit) break;
      shown++;
      printBlock(shown, g.inst, g.detail, g.count);
      console.log('');
    }
  }

  console.log('==== 分组统计 ====');
  shown = 0;
  for (const g of sorted) {
    if (shown >= limit) break;
    shown++;
    const i = g.inst;
    const pct = ((g.count / total) * 100).toFixed(1);
    console.log(
      `${String(shown).padStart(2)}. ${g.label} — ${g.count} 次（${pct}%）| 代表：种子${i.seed} 庄家P${i.seat} 亮主${i.cfg.tag}`,
    );
  }
}

// ---- 参数解析 ----

function main(): void {
  const args = process.argv.slice(2);
  let seedCount = 1;
  let printBlocks = false;
  let limit = Infinity;
  for (const a of args) {
    if (a === '--blocks') printBlocks = true;
    else if (a === '--help') {
      console.log('用法：npx tsx scripts/gen-bottom-tests.ts [seedCount=1] [--blocks] [--limit N]');
      process.exit(0);
    } else if (a.startsWith('--limit=')) {
      limit = Number(a.slice('--limit='.length));
    } else if (/^\d+$/.test(a)) {
      seedCount = Number(a);
    }
  }
  if (seedCount < 1 || seedCount > 1000) {
    console.error('seedCount 必须在 1..1000');
    process.exit(1);
  }
  if (seedCount > 1 && !args.includes('--blocks')) {
    console.log(`多种子（${seedCount}）默认只输出分组统计；加 --blocks 输出候选清单。`);
  }
  run(seedCount, printBlocks || seedCount <= 1, Number.isFinite(limit) ? limit : Infinity);
}

main();

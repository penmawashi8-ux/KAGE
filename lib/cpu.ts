import type { Player, Room } from "./types";

export const CPU_NAMES = ["鴉", "宵", "霧", "灯", "椿", "縞", "楓", "鵺"];

function rand() {
  return Math.random();
}

function pickFrom<T>(arr: T[]): T {
  return arr[Math.floor(rand() * arr.length)];
}

export function makeBrain() {
  return {
    aggression: 0.35 + rand() * 0.45,
    suspicion: 0.25 + rand() * 0.45,
  };
}

/** 得点順位（0 = 首位）を返す */
function rankOf(room: Room, p: Player): number {
  const sorted = [...room.players].sort((a, b) => b.score - a.score);
  return sorted.findIndex((x) => x.id === p.id);
}

/**
 * CPUのカード選択と宣言。
 * - 高札を正直に出す / 低札で高宣言のブラフ / 中札を正直に流す、の三択を性格と局面で重み付け
 * - 自分の公開済みカードと同じ値の宣言は「確定で嘘」とバレるので避ける
 */
export function cpuPick(room: Room, p: Player): { card: number; declared: number } {
  const hand = [...p.hand].sort((a, b) => a - b);
  const brain = p.brain ?? makeBrain();
  const behind = rankOf(room, p) >= Math.ceil(room.players.length / 2);
  const lastRounds = room.round >= 6;

  const high = hand[hand.length - 1];
  const low = hand[0];
  const mid = hand[Math.floor(hand.length / 2)];

  // ブラフ宣言の候補: まだ自分が公開で使い切っていない高い値
  const bluffValues = [7, 6, 5].filter(
    (v) => !p.revealed.includes(v) && v > low
  );

  let wBluff = brain.aggression * (behind ? 1.4 : 1.0);
  let wHonestHigh = high >= 6 ? 1.0 : 0.4;
  let wFold = hand.length > 2 && !lastRounds ? 0.7 : 0.25;
  if (bluffValues.length === 0) wBluff = 0;
  // 高札を温存しすぎないように、終盤は正直高札を優先
  if (lastRounds) wHonestHigh *= 1.6;

  const total = wBluff + wHonestHigh + wFold;
  const roll = rand() * total;

  if (roll < wBluff) {
    return { card: low, declared: pickFrom(bluffValues) };
  }
  if (roll < wBluff + wHonestHigh) {
    // 本物の高札。あえてダウトを誘う「逆ブラフ」になる
    return { card: high, declared: high };
  }
  return { card: mid, declared: mid };
}

/**
 * 暫定勝者の宣言が嘘である確率の見積もり。
 * - 公開済みカードと同じ宣言 → ほぼ確定で嘘
 * - 残り札に対する「その値をまだ持っている確率」をベースにする
 * - 同じ高宣言を何度も繰り返している相手は疑う
 */
export function estimateLieProbability(room: Room, winner: Player, declared: number): number {
  if (winner.revealed.includes(declared)) return 0.97;

  const used = 7 - winner.hand.length; // このラウンドの分も既に引かれている
  const unknownUsed = used - winner.revealed.length;
  // 公開されていない使用済み札の中に declared が混ざっている可能性
  const slotsUnknown = 7 - winner.revealed.length;
  const pStillHad = slotsUnknown > 0 ? Math.max(0, (slotsUnknown - unknownUsed + 1) / slotsUnknown) : 0;

  let pLie = 1 - pStillHad * 0.75;

  // 過去に同じ値を宣言済み(未検証)なら加点
  const sameBefore = room.history.filter(
    (h) => h.winnerId === winner.id && !h.doubt &&
      h.declarations.some((d) => d.playerId === winner.id && d.declared === declared)
  ).length;
  pLie += sameBefore * 0.18;

  // 高い宣言ほど嘘の動機が強い
  if (declared === 7) pLie += 0.08;

  return Math.min(0.97, Math.max(0.05, pLie));
}

/**
 * ダウトフェーズ開始時に、ダウトしたいCPUの中で最速の1人を決める。
 * 期待値: 嘘なら+2 / 本当なら-1 なので P(嘘) > 1/3 で得。性格でしきい値をずらす。
 */
export function planCpuDoubt(
  room: Room,
  winnerId: string,
  declared: number,
  now: number
): { playerId: string; at: number } | null {
  const winner = room.players.find((p) => p.id === winnerId);
  if (!winner) return null;

  let best: { playerId: string; at: number } | null = null;
  for (const p of room.players) {
    if (p.id === winnerId || !p.isCpu) continue;
    const brain = p.brain ?? makeBrain();
    const pLie = estimateLieProbability(room, winner, declared);
    const threshold = 0.55 - brain.suspicion * 0.25;
    const certain = pLie > 0.9;
    const wants = certain ? rand() < 0.95 : pLie > threshold && rand() < 0.75;
    if (!wants) continue;
    // 確信があるほど早く飛び込む
    const delay = certain ? 1500 + rand() * 3000 : 4000 + rand() * 11000;
    const at = now + delay;
    if (!best || at < best.at) best = { playerId: p.id, at };
  }
  return best;
}

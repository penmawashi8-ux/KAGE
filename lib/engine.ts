import { cpuPick, planCpuDoubt, makeBrain, CPU_NAMES } from "./cpu";
import type { Choice, Player, Room, RoomView, RoundRecord } from "./types";

export const ROUNDS = 7;
export const PICK_MS = 40_000;
export const DOUBT_MS = 20_000;
export const RESULT_MS = 7_000;
export const WAIT_MS = 20_000;
export const MAX_PLAYERS = 5;
export const FILL_TARGET = 4;

export function newId(len = 12): string {
  const chars = "abcdefghjkmnpqrstuvwxyz23456789";
  let s = "";
  for (let i = 0; i < len; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}

export function newRoom(isPublic: boolean, now: number): Room {
  return {
    id: newId(8),
    isPublic,
    phase: "waiting",
    createdAt: now,
    round: 0,
    players: [],
    choices: {},
    cpuPickAt: {},
    pickDeadline: null,
    doubt: null,
    resultUntil: null,
    history: [],
    waitDeadline: isPublic ? now + WAIT_MS : null,
  };
}

export function addHuman(room: Room, name: string, now: number): Player {
  const p: Player = {
    id: newId(16),
    name: name.trim().slice(0, 12) || "名無し",
    isCpu: false,
    hand: [1, 2, 3, 4, 5, 6, 7],
    score: 0,
    revealed: [],
    lastSeen: now,
  };
  room.players.push(p);
  return p;
}

export function addCpus(room: Room, count: number, now: number): void {
  const used = new Set(room.players.map((p) => p.name));
  const pool = CPU_NAMES.filter((n) => !used.has(n));
  for (let i = 0; i < count && room.players.length < MAX_PLAYERS; i++) {
    room.players.push({
      id: newId(16),
      name: pool[i % pool.length] ?? `影${i + 1}`,
      isCpu: true,
      hand: [1, 2, 3, 4, 5, 6, 7],
      score: 0,
      revealed: [],
      lastSeen: now,
      brain: makeBrain(),
    });
  }
}

export function startGame(room: Room, now: number): void {
  room.waitDeadline = null;
  startRound(room, now);
}

function startRound(room: Room, now: number): void {
  room.round += 1;
  room.phase = "pick";
  room.choices = {};
  room.doubt = null;
  room.resultUntil = null;
  room.pickDeadline = now + PICK_MS;
  room.cpuPickAt = {};
  for (const p of room.players) {
    if (p.isCpu) room.cpuPickAt[p.id] = now + 2_500 + Math.random() * 9_000;
  }
}

function resolvePicks(room: Room, now: number): void {
  for (const p of room.players) {
    const c = room.choices[p.id];
    if (c) p.hand = p.hand.filter((x) => x !== c.card);
  }
  const entries = room.players
    .map((p) => ({ p, c: room.choices[p.id] }))
    .filter((e): e is { p: Player; c: Choice } => !!e.c)
    .sort((a, b) => b.c.declared - a.c.declared || a.c.at - b.c.at);
  const winner = entries[0];
  room.phase = "doubt";
  room.doubt = {
    winnerId: winner.p.id,
    deadline: now + DOUBT_MS,
    cpuPlan: planCpuDoubt(room, winner.p.id, winner.c.declared, now),
    passed: [],
  };
}

export function resolveDoubt(room: Room, doubterId: string | null, now: number): void {
  const d = room.doubt;
  if (!d) return;
  const winner = room.players.find((p) => p.id === d.winnerId)!;
  const choice = room.choices[winner.id];
  const deltas: Record<string, number> = {};
  let doubtRec: RoundRecord["doubt"] = null;

  if (doubterId) {
    const doubter = room.players.find((p) => p.id === doubterId)!;
    const lie = choice.card !== choice.declared;
    winner.revealed.push(choice.card);
    winner.revealed.sort((a, b) => a - b);
    if (lie) {
      deltas[winner.id] = -1;
      deltas[doubter.id] = 2;
    } else {
      deltas[winner.id] = 2;
      deltas[doubter.id] = -1;
    }
    doubtRec = { by: doubterId, card: choice.card, lie };
  } else {
    deltas[winner.id] = 1;
  }

  for (const [pid, delta] of Object.entries(deltas)) {
    const p = room.players.find((x) => x.id === pid);
    if (p) p.score += delta;
  }

  const record: RoundRecord = {
    round: room.round,
    declarations: room.players
      .filter((p) => room.choices[p.id])
      .sort((a, b) => room.choices[a.id].at - room.choices[b.id].at)
      .map((p) => ({ playerId: p.id, declared: room.choices[p.id].declared })),
    winnerId: winner.id,
    doubt: doubtRec,
    deltas,
  };
  room.history.push(record);
  room.doubt = null;
  room.phase = "result";
  room.resultUntil = now + RESULT_MS;
}

/**
 * 時刻に応じて状態機械を進める。ポーリング/アクションのたびに呼ぶ。
 */
export function advance(room: Room, now: number): void {
  for (let guard = 0; guard < 20; guard++) {
    const phase = room.phase;

    if (phase === "waiting") {
      // 応答が途絶えた待機者は退室扱い
      room.players = room.players.filter((p) => p.isCpu || now - p.lastSeen < 15_000);
      const humans = room.players.filter((p) => !p.isCpu).length;
      if (humans >= MAX_PLAYERS) {
        startGame(room, now);
        continue;
      }
      if (room.waitDeadline !== null && now >= room.waitDeadline && humans >= 1) {
        addCpus(room, Math.max(FILL_TARGET, humans) - room.players.length, now);
        startGame(room, now);
        continue;
      }
      return;
    }

    if (phase === "pick") {
      for (const p of room.players) {
        if (room.choices[p.id]) continue;
        if (p.isCpu && now >= (room.cpuPickAt[p.id] ?? 0)) {
          const { card, declared } = cpuPick(room, p);
          room.choices[p.id] = { card, declared, at: now + Math.random() * 50 };
        }
      }
      const allDone = room.players.every((p) => room.choices[p.id]);
      const expired = room.pickDeadline !== null && now >= room.pickDeadline;
      if (expired) {
        // 時間切れの人間はランダムな札を正直宣言で自動提出
        for (const p of room.players) {
          if (room.choices[p.id]) continue;
          const card = p.hand[Math.floor(Math.random() * p.hand.length)];
          room.choices[p.id] = { card, declared: card, at: now, auto: true };
        }
      }
      if (allDone || expired) {
        resolvePicks(room, now);
        continue;
      }
      return;
    }

    if (phase === "doubt") {
      const d = room.doubt!;
      if (d.cpuPlan && now >= d.cpuPlan.at) {
        resolveDoubt(room, d.cpuPlan.playerId, now);
        continue;
      }
      // ダウトできる人間が全員「見送り」なら、間を少しだけ残して早送りする
      const eligibleHumans = room.players.filter(
        (p) => !p.isCpu && p.id !== d.winnerId
      );
      const allPassed = eligibleHumans.every((p) => d.passed.includes(p.id));
      if (allPassed) {
        if (d.cpuPlan) {
          d.cpuPlan.at = Math.min(d.cpuPlan.at, now + 1_500 + Math.random() * 2_000);
        } else {
          d.deadline = Math.min(d.deadline, now + 2_000 + Math.random() * 2_500);
        }
      }
      if (now >= d.deadline) {
        resolveDoubt(room, null, now);
        continue;
      }
      return;
    }

    if (phase === "result") {
      if (room.resultUntil !== null && now >= room.resultUntil) {
        if (room.round >= ROUNDS) {
          room.phase = "finished";
        } else {
          startRound(room, now);
        }
        continue;
      }
      return;
    }

    return; // finished
  }
}

export function applyPick(
  room: Room,
  playerId: string,
  card: number,
  declared: number,
  now: number
): string | null {
  if (room.phase !== "pick") return "今は札を選べません";
  const p = room.players.find((x) => x.id === playerId);
  if (!p) return "プレイヤーが見つかりません";
  if (room.choices[p.id]) return "このラウンドはすでに宣言済みです";
  if (!p.hand.includes(card)) return "その札は手元にありません";
  if (!Number.isInteger(declared) || declared < 1 || declared > 7) return "宣言は一〜七です";
  room.choices[p.id] = { card, declared, at: now };
  return null;
}

export function applyDoubt(room: Room, playerId: string, now: number): string | null {
  if (room.phase !== "doubt" || !room.doubt) return "今はダウトできません";
  if (room.doubt.winnerId === playerId) return "自分の宣言にはダウトできません";
  if (room.doubt.passed.includes(playerId)) return "このラウンドは見送り済みです";
  const p = room.players.find((x) => x.id === playerId);
  if (!p) return "プレイヤーが見つかりません";
  resolveDoubt(room, playerId, now);
  return null;
}

export function applyPass(room: Room, playerId: string): string | null {
  if (room.phase !== "doubt" || !room.doubt) return "今は見送れません";
  if (room.doubt.winnerId === playerId) return "宣言者は見送れません";
  const p = room.players.find((x) => x.id === playerId);
  if (!p) return "プレイヤーが見つかりません";
  if (!room.doubt.passed.includes(playerId)) room.doubt.passed.push(playerId);
  return null;
}

export function viewFor(room: Room, playerId: string, now: number): RoomView {
  const you = room.players.find((p) => p.id === playerId);
  const showDeclarations =
    room.phase === "doubt" ||
    (room.phase === "result" && room.history.length > 0);

  let declarations: RoomView["declarations"] = null;
  if (room.phase === "doubt") {
    declarations = room.players
      .filter((p) => room.choices[p.id])
      .sort((a, b) => room.choices[a.id].at - room.choices[b.id].at)
      .map((p) => ({ playerId: p.id, declared: room.choices[p.id].declared }));
  } else if (showDeclarations) {
    declarations = room.history[room.history.length - 1].declarations;
  }

  let standings: RoomView["standings"] = null;
  if (room.phase === "finished") {
    // 同点の決着: ①嘘を見破った回数 ②より遅い局での得点 ③それでも並べば同着
    const stats = new Map(
      room.players.map((p) => {
        const doubtWins = room.history.filter(
          (h) => h.doubt && h.doubt.by === p.id && h.doubt.lie
        ).length;
        let lastGain = 0;
        for (const h of room.history) {
          if ((h.deltas[p.id] ?? 0) > 0) lastGain = h.round;
        }
        return [p.id, { doubtWins, lastGain }] as const;
      })
    );
    const sorted = [...room.players].sort((a, b) => {
      const sa = stats.get(a.id)!;
      const sb = stats.get(b.id)!;
      return (
        b.score - a.score ||
        sb.doubtWins - sa.doubtWins ||
        sb.lastGain - sa.lastGain
      );
    });
    let rank = 0;
    let prevKey = "";
    standings = sorted.map((p, i) => {
      const s = stats.get(p.id)!;
      const key = `${p.score}/${s.doubtWins}/${s.lastGain}`;
      if (key !== prevKey) {
        rank = i + 1;
        prevKey = key;
      }
      return {
        playerId: p.id,
        score: p.score,
        rank,
        doubtWins: s.doubtWins,
        lastGain: s.lastGain,
      };
    });
  }

  return {
    id: room.id,
    phase: room.phase,
    round: room.round,
    now,
    waitDeadline: room.waitDeadline,
    pickDeadline: room.pickDeadline,
    youId: playerId,
    hand: you ? [...you.hand].sort((a, b) => a - b) : [],
    yourChoice:
      you && room.choices[you.id]
        ? { card: room.choices[you.id].card, declared: room.choices[you.id].declared }
        : null,
    players: room.players.map((p) => ({
      id: p.id,
      name: p.name,
      isCpu: p.isCpu,
      score: p.score,
      cards: p.hand.length,
      revealed: p.revealed,
      done: !!room.choices[p.id],
      you: p.id === playerId,
    })),
    declarations,
    doubt: room.doubt
      ? {
          winnerId: room.doubt.winnerId,
          deadline: room.doubt.deadline,
          passed: room.doubt.passed,
        }
      : null,
    lastResult:
      room.phase === "result" || room.phase === "finished"
        ? room.history[room.history.length - 1] ?? null
        : null,
    history: room.history,
    standings,
  };
}

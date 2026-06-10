export type Phase = "waiting" | "pick" | "doubt" | "result" | "finished";

export interface CpuBrain {
  /** 0..1 ブラフ傾向 */
  aggression: number;
  /** 0..1 ダウト傾向 */
  suspicion: number;
}

export interface Player {
  id: string;
  name: string;
  isCpu: boolean;
  hand: number[];
  score: number;
  /** ダウトで公開された使用済みカード */
  revealed: number[];
  lastSeen: number;
  brain?: CpuBrain;
}

export interface Choice {
  card: number;
  declared: number;
  at: number;
  auto?: boolean;
}

export interface DoubtState {
  winnerId: string;
  deadline: number;
  /** このラウンドでダウトする予定のCPUと実行時刻 */
  cpuPlan: { playerId: string; at: number } | null;
  /** 「見送る」を選んだプレイヤー。対象者全員が見送れば早送りする */
  passed: string[];
}

export interface RoundRecord {
  round: number;
  declarations: { playerId: string; declared: number }[];
  winnerId: string;
  doubt: { by: string; card: number; lie: boolean } | null;
  deltas: Record<string, number>;
}

export interface Room {
  id: string;
  isPublic: boolean;
  phase: Phase;
  createdAt: number;
  round: number;
  players: Player[];
  choices: Record<string, Choice>;
  cpuPickAt: Record<string, number>;
  pickDeadline: number | null;
  doubt: DoubtState | null;
  resultUntil: number | null;
  history: RoundRecord[];
  waitDeadline: number | null;
}

/** クライアントへ返す、本人視点に検閲済みの状態 */
export interface RoomView {
  id: string;
  phase: Phase;
  round: number;
  now: number;
  waitDeadline: number | null;
  pickDeadline: number | null;
  youId: string;
  hand: number[];
  yourChoice: { card: number; declared: number } | null;
  players: {
    id: string;
    name: string;
    isCpu: boolean;
    score: number;
    cards: number;
    revealed: number[];
    done: boolean;
    you: boolean;
  }[];
  declarations: { playerId: string; declared: number }[] | null;
  doubt: { winnerId: string; deadline: number; passed: string[] } | null;
  lastResult: RoundRecord | null;
  history: RoundRecord[];
  standings:
    | {
        playerId: string;
        score: number;
        rank: number;
        doubtWins: number;
        lastGain: number;
      }[]
    | null;
}

"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { advance, applyDoubt, applyPass, applyPick, viewFor } from "@/lib/engine";
import type { Room, RoomView, RoundRecord } from "@/lib/types";

const KANJI = ["", "一", "二", "三", "四", "五", "六", "七"];

function useNow(intervalMs = 250): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return now;
}

export default function PlayPage() {
  const { roomId } = useParams<{ roomId: string }>();
  // "local" はサーバーを使わないCPU戦。ブラウザ内でエンジンを直接回す
  const isLocal = roomId === "local";
  const localRoomRef = useRef<Room | null>(null);
  const [playerId, setPlayerId] = useState<string | null>(null);
  const [view, setView] = useState<RoomView | null>(null);
  const [gone, setGone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [selectedCard, setSelectedCard] = useState<number | null>(null);
  const [selectedDecl, setSelectedDecl] = useState<number | null>(null);
  const [sending, setSending] = useState(false);

  const offsetRef = useRef(0);
  const tick = useNow();

  useEffect(() => {
    // 参加情報がなければ空文字で観戦扱いにする
    setPlayerId(sessionStorage.getItem(`kagefuda:${roomId}`) ?? "");
  }, [roomId]);

  const applyView = useCallback((v: RoomView) => {
    offsetRef.current = v.now - Date.now();
    setView(v);
  }, []);

  // ローカルCPU戦: sessionStorage のルームを読み込み、タイマーでエンジンを進める
  useEffect(() => {
    if (!isLocal || playerId === null) return;
    const raw = sessionStorage.getItem("kagefuda-local");
    if (!raw) {
      setGone(true);
      return;
    }
    localRoomRef.current = JSON.parse(raw) as Room;

    const step = () => {
      const room = localRoomRef.current;
      if (!room) return;
      const now = Date.now();
      advance(room, now);
      sessionStorage.setItem("kagefuda-local", JSON.stringify(room));
      applyView(viewFor(room, playerId, now));
    };
    step();
    const t = setInterval(step, 400);
    return () => clearInterval(t);
  }, [isLocal, playerId, applyView]);

  // オンライン戦: サーバーをポーリング。404は数回続いたときだけ「卓なし」と判断する
  useEffect(() => {
    if (isLocal || playerId === null) return;
    let stop = false;
    let timer: ReturnType<typeof setTimeout>;
    let misses = 0;

    async function poll() {
      try {
        const res = await fetch(`/api/room/${roomId}?p=${playerId}`, {
          cache: "no-store",
        });
        if (res.status === 404) {
          misses += 1;
          if (misses >= 4) {
            setGone(true);
            return;
          }
        } else if (res.ok) {
          misses = 0;
          applyView((await res.json()) as RoomView);
        }
      } catch {
        /* 次のポーリングで回復 */
      }
      if (!stop) timer = setTimeout(poll, 1200);
    }

    poll();
    return () => {
      stop = true;
      clearTimeout(timer);
    };
  }, [isLocal, roomId, playerId, applyView]);

  // ラウンドが変わったら選択をリセット
  const roundRef = useRef(0);
  useEffect(() => {
    if (view && view.round !== roundRef.current) {
      roundRef.current = view.round;
      setSelectedCard(null);
      setSelectedDecl(null);
      setError(null);
    }
  }, [view]);

  async function act(body: Record<string, unknown>) {
    if (!playerId) return;

    if (isLocal) {
      const room = localRoomRef.current;
      if (!room) return;
      const now = Date.now();
      advance(room, now);
      let err: string | null = null;
      if (body.type === "pick") {
        err = applyPick(room, playerId, Number(body.card), Number(body.declared), now);
      } else if (body.type === "doubt") {
        err = applyDoubt(room, playerId, now);
      } else if (body.type === "pass") {
        err = applyPass(room, playerId);
      }
      advance(room, now);
      sessionStorage.setItem("kagefuda-local", JSON.stringify(room));
      if (err) setError(err);
      else {
        setError(null);
        applyView(viewFor(room, playerId, now));
      }
      return;
    }

    setSending(true);
    setError(null);
    try {
      const res = await fetch(`/api/room/${roomId}/action`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ playerId, ...body }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError((data as { error?: string }).error ?? "操作に失敗しました");
      } else {
        applyView(data as RoomView);
      }
    } catch {
      setError("通信に失敗しました");
    } finally {
      setSending(false);
    }
  }

  if (gone) {
    return (
      <div className="wrap">
        <div className="game-header">
          <span className="logo">
            影<span className="fuda">札</span>
          </span>
        </div>
        <div className="stage" style={{ marginTop: 32 }}>
          <p className="stage-message">この卓はすでに片付けられました。</p>
          <p style={{ marginTop: 20 }}>
            <Link className="btn" href="/">
              入口へ戻る
            </Link>
          </p>
        </div>
      </div>
    );
  }

  if (!view) {
    return (
      <div className="wrap">
        <div className="game-header">
          <span className="logo">
            影<span className="fuda">札</span>
          </span>
        </div>
        <p className="dim" style={{ marginTop: 32, textAlign: "center" }}>
          卓の様子をうかがっています…
        </p>
      </div>
    );
  }

  const serverNow = tick + offsetRef.current;
  const names = new Map(view.players.map((p) => [p.id, p.name]));
  const nameOf = (id: string) => names.get(id) ?? "？";
  const you = view.players.find((p) => p.you);
  const winnerId = view.doubt?.winnerId ?? null;

  const remain = (deadline: number | null) =>
    deadline === null ? 0 : Math.max(0, deadline - serverNow);

  return (
    <div className="wrap">
      <div className="game-header">
        <span className="logo">
          影<span className="fuda">札</span>
        </span>
        <span className="round-label">
          {view.phase === "waiting"
            ? "席を整えています"
            : view.phase === "finished"
              ? "終局"
              : `第${KANJI[view.round]}局 ／ 全七局`}
        </span>
      </div>

      <div className="players-row">
        {view.players.map((p) => (
          <div
            key={p.id}
            className={
              "plaque" +
              (p.you ? " is-you" : "") +
              (p.id === winnerId ? " is-winner" : "")
            }
          >
            <div className="p-name">
              <span>{p.name}</span>
              {p.isCpu && <span className="p-tag">CPU</span>}
              {p.you && <span className="p-tag">自分</span>}
            </div>
            <div className="p-score">
              {p.score}
              <small>点</small>
            </div>
            {view.phase !== "waiting" && (
              <div className="p-meta">
                残り{p.cards}枚
                {p.revealed.length > 0 && (
                  <>
                    <br />
                    公開済{" "}
                    <span className="p-revealed">
                      {p.revealed.map((c) => KANJI[c]).join("・")}
                    </span>
                  </>
                )}
                {view.phase === "pick" && (
                  <>
                    <br />
                    {p.done ? "宣言済" : "思案中…"}
                  </>
                )}
              </div>
            )}
          </div>
        ))}
      </div>

      {view.phase === "waiting" && (
        <WaitingStage
          view={view}
          remainMs={remain(view.waitDeadline)}
          onStartNow={() => act({ type: "start" })}
          sending={sending}
        />
      )}

      {view.phase === "pick" && you && (
        <>
          <div className="stage">
            <p className="stage-message">
              手札から一枚を伏せ、宣言値を決めてください。
              <br />
              <span className="dim">
                嘘は自由。ただし、ダウトされて暴かれれば一点を失います。
                同じ宣言値がぶつかったときは、先に宣言した方が取ります。
              </span>
            </p>
            <TimerBar remainMs={remain(view.pickDeadline)} totalMs={40000} />
            <p className="dim" style={{ marginTop: 8, fontSize: "0.78rem" }}>
              残り {Math.ceil(remain(view.pickDeadline) / 1000)} 秒
            </p>
          </div>

          {view.yourChoice ? (
            <div className="stage" style={{ marginTop: 16 }}>
              <p className="stage-message">
                <span className="big">{KANJI[view.yourChoice.card]}</span>
                の札を伏せ、「{KANJI[view.yourChoice.declared]}」と宣言しました。
                <br />
                <span className="dim">他の面々を待っています…</span>
              </p>
            </div>
          ) : (
            <div className="hand-section">
              <p className="hand-label">伏せる札</p>
              <div className="hand-row">
                {view.hand.map((c) => (
                  <button
                    key={c}
                    className={"card-btn" + (selectedCard === c ? " selected" : "")}
                    onClick={() => setSelectedCard(c)}
                  >
                    <span className="corner">{c}</span>
                    {KANJI[c]}
                  </button>
                ))}
              </div>

              <p className="hand-label" style={{ marginTop: 20 }}>
                宣言する値
              </p>
              <div className="declare-row">
                {[1, 2, 3, 4, 5, 6, 7].map((v) => (
                  <button
                    key={v}
                    className={
                      "declare-chip" + (selectedDecl === v ? " selected" : "")
                    }
                    onClick={() => setSelectedDecl(v)}
                  >
                    {KANJI[v]}
                  </button>
                ))}
              </div>

              <div className="submit-row">
                <button
                  className="btn btn-shu"
                  disabled={sending || selectedCard === null || selectedDecl === null}
                  onClick={() =>
                    act({ type: "pick", card: selectedCard, declared: selectedDecl })
                  }
                >
                  伏せて宣言する
                </button>
                {selectedCard !== null && selectedDecl !== null && (
                  <span className="lie-note">
                    {selectedCard === selectedDecl ? (
                      <>正直な宣言です。</>
                    ) : (
                      <>
                        <span className="shu">嘘</span>
                        の宣言です。暴かれれば −1点、つき通せば儲けもの。
                      </>
                    )}
                  </span>
                )}
              </div>
            </div>
          )}
        </>
      )}

      {view.phase === "doubt" && view.doubt && (
        <div className="stage">
          <p className="stage-message">
            <span className="big shu">{nameOf(view.doubt.winnerId)}</span>
            が「
            <span className="big">
              {KANJI[
                view.declarations?.find((d) => d.playerId === view.doubt!.winnerId)
                  ?.declared ?? 0
              ]}
            </span>
            」を宣言し、この局を取ろうとしています。
          </p>

          {view.declarations && (
            <>
              <div className="decl-list">
                {view.declarations.map((d, i) => (
                  <div
                    key={d.playerId}
                    className={
                      "decl-item" + (d.playerId === view.doubt!.winnerId ? " is-top" : "")
                    }
                  >
                    <div className="d-name">
                      <span className="d-order">{i + 1}番</span> {nameOf(d.playerId)}
                    </div>
                    <div className="d-value">{KANJI[d.declared]}</div>
                  </div>
                ))}
              </div>
              <p className="dim" style={{ marginTop: 10, fontSize: "0.75rem" }}>
                並びは宣言した順。同じ宣言値なら、先に宣言した方が暫定勝者になります。
              </p>
            </>
          )}

          <TimerBar remainMs={remain(view.doubt.deadline)} totalMs={20000} />
          <p className="dim" style={{ marginTop: 8, fontSize: "0.78rem" }}>
            ダウト受付 残り {Math.ceil(remain(view.doubt.deadline) / 1000)} 秒
          </p>

          <div className="doubt-actions">
            {you && view.doubt.winnerId !== you.id ? (
              view.doubt.passed.includes(you.id) ? (
                <p className="dim" style={{ fontSize: "0.9rem" }}>
                  見送りました。成り行きを見守ります…
                </p>
              ) : (
                <>
                  <button
                    className="btn btn-shu btn-doubt"
                    disabled={sending}
                    onClick={() => act({ type: "doubt" })}
                  >
                    ダウト
                  </button>
                  <button
                    className="btn"
                    style={{ marginLeft: 12 }}
                    disabled={sending}
                    onClick={() => act({ type: "pass" })}
                  >
                    見送る
                  </button>
                  <p className="dim" style={{ marginTop: 12, fontSize: "0.8rem" }}>
                    嘘を見破れば＋2点。本物なら −1点。早い者勝ちで一人だけ。
                    全員が見送ればすぐ次へ進みます。
                  </p>
                </>
              )
            ) : you ? (
              <p className="dim" style={{ fontSize: "0.9rem" }}>
                あなたの宣言が場に出ています。誰も動かなければ＋1点。
              </p>
            ) : (
              <p className="dim" style={{ fontSize: "0.9rem" }}>
                成り行きを見守っています。
              </p>
            )}
          </div>
        </div>
      )}

      {view.phase === "result" && view.lastResult && (
        <div className="stage">
          <ResultText record={view.lastResult} nameOf={nameOf} />
        </div>
      )}

      {view.phase === "finished" && view.standings && (
        <div className="stage">
          <p className="stage-message">終局 ― 七つの局が打ち終わりました。</p>
          <div className="standings">
            {view.standings.map((s) => (
              <div
                key={s.playerId}
                className={"standing-row" + (s.rank === 1 ? " first" : "")}
              >
                <span className="rank">第{KANJI[Math.min(s.rank, 7)]}位</span>
                <span className="s-name">{nameOf(s.playerId)}</span>
                <span className="dim" style={{ fontSize: "0.75rem" }}>
                  見破り{s.doubtWins}回
                </span>
                <span className="s-score">{s.score}点</span>
              </div>
            ))}
          </div>
          <p className="dim" style={{ marginTop: 14, fontSize: "0.75rem" }}>
            同点のときは、嘘を見破った回数が多い方 →
            より遅い局で得点した方、の順で上位。それでも並べば同着です。
          </p>
          <p style={{ marginTop: 28 }}>
            <Link className="btn btn-shu" href="/">
              もう一卓
            </Link>
          </p>
        </div>
      )}

      {error && <p className="error-note">{error}</p>}

      {view.history.length > 0 && view.phase !== "waiting" && (
        <div className="history">
          <h3>これまでの局</h3>
          <table className="history-table">
            <tbody>
              <tr>
                <th>局</th>
                <th>宣言（先着順）</th>
                <th>結末</th>
              </tr>
              {view.history.map((h) => (
                <tr key={h.round}>
                  <td>第{KANJI[h.round]}局</td>
                  <td>
                    {h.declarations.map((d, i) => (
                      <span key={d.playerId}>
                        {i > 0 && " ／ "}
                        {nameOf(d.playerId)}「{KANJI[d.declared]}」
                      </span>
                    ))}
                  </td>
                  <td>
                    <HistoryOutcome record={h} nameOf={nameOf} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function WaitingStage(props: {
  view: RoomView;
  remainMs: number;
  onStartNow: () => void;
  sending: boolean;
}) {
  const { view, remainMs, onStartNow, sending } = props;
  const humans = view.players.filter((p) => !p.isCpu);
  return (
    <div className="stage">
      <p className="stage-message">
        対戦相手を探しています。
        <br />
        <span className="dim">
          あと {Math.ceil(remainMs / 1000)} 秒で、空いた席はCPUが埋めます。
        </span>
      </p>
      <div className="wait-list">
        {humans.map((p) => (
          <div key={p.id}>
            {p.name}
            {p.you ? "（自分）" : ""} ― 着席
          </div>
        ))}
        <div className="dim">… {5 - humans.length} 席 空き</div>
      </div>
      <p style={{ marginTop: 18 }}>
        <button className="btn" onClick={onStartNow} disabled={sending}>
          待たずに始める
        </button>
      </p>
    </div>
  );
}

function TimerBar({ remainMs, totalMs }: { remainMs: number; totalMs: number }) {
  const pct = Math.max(0, Math.min(100, (remainMs / totalMs) * 100));
  return (
    <div className="timer-track">
      <div className="timer-bar" style={{ width: `${pct}%` }} />
    </div>
  );
}

function ResultText({
  record,
  nameOf,
}: {
  record: RoundRecord;
  nameOf: (id: string) => string;
}) {
  const winner = nameOf(record.winnerId);
  const decl =
    record.declarations.find((d) => d.playerId === record.winnerId)?.declared ?? 0;

  if (!record.doubt) {
    return (
      <p className="result-line">
        誰も動かず。<span className="big">{winner}</span> の「{KANJI[decl]}」は
        伏せられたまま流れ、<span className="shu">＋1点</span>。
        <br />
        <span className="dim">本当だったのか、嘘だったのか――誰にも分からない。</span>
      </p>
    );
  }

  const d = record.doubt;
  return (
    <p className="result-line">
      <span className="big">{nameOf(d.by)}</span> がダウト。札がめくられる――
      正体は <span className="big shu">{KANJI[d.card]}</span>。
      <br />
      {d.lie ? (
        <>
          「{KANJI[decl]}」は<span className="shu">嘘</span>だった。 {winner} は −1点、
          {nameOf(d.by)} は ＋2点。
        </>
      ) : (
        <>
          宣言どおりの<span className="shu">本物</span>。 {winner} は ＋2点、
          {nameOf(d.by)} は −1点。
        </>
      )}
    </p>
  );
}

function HistoryOutcome({
  record,
  nameOf,
}: {
  record: RoundRecord;
  nameOf: (id: string) => string;
}) {
  const winner = nameOf(record.winnerId);
  if (!record.doubt) {
    return (
      <span>
        {winner} が伏せたまま ＋1点
      </span>
    );
  }
  const d = record.doubt;
  return (
    <span>
      {nameOf(d.by)} がダウト → 正体は{KANJI[d.card]}。
      {d.lie ? `嘘。${winner} −1 ／ ${nameOf(d.by)} ＋2` : `本物。${winner} ＋2 ／ ${nameOf(d.by)} −1`}
    </span>
  );
}

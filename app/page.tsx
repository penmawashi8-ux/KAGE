"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export default function TopPage() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [cpuCount, setCpuCount] = useState(3);
  const [busy, setBusy] = useState<"match" | "cpu" | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function start(mode: "match" | "cpu") {
    setBusy(mode);
    setError(null);
    try {
      const res = await fetch(mode === "match" ? "/api/match" : "/api/cpu", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, cpuCount }),
      });
      if (!res.ok) throw new Error();
      const data = (await res.json()) as { roomId: string; playerId: string };
      sessionStorage.setItem(`kagefuda:${data.roomId}`, data.playerId);
      router.push(`/play/${data.roomId}`);
    } catch {
      setError("接続に失敗しました。少し待ってからもう一度どうぞ。");
      setBusy(null);
    }
  }

  return (
    <div className="wrap">
      <header className="top-header">
        <h1 className="top-title">
          <span className="kage">影</span>
          <span className="fuda">札</span>
        </h1>
        <p className="top-sub">カゲフダ ― 宣言ブラフ×カウンティング</p>
        <div className="top-rule" />
      </header>

      <div className="name-row">
        <label htmlFor="name">名前</label>
        <input
          id="name"
          value={name}
          maxLength={12}
          placeholder="名無し"
          onChange={(e) => setName(e.target.value)}
        />
      </div>

      <div className="mode-grid">
        <div className="mode-card">
          <h2>オンライン対戦</h2>
          <p>
            ランダムマッチで他のプレイヤーと卓を囲みます。
            二十秒ほど待っても人数が揃わなければ、残りの席はCPUが埋めます。
          </p>
          <button
            className="btn btn-shu"
            disabled={busy !== null}
            onClick={() => start("match")}
          >
            {busy === "match" ? "席を探しています…" : "卓に着く"}
          </button>
        </div>

        <div className="mode-card">
          <h2>CPU対戦</h2>
          <p>すぐに一人で遊べます。相手は読み合いを仕掛けてくるCPUです。</p>
          <div className="cpu-count">
            <span>相手の数</span>
            <select
              value={cpuCount}
              onChange={(e) => setCpuCount(Number(e.target.value))}
            >
              <option value={1}>1人</option>
              <option value={2}>2人</option>
              <option value={3}>3人</option>
              <option value={4}>4人</option>
            </select>
          </div>
          <button
            className="btn"
            disabled={busy !== null}
            onClick={() => start("cpu")}
          >
            {busy === "cpu" ? "支度しています…" : "ひとりで打つ"}
          </button>
        </div>
      </div>

      {error && <p className="error-note">{error}</p>}

      <details className="rules">
        <summary>遊び方</summary>
        <div className="rules-body">
          <h3>道具</h3>
          <p>全員が同じ「一〜七」の数字札を七枚ずつ持ちます。それだけです。</p>

          <h3>ラウンドの流れ（全七ラウンド）</h3>
          <p>
            一、手札から一枚を伏せて選び、全員同時に「宣言値」を出します。嘘をついて構いません。三の札で「七」と言ってよいのです。
            <br />
            二、宣言値が最も大きい人が暫定勝者。同値なら先に宣言した方が取ります。
            <br />
            三、他の全員に約二十秒の「ダウト」の機会があります。早い者勝ちで一人だけ。
            <br />
            　・ダウト成立なら札を公開。嘘なら宣言者が一点失い、見破った側は二点得ます。本当なら宣言者が二点得て、疑った側が一点失います。
            <br />
            　・誰もダウトしなければ暫定勝者に一点。札は伏せられたまま誰にも見られません。
            <br />
            四、使った札は手元に戻りません。七ラウンドの後、最も点の多い者の勝ちです。
          </p>

          <h3>勘どころ</h3>
          <p>
            嘘はつき通せばバレずに終わります。札は戻らないので「あの人、七はもう使ったはずでは…」という数え読みが効きます。
            本物の七を出してわざとダウトを誘う、逆の仕掛けも立派な戦術です。
          </p>
        </div>
      </details>

      <p className="footer-note">影札 ― 二〜五人用</p>
    </div>
  );
}

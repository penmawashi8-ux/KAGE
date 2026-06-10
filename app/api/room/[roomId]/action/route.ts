import { NextRequest, NextResponse } from "next/server";
import { advance, applyDoubt, applyPass, applyPick, startGame, viewFor, addCpus, FILL_TARGET } from "@/lib/engine";
import { getRoom, saveRoom, setOpenRoomId, withLock } from "@/lib/store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** プレイヤーの操作: 札の宣言 / ダウト / 待機中の即時開始 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ roomId: string }> }
) {
  const { roomId } = await params;
  const body = await req.json().catch(() => ({}));
  const playerId = typeof body.playerId === "string" ? body.playerId : "";
  const type = body.type as string;
  const now = Date.now();

  const result = await withLock(`room:${roomId}`, async () => {
    const room = await getRoom(roomId);
    if (!room) return { status: 404, error: "ルームが見つかりません" };

    const you = room.players.find((p) => p.id === playerId);
    if (!you) return { status: 403, error: "このルームの参加者ではありません" };
    you.lastSeen = now;

    advance(room, now);

    let error: string | null = null;
    if (type === "pick") {
      error = applyPick(room, playerId, Number(body.card), Number(body.declared), now);
    } else if (type === "doubt") {
      error = applyDoubt(room, playerId, now);
    } else if (type === "pass") {
      error = applyPass(room, playerId);
    } else if (type === "start") {
      if (room.phase !== "waiting") {
        error = "すでに開始しています";
      } else {
        const humans = room.players.filter((p) => !p.isCpu).length;
        addCpus(room, Math.max(FILL_TARGET, humans) - room.players.length, now);
        startGame(room, now);
        await setOpenRoomId(null);
      }
    } else {
      error = "不明な操作です";
    }

    advance(room, now);
    await saveRoom(room);
    return { status: error ? 400 : 200, error, view: viewFor(room, playerId, now) };
  });

  if (result.status !== 200) {
    return NextResponse.json({ error: result.error }, { status: result.status });
  }
  return NextResponse.json(result.view);
}

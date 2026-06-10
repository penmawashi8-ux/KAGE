import { NextRequest, NextResponse } from "next/server";
import { MAX_PLAYERS, WAIT_MS, addHuman, advance, newRoom } from "@/lib/engine";
import { getOpenRoomId, getRoom, saveRoom, setOpenRoomId, withLock } from "@/lib/store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** ランダムマッチへの参加。受付中ルームがあれば合流、なければ新設する。 */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const name = typeof body.name === "string" ? body.name : "";
  const now = Date.now();

  const result = await withLock("match", async () => {
    const openId = await getOpenRoomId();
    let room = openId ? await getRoom(openId) : null;

    if (room) {
      advance(room, now);
      if (room.phase !== "waiting" || room.players.length >= MAX_PLAYERS) {
        if (openId) await saveRoom(room);
        room = null;
      }
    }

    if (!room) {
      room = newRoom(true, now);
    } else if (room.players.filter((p) => !p.isCpu).length === 0) {
      // 全員去った待機ルームを再利用するときは待ち時間を仕切り直す
      room.waitDeadline = now + WAIT_MS;
    }

    const player = addHuman(room, name, now);
    advance(room, now); // 5人揃ったら即開始
    await saveRoom(room);
    await setOpenRoomId(room.phase === "waiting" ? room.id : null);

    return { roomId: room.id, playerId: player.id };
  });

  return NextResponse.json(result);
}

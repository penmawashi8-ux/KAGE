import { NextRequest, NextResponse } from "next/server";
import { advance, viewFor } from "@/lib/engine";
import { deleteRoom, getRoom, saveRoom, withLock } from "@/lib/store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** 状態のポーリング。呼ばれるたびに状態機械を進める。 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ roomId: string }> }
) {
  const { roomId } = await params;
  const playerId = req.nextUrl.searchParams.get("p") ?? "";
  const now = Date.now();

  const view = await withLock(`room:${roomId}`, async () => {
    const room = await getRoom(roomId);
    if (!room) return null;

    const you = room.players.find((p) => p.id === playerId);
    if (you) you.lastSeen = now;

    advance(room, now);

    if (room.players.length === 0) {
      await deleteRoom(roomId);
      return null;
    }
    await saveRoom(room);
    return viewFor(room, playerId, now);
  });

  if (!view) {
    return NextResponse.json({ error: "ルームが見つかりません" }, { status: 404 });
  }
  return NextResponse.json(view);
}

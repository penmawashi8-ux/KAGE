import { NextRequest, NextResponse } from "next/server";
import { addCpus, addHuman, newRoom, startGame } from "@/lib/engine";
import { saveRoom } from "@/lib/store";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** CPUのみと対戦するルームを作って即開始する。 */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const name = typeof body.name === "string" ? body.name : "";
  const count = Math.min(4, Math.max(1, Number(body.cpuCount) || 3));
  const now = Date.now();

  const room = newRoom(false, now);
  const player = addHuman(room, name, now);
  addCpus(room, count, now);
  startGame(room, now);
  await saveRoom(room);

  return NextResponse.json({ roomId: room.id, playerId: player.id });
}

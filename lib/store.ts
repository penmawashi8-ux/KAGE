import type { Room } from "./types";

/**
 * ルーム保存層。
 * UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN があれば Upstash Redis を使い、
 * なければプロセス内メモリに保存する（ローカル開発・小規模運用向け）。
 */

const TTL_SEC = 2 * 60 * 60;

const REDIS_URL = process.env.UPSTASH_REDIS_REST_URL;
const REDIS_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;
const useRedis = !!REDIS_URL && !!REDIS_TOKEN;

type MemEntry = { value: string; exp: number };

const g = globalThis as unknown as {
  __kagefudaMem?: Map<string, MemEntry>;
  __kagefudaLocks?: Map<string, Promise<void>>;
};
const mem = (g.__kagefudaMem ??= new Map());
const memLocks = (g.__kagefudaLocks ??= new Map());

async function redis(cmd: (string | number)[]): Promise<unknown> {
  const res = await fetch(REDIS_URL!, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${REDIS_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(cmd),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`redis error: ${res.status}`);
  const data = (await res.json()) as { result: unknown };
  return data.result;
}

function memGet(key: string): string | null {
  const e = mem.get(key);
  if (!e) return null;
  if (Date.now() > e.exp) {
    mem.delete(key);
    return null;
  }
  return e.value;
}

function memSet(key: string, value: string): void {
  if (mem.size > 5000) {
    const now = Date.now();
    for (const [k, v] of mem) if (now > v.exp) mem.delete(k);
  }
  mem.set(key, { value, exp: Date.now() + TTL_SEC * 1000 });
}

async function kvGet(key: string): Promise<string | null> {
  if (useRedis) return (await redis(["GET", key])) as string | null;
  return memGet(key);
}

async function kvSet(key: string, value: string): Promise<void> {
  if (useRedis) {
    await redis(["SET", key, value, "EX", String(TTL_SEC)]);
    return;
  }
  memSet(key, value);
}

async function kvDel(key: string): Promise<void> {
  if (useRedis) {
    await redis(["DEL", key]);
    return;
  }
  mem.delete(key);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * 排他ロック。Redis では SET NX、メモリでは Promise チェーンで直列化する。
 */
export async function withLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  if (useRedis) {
    const lockKey = `lock:${key}`;
    for (let i = 0; i < 40; i++) {
      const ok = await redis(["SET", lockKey, "1", "NX", "PX", "5000"]);
      if (ok === "OK") break;
      await sleep(120);
    }
    try {
      return await fn();
    } finally {
      await redis(["DEL", lockKey]).catch(() => {});
    }
  }

  const prev = memLocks.get(key) ?? Promise.resolve();
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  memLocks.set(key, prev.then(() => gate));
  await prev;
  try {
    return await fn();
  } finally {
    release();
    if (memLocks.get(key) === gate) memLocks.delete(key);
  }
}

export async function getRoom(id: string): Promise<Room | null> {
  const raw = await kvGet(`room:${id}`);
  return raw ? (JSON.parse(raw) as Room) : null;
}

export async function saveRoom(room: Room): Promise<void> {
  await kvSet(`room:${room.id}`, JSON.stringify(room));
}

export async function deleteRoom(id: string): Promise<void> {
  await kvDel(`room:${id}`);
}

/** ランダムマッチで現在受付中のルームID */
export async function getOpenRoomId(): Promise<string | null> {
  return kvGet("openRoom");
}

export async function setOpenRoomId(id: string | null): Promise<void> {
  if (id === null) await kvDel("openRoom");
  else await kvSet("openRoom", id);
}

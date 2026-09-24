export interface Env {
  PK_POOL: KVNamespace;
}

type PkLineup = {
  id: string;
  playerId: string;
  trainerName: string;
  team: unknown[];
  power: number;
  wins: number;
  losses: number;
  pendingGold: number;
  updatedAt: number;
};

const KEY = "lineups";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "GET,PUT,POST,OPTIONS",
};

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...cors },
  });
}

async function load(env: Env): Promise<PkLineup[]> {
  const raw = await env.PK_POOL.get(KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as PkLineup[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function save(env: Env, list: PkLineup[]): Promise<void> {
  await env.PK_POOL.put(KEY, JSON.stringify(list));
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    if (req.method === "OPTIONS") return new Response(null, { headers: cors });
    const url = new URL(req.url);
    const path = url.pathname.replace(/\/$/, "") || "/";

    if (req.method === "GET" && path === "/lineups") {
      const list = await load(env);
      list.sort((a, b) => b.updatedAt - a.updatedAt);
      return json(list);
    }

    if (req.method === "PUT" && path === "/lineups") {
      const body = (await req.json()) as PkLineup;
      if (!body?.playerId || !Array.isArray(body.team) || body.team.length !== 3) {
        return json({ error: "bad lineup" }, 400);
      }
      if (String(body.playerId).startsWith("npc-")) {
        return json({ error: "npc lineup" }, 400);
      }
      const list = await load(env);
      const prev = list.find((x) => x.playerId === body.playerId);
      const next: PkLineup = {
        id: body.playerId,
        playerId: body.playerId,
        trainerName: String(body.trainerName || "队长").slice(0, 16),
        team: body.team,
        power: Number(body.power) || 0,
        wins: prev?.wins ?? 0,
        losses: prev?.losses ?? 0,
        pendingGold: prev?.pendingGold ?? 0,
        updatedAt: Date.now(),
      };
      await save(env, [next, ...list.filter((x) => x.playerId !== body.playerId)]);
      return json(next);
    }

    const result = path.match(/^\/lineups\/([^/]+)\/result$/);
    if (req.method === "POST" && result) {
      const foeId = decodeURIComponent(result[1] ?? "");
      const body = (await req.json()) as { playerId?: string; won?: boolean; stake?: number; selfOnly?: boolean };
      const list = await load(env);
      const mine = list.find((x) => x.playerId === body.playerId);
      if (body.selfOnly) {
        if (mine && !String(mine.playerId).startsWith("npc-")) {
          if (body.won) mine.wins += 1;
          else mine.losses += 1;
        }
        await save(env, list);
        return json(mine ?? { ok: true });
      }
      const foe = list.find((x) => x.playerId === foeId);
      const stake = Math.max(0, Math.floor(body.stake ?? 50));
      if (foe && !String(foe.playerId).startsWith("npc-")) {
        if (body.won) foe.losses += 1;
        else {
          foe.wins += 1;
          foe.pendingGold += stake;
        }
      }
      if (mine && !String(mine.playerId).startsWith("npc-")) {
        if (body.won) mine.wins += 1;
        else mine.losses += 1;
      }
      await save(env, list);
      return json(foe ?? { ok: true });
    }

    if (req.method === "POST" && path === "/me/collect") {
      const body = (await req.json()) as { playerId?: string };
      if (String(body.playerId ?? "").startsWith("npc-")) return json({ gold: 0 });
      const list = await load(env);
      const mine = list.find((x) => x.playerId === body.playerId);
      const gold = Math.max(0, Math.floor(mine?.pendingGold ?? 0));
      if (mine) mine.pendingGold = 0;
      await save(env, list);
      return json({ gold });
    }

    return json({ error: "not found" }, 404);
  },
};

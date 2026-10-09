import { sql } from "drizzle-orm";
import { z, ZodError } from "zod";
import { getDb, schema } from "./db";
import { readCookie, SESSION_COOKIE, userFromToken, type SessionUser } from "./auth";

export class HttpError extends Error {
  constructor(public status: number, public code: string, message?: string) {
    super(message ?? code);
  }
}

export const notFound = () => new HttpError(404, "not_found");
export const badRequest = (code: string, message?: string) => new HttpError(400, code, message);

export interface Ctx<P = Record<string, string>> {
  req: Request;
  user: SessionUser;
  params: P;
  body<T extends z.ZodType>(s: T): Promise<z.infer<T>>;
  query: URLSearchParams;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type RouteCtx = { params: Promise<any> };

interface Opts {
  /** Requests per window for this route, per user (or per IP when unauthenticated). */
  rateLimit?: { limit: number; windowSec: number; name: string };
  public?: boolean;
}

export function clientIp(req: Request) {
  return (req.headers.get("x-forwarded-for")?.split(",")[0] ?? req.headers.get("x-real-ip") ?? "local").trim();
}

/** Fixed-window rate limiter stored in the database (works across instances). */
export async function rateLimit(key: string, limit: number, windowSec: number) {
  const db = await getDb();
  const rows = await db.execute(sql`
    insert into ${schema.rateLimits} (key, window_start, count) values (${key}, now(), 1)
    on conflict (key) do update set
      count = case when ${schema.rateLimits.windowStart} < now() - make_interval(secs => ${windowSec}) then 1 else ${schema.rateLimits.count} + 1 end,
      window_start = case when ${schema.rateLimits.windowStart} < now() - make_interval(secs => ${windowSec}) then now() else ${schema.rateLimits.windowStart} end
    returning count`);
  const count = Number((rows as unknown as { rows: { count: number }[] }).rows[0]?.count ?? 0);
  if (count > limit) throw new HttpError(429, "rate_limited");
}

function checkOrigin(req: Request) {
  if (req.method === "GET" || req.method === "HEAD") return;
  const origin = req.headers.get("origin");
  if (!origin) return; // same-origin fetches from some browsers / server-to-server
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  try {
    if (new URL(origin).host !== host) throw new HttpError(403, "bad_origin");
  } catch (e) {
    if (e instanceof HttpError) throw e;
    throw new HttpError(403, "bad_origin");
  }
}

export function errorResponse(e: unknown) {
  if (e instanceof HttpError) return Response.json({ error: e.code, message: e.message }, { status: e.status });
  if (e instanceof ZodError) {
    return Response.json({ error: "validation", issues: e.issues.map((i) => ({ path: i.path.join("."), message: i.message })) }, { status: 400 });
  }
  console.error(e);
  return Response.json({ error: "server_error" }, { status: 500 });
}

export async function currentUser(req: Request) {
  return userFromToken(readCookie(req.headers.get("cookie"), SESSION_COOKIE));
}

export function route<P = Record<string, string>>(
  handler: (ctx: Ctx<P>) => Promise<unknown>,
  opts: Opts = {},
) {
  return async (req: Request, rc: RouteCtx): Promise<Response> => {
    try {
      checkOrigin(req);
      const user = await currentUser(req);
      if (!user && !opts.public) throw new HttpError(401, "unauthorized");
      if (opts.rateLimit) {
        const who = user?.id ?? clientIp(req);
        await rateLimit(`${opts.rateLimit.name}:${who}`, opts.rateLimit.limit, opts.rateLimit.windowSec);
      }
      const params = ((await rc?.params) ?? {}) as P;
      let parsed = false;
      const ctx: Ctx<P> = {
        req,
        user: user as SessionUser,
        params,
        query: new URL(req.url).searchParams,
        async body(s) {
          if (parsed) throw new Error("body already read");
          parsed = true;
          let raw: unknown;
          try {
            raw = await req.json();
          } catch {
            throw badRequest("invalid_json");
          }
          return s.parse(raw);
        },
      };
      const out = await handler(ctx);
      if (out instanceof Response) return out;
      return Response.json(out ?? { ok: true });
    } catch (e) {
      return errorResponse(e);
    }
  };
}

export const uuidSchema = z.string().uuid();
export function assertUuid(id: string) {
  if (!uuidSchema.safeParse(id).success) throw notFound();
  return id;
}

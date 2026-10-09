import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import { and, eq, gt, sql } from "drizzle-orm";
import { getDb, schema } from "./db";

export const SESSION_COOKIE = "mp_session";
const SESSION_DAYS = 30;

export function hashToken(token: string) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

export async function hashPassword(pw: string) {
  return bcrypt.hash(pw, 12);
}

export async function verifyPassword(pw: string, hash: string) {
  return bcrypt.compare(pw, hash);
}

export async function createSession(userId: string) {
  const db = await getDb();
  const token = crypto.randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 86400000);
  await db.insert(schema.sessions).values({ userId, tokenHash: hashToken(token), expiresAt });
  return { token, expiresAt };
}

export async function deleteSession(token: string) {
  const db = await getDb();
  await db.delete(schema.sessions).where(eq(schema.sessions.tokenHash, hashToken(token)));
}

export interface SessionUser {
  id: string;
  email: string;
  name: string;
  isDemo: boolean;
}

export async function userFromToken(token: string | undefined | null): Promise<SessionUser | null> {
  if (!token || token.length > 200) return null;
  const db = await getDb();
  const rows = await db
    .select({ id: schema.users.id, email: schema.users.email, name: schema.users.name, isDemo: schema.users.isDemo })
    .from(schema.sessions)
    .innerJoin(schema.users, eq(schema.users.id, schema.sessions.userId))
    .where(and(eq(schema.sessions.tokenHash, hashToken(token)), gt(schema.sessions.expiresAt, new Date())))
    .limit(1);
  return rows[0] ?? null;
}

export function sessionCookie(token: string, expiresAt: Date) {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Expires=${expiresAt.toUTCString()}${secure}`;
}

export function clearSessionCookie() {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}

export function readCookie(header: string | null, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return decodeURIComponent(v.join("="));
  }
  return undefined;
}

export async function findUserByEmail(email: string) {
  const db = await getDb();
  const rows = await db.select().from(schema.users).where(sql`lower(${schema.users.email}) = ${email.toLowerCase()}`).limit(1);
  return rows[0] ?? null;
}

/** Remove expired sessions (called opportunistically from the scheduler). */
export async function purgeExpiredSessions() {
  const db = await getDb();
  await db.delete(schema.sessions).where(sql`${schema.sessions.expiresAt} < now()`);
}

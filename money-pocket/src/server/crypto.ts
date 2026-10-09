import crypto from "node:crypto";

/** AES-256-GCM encryption for secrets at rest (OAuth tokens). Key derived from APP_SECRET. */
function key() {
  const secret = process.env.APP_SECRET;
  if (!secret || secret.length < 16) throw new Error("APP_SECRET (min 16 chars) must be set to store integration tokens");
  return crypto.createHash("sha256").update("money-pocket:" + secret).digest();
}

export function encrypt(plain: string): string {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv("aes-256-gcm", key(), iv);
  const enc = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return [iv, c.getAuthTag(), enc].map((b) => b.toString("base64url")).join(".");
}

export function decrypt(payload: string): string {
  const [iv, tag, enc] = payload.split(".").map((p) => Buffer.from(p, "base64url"));
  const d = crypto.createDecipheriv("aes-256-gcm", key(), iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(enc), d.final()]).toString("utf8");
}

export function randomToken(bytes = 24) {
  return crypto.randomBytes(bytes).toString("base64url");
}

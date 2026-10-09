import { getDb } from "@/server/db";
import { badRequest, route } from "@/server/http";
import { listReceipts, MAX_UPLOAD, uploadReceipt } from "@/server/services/receipts";

export const GET = route(async ({ user }) => listReceipts(await getDb(), user.id));

export const POST = route(async ({ user, req }) => {
  const len = Number(req.headers.get("content-length") ?? 0);
  if (len > MAX_UPLOAD + 64 * 1024) throw badRequest("file_too_large");
  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!file || typeof file === "string") throw badRequest("file_required");
  const mode = form?.get("mode") === "banknote" ? "banknote" : "receipt";
  const buf = Buffer.from(await file.arrayBuffer());
  return uploadReceipt(await getDb(), user.id, buf, mode);
}, { rateLimit: { name: "upload", limit: 60, windowSec: 3600 } });

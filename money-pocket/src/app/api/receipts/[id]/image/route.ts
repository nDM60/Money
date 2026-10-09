import { getDb } from "@/server/db";
import { assertUuid, route } from "@/server/http";
import { receiptImage } from "@/server/services/receipts";

export const GET = route<{ id: string }>(async ({ user, params }) => {
  const r = await receiptImage(await getDb(), user.id, assertUuid(params.id));
  return new Response(new Uint8Array(r.image!), {
    headers: { "content-type": r.mime, "cache-control": "private, max-age=3600", "content-security-policy": "default-src 'none'", "x-content-type-options": "nosniff" },
  });
});

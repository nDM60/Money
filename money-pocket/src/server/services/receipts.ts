import crypto from "node:crypto";
import { and, desc, eq, ne } from "drizzle-orm";
import { z } from "zod";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { schema } from "../db";
import { DEFAULT_CATEGORIES } from "@/lib/domain";
import { CURRENCY_CODES, parseAmount } from "@/lib/money";
import { isDateStr } from "@/lib/dates";
import { HttpError, badRequest, notFound } from "../http";
import { aiConfigured, anthropic, AI_MODEL, FALLBACK_BETA } from "../ai";
import type { Exec } from "./common";
import { findPossibleDuplicates } from "./transactions";
import { getSettings } from "./settings";

export const MAX_UPLOAD = 8 * 1024 * 1024;
const MAGIC: [string, (b: Buffer) => boolean][] = [
  ["image/jpeg", (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff],
  ["image/png", (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))],
  ["image/webp", (b) => b.subarray(0, 4).toString() === "RIFF" && b.subarray(8, 12).toString() === "WEBP"],
  ["image/gif", (b) => b.subarray(0, 4).toString() === "GIF8"],
];

/** Detect the real image type from file contents; the declared type is not trusted. */
export function sniffImage(buf: Buffer): string | null {
  for (const [mime, test] of MAGIC) if (buf.length > 12 && test(buf)) return mime;
  return null;
}

const confidence = z.number().describe("0 to 1");
export const receiptSchema = z.object({
  readable: z.boolean().describe("false if the image is not a legible financial document"),
  documentType: z.enum(["receipt", "restaurant_bill", "utility_bill", "invoice", "bank_slip", "other"]),
  merchant: z.string().nullable(),
  date: z.string().nullable().describe("YYYY-MM-DD"),
  time: z.string().nullable().describe("HH:MM 24h"),
  total: z.string().nullable().describe("Grand total paid, plain decimal like 125000 or 12.50, no separators"),
  currency: z.string().nullable().describe("ISO 4217 code, e.g. LAK, THB, VND, USD"),
  tax: z.string().nullable(),
  items: z.array(z.object({ name: z.string(), quantity: z.string().nullable(), amount: z.string().nullable() })),
  paymentMethod: z.enum(["cash", "bank_transfer", "card", "qr", "ewallet", "other"]).nullable(),
  reference: z.string().nullable().describe("Receipt / invoice / transaction reference number"),
  suggestedCategory: z.enum(DEFAULT_CATEGORIES.filter((c) => c.kind === "expense").map((c) => c.key) as [string, ...string[]]).nullable(),
  confidence: z.object({ merchant: confidence, date: confidence, total: confidence, currency: confidence }),
  uncertainty: z.string().nullable().describe("Short explanation of anything unclear"),
});
export type ReceiptExtraction = z.infer<typeof receiptSchema>;

export const banknoteSchema = z.object({
  readable: z.boolean(),
  notes: z.array(z.object({
    currency: z.string().describe("ISO code: LAK, THB, VND, USD or other"),
    denomination: z.string().describe("Face value as a plain number"),
    count: z.number().int(),
    confidence,
  })),
  uncertainty: z.string().nullable(),
});
export type BanknoteExtraction = z.infer<typeof banknoteSchema>;

export interface Extractor {
  receipt(image: Buffer, mime: string, hints: { currency: string; language: string }): Promise<ReceiptExtraction>;
  banknote(image: Buffer, mime: string): Promise<BanknoteExtraction>;
}

const RECEIPT_PROMPT = `Extract the transaction details from this image of a receipt, bill, invoice or bank transfer slip.
Only report what is visible in the image. Use null for anything you cannot read, and lower the confidence
for fields that are blurry, partially hidden or ambiguous. Amounts are plain decimal strings without thousands
separators. Lao kip (₭, LAK), Thai baht (฿, THB), Vietnamese dong (₫, VND) and US dollars are common.`;

const BANKNOTE_PROMPT = `Identify the banknotes visible in this image: currency and face value of each, and how many of each.
Supported currencies are Lao kip (LAK), Thai baht (THB), Vietnamese dong (VND) and US dollars (USD).
Do not guess when a note is unclear: give it a low confidence and explain in "uncertainty".`;

export const claudeExtractor: Extractor = {
  async receipt(image, mime, hints) {
    const res = await anthropic().beta.messages.parse({
      model: AI_MODEL,
      max_tokens: 16000,
      betas: [FALLBACK_BETA],
      fallbacks: "default",
      output_config: { format: betaZodOutputFormat(receiptSchema), effort: "medium" },
      messages: [{
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: mime as "image/jpeg", data: image.toString("base64") } },
          { type: "text", text: `${RECEIPT_PROMPT}\nThe user's main currency is ${hints.currency}.` },
        ],
      }],
    });
    if (res.stop_reason === "refusal" || !res.parsed_output) throw new HttpError(422, "extraction_failed");
    return res.parsed_output;
  },
  async banknote(image, mime) {
    const res = await anthropic().beta.messages.parse({
      model: AI_MODEL,
      max_tokens: 16000,
      betas: [FALLBACK_BETA],
      fallbacks: "default",
      output_config: { format: betaZodOutputFormat(banknoteSchema), effort: "medium" },
      messages: [{
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: mime as "image/jpeg", data: image.toString("base64") } },
          { type: "text", text: BANKNOTE_PROMPT },
        ],
      }],
    });
    if (res.stop_reason === "refusal" || !res.parsed_output) throw new HttpError(422, "extraction_failed");
    return res.parsed_output;
  },
};

export async function uploadReceipt(db: Exec, userId: string, buf: Buffer, mode: "receipt" | "banknote") {
  if (buf.length === 0) throw badRequest("empty_file");
  if (buf.length > MAX_UPLOAD) throw new HttpError(413, "file_too_large");
  const mime = sniffImage(buf);
  if (!mime) throw new HttpError(415, "unsupported_image", "Upload a JPEG, PNG, WebP or GIF image");
  const sha256 = crypto.createHash("sha256").update(buf).digest("hex");
  const [dup] = await db.select({ id: schema.receipts.id, status: schema.receipts.status, transactionId: schema.receipts.transactionId })
    .from(schema.receipts).where(and(eq(schema.receipts.userId, userId), eq(schema.receipts.sha256, sha256), ne(schema.receipts.status, "discarded"))).limit(1);
  const [r] = await db.insert(schema.receipts).values({ userId, mode, mimeType: mime, size: buf.length, sha256, image: buf }).returning({ id: schema.receipts.id });
  return { id: r.id, duplicateOf: dup ?? null };
}

export async function getReceipt(db: Exec, userId: string, id: string) {
  const [r] = await db.select({
    id: schema.receipts.id, mode: schema.receipts.mode, mimeType: schema.receipts.mimeType, size: schema.receipts.size,
    status: schema.receipts.status, extracted: schema.receipts.extracted, error: schema.receipts.error,
    transactionId: schema.receipts.transactionId, createdAt: schema.receipts.createdAt,
  }).from(schema.receipts).where(and(eq(schema.receipts.id, id), eq(schema.receipts.userId, userId)));
  if (!r) throw notFound();
  return r;
}

export async function receiptImage(db: Exec, userId: string, id: string) {
  const [r] = await db.select({ image: schema.receipts.image, mime: schema.receipts.mimeType }).from(schema.receipts)
    .where(and(eq(schema.receipts.id, id), eq(schema.receipts.userId, userId)));
  if (!r?.image) throw notFound();
  return r;
}

/** Run AI extraction. The result is only a draft — nothing is recorded until the user confirms. */
export async function extractReceipt(db: Exec, userId: string, id: string, extractor: Extractor | null = aiConfigured() ? claudeExtractor : null) {
  const [r] = await db.select().from(schema.receipts).where(and(eq(schema.receipts.id, id), eq(schema.receipts.userId, userId)));
  if (!r || !r.image) throw notFound();
  if (!extractor) throw new HttpError(503, "ai_not_configured", "Receipt recognition needs ANTHROPIC_API_KEY on the server");
  const s = await getSettings(userId, db);
  try {
    if (r.mode === "banknote") {
      const out = await extractor.banknote(r.image, r.mimeType);
      await db.update(schema.receipts).set({ extracted: out, status: "extracted", error: null }).where(eq(schema.receipts.id, id));
      return { mode: "banknote" as const, banknote: out };
    }
    const out = await extractor.receipt(r.image, r.mimeType, { currency: s.primaryCurrency, language: s.language });
    await db.update(schema.receipts).set({ extracted: out, status: "extracted", error: null }).where(eq(schema.receipts.id, id));
    return { mode: "receipt" as const, receipt: out, draft: await draftFromReceipt(db, userId, out, s.primaryCurrency) };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await db.update(schema.receipts).set({ status: "error", error: msg.slice(0, 300) }).where(eq(schema.receipts.id, id));
    throw e instanceof HttpError ? e : new HttpError(502, "extraction_failed");
  }
}

/** Turn an extraction into an editable transaction draft, flagging uncertain fields. */
export async function draftFromReceipt(db: Exec, userId: string, x: ReceiptExtraction, fallbackCurrency: string) {
  const currency = x.currency && (CURRENCY_CODES as string[]).includes(x.currency.toUpperCase()) ? x.currency.toUpperCase() : fallbackCurrency;
  const amount = x.total ? parseAmount(x.total, currency) : null;
  const date = x.date && isDateStr(x.date) ? x.date : null;
  const cats = await db.select().from(schema.categories).where(and(eq(schema.categories.userId, userId), eq(schema.categories.kind, "expense")));
  const cat = x.suggestedCategory ? cats.find((c) => c.systemKey === x.suggestedCategory) : null;
  const uncertain: string[] = [];
  if (!x.merchant || x.confidence.merchant < 0.7) uncertain.push("merchant");
  if (!date || x.confidence.date < 0.7) uncertain.push("date");
  if (!amount || x.confidence.total < 0.8) uncertain.push("amount");
  if (!x.currency || x.confidence.currency < 0.7 || currency !== x.currency?.toUpperCase()) uncertain.push("currency");
  if (!cat) uncertain.push("category");
  const duplicates = amount && date ? await findPossibleDuplicates(db, userId, { amount, currency, date, merchant: x.merchant }) : [];
  return {
    type: "expense" as const,
    amount, currency, date,
    time: x.time && /^\d{2}:\d{2}$/.test(x.time) ? x.time : null,
    merchant: x.merchant,
    description: x.merchant ?? "",
    categoryId: cat?.id ?? null,
    paymentMethod: x.paymentMethod,
    notes: [x.reference ? `Ref: ${x.reference}` : null, x.tax ? `Tax: ${x.tax}` : null, x.items.length ? x.items.map((i) => `${i.quantity ? i.quantity + "× " : ""}${i.name}${i.amount ? " " + i.amount : ""}`).join("\n") : null].filter(Boolean).join("\n") || null,
    uncertain,
    duplicates: duplicates.map((d) => ({ id: d.id, date: d.localDate, amount: d.amount, currency: d.currency, description: d.description, merchant: d.merchant })),
  };
}

export async function listReceipts(db: Exec, userId: string) {
  return db.select({
    id: schema.receipts.id, mode: schema.receipts.mode, status: schema.receipts.status, size: schema.receipts.size,
    transactionId: schema.receipts.transactionId, createdAt: schema.receipts.createdAt,
  }).from(schema.receipts).where(eq(schema.receipts.userId, userId)).orderBy(desc(schema.receipts.createdAt)).limit(100);
}

/** Delete the image and all extracted data; detach it from any transaction. */
export async function deleteReceipt(db: Exec, userId: string, id: string) {
  const [r] = await db.delete(schema.receipts).where(and(eq(schema.receipts.id, id), eq(schema.receipts.userId, userId))).returning({ id: schema.receipts.id });
  if (!r) throw notFound();
  await db.update(schema.transactions).set({ receiptId: null }).where(and(eq(schema.transactions.userId, userId), eq(schema.transactions.receiptId, id)));
}

export async function discardReceipt(db: Exec, userId: string, id: string) {
  await db.update(schema.receipts).set({ status: "discarded" }).where(and(eq(schema.receipts.id, id), eq(schema.receipts.userId, userId)));
}

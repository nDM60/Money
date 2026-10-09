"use client";
import { useEffect, useRef, useState } from "react";
import { Camera, Upload, Trash2, ScanLine, AlertTriangle, Lock } from "lucide-react";
import { useApp, errorText } from "@/client/app";
import { api, ApiError } from "@/client/api";
import { Modal, Segmented, Spinner } from "./ui";
import { CURRENCY_CODES, parseAmount } from "@/lib/money";

interface Banknote { currency: string; denomination: string; count: number; confidence: number }
interface ExtractResult {
  mode: "receipt" | "banknote";
  receipt?: { readable: boolean; documentType: string; uncertainty: string | null };
  draft?: Record<string, unknown> & { uncertain: string[] };
  banknote?: { readable: boolean; notes: Banknote[]; uncertainty: string | null };
}

export function Scanner({ initialMode, onClose }: { initialMode: "receipt" | "banknote"; onClose: () => void }) {
  const { t, me, open, close, money } = useApp();
  const [mode, setMode] = useState(initialMode);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [receiptId, setReceiptId] = useState<string | null>(null);
  const [dup, setDup] = useState(false);
  const [busy, setBusy] = useState<"" | "upload" | "extract">("");
  const [error, setError] = useState<string | null>(null);
  const [notConfigured, setNotConfigured] = useState(!me?.features.ai);
  const [notes, setNotes] = useState<Banknote[] | null>(null);
  const [uncertainty, setUncertainty] = useState<string | null>(null);
  const camRef = useRef<HTMLInputElement>(null);
  const upRef = useRef<HTMLInputElement>(null);

  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);

  async function pick(f: File | undefined) {
    if (!f) return;
    setError(null);
    setNotes(null);
    if (f.size > 8 * 1024 * 1024) return setError(t("scan.too_large"));
    setFile(f);
    setPreview(URL.createObjectURL(f));
    setBusy("upload");
    try {
      const fd = new FormData();
      fd.set("file", f);
      fd.set("mode", mode);
      const r = await api<{ id: string; duplicateOf: unknown }>("/api/receipts", { form: fd });
      setReceiptId(r.id);
      setDup(!!r.duplicateOf);
      if (me?.features.ai) await extract(r.id);
    } catch (e) {
      setError(errorText(t, e));
    } finally {
      setBusy("");
    }
  }

  async function extract(id: string) {
    setBusy("extract");
    setError(null);
    try {
      const r = await api<ExtractResult>(`/api/receipts/${id}/extract`, { method: "POST", body: {} });
      if (r.mode === "receipt" && r.draft) {
        if (r.receipt && !r.receipt.readable) setError(t("scan.unreadable"));
        else {
          const d = r.draft;
          open("tx", { prefill: { ...d, type: "expense", receiptId: id, amount: (d.amount as number | null) ?? null } as never });
          close("scanner");
        }
      } else if (r.banknote) {
        if (!r.banknote.readable) setError(t("scan.unreadable"));
        setNotes(r.banknote.notes);
        setUncertainty(r.banknote.uncertainty);
      }
    } catch (e) {
      if (e instanceof ApiError && e.code === "ai_not_configured") setNotConfigured(true);
      else setError(t("scan.failed"));
    } finally {
      setBusy("");
    }
  }

  async function removeImage() {
    if (receiptId) await api(`/api/receipts/${receiptId}`, { method: "DELETE" }).catch(() => {});
    setReceiptId(null);
    setFile(null);
    setPreview(null);
    setNotes(null);
  }

  function manual() {
    open("tx", { prefill: { type: "expense", receiptId } });
    close("scanner");
  }

  const totals = (notes ?? []).reduce<Record<string, number>>((acc, n) => {
    const v = parseAmount(n.denomination, n.currency);
    if (v !== null && (CURRENCY_CODES as string[]).includes(n.currency)) acc[n.currency] = (acc[n.currency] ?? 0) + v * Math.max(0, n.count);
    return acc;
  }, {});

  return (
    <Modal open onClose={onClose} title={t("scan.title")}
      footer={receiptId ? <>
        <button className="btn btn-danger mr-auto" onClick={removeImage}><Trash2 size={16} /> {t("scan.delete_image")}</button>
        {mode === "receipt" && <button className="btn btn-soft" onClick={manual}>{t("scan.manual")}</button>}
      </> : undefined}>
      <div className="space-y-4">
        <Segmented value={mode} onChange={(m) => { setMode(m); setNotes(null); }} options={[{ value: "receipt", label: t("scan.mode.receipt") }, { value: "banknote", label: t("scan.mode.banknote") }]} />

        <input ref={camRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => pick(e.target.files?.[0])} />
        <input ref={upRef} type="file" accept="image/jpeg,image/png,image/webp,image/gif" className="hidden" onChange={(e) => pick(e.target.files?.[0])} />

        {!file && (
          <div className="grid grid-cols-2 gap-3">
            <button className="flex flex-col items-center gap-2 rounded-2xl border-2 border-dashed border-line p-6 text-sm font-semibold text-ink hover:border-brand" onClick={() => camRef.current?.click()}>
              <Camera size={28} className="text-brand" /> {t("scan.take_photo")}
            </button>
            <button className="flex flex-col items-center gap-2 rounded-2xl border-2 border-dashed border-line p-6 text-sm font-semibold text-ink hover:border-brand" onClick={() => upRef.current?.click()}>
              <Upload size={28} className="text-brand" /> {t("scan.upload")}
            </button>
          </div>
        )}

        {preview && (
          <div className="relative overflow-hidden rounded-2xl border border-line bg-card-2">
            <img src={preview} alt="" className="mx-auto max-h-72 object-contain" />
            {busy && (
              <div className="absolute inset-0 flex items-center justify-center gap-2 bg-black/50 text-sm font-semibold text-white">
                <Spinner /> {busy === "extract" ? t("scan.analyzing") : t("common.loading")}
              </div>
            )}
          </div>
        )}

        {dup && <p className="flex items-center gap-2 text-xs font-medium text-warn"><AlertTriangle size={14} /> {t("scan.duplicate_image")}</p>}
        {notConfigured && (
          <div className="rounded-xl bg-card-2 p-3 text-xs text-ink-2">
            <p>{t("scan.not_configured")}</p>
            {file && mode === "receipt" && <button className="btn btn-primary btn-sm mt-2" onClick={manual}>{t("scan.manual")}</button>}
          </div>
        )}
        {receiptId && !notConfigured && !busy && !notes && error && (
          <button className="btn btn-soft w-full" onClick={() => extract(receiptId)}><ScanLine size={16} /> {t("scan.extract")}</button>
        )}
        {error && <p className="text-sm font-medium text-bad" role="alert">{error}</p>}

        {notes && (
          <div className="space-y-2">
            <h3 className="text-sm font-semibold">{t("scan.banknotes_found")}</h3>
            {uncertainty && <p className="text-xs text-warn">⚠ {uncertainty}</p>}
            <div className="overflow-hidden rounded-xl border border-line">
              <table className="w-full text-sm">
                <thead className="bg-card-2 text-xs text-muted"><tr><th className="p-2 text-left">{t("common.currency")}</th><th className="p-2 text-left">{t("scan.denomination")}</th><th className="p-2 text-left">{t("scan.count")}</th><th className="p-2 text-right">{t("scan.confidence")}</th></tr></thead>
                <tbody>
                  {notes.map((n, i) => (
                    <tr key={i} className="border-t border-line">
                      <td className="p-1.5"><select className="input !py-1" value={n.currency} onChange={(e) => setNotes(notes.map((x, j) => j === i ? { ...x, currency: e.target.value } : x))}>{[...CURRENCY_CODES, ...(CURRENCY_CODES.includes(n.currency as never) ? [] : [n.currency])].map((c) => <option key={c}>{c}</option>)}</select></td>
                      <td className="p-1.5"><input className="input num !py-1" value={n.denomination} onChange={(e) => setNotes(notes.map((x, j) => j === i ? { ...x, denomination: e.target.value } : x))} /></td>
                      <td className="p-1.5"><input className="input num !w-16 !py-1" type="number" min={0} value={n.count} onChange={(e) => setNotes(notes.map((x, j) => j === i ? { ...x, count: Number(e.target.value) } : x))} /></td>
                      <td className={`p-2 text-right text-xs ${n.confidence < 0.7 ? "text-warn" : "text-muted"}`}>{n.confidence < 0.7 ? "⚠ " : ""}{Math.round(n.confidence * 100)}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {Object.entries(totals).map(([c, v]) => (
              <div key={c} className="flex items-center justify-between rounded-xl bg-card-2 p-3">
                <span className="text-sm">{t("scan.banknote_total")}: <b className="num">{money(v, c)}</b></span>
                <button className="btn btn-primary btn-sm" onClick={() => { open("tx", { prefill: { type: "expense", amount: v, currency: c, receiptId } }); close("scanner"); }}>{t("scan.use_amount")}</button>
              </div>
            ))}
          </div>
        )}
        <p className="flex items-center gap-1.5 text-[11px] text-muted"><Lock size={12} /> {t("scan.privacy")}</p>
      </div>
    </Modal>
  );
}

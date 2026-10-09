"use client";
import { useState } from "react";
import useSWR from "swr";
import clsx from "clsx";
import { Plus, Pencil, Trash2, TrendingUp, Archive } from "lucide-react";
import { useApp, errorText } from "@/client/app";
import { api, fetcher } from "@/client/api";
import type { Category } from "@/client/types";
import { Card, Empty, Field, Loading, Meter, Modal, PageHeader, SectionTitle, Segmented } from "@/components/ui";
import { IconTile } from "@/components/icon";
import { ColorPicker, IconPicker } from "@/components/forms/forms";
import type { Key } from "@/lib/i18n";

interface BudgetRow { id: string; categoryId: string | null; period: string; amount: number; currency: string; rollover: boolean; thresholds: number[]; active: boolean }
interface Status { id: string; spent: number; available: number; remaining: number; carried: number; ratio: number | null; window: { start: string; end: string } }
interface Data { budgets: BudgetRow[]; status: Status[]; unusual: { categoryId: string; current: number; average: number; change: number }[] }

export default function BudgetsPage() {
  const { t } = useApp();
  const [tab, setTab] = useState<"budgets" | "categories">("budgets");
  return (
    <div>
      <PageHeader title={t("budgets.title")} actions={<Segmented value={tab} onChange={setTab} options={[{ value: "budgets", label: t("budgets.title") }, { value: "categories", label: t("cat.title") }]} />} />
      {tab === "budgets" ? <Budgets /> : <Categories />}
    </div>
  );
}

function Budgets() {
  const { t, money, categories, catLabel, open, confirm, refresh, date } = useApp();
  const { data, mutate } = useSWR<Data>("/api/budgets", fetcher);
  if (!data) return <Loading />;
  const statusOf = new Map(data.status.map((s) => [s.id, s]));
  return (
    <div className="grid gap-5 lg:grid-cols-[1fr_320px]">
      <Card className="p-5">
        <SectionTitle title={t("budgets.title")} action={<button className="btn btn-primary btn-sm" onClick={() => open("budget", {})}><Plus size={15} />{t("budgets.add")}</button>} />
        {data.budgets.length === 0 ? <Empty title={t("budgets.empty")} /> : (
          <ul className="space-y-5">
            {data.budgets.map((b) => {
              const s = statusOf.get(b.id);
              const c = categories.find((x) => x.id === b.categoryId);
              const r = s ? (s.available > 0 ? s.spent / s.available : s.spent > 0 ? 1 : 0) : 0;
              const tone = r >= 1 ? "var(--bad)" : r >= 0.8 ? "var(--warn)" : "var(--good)";
              return (
                <li key={b.id} className={clsx(!b.active && "opacity-50")}>
                  <div className="mb-2 flex items-center gap-3">
                    {c ? <IconTile name={c.icon} color={c.color} size={36} /> : <IconTile name="wallet" color="var(--brand)" size={36} />}
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold">{c ? catLabel(c) : t("budgets.overall")}</p>
                      <p className="text-xs text-muted">{t(`period.${b.period}` as Key)}{s ? ` · ${date(s.window.start, "short")} – ${date(s.window.end, "short")}` : ""}{b.rollover ? " · ↻" : ""}</p>
                    </div>
                    <div className="text-right text-sm">
                      {s && <p className={clsx("num font-semibold", s.remaining < 0 && "text-neg")}>{s.remaining < 0 ? t("budgets.over", { amount: money(-s.remaining) }) : t("budgets.left", { amount: money(s.remaining) })}</p>}
                      {s && <p className="num text-xs text-muted">{t("budgets.spent", { spent: money(s.spent), limit: money(s.available) })}</p>}
                    </div>
                    <div className="flex">
                      <button className="btn btn-ghost btn-sm !px-2" aria-label={t("common.edit")} onClick={() => open("budget", { existing: b as unknown as Record<string, unknown> })}><Pencil size={15} /></button>
                      <button className="btn btn-ghost btn-sm !px-2" aria-label={t("common.delete")} onClick={async () => { if (await confirm(t("common.are_you_sure"))) { await api(`/api/budgets/${b.id}`, { method: "DELETE" }); await refresh(); mutate(); } }}><Trash2 size={15} /></button>
                    </div>
                  </div>
                  <Meter value={r} color={tone} label={`${Math.round(r * 100)}%`} />
                  <div className="mt-1 flex justify-between text-[11px] text-muted">
                    <span>{Math.round(r * 100)}%</span>
                    <span>{s?.carried ? t("budgets.carried", { amount: money(s.carried) }) : ""} {t("budgets.alerts")} {b.thresholds.join("/")}%</span>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
      <Card className="h-fit p-5">
        <SectionTitle title={t("budgets.unusual")} />
        {data.unusual.length === 0 ? <p className="text-sm text-muted">{t("budgets.no_unusual")}</p> : (
          <ul className="space-y-3">
            {data.unusual.map((u) => {
              const c = categories.find((x) => x.id === u.categoryId);
              return (
                <li key={u.categoryId} className="flex gap-3 text-sm">
                  <TrendingUp size={18} className="mt-0.5 shrink-0 text-warn" />
                  <div>
                    <p>{t("budgets.unusual_item", { name: catLabel(c), pct: u.change })}</p>
                    <p className="num text-xs text-muted">{money(u.current)} vs {money(u.average)}</p>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </div>
  );
}

function Categories() {
  const { t, categories, catLabel, refresh, toast, confirm } = useApp();
  const [edit, setEdit] = useState<Partial<Category> | null>(null);
  async function remove(c: Category) {
    if (!(await confirm(t("cat.archived_note")))) return;
    await api(`/api/categories/${c.id}`, { method: "DELETE" });
    await refresh();
  }
  const kinds: ("expense" | "income")[] = ["expense", "income"];
  return (
    <div className="grid gap-5 lg:grid-cols-2">
      {kinds.map((k) => (
        <Card key={k} className="p-5">
          <SectionTitle title={t(k === "expense" ? "cat.expense" : "cat.income")} action={<button className="btn btn-soft btn-sm" onClick={() => setEdit({ kind: k })}><Plus size={15} />{t("cat.add")}</button>} />
          <ul className="space-y-1">
            {categories.filter((c) => c.kind === k && !c.parentId).map((c) => (
              <div key={c.id}>
                <CatRow c={c} onEdit={() => setEdit(c)} onDelete={() => remove(c)} label={catLabel(c)} />
                {categories.filter((s) => s.parentId === c.id).map((s) => <div key={s.id} className="pl-8"><CatRow c={s} onEdit={() => setEdit(s)} onDelete={() => remove(s)} label={catLabel(s)} /></div>)}
              </div>
            ))}
          </ul>
        </Card>
      ))}
      {edit && <CategoryForm initial={edit} onClose={() => setEdit(null)} onSaved={async () => { await refresh(); toast(t("common.saved"), { tone: "ok" }); }} />}
    </div>
  );
}

function CatRow({ c, label, onEdit, onDelete }: { c: Category; label: string; onEdit: () => void; onDelete: () => void }) {
  const { t } = useApp();
  return (
    <li className={clsx("group flex items-center gap-3 rounded-xl px-2 py-1.5 hover:bg-card-2", c.archived && "opacity-50")}>
      <IconTile name={c.icon} color={c.color} size={32} />
      <span className="flex-1 text-sm">{label}{c.archived && <Archive size={12} className="ml-1 inline text-muted" />}</span>
      <button className="btn btn-ghost btn-sm !px-2" onClick={onEdit} aria-label={t("common.edit")}><Pencil size={14} /></button>
      {!c.archived && <button className="btn btn-ghost btn-sm !px-2" onClick={onDelete} aria-label={t("common.delete")}><Trash2 size={14} /></button>}
    </li>
  );
}

function CategoryForm({ initial, onClose, onSaved }: { initial: Partial<Category>; onClose: () => void; onSaved: () => void }) {
  const { t, categories, catLabel } = useApp();
  const [name, setName] = useState(initial.id ? catLabel(initial as Category) : "");
  const [color, setColor] = useState(initial.color ?? "#0f766e");
  const [icon, setIcon] = useState(initial.icon ?? "circle");
  const [parentId, setParentId] = useState(initial.parentId ?? "");
  const [error, setError] = useState<string | null>(null);
  const kind = initial.kind ?? "expense";
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    try {
      const body = { name, kind, color, icon, parentId: parentId || null };
      if (initial.id) await api(`/api/categories/${initial.id}`, { method: "PATCH", body: { ...body, archived: false } });
      else await api("/api/categories", { body });
      onSaved();
      onClose();
    } catch (err) {
      setError(errorText(t, err));
    }
  }
  return (
    <Modal open onClose={onClose} title={initial.id ? t("common.edit") : t("cat.add")}
      footer={<><button className="btn btn-soft" onClick={onClose}>{t("common.cancel")}</button><button form="cat-form" className="btn btn-primary">{t("common.save")}</button></>}>
      <form id="cat-form" onSubmit={submit} className="space-y-4">
        <Field label={t("common.name")}><input className="input" value={name} onChange={(e) => setName(e.target.value)} required maxLength={60} /></Field>
        <Field label={t("cat.parent")}>
          <select className="input" value={parentId} onChange={(e) => setParentId(e.target.value)}>
            <option value="">{t("common.none")}</option>
            {categories.filter((c) => c.kind === kind && !c.parentId && c.id !== initial.id).map((c) => <option key={c.id} value={c.id}>{catLabel(c)}</option>)}
          </select>
        </Field>
        <Field label={t("common.color")}><ColorPicker value={color} onChange={setColor} /></Field>
        <Field label={t("common.icon")}><IconPicker value={icon} onChange={setIcon} color={color} /></Field>
        {error && <p className="text-sm text-bad">{error}</p>}
      </form>
    </Modal>
  );
}

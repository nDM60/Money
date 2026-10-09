"use client";
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Line, LineChart, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import { useApp } from "@/client/app";

type Row = Record<string, number | string>;

function useAxis() {
  const { money, date, lang } = useApp();
  const tick = (v: number) => money(v, undefined, { compact: true, code: false });
  const label = (k: string) => (k.length === 7 ? new Intl.DateTimeFormat(lang, { month: "short", timeZone: "UTC" }).format(new Date(k + "-01T00:00:00Z")) : date(k, "short"));
  return { tick, label, money };
}

function TooltipBox({ active, payload, label, fmtLabel }: { active?: boolean; payload?: { name: string; value: number; color: string; dataKey: string }[]; label?: string; fmtLabel: (l: string) => string }) {
  const { money } = useApp();
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-xl border border-line bg-card px-3 py-2 text-xs shadow-lg">
      {label && <div className="mb-1 font-semibold text-ink">{fmtLabel(String(label))}</div>}
      {payload.map((p) => (
        <div key={p.dataKey} className="flex items-center gap-2 py-0.5">
          <span className="h-2.5 w-2.5 rounded-sm" style={{ background: p.color }} />
          <span className="text-ink-2">{p.name}</span>
          <span className="num ml-auto pl-3 font-semibold text-ink">{money(p.value)}</span>
        </div>
      ))}
    </div>
  );
}

export function Legend({ items }: { items: { label: string; color: string }[] }) {
  return (
    <div className="mb-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-2">
      {items.map((i) => (
        <span key={i.label} className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-sm" style={{ background: i.color }} />{i.label}</span>
      ))}
    </div>
  );
}

const axisProps = { tickLine: false, axisLine: false, fontSize: 11 } as const;

export function CashflowChart({ data, height = 240 }: { data: { key: string; income: number; expense: number }[]; height?: number }) {
  const { t } = useApp();
  const { tick, label } = useAxis();
  return (
    <div>
      <Legend items={[{ label: t("dash.income"), color: "var(--income)" }, { label: t("dash.expenses"), color: "var(--expense)" }]} />
      <div style={{ height }}>
        <ResponsiveContainer>
          <BarChart data={data} barGap={2} barCategoryGap="22%" margin={{ top: 6, right: 4, left: 0, bottom: 0 }}>
            <CartesianGrid vertical={false} />
            <XAxis dataKey="key" tickFormatter={label} {...axisProps} minTickGap={12} />
            <YAxis tickFormatter={tick} {...axisProps} width={52} />
            <Tooltip content={<TooltipBox fmtLabel={label} />} cursor={{ fill: "var(--grid)", opacity: 0.6 }} />
            <Bar dataKey="income" name={t("dash.income")} fill="var(--income)" radius={[4, 4, 0, 0]} maxBarSize={24} />
            <Bar dataKey="expense" name={t("dash.expenses")} fill="var(--expense)" radius={[4, 4, 0, 0]} maxBarSize={24} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

export function TrendChart({ data, dataKey = "expense", color = "var(--expense)", name, height = 220 }: { data: Row[]; dataKey?: string; color?: string; name: string; height?: number }) {
  const { tick, label } = useAxis();
  const id = `g-${dataKey}`;
  return (
    <div style={{ height }}>
      <ResponsiveContainer>
        <AreaChart data={data} margin={{ top: 6, right: 4, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity={0.16} />
              <stop offset="100%" stopColor={color} stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <CartesianGrid vertical={false} />
          <XAxis dataKey="key" tickFormatter={label} {...axisProps} minTickGap={16} />
          <YAxis tickFormatter={tick} {...axisProps} width={52} />
          <Tooltip content={<TooltipBox fmtLabel={label} />} cursor={{ stroke: "var(--line)" }} />
          <Area type="monotone" dataKey={dataKey} name={name} stroke={color} strokeWidth={2} fill={`url(#${id})`} activeDot={{ r: 4, strokeWidth: 2, stroke: "var(--card)" }} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

export function LinesChart({ data, lines, height = 220 }: { data: Row[]; lines: { key: string; name: string; color: string }[]; height?: number }) {
  const { tick, label } = useAxis();
  return (
    <div>
      {lines.length > 1 && <Legend items={lines.map((l) => ({ label: l.name, color: l.color }))} />}
      <div style={{ height }}>
        <ResponsiveContainer>
          <LineChart data={data} margin={{ top: 6, right: 8, left: 0, bottom: 0 }}>
            <CartesianGrid vertical={false} />
            <XAxis dataKey="key" tickFormatter={label} {...axisProps} minTickGap={16} />
            <YAxis tickFormatter={tick} {...axisProps} width={56} domain={["auto", "auto"]} />
            <Tooltip content={<TooltipBox fmtLabel={label} />} cursor={{ stroke: "var(--line)" }} />
            {lines.map((l) => (
              <Line key={l.key} type="monotone" dataKey={l.key} name={l.name} stroke={l.color} strokeWidth={2} dot={false} activeDot={{ r: 4, strokeWidth: 2, stroke: "var(--card)" }} />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

/** Donut + labelled list (identity never relies on color alone). */
export function DonutList({ items, total, emptyText, onSelect }: { items: { id: string; label: string; color: string; amount: number }[]; total: number; emptyText: string; onSelect?: (id: string) => void }) {
  const { money } = useApp();
  if (!items.length || total <= 0) return <p className="py-8 text-center text-sm text-muted">{emptyText}</p>;
  // Keep at most 7 slices; fold the rest into "Other".
  const shown = items.slice(0, 7);
  const rest = items.slice(7).reduce((s, i) => s + i.amount, 0);
  const slices = rest > 0 ? [...shown, { id: "other", label: "…", color: "#94a3b8", amount: rest }] : shown;
  return (
    <div className="grid items-center gap-4 sm:grid-cols-[180px_1fr]">
      <div className="relative mx-auto h-[180px] w-[180px]">
        <ResponsiveContainer>
          <PieChart>
            <Pie data={slices} dataKey="amount" nameKey="label" innerRadius={58} outerRadius={86} paddingAngle={1.5} stroke="var(--card)" strokeWidth={2} isAnimationActive={false}>
              {slices.map((s) => <Cell key={s.id} fill={s.color} />)}
            </Pie>
            <Tooltip formatter={(v) => money(Number(v))} contentStyle={{ background: "var(--card)", border: "1px solid var(--line)", borderRadius: 12, fontSize: 12 }} />
          </PieChart>
        </ResponsiveContainer>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <span className="num text-sm font-bold text-ink">{money(total, undefined, { compact: true })}</span>
        </div>
      </div>
      <ul className="space-y-1.5">
        {slices.map((s) => (
          <li key={s.id}>
            <button type="button" disabled={!onSelect || s.id === "other"} onClick={() => onSelect?.(s.id)} className="flex w-full items-center gap-2 rounded-lg px-1 py-1 text-left text-sm hover:bg-card-2 disabled:hover:bg-transparent">
              <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: s.color }} />
              <span className="min-w-0 flex-1 truncate text-ink-2">{s.label}</span>
              <span className="num font-semibold text-ink">{money(s.amount)}</span>
              <span className="num w-10 text-right text-xs text-muted">{Math.round((s.amount / total) * 100)}%</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Horizontal bars for account distribution, labelled with names and values. */
export function DistributionBars({ items }: { items: { id: string; label: string; color: string; value: number }[] }) {
  const { money } = useApp();
  const max = Math.max(1, ...items.map((i) => Math.abs(i.value)));
  return (
    <ul className="space-y-3">
      {items.map((i) => (
        <li key={i.id}>
          <div className="mb-1 flex items-center justify-between gap-2 text-sm">
            <span className="flex min-w-0 items-center gap-2 text-ink-2"><span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: i.color }} /><span className="truncate">{i.label}</span></span>
            <span className={`num font-semibold ${i.value < 0 ? "text-neg" : "text-ink"}`}>{money(i.value)}</span>
          </div>
          <div className="meter !h-1.5"><i style={{ width: `${(Math.abs(i.value) / max) * 100}%`, background: i.color }} /></div>
        </li>
      ))}
    </ul>
  );
}

export function BarsSimple({ data, dataKey, name, color, height = 200 }: { data: Row[]; dataKey: string; name: string; color: string; height?: number }) {
  const { tick, label } = useAxis();
  return (
    <div style={{ height }}>
      <ResponsiveContainer>
        <BarChart data={data} margin={{ top: 6, right: 4, left: 0, bottom: 0 }}>
          <CartesianGrid vertical={false} />
          <XAxis dataKey="key" tickFormatter={label} {...axisProps} minTickGap={12} />
          <YAxis tickFormatter={tick} {...axisProps} width={52} />
          <Tooltip content={<TooltipBox fmtLabel={label} />} cursor={{ fill: "var(--grid)", opacity: 0.6 }} />
          <Bar dataKey={dataKey} name={name} fill={color} radius={[4, 4, 0, 0]} maxBarSize={24} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

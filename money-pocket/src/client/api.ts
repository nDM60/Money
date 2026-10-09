export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string, public issues?: { path: string; message: string }[], public extra?: Record<string, unknown>) {
    super(message);
  }
}

export async function api<T = unknown>(url: string, opts: { method?: string; body?: unknown; form?: FormData } = {}): Promise<T> {
  const res = await fetch(url, {
    method: opts.method ?? (opts.body !== undefined || opts.form ? "POST" : "GET"),
    headers: opts.form ? undefined : { "content-type": "application/json" },
    body: opts.form ?? (opts.body !== undefined ? JSON.stringify(opts.body) : undefined),
    credentials: "same-origin",
  });
  const text = await res.text();
  const data = text ? (() => { try { return JSON.parse(text); } catch { return text; } })() : null;
  if (!res.ok) {
    if (res.status === 401 && typeof window !== "undefined" && !url.startsWith("/api/auth")) window.location.href = "/login";
    throw new ApiError(res.status, data?.error ?? "error", data?.message ?? data?.error ?? res.statusText, data?.issues, data);
  }
  return data as T;
}

export const fetcher = <T,>(url: string) => api<T>(url);

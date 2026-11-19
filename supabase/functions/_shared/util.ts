// Shared helpers for every Nexlyr for Students edge function.
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";

const ALLOWED = (Deno.env.get("ALLOWED_ORIGINS") ??
  "https://students.nexlyr.solutions,https://admin.students.nexlyr.solutions,http://localhost:3000,http://localhost:5173,http://127.0.0.1:8080")
  .split(",").map((s) => s.trim()).filter(Boolean);

export function cors(req: Request): Record<string, string> {
  const origin = req.headers.get("origin") ?? "";
  const ok = ALLOWED.includes(origin) || /^https:\/\/[a-z0-9-]+\.vercel\.app$/.test(origin);
  return {
    "Access-Control-Allow-Origin": ok ? origin : ALLOWED[0],
    "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
}

export function json(req: Request, body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...cors(req), "Content-Type": "application/json" } });
}
export const fail = (req: Request, reason: string, status = 400, extra: Record<string, unknown> = {}) =>
  json(req, { ok: false, reason, ...extra }, status);

/** Service-role client: bypasses row security. Only ever used inside these functions. */
export function service(): SupabaseClient {
  return createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/** The signed-in caller, or null. */
export async function caller(req: Request, db: SupabaseClient) {
  const token = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!token) return null;
  const { data } = await db.auth.getUser(token);
  if (!data?.user) return null;
  const { data: p } = await db.from("profiles").select("id, role, code, full_name, status").eq("id", data.user.id).single();
  if (!p || p.status !== "active") return null;
  return p as { id: string; role: "student" | "teacher" | "admin"; code: string; full_name: string; status: string };
}

export async function ipHash(req: Request): Promise<string> {
  const ip = (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || req.headers.get("cf-connecting-ip") || "unknown";
  const salt = Deno.env.get("IP_SALT") ?? "nexlyr-students";
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(salt + ip));
  return Array.from(new Uint8Array(buf)).slice(0, 12).map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** true = allowed (and counted). Sliding window on the rate_limits table. */
export async function allow(db: SupabaseClient, bucket: string, max: number, minutes: number): Promise<boolean> {
  const since = new Date(Date.now() - minutes * 60_000).toISOString();
  const { count } = await db.from("rate_limits").select("id", { count: "exact", head: true }).eq("bucket", bucket).gte("created_at", since);
  if ((count ?? 0) >= max) return false;
  await db.from("rate_limits").insert({ bucket });
  return true;
}

export async function notifyAdmins(db: SupabaseClient, title: string, body: string, link: string) {
  const { data } = await db.from("profiles").select("id").eq("role", "admin").eq("status", "active");
  if (data?.length) await db.from("notifications").insert(data.map((a) => ({ recipient_id: a.id, kind: "payment", title, body, link })));
}

export const clean = (v: unknown, max = 200) => String(v ?? "").replace(/[\u0000-\u001f]/g, " ").trim().slice(0, max);
export const emailOk = (e: string) => /^[^\s@]{1,64}@[^\s@]{1,190}\.[a-z]{2,24}$/i.test(e);
export const phoneOk = (p: string) => p.replace(/\D/g, "").length >= 7 && p.replace(/\D/g, "").length <= 15;

const FILE_OK: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "application/pdf": "pdf" };

/** Stores a payment slip in the private slips bucket and returns its path. */
export async function saveSlip(db: SupabaseClient, owner: string, file: File | null): Promise<string | null | "bad"> {
  if (!file || !file.size) return null;
  const ext = FILE_OK[file.type];
  if (!ext || file.size > 8 * 1024 * 1024) return "bad";
  const path = `${owner}/${Date.now()}.${ext}`;
  const { error } = await db.storage.from("slips").upload(path, file, { contentType: file.type, upsert: false });
  return error ? "bad" : path;
}

export function randomPassword(): string {
  const words = ["Orbit", "Prism", "Quartz", "Delta", "Cobalt", "Vector", "Signal", "Harbor", "Summit", "Atlas"];
  const n = crypto.getRandomValues(new Uint32Array(3));
  return `${words[n[0] % words.length]}-${words[n[1] % words.length]}-${1000 + (n[2] % 9000)}`;
}
export function classCode(): string {
  const A = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  return Array.from(crypto.getRandomValues(new Uint8Array(6)), (b) => A[b % A.length]).join("");
}

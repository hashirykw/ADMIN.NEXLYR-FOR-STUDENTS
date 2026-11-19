// POST /functions/v1/admin  (JSON, admins only)
// Everything that needs the service role: creating teacher / admin logins, resetting passwords,
// suspending accounts and granting plans by hand. Every action is written to audit_log.
import { caller, classCode, clean, cors, emailOk, fail, json, randomPassword, service } from "../_shared/util.ts";
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";

type Body = Record<string, unknown>;
const slugify = (s: string) => s.toLowerCase().replace(/^(sir|miss|ms|mr|mrs|dr)\.?\s+/, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 50) || "teacher";

async function uniqueSlug(db: SupabaseClient, base: string) {
  for (let i = 0; i < 50; i++) {
    const s = i ? `${base}-${i + 1}` : base;
    const { count } = await db.from("teachers").select("id", { count: "exact", head: true }).eq("slug", s);
    if (!count) return s;
  }
  return `${base}-${Date.now() % 10000}`;
}
async function uniqueCode(db: SupabaseClient) {
  for (;;) {
    const c = classCode();
    const { count } = await db.from("teachers").select("id", { count: "exact", head: true }).eq("class_code", c);
    if (!count) return c;
  }
}

async function makeTeacher(db: SupabaseClient, b: { name: string; email: string; phone?: string; subjects?: string[]; levels?: string[]; city?: string; rate?: number; checks?: number }) {
  const password = randomPassword();
  const { data, error } = await db.auth.admin.createUser({ email: b.email, password, email_confirm: true, user_metadata: { full_name: b.name, phone: b.phone ?? "" } });
  if (error || !data?.user) throw new Error(/already|registered|exists/i.test(error?.message ?? "") ? "email_taken" : "auth");
  const uid = data.user.id;
  const { data: code } = await db.rpc("set_role", { p_user: uid, p_role: "teacher" });
  const slug = await uniqueSlug(db, slugify(b.name));
  const class_code = await uniqueCode(db);
  const { error: tErr } = await db.from("teachers").insert({
    id: uid, slug, display_name: b.name, subjects: b.subjects ?? [], levels: b.levels?.length ? b.levels : ["O", "A"],
    city: b.city ?? null, class_code, rate_per_student: b.rate ?? 500, checks_per_student: b.checks ?? 20,
  });
  if (tErr) throw new Error("teacher_row");
  return { user_id: uid, code, slug, class_code, email: b.email, password };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors(req) });
  if (req.method !== "POST") return fail(req, "method", 405);
  const db = service();
  const me = await caller(req, db);
  if (!me || me.role !== "admin") return fail(req, "admins_only", 403);

  let b: Body;
  try { b = await req.json(); } catch { return fail(req, "json"); }
  const action = clean(b.action, 40);
  const log = (target: string, detail: Body = {}) => db.from("audit_log").insert({ actor_id: me.id, action: `admin.${action}`, target, detail });

  try {
    switch (action) {
      case "approve_teacher": {
        const { data: app } = await db.from("teacher_applications").select("*").eq("id", Number(b.application_id)).single();
        if (!app || app.status !== "pending") return fail(req, "application");
        const out = await makeTeacher(db, { name: app.full_name, email: app.email, phone: app.phone, subjects: app.subjects, levels: app.levels, city: app.city, rate: Number(b.rate) || 500, checks: Number(b.checks) || 20 });
        await db.from("teacher_applications").update({ status: "approved", teacher_id: out.user_id, reviewed_by: me.id, reviewed_at: new Date().toISOString() }).eq("id", app.id);
        await log(out.user_id, { application: app.id });
        return json(req, { ok: true, ...out });
      }
      case "reject_teacher": {
        await db.from("teacher_applications").update({ status: "rejected", reviewed_by: me.id, reviewed_at: new Date().toISOString() }).eq("id", Number(b.application_id)).eq("status", "pending");
        await log(String(b.application_id));
        return json(req, { ok: true });
      }
      case "create_teacher": {
        const name = clean(b.name, 80), email = clean(b.email, 200).toLowerCase();
        if (name.length < 2 || !emailOk(email)) return fail(req, "fields");
        const subjects = Array.isArray(b.subjects) ? (b.subjects as unknown[]).map((s) => clean(s, 10)).filter(Boolean) : [];
        const out = await makeTeacher(db, { name, email, phone: clean(b.phone, 24), subjects, levels: ["O", "A"], city: clean(b.city, 60), rate: Number(b.rate) || 500, checks: Number(b.checks) || 20 });
        await log(out.user_id);
        return json(req, { ok: true, ...out });
      }
      case "create_admin": {
        const name = clean(b.name, 80), email = clean(b.email, 200).toLowerCase();
        if (!emailOk(email)) return fail(req, "fields");
        const password = randomPassword();
        const { data, error } = await db.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { full_name: name } });
        if (error || !data?.user) return fail(req, /already/i.test(error?.message ?? "") ? "email_taken" : "auth");
        const { data: code } = await db.rpc("set_role", { p_user: data.user.id, p_role: "admin" });
        await log(data.user.id);
        return json(req, { ok: true, email, password, code });
      }
      case "reset_password": {
        const uid = clean(b.user_id, 40);
        if (uid === me.id) return fail(req, "self");
        const password = randomPassword();
        const { error } = await db.auth.admin.updateUserById(uid, { password });
        if (error) return fail(req, "auth");
        await log(uid);
        return json(req, { ok: true, password });
      }
      case "set_status": {
        const uid = clean(b.user_id, 40), status = b.status === "suspended" ? "suspended" : "active";
        if (uid === me.id) return fail(req, "self");
        await db.from("profiles").update({ status }).eq("id", uid);
        await db.auth.admin.updateUserById(uid, { ban_duration: status === "suspended" ? "876000h" : "none" });
        await log(uid, { status });
        return json(req, { ok: true });
      }
      case "grant_plan": {
        const uid = clean(b.user_id, 40), plan = clean(b.plan_id, 20), days = Math.min(400, Math.max(1, Number(b.days) || 30));
        const { data: p } = await db.from("plans").select("id, name").eq("id", plan).eq("audience", "student").maybeSingle();
        if (!p) return fail(req, "plan");
        const ends = new Date(Date.now() + days * 86400_000).toISOString();
        await db.from("subscriptions").insert({ student_id: uid, plan_id: plan, ends_at: ends });
        await db.from("notifications").insert({ recipient_id: uid, kind: "payment", title: `${p.name} plan added`, body: `Active for ${days} days.`, link: "/portal" });
        await log(uid, { plan, days });
        return json(req, { ok: true, ends_at: ends });
      }
      default:
        return fail(req, "action");
    }
  } catch (e) {
    const m = (e as Error).message;
    return fail(req, m === "email_taken" ? m : "server", m === "email_taken" ? 409 : 500);
  }
});

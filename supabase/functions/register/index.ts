// POST /functions/v1/register  (multipart/form-data, no login needed)
//
// kind=student → creates the student's login in one step, joins a teacher's class if a class code
//                was given, and files the payment slip for a paid plan (admin approves it later).
// kind=teacher → files a teacher application for the admin to approve.
//
// Improves on the englishwithsxa fee-slip flow: the account exists the moment the form is sent
// (the student can sign in and use the Free plan straight away), the slip is tied to that account,
// and the admin gets a bell notification instead of a WhatsApp forward.
import { allow, clean, cors, emailOk, fail, ipHash, json, notifyAdmins, phoneOk, saveSlip, service } from "../_shared/util.ts";

const PAID = ["student", "pro"];
const METHODS = ["Bank transfer", "JazzCash", "Easypaisa", "Raast", "Card / abroad"];

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors(req) });
  if (req.method !== "POST") return fail(req, "method", 405);

  let form: FormData;
  try { form = await req.formData(); } catch { return fail(req, "form"); }
  if (clean(form.get("website"))) return json(req, { ok: true });           // honeypot: bots fill every field

  const db = service();
  const ip = await ipHash(req);
  const kind = clean(form.get("kind"), 10) === "teacher" ? "teacher" : "student";
  if (!(await allow(db, `${kind}:${ip}`, kind === "teacher" ? 3 : 6, 60))) return fail(req, "too_many", 429);

  const name = clean(form.get("name"), 80);
  const email = clean(form.get("email"), 200).toLowerCase();
  const phone = clean(form.get("phone"), 24);
  const country = clean(form.get("country"), 60) || "Pakistan";
  if (name.length < 2) return fail(req, "name");
  if (!emailOk(email)) return fail(req, "email");
  if (!phoneOk(phone)) return fail(req, "phone");

  // ───────── teacher application ─────────
  if (kind === "teacher") {
    const list = (k: string) => clean(form.get(k), 400).split(",").map((s) => s.trim()).filter(Boolean).slice(0, 30);
    const { error } = await db.from("teacher_applications").insert({
      full_name: name, email, phone, country, city: clean(form.get("city"), 60),
      subjects: list("subjects"), levels: list("levels"), experience: clean(form.get("experience"), 300),
      students: clean(form.get("students"), 60), links: clean(form.get("links"), 500), note: clean(form.get("note"), 1000), ip_hash: ip,
    });
    if (error) return fail(req, "server", 500);
    await notifyAdmins(db, "New teacher application", `${name} · ${list("subjects").join(", ") || "subjects not given"}`, "/#teachers");
    return json(req, { ok: true, kind });
  }

  // ───────── student account ─────────
  const password = String(form.get("password") ?? "");
  if (password.length < 8 || password.length > 72) return fail(req, "password");
  const level = ["O", "A", "Both"].includes(clean(form.get("level"), 4)) ? clean(form.get("level"), 4) : "O";
  const plan = clean(form.get("plan"), 20) || "free";
  const { data: planRow } = await db.from("plans").select("id, name, price_pkr, audience, active").eq("id", plan).maybeSingle();
  if (!planRow || !planRow.active || planRow.audience !== "student") return fail(req, "plan");

  const proof = form.get("proof") instanceof File ? form.get("proof") as File : null;
  const paid = PAID.includes(plan) && planRow.price_pkr > 0;
  if (paid && (!proof || !proof.size) && !clean(form.get("reference"), 80)) return fail(req, "proof");

  const { data: created, error: authErr } = await db.auth.admin.createUser({
    email, password, email_confirm: true,
    user_metadata: { full_name: name, phone, country, level, school: clean(form.get("school"), 120) },
  });
  if (authErr || !created?.user) {
    const taken = /already|registered|exists/i.test(authErr?.message ?? "");
    return fail(req, taken ? "email_taken" : "server", taken ? 409 : 500);
  }
  const uid = created.user.id;
  const { data: profile } = await db.from("profiles").select("code").eq("id", uid).single();

  // optional class code → join teacher
  let teacher: string | null = null;
  const code = clean(form.get("class_code"), 12).toUpperCase();
  if (code) {
    const { data: t } = await db.from("teachers").select("id, display_name").eq("class_code", code).maybeSingle();
    if (t) {
      await db.from("class_members").upsert({ teacher_id: t.id, student_id: uid, status: "active" });
      await db.from("notifications").insert({ recipient_id: t.id, kind: "class", title: "New student in your class", body: `${name} (${profile?.code}) joined with your class code.`, link: "/#students" });
      teacher = t.display_name;
    }
  }

  // paid plan → slip
  let pending = false;
  if (paid) {
    const slip = await saveSlip(db, uid, proof);
    if (slip === "bad") return json(req, { ok: true, code: profile?.code, teacher, pending: false, slip: "bad" });
    const months = Math.min(12, Math.max(1, parseInt(clean(form.get("months"), 2)) || 1));
    const method = METHODS.includes(clean(form.get("method"), 30)) ? clean(form.get("method"), 30) : "Bank transfer";
    await db.from("payments").insert({
      kind: "plan", student_id: uid, plan_id: plan, months, amount_pkr: planRow.price_pkr * months,
      method, reference: clean(form.get("reference"), 80), slip_path: slip, payer_note: clean(form.get("note"), 500),
    });
    await notifyAdmins(db, "New payment slip", `${name} · ${planRow.name} × ${months} · Rs ${planRow.price_pkr * months}`, "/#payments");
    pending = true;
  }

  return json(req, { ok: true, kind, code: profile?.code, plan: planRow.name, teacher, pending });
});

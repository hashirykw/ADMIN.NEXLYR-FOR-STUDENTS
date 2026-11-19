// POST /functions/v1/payment  (multipart/form-data, signed in)
// A signed-in student upgrades / renews a plan, or a teacher pays a monthly invoice, by sending a slip.
import { allow, caller, clean, cors, fail, json, notifyAdmins, saveSlip, service } from "../_shared/util.ts";

const METHODS = ["Bank transfer", "JazzCash", "Easypaisa", "Raast", "Card / abroad"];

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors(req) });
  if (req.method !== "POST") return fail(req, "method", 405);
  const db = service();
  const me = await caller(req, db);
  if (!me) return fail(req, "signin", 401);
  if (!(await allow(db, `pay:${me.id}`, 8, 60))) return fail(req, "too_many", 429);

  let form: FormData;
  try { form = await req.formData(); } catch { return fail(req, "form"); }
  const proof = form.get("proof") instanceof File ? form.get("proof") as File : null;
  const reference = clean(form.get("reference"), 80);
  if ((!proof || !proof.size) && !reference) return fail(req, "proof");
  const method = METHODS.includes(clean(form.get("method"), 30)) ? clean(form.get("method"), 30) : "Bank transfer";
  const note = clean(form.get("note"), 500);

  // one open slip at a time per thing being paid, so double taps don't create duplicates
  if (me.role === "teacher") {
    const invoiceId = parseInt(clean(form.get("invoice_id"), 12));
    const { data: inv } = await db.from("invoices").select("id, amount_pkr, month, status").eq("id", invoiceId).eq("teacher_id", me.id).maybeSingle();
    if (!inv || inv.status !== "unpaid") return fail(req, "invoice");
    const { count } = await db.from("payments").select("id", { count: "exact", head: true }).eq("invoice_id", inv.id).eq("status", "pending");
    if (count) return fail(req, "already_pending", 409);
    const slip = await saveSlip(db, me.id, proof);
    if (slip === "bad") return fail(req, "file_type");
    await db.from("payments").insert({ kind: "teacher_invoice", teacher_id: me.id, invoice_id: inv.id, amount_pkr: inv.amount_pkr, method, reference, slip_path: slip, payer_note: note });
    await notifyAdmins(db, "Teacher invoice slip", `${me.full_name} · Rs ${inv.amount_pkr} for ${inv.month}`, "/#payments");
    return json(req, { ok: true });
  }

  const plan = clean(form.get("plan"), 20);
  const { data: planRow } = await db.from("plans").select("id, name, price_pkr, audience, active").eq("id", plan).maybeSingle();
  if (!planRow || !planRow.active || planRow.audience !== "student" || planRow.price_pkr <= 0) return fail(req, "plan");
  const { count } = await db.from("payments").select("id", { count: "exact", head: true }).eq("student_id", me.id).eq("status", "pending");
  if (count) return fail(req, "already_pending", 409);
  const months = Math.min(12, Math.max(1, parseInt(clean(form.get("months"), 2)) || 1));
  const slip = await saveSlip(db, me.id, proof);
  if (slip === "bad") return fail(req, "file_type");
  await db.from("payments").insert({ kind: "plan", student_id: me.id, plan_id: plan, months, amount_pkr: planRow.price_pkr * months, method, reference, slip_path: slip, payer_note: note });
  await notifyAdmins(db, "New payment slip", `${me.full_name} (${me.code}) · ${planRow.name} × ${months} · Rs ${planRow.price_pkr * months}`, "/#payments");
  return json(req, { ok: true, plan: planRow.name });
});

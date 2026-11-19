/* Admin panel core: helpers, modal, and the data layer (live Supabase, or preview data). */
(function () {
  const C = window.NX_CONFIG || {};
  const live = !!(C.SUPABASE_URL && C.SUPABASE_KEY && window.supabase);
  const db = live ? window.supabase.createClient(C.SUPABASE_URL, C.SUPABASE_KEY, { auth: { persistSession: true, autoRefreshToken: true, storageKey: "nx-admin-auth" } }) : null;
  const D = window.NX_DEMO || { subjects: [], plans: [] };

  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const esc = (t) => String(t == null ? "" : t).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const date = (d, o) => d ? new Date(d).toLocaleDateString("en-GB", o || { day: "numeric", month: "short", year: "numeric" }) : "—";
  const short = (d) => date(d, { day: "numeric", month: "short" });
  const ago = (d) => { const s = (Date.now() - new Date(d)) / 1000; return s < 60 ? "just now" : s < 3600 ? Math.floor(s / 60) + " min ago" : s < 86400 ? Math.floor(s / 3600) + " h ago" : short(d); };
  const rs = (n) => n == null ? "—" : "Rs " + Number(n).toLocaleString("en-PK");
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const btn = (el, state, ms) => { if (!el) return; if (!state) { el.removeAttribute("data-state"); el.disabled = false; return; } el.setAttribute("data-state", state); el.disabled = state === "loading"; if (ms) setTimeout(() => btn(el, null), ms); };
  const tag = (s) => ({ pending: "tag-warn", unpaid: "tag-warn", overdue: "tag-bad", rejected: "tag-bad", suspended: "tag-bad", failed: "tag-bad", approved: "tag-good", paid: "tag-good", active: "tag-good", done: "tag-good", waived: "", paused: "tag-warn" })[s] || "";
  const pill = (s, label) => `<span class="tag ${tag(s)}">${esc(label || s)}</span>`;
  const subName = (id) => { const s = D.subjects.find((x) => x.id === +id) || (window.NX && NX.subjects || []).find((x) => x.id === +id); return s ? `${s.level === "A" ? "A" : "O"} · ${s.name} ${s.code}` : "—"; };

  // toast
  let tb;
  function toast(msg, action) {
    if (!tb) { tb = document.createElement("div"); tb.className = "toasts"; tb.setAttribute("aria-live", "polite"); document.body.appendChild(tb); }
    tb.innerHTML = ""; const t = document.createElement("div"); t.className = "toast";
    t.innerHTML = `<span>${esc(msg)}</span>` + (action ? `<button type="button">${esc(action.label)}</button>` : "");
    if (action) t.querySelector("button").onclick = () => { action.run(); t.remove(); };
    tb.appendChild(t); requestAnimationFrame(() => t.classList.add("on"));
    setTimeout(() => { t.classList.remove("on"); setTimeout(() => t.remove(), 300); }, action ? 6000 : 3400);
  }

  // modal
  let last;
  function modal(title, sub, html, opts = {}) {
    const m = $("#m"); last = document.activeElement;
    $("#mTitle").textContent = title; $("#mSub").textContent = sub || ""; $("#mSub").hidden = !sub;
    $("#mBody").innerHTML = html; $("#mCard").classList.toggle("wide", !!opts.wide);
    m.classList.add("open"); m.setAttribute("aria-hidden", "false"); document.documentElement.style.overflow = "hidden";
    const f = $("#mBody input:not([type=hidden]), #mBody select, #mBody textarea"); (f || $("#mBody button") || $(".modal-x")).focus({ preventScroll: true });
    return $("#mBody");
  }
  function close() { const m = $("#m"); if (!m.classList.contains("open")) return; m.classList.remove("open"); m.setAttribute("aria-hidden", "true"); document.documentElement.style.overflow = ""; last && last.focus && last.focus({ preventScroll: true }); }
  document.addEventListener("click", (e) => { if (e.target.closest("[data-close]") || e.target.id === "m") close(); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") close(); });

  // a form inside the modal: fields = [{ name, label, type, value, options, required, hint, full }]
  function formHtml(fields, submit) {
    const f = (x) => {
      const v = x.value == null ? "" : x.value, id = "f_" + x.name;
      let input;
      if (x.type === "select") input = `<select class="select" id="${id}" name="${x.name}">${x.options.map((o) => { const [val, lab] = Array.isArray(o) ? o : [o, o]; return `<option value="${esc(val)}" ${String(val) === String(v) ? "selected" : ""}>${esc(lab)}</option>`; }).join("")}</select>`;
      else if (x.type === "textarea") input = `<textarea class="textarea" id="${id}" name="${x.name}" rows="${x.rows || 4}" ${x.required ? "required" : ""}>${esc(v)}</textarea>`;
      else if (x.type === "switch") return `<label class="switch ok"><input type="checkbox" name="${x.name}" ${v ? "checked" : ""}> ${esc(x.label)}</label>`;
      else if (x.type === "file") input = `<input class="input" id="${id}" name="${x.name}" type="file" accept="${esc(x.accept || "")}" ${x.required ? "required" : ""} style="padding-top:12px">`;
      else input = `<input class="input${x.mono ? " mono" : ""}" id="${id}" name="${x.name}" type="${x.type || "text"}" value="${esc(v)}" ${x.required ? "required" : ""} ${x.min != null ? `min="${x.min}"` : ""} ${x.max != null ? `max="${x.max}"` : ""} ${x.placeholder ? `placeholder="${esc(x.placeholder)}"` : ""} autocomplete="off">`;
      return `<div class="field" ${x.full ? 'style="grid-column:1/-1"' : ""}><label for="${id}">${esc(x.label)}${x.hint ? ` <small>${esc(x.hint)}</small>` : ""}</label>${input}<span class="err">${esc(x.err || "Required.")}</span></div>`;
    };
    return `<form class="form" id="mForm" novalidate><div class="grid-2">${fields.map(f).join("")}</div><p class="note note-bad" id="mErr" hidden></p><button class="btn btn-primary" type="submit">${esc(submit || "Save")}</button></form>`;
  }
  function onForm(handler) {
    const form = $("#mForm");
    form.addEventListener("submit", async (e) => {
      e.preventDefault(); let ok = true;
      $$("[required]", form).forEach((i) => { const bad = i.type === "file" ? !i.files.length : !i.value.trim(); i.closest(".field").classList.toggle("invalid", bad); if (bad) ok = false; });
      if (!ok) return;
      const b = form.querySelector("[type=submit]"); btn(b, "loading"); $("#mErr").hidden = true;
      const data = {}; new FormData(form).forEach((v, k) => (data[k] = v)); $$("input[type=checkbox]", form).forEach((c) => (data[c.name] = c.checked));
      try { const r = await handler(data, form); btn(b, null); if (r !== false) close(); }
      catch (er) { btn(b, "error", 1500); $("#mErr").textContent = er.message || "That didn't save. Try again."; $("#mErr").hidden = false; }
    });
  }

  function table(cols, rows, empty) {
    if (!rows.length) return `<div class="empty">${esc(empty || "Nothing here yet.")}</div>`;
    return `<div class="table-wrap"><table class="table"><thead><tr>${cols.map((c) => `<th${c.right ? ' style="text-align:right"' : ""}>${esc(c.h)}</th>`).join("")}</tr></thead><tbody>${rows.map((r) => `<tr>${cols.map((c) => `<td${c.cls ? ` class="${c.cls}"` : ""}>${c.v(r)}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`;
  }
  const copy = async (t) => { try { await navigator.clipboard.writeText(t); toast("Copied."); } catch (e) { toast("Copy didn't work; select it instead."); } };
  const wa = (phone, text) => `https://wa.me/${String(phone || "").replace(/\D/g, "").replace(/^0/, "92")}?text=${encodeURIComponent(text)}`;

  // ───────── preview data ─────────
  const now = Date.now(), dAgo = (n) => new Date(now - n * 864e5).toISOString();
  const T1 = "t-0001", S = (i) => "s-" + String(i).padStart(4, "0");
  const P = {
    me: null,
    students: Array.from({ length: 9 }, (_, i) => ({ id: S(i + 1), code: "NX-" + (10001 + i), name: ["Ali Raza", "Sara Khan", "Hamza Iqbal", "Zainab Ahmed", "Omar Farooq", "Ayesha Malik", "Bilal Shah", "Fatima Noor", "Usman Tariq"][i], email: `student${i + 1}@example.com`, phone: "+92 300 00000" + i, country: i === 4 ? "United Arab Emirates" : "Pakistan", level: i % 3 ? "O" : "A", status: i === 8 ? "suspended" : "active", created_at: dAgo(i * 3 + 1), plan: ["Free", "Student", "Academy", "Pro", "Free", "Academy", "Student", "Free", "Free"][i], plan_source: i === 2 || i === 5 ? "class" : "plan", ends_at: [1, 3, 6].includes(i) ? dAgo(-20) : null, checks_month: [2, 11, 7, 30, 0, 4, 9, 3, 0][i], teacher: i === 2 || i === 5 ? "Sample Physics Teacher" : null })),
    teachers: [{ id: T1, code: "NXT-101", slug: "sample-physics", name: "Sample Physics Teacher", email: "physics@example.com", phone: "+92 321 0000000", class_code: "PHY7Q2", rate: 500, checks_per_student: 20, billing_status: "active", verified: true, is_public: true, students: 2, unpaid: 1000, status: "active", created_at: dAgo(40), title: "O & A Level Physics", bio: "Placeholder profile shown in preview mode.", subjects: ["5054", "9702"], levels: ["O", "A"], city: "Karachi" }],
    applications: [{ id: 1, full_name: "Sample Applicant", email: "applicant@example.com", phone: "+92 333 0000000", city: "Lahore", country: "Pakistan", subjects: ["2058", "9488"], levels: ["O", "A"], experience: "6 years", students: "20–50", links: "", note: "Preview application.", status: "pending", created_at: dAgo(1) }],
    payments: [
      { id: 3, kind: "plan", student_id: S(1), who: "Ali Raza", code: "NX-10001", phone: "+92 300 000000", plan_id: "student", months: 1, amount_pkr: 999, method: "JazzCash", reference: "TX81920", slip_path: null, status: "pending", created_at: dAgo(0.1) },
      { id: 2, kind: "plan", student_id: S(4), who: "Zainab Ahmed", code: "NX-10004", phone: "+92 300 000003", plan_id: "pro", months: 3, amount_pkr: 7497, method: "Bank transfer", reference: "", slip_path: null, status: "approved", created_at: dAgo(5) },
      { id: 1, kind: "teacher_invoice", teacher_id: T1, who: "Sample Physics Teacher", code: "NXT-101", phone: "+92 321 0000000", invoice_id: 1, amount_pkr: 1000, method: "Bank transfer", reference: "IBFT-22", slip_path: null, status: "pending", created_at: dAgo(0.5) }],
    invoices: [{ id: 1, teacher_id: T1, teacher: "Sample Physics Teacher", month: new Date(new Date().getFullYear(), new Date().getMonth() - 1, 1).toISOString().slice(0, 10), students: 2, rate: 500, amount_pkr: 1000, status: "unpaid", created_at: dAgo(19) }],
    notes: (D.notes || []).map((n) => ({ ...n, teacher_id: n.teacher_slug === "sample-physics" ? T1 : null, published: true, views: 12 + n.id * 7 })),
    lectures: (D.lectures || []).map((l) => ({ id: l.id, teacher_id: l.teacher_slug === "sample-physics" ? T1 : null, subject_id: l.subject_id, title: l.title, topic: l.topic, youtube_id: "dQw4w9WgXcQ", duration_min: l.duration_min, audience: l.id === 3 ? "class" : "subscribers", published: true, created_at: dAgo(l.id * 4) })),
    checks: Array.from({ length: 8 }, (_, i) => { const mm = [5, 9, 12, 6, 20, 4, 8, 15][i], got = Math.round(mm * [0.8, 0.55, 0.7, 0.5, 0.75, 1, 0.62, 0.4][i]);
      return { id: "c-" + i, student_id: S((i % 6) + 1), student: ["Ali Raza", "Sara Khan", "Hamza Iqbal", "Zainab Ahmed", "Omar Farooq", "Ayesha Malik"][i % 6], code: "NX-" + (10001 + (i % 6)), subject_id: D.subjects[[5, 0, 11, 6, 1, 3, 26, 30][i] || 0].id, question_label: ["Q3(b)", "Q1", "Q4", "Q2(a)", "Q7", "Q1(c)", "Q5", "Q2"][i], max_marks: mm, marks_awarded: got, status: "done", model: i % 2 ? "claude-sonnet-5-5" : "claude-haiku-5-5", cost_pkr: [3.1, 9.8, 11.2, 4.4, 14.9, 2.6, 8.7, 12.4][i], source: i % 3 === 2 ? "class" : "plan", teacher_id: i % 3 === 2 ? T1 : null, created_at: dAgo(i * 0.7), is_demo: false, report: { ...D.sample.report, marks_awarded: got, max_marks: mm }, question: D.sample.question, answer_text: D.sample.answer_text }; }),
    settings: { id: 1, ai_paused: false, pause_message: "The AI checker is paused for an upgrade. Your checks are safe — try again soon.", model_main: "claude-sonnet-5-5", model_light: "claude-haiku-5-5", light_max_marks: 6, usd_pkr: 280, main_in_usd_mtok: 3, main_out_usd_mtok: 15, light_in_usd_mtok: 1, light_out_usd_mtok: 5, monthly_budget_pkr: 50000, free_checks_ip_day: 10, payment_accounts: [], whatsapp: "+92 305 3687680", support_email: "nexlyr.solutions@gmail.com" },
    notifications: [{ id: 1, title: "New payment slip", body: "Ali Raza · Student × 1 · Rs 999", link: "#payments", created_at: dAgo(0.1), read_at: null }, { id: 2, title: "New teacher application", body: "Sample Applicant · 2058, 9488", link: "#teachers", created_at: dAgo(1), read_at: null }]
  };

  const must = ({ data, error }) => { if (error) throw new Error(error.message); return data; };
  async function fn(action, body) {
    if (!live) { await wait(500); return P_FN(action, body); }
    const { data: s } = await db.auth.getSession();
    const r = await fetch(`${C.SUPABASE_URL}/functions/v1/admin`, { method: "POST", headers: { apikey: C.SUPABASE_KEY, Authorization: "Bearer " + (s.session && s.session.access_token), "Content-Type": "application/json" }, body: JSON.stringify({ action, ...body }) });
    const out = await r.json().catch(() => ({ ok: false, reason: "server" }));
    if (!out.ok) throw new Error({ email_taken: "That email already has an account.", admins_only: "Admins only.", application: "That application was already handled.", self: "You can't do that to your own account." }[out.reason] || "That didn't work (" + out.reason + ").");
    return out;
  }
  function P_FN(action, b) {
    const cred = { email: "teacher@example.com", password: "Orbit-Prism-4821", code: "NXT-102", class_code: "Q7HX2M", slug: "new-teacher" };
    if (action === "approve_teacher") { const a = P.applications.find((x) => x.id === b.application_id); a.status = "approved"; return { ok: true, ...cred, email: a.email }; }
    if (action === "reject_teacher") { P.applications.find((x) => x.id === b.application_id).status = "rejected"; return { ok: true }; }
    if (action === "create_teacher") return { ok: true, ...cred, email: b.email };
    if (action === "create_admin") return { ok: true, email: b.email, password: "Delta-Atlas-1192", code: "NXA-2" };
    if (action === "reset_password") return { ok: true, password: "Summit-Vector-5530" };
    if (action === "set_status") { const s = P.students.find((x) => x.id === b.user_id); if (s) s.status = b.status; return { ok: true }; }
    if (action === "grant_plan") return { ok: true };
    return { ok: true };
  }

  window.NX = { C, live, db, D, P, $, $$, esc, date, short, ago, rs, wait, btn, toast, modal, close, formHtml, onForm, table, pill, copy, wa, must, fn, subName, subjects: D.subjects };
})();

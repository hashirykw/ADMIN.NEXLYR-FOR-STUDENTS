/* Admin views. Each view(el) draws into the main area. Live data through Supabase, or preview data (NX.P). */
(function () {
  const N = window.NX;
  const { live, db, P, $, $$, esc, date, short, ago, rs, btn, toast, modal, close, formHtml, onForm, table, pill, copy, wa, must, fn, subName } = N;
  const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0);
  const planName = (id) => ((N.D.plans || []).find((p) => p.id === id) || { name: id || "—" }).name;

  async function subjects() { if (!live) return N.D.subjects; if (!N._subs) N._subs = must(await db.from("subjects").select("*").order("level", { ascending: false }).order("sort")); N.subjects = N._subs; return N._subs; }
  async function teachersLite() { if (!live) return P.teachers.map((t) => ({ id: t.id, name: t.name })); return must(await db.from("teachers").select("id, display_name").order("display_name")).map((t) => ({ id: t.id, name: t.display_name })); }

  // ───────── overview ─────────
  async function overview(el) {
    const o = live ? must(await db.rpc("admin_overview")) : {
      students: P.students.length, new_students_7d: 3, paying: 3, teachers: P.teachers.length, class_students: 2, pending_payments: P.payments.filter((p) => p.status === "pending").length,
      pending_teachers: P.applications.filter((a) => a.status === "pending").length, checks_today: 6, checks_month: 142, ai_cost_month: 1310, revenue_month: 11495, unpaid_invoices: 1000, budget: 50000, paused: P.settings.ai_paused,
      by_day: Array.from({ length: 30 }, (_, i) => ({ d: new Date(Date.now() - (29 - i) * 864e5).toISOString().slice(0, 10), n: Math.round(2 + Math.abs(Math.sin(i / 3)) * 9 + (i > 20 ? 4 : 0)), cost: 0 })) };
    const max = Math.max(1, ...o.by_day.map((d) => d.n));
    el.innerHTML = `
      ${!live ? `<div class="note note-warn"><span><b>Preview mode.</b> No database connected; this is sample data. Add the Supabase URL and key in <span class="mono">assets/js/config.js</span>.</span></div>` : ""}
      ${o.paused ? `<div class="note note-bad"><span><b>The AI checker is paused.</b> Students see the pause message. <a class="link" href="#ai">Turn it back on</a></span></div>` : ""}
      <div class="kpis">
        <a class="kpi ${o.pending_payments ? "kpi-warn" : ""}" href="#payments"><span>Slips to review</span><b>${o.pending_payments}</b><small>approve to start plans</small></a>
        <a class="kpi ${o.pending_teachers ? "kpi-warn" : ""}" href="#teachers"><span>Teacher applications</span><b>${o.pending_teachers}</b><small>waiting for you</small></a>
        <a class="kpi" href="#students"><span>Students</span><b>${o.students}</b><small>+${o.new_students_7d} in 7 days</small></a>
        <div class="kpi"><span>Paying students</span><b>${o.paying}</b><small>active Student / Pro</small></div>
        <a class="kpi" href="#teachers"><span>Teachers</span><b>${o.teachers}</b><small>${o.class_students} students in classes</small></a>
        <div class="kpi"><span>Revenue this month</span><b>${rs(o.revenue_month)}</b><small>approved slips</small></div>
        <a class="kpi" href="#billing"><span>Unpaid teacher invoices</span><b>${rs(o.unpaid_invoices)}</b><small>all months</small></a>
        <a class="kpi" href="#checks"><span>AI checks</span><b>${o.checks_month}</b><small>${o.checks_today} today · this month</small></a>
        <a class="kpi ${o.ai_cost_month > o.budget * 0.8 ? "kpi-warn" : ""}" href="#ai"><span>AI cost this month</span><b>${rs(Math.round(o.ai_cost_month))}</b><small>${pct(o.ai_cost_month, o.budget)}% of ${rs(o.budget)} budget</small></a>
      </div>
      <section><div class="bar"><h2>Checks per day, last 30 days</h2></div>
        <div class="chart" role="img" aria-label="Checks per day">${o.by_day.map((d) => `<i style="height:${Math.max(2, (d.n / max) * 100)}%" title="${esc(short(d.d))}: ${d.n} checks"></i>`).join("")}</div></section>`;
  }

  // ───────── payments ─────────
  async function payments(el) {
    let status = "pending";
    el.innerHTML = `<div class="bar"><div class="seg" role="tablist"><label><input type="radio" name="ps" value="pending" checked><span>To review</span></label><label><input type="radio" name="ps" value="approved"><span>Approved</span></label><label><input type="radio" name="ps" value="rejected"><span>Rejected</span></label></div></div><div id="payT"></div>`;
    async function load() {
      let rows;
      if (live) {
        rows = must(await db.from("payments").select("*, student:profiles!payments_student_id_fkey(full_name, code, phone), teacher:teachers(display_name)").eq("status", status).order("created_at", { ascending: status === "pending" }).limit(300))
          .map((p) => ({ ...p, who: p.student ? p.student.full_name : p.teacher ? p.teacher.display_name : "—", code: p.student ? p.student.code : "Teacher", phone: p.student && p.student.phone }));
      } else rows = P.payments.filter((p) => p.status === status);
      $("#payT").innerHTML = table([
        { h: "Sent", v: (p) => `<span title="${esc(date(p.created_at))}">${esc(ago(p.created_at))}</span>` },
        { h: "From", v: (p) => `<div class="cell-main"><b>${esc(p.who)}</b><small class="mono">${esc(p.code)}</small></div>` },
        { h: "For", v: (p) => p.kind === "plan" ? `${esc(planName(p.plan_id))} × ${p.months}` : "Teacher invoice" },
        { h: "Amount", v: (p) => `<b class="num">${esc(rs(p.amount_pkr))}</b>` },
        { h: "Method", v: (p) => `${esc(p.method || "—")}${p.reference ? `<br><small class="mono muted">${esc(p.reference)}</small>` : ""}` },
        { h: "", cls: "acts-cell", v: (p) => `<div class="acts">${p.slip_path || !live ? `<button class="btn btn-line btn-sm" data-slip="${p.id}">Slip</button>` : ""}${p.status === "pending" ? `<button class="btn btn-primary btn-sm" data-ok="${p.id}">Approve</button><button class="btn btn-ghost btn-sm" data-no="${p.id}">Reject</button>` : pill(p.status)}</div>` }
      ], rows, status === "pending" ? "No slips waiting. New ones show up here and in the bell." : "None.");
      $("#payT").onclick = async (e) => {
        const id = +(e.target.dataset.ok || e.target.dataset.no || e.target.dataset.slip); if (!id) return;
        const p = rows.find((x) => x.id === id);
        if (e.target.dataset.slip) {
          let url = null; if (live && p.slip_path) { const { data } = await db.storage.from("slips").createSignedUrl(p.slip_path, 600); url = data && data.signedUrl; }
          const body = modal(`${p.who} · ${rs(p.amount_pkr)}`, `${p.method || ""}${p.reference ? " · Ref " + p.reference : ""} · ${date(p.created_at)}`,
            (url ? (/\.pdf$/i.test(p.slip_path) ? `<iframe class="slip-frame" src="${esc(url)}" title="Slip"></iframe>` : `<img class="slip-img" src="${esc(url)}" alt="Payment slip">`) : `<div class="empty">${live ? "No slip file: they typed a transaction ID instead." : "Preview: the uploaded slip shows here."}</div>`) +
            (p.status === "pending" ? `<div class="row" style="margin-top:16px"><button class="btn btn-primary" data-ok="${p.id}">Approve</button><button class="btn btn-ghost" data-no="${p.id}">Reject</button>${p.phone ? `<a class="btn btn-ghost" target="_blank" rel="noopener" href="${esc(wa(p.phone, "Hi " + p.who + ", about your Nexlyr payment slip: "))}">WhatsApp</a>` : ""}</div>` : ""), { wide: true });
          body.onclick = (ev) => { if (ev.target.dataset.ok || ev.target.dataset.no) { close(); $("#payT").onclick(ev); } };
          return;
        }
        if (e.target.dataset.ok) {
          btn(e.target, "loading");
          try { if (live) must(await db.rpc("review_payment", { p_id: id, p_approve: true })); else p.status = "approved"; toast(p.kind === "plan" ? `${p.who}'s ${planName(p.plan_id)} plan is active.` : "Invoice marked paid."); load(); N.refreshCounts(); }
          catch (er) { btn(e.target, "error", 1500); toast(er.message); }
          return;
        }
        modal("Reject this slip?", `${p.who} · ${rs(p.amount_pkr)}`, formHtml([{ name: "reason", label: "Reason the student will see", type: "textarea", full: true, rows: 3, value: "We couldn't find this payment. Please check the amount and account, then send the slip again." }], "Reject slip"));
        onForm(async (d) => { if (live) must(await db.rpc("review_payment", { p_id: id, p_approve: false, p_reason: d.reason })); else p.status = "rejected"; toast("Slip rejected. They've been told why."); load(); N.refreshCounts(); });
      };
    }
    $$("input[name=ps]", el).forEach((r) => r.addEventListener("change", () => { status = r.value; load(); }));
    load();
  }

  // ───────── students ─────────
  async function students(el) {
    el.innerHTML = `<div class="bar"><input class="input" id="sq" type="search" placeholder="Search name, email, phone or NX- code"><span class="muted" id="sc"></span></div><div id="sT"></div>`;
    let rows = [];
    async function load() {
      const q = $("#sq").value.trim();
      rows = live ? must(await db.rpc("admin_students", { p_q: q || null })) : P.students.filter((s) => !q || (s.name + s.email + s.code + s.phone).toLowerCase().includes(q.toLowerCase()));
      $("#sc").textContent = rows.length + " shown";
      $("#sT").innerHTML = table([
        { h: "Student", v: (s) => `<div class="cell-main"><b>${esc(s.name)}</b><small><span class="mono">${esc(s.code)}</span> · ${esc(s.email)}</small></div>` },
        { h: "Plan", v: (s) => `${esc(s.plan)}${s.ends_at ? `<br><small class="muted">until ${esc(short(s.ends_at))}</small>` : ""}${s.teacher ? `<br><small class="muted">${esc(s.teacher)}</small>` : ""}` },
        { h: "Checks", v: (s) => `<span class="num">${s.checks_month}</span>` },
        { h: "Country", v: (s) => esc(s.country) },
        { h: "Joined", v: (s) => esc(short(s.created_at)) },
        { h: "", cls: "acts-cell", v: (s) => `<div class="acts">${s.status !== "active" ? pill("suspended") : ""}<button class="btn btn-line btn-sm" data-s="${s.id}">Manage</button></div>` }
      ], rows, "No students match.");
    }
    let t; $("#sq").addEventListener("input", () => { clearTimeout(t); t = setTimeout(load, 250); });
    $("#sT").addEventListener("click", (e) => { const id = e.target.dataset.s; if (id) manageStudent(rows.find((x) => x.id === id), load); });
    load();
  }
  function manageStudent(s, reload) {
    const body = modal(s.name, `${s.code} · ${s.email} · ${s.phone || "no phone"}`, `
      <div class="stack">
        <div class="row"><a class="btn btn-line btn-sm" target="_blank" rel="noopener" href="${esc(wa(s.phone, "Hi " + s.name + ", this is Nexlyr for Students. "))}">WhatsApp</a><a class="btn btn-line btn-sm" href="#checks?student=${esc(s.id)}">Their checks</a></div>
        <hr class="divider">
        <h3>Give a plan by hand</h3>
        <form class="form" id="gp"><div class="grid-2"><div class="field"><label for="gpPlan">Plan</label><select class="select" id="gpPlan" name="plan"><option value="student">Student</option><option value="pro">Pro</option></select></div><div class="field"><label for="gpDays">Days</label><input class="input" id="gpDays" name="days" type="number" value="30" min="1" max="400"></div></div><button class="btn btn-primary btn-sm" type="submit">Add plan</button></form>
        <hr class="divider">
        <div class="row"><button class="btn btn-line btn-sm" type="button" id="rp">Reset password</button><button class="btn btn-ghost btn-sm" type="button" id="sus">${s.status === "active" ? "Suspend account" : "Re-activate account"}</button></div>
        <div id="out"></div>
      </div>`);
    body.querySelector("#gp").addEventListener("submit", async (e) => { e.preventDefault(); const b = e.target.querySelector("button"); btn(b, "loading"); try { await fn("grant_plan", { user_id: s.id, plan_id: e.target.plan.value, days: +e.target.days.value }); btn(b, "success", 1500); reload(); } catch (er) { btn(b, "error", 1500); toast(er.message); } });
    body.querySelector("#rp").addEventListener("click", async (e) => { btn(e.target, "loading"); try { const r = await fn("reset_password", { user_id: s.id }); btn(e.target, null); body.querySelector("#out").innerHTML = credBox({ Email: s.email, "New password": r.password }, s.phone, `Your Nexlyr for Students password was reset.\nEmail: ${s.email}\nPassword: ${r.password}\nSign in: ${N.C.STUDENT_SITE}/portal`); } catch (er) { btn(e.target, "error", 1500); toast(er.message); } });
    body.querySelector("#sus").addEventListener("click", async (e) => { const st = s.status === "active" ? "suspended" : "active"; btn(e.target, "loading"); try { await fn("set_status", { user_id: s.id, status: st }); s.status = st; close(); toast(st === "suspended" ? "Account suspended." : "Account active again."); reload(); } catch (er) { btn(e.target, "error", 1500); toast(er.message); } });
  }
  function credBox(pairs, phone, message) {
    return `<div class="cred" style="margin-top:16px">${Object.entries(pairs).map(([k, v]) => `<div><span>${esc(k)}</span><b>${esc(v)}</b></div>`).join("")}</div>
      <div class="row" style="margin-top:8px"><button class="btn btn-line btn-sm" type="button" onclick='NX.copy(${JSON.stringify(message)})'>Copy message</button>${phone ? `<a class="btn btn-primary btn-sm" target="_blank" rel="noopener" href="${esc(wa(phone, message))}">Send on WhatsApp</a>` : ""}</div>
      <p class="hint">Shown once. Send it now; it isn't stored anywhere you can see again.</p>`;
  }

  // ───────── teachers ─────────
  async function teachers(el) {
    el.innerHTML = `<section><div class="bar"><h2>Applications</h2></div><div id="aT"></div></section>
      <section><div class="bar"><h2>Teachers</h2><button class="btn btn-primary btn-sm" id="newT">Add a teacher</button></div><div id="tT"></div></section>`;
    async function load() {
      const apps = live ? must(await db.from("teacher_applications").select("*").eq("status", "pending").order("created_at")) : P.applications.filter((a) => a.status === "pending");
      $("#aT").innerHTML = table([
        { h: "Applicant", v: (a) => `<div class="cell-main"><b>${esc(a.full_name)}</b><small>${esc(a.email)} · ${esc(a.phone)}</small></div>` },
        { h: "Teaches", v: (a) => `${esc((a.levels || []).join(" + "))} · ${esc((a.subjects || []).join(", "))}` },
        { h: "Experience", v: (a) => `${esc(a.experience || "—")}<br><small class="muted">${esc(a.students || "")} students · ${esc(a.city || "")}</small>` },
        { h: "Sent", v: (a) => esc(ago(a.created_at)) },
        { h: "", cls: "acts-cell", v: (a) => `<div class="acts"><button class="btn btn-primary btn-sm" data-ap="${a.id}">Approve</button><button class="btn btn-ghost btn-sm" data-rj="${a.id}">Reject</button></div>` }
      ], apps, "No applications waiting.");
      const ts = live ? must(await db.rpc("admin_teachers")) : P.teachers;
      $("#tT").innerHTML = table([
        { h: "Teacher", v: (t) => `<div class="cell-main"><b>${esc(t.name)}</b><small><span class="mono">${esc(t.code)}</span> · ${esc(t.email)}</small></div>` },
        { h: "Class code", v: (t) => `<span class="code">${esc(t.class_code)}</span>` },
        { h: "Students", v: (t) => `<span class="num">${t.students}</span>` },
        { h: "Rate", v: (t) => `${esc(rs(t.rate))}<br><small class="muted">${t.checks_per_student} checks each</small>` },
        { h: "Billing", v: (t) => `${pill(t.billing_status)}${t.unpaid ? `<br><small class="muted">${esc(rs(t.unpaid))} unpaid</small>` : ""}` },
        { h: "", cls: "acts-cell", v: (t) => `<div class="acts">${t.verified ? pill("active", "Verified") : ""}<button class="btn btn-line btn-sm" data-ed="${t.id}">Edit</button></div>` }
      ], ts, "No teachers yet.");
      $("#aT").onclick = async (e) => {
        const ap = +e.target.dataset.ap, rj = +e.target.dataset.rj; const a = apps.find((x) => x.id === (ap || rj)); if (!a) return;
        if (rj) { btn(e.target, "loading"); await fn("reject_teacher", { application_id: rj }); toast("Application rejected."); load(); N.refreshCounts(); return; }
        modal(`Approve ${a.full_name}`, "Creates their teacher login, class code and public page.", formHtml([
          { name: "rate", label: "Rs per student, per month", type: "number", value: 500, min: 0 }, { name: "checks", label: "AI checks per student, per month", type: "number", value: 20, min: 0, max: 500 }], "Approve and create login"));
        onForm(async (d) => {
          const r = await fn("approve_teacher", { application_id: a.id, rate: +d.rate, checks: +d.checks });
          showTeacherCred(a.full_name, a.phone, r); load(); N.refreshCounts(); return false;
        });
      };
      $("#tT").onclick = (e) => { const id = e.target.dataset.ed; if (id) editTeacher(ts.find((x) => x.id === id), load); };
    }
    $("#newT").addEventListener("click", async () => {
      const subs = await subjects();
      modal("Add a teacher", "For teachers you've agreed with directly. They get a login straight away.", formHtml([
        { name: "name", label: "Name", required: true, placeholder: "Sir Ahmed Khan" }, { name: "email", label: "Email", type: "email", required: true },
        { name: "phone", label: "WhatsApp" }, { name: "city", label: "City" },
        { name: "subjects", label: "Subject codes", hint: "comma separated", placeholder: "5054, 9702", full: true },
        { name: "rate", label: "Rs per student", type: "number", value: 500 }, { name: "checks", label: "Checks per student", type: "number", value: 20 }], "Create teacher login"));
      onForm(async (d) => {
        const codes = d.subjects.split(/[,\s]+/).filter((c) => subs.some((s) => s.code === c));
        const r = await fn("create_teacher", { name: d.name, email: d.email, phone: d.phone, city: d.city, subjects: codes, rate: +d.rate, checks: +d.checks });
        showTeacherCred(d.name, d.phone, r); load(); return false;
      });
    });
    load();
  }
  function showTeacherCred(name, phone, r) {
    const msg = `Welcome to Nexlyr for Students, ${name}.\n\nTeacher panel: ${location.origin}\nEmail: ${r.email}\nPassword: ${r.password}\n\nYour class code: ${r.class_code}\nStudents join at ${N.C.STUDENT_SITE}/join?class=${r.class_code}\nYour public page: ${N.C.STUDENT_SITE}/teachers?t=${r.slug}`;
    modal(`${name} is set up`, "Send these details now.", `<div class="cred"><div><span>Login email</span><b>${esc(r.email)}</b></div><div><span>Password</span><b>${esc(r.password)}</b></div><div><span>Teacher ID</span><b>${esc(r.code)}</b></div><div><span>Class code</span><b>${esc(r.class_code)}</b></div><div><span>Public page</span><b>/teachers?t=${esc(r.slug)}</b></div></div>` + credBox({}, phone, msg).replace('<div class="cred" style="margin-top:16px"></div>', ""));
  }
  function editTeacher(t, reload) {
    modal(t.name, `${t.code} · class code ${t.class_code}`, formHtml([
      { name: "rate", label: "Rs per student / month", type: "number", value: t.rate, min: 0 }, { name: "checks", label: "Checks per student / month", type: "number", value: t.checks_per_student, min: 0 },
      { name: "billing_status", label: "Billing", type: "select", value: t.billing_status, options: [["active", "Active"], ["overdue", "Overdue (class paused)"], ["paused", "Paused"]] },
      { name: "verified", label: "Verified badge", type: "switch", value: t.verified }, { name: "is_public", label: "Public page on", type: "switch", value: t.is_public }], "Save teacher")
      + `<div class="row" style="margin-top:16px"><button class="btn btn-line btn-sm" id="trp">Reset password</button><button class="btn btn-ghost btn-sm" id="tsus">${t.status === "active" ? "Suspend login" : "Re-activate login"}</button><a class="btn btn-ghost btn-sm" target="_blank" rel="noopener" href="${esc(N.C.STUDENT_SITE)}/teachers?t=${esc(t.slug)}">Public page ↗</a></div><div id="tout"></div>`);
    onForm(async (d) => {
      const row = { rate_per_student: +d.rate, checks_per_student: +d.checks, billing_status: d.billing_status, verified: d.verified, is_public: d.is_public };
      if (live) must(await db.from("teachers").update(row).eq("id", t.id)); else Object.assign(t, { rate: row.rate_per_student, checks_per_student: row.checks_per_student, billing_status: row.billing_status, verified: row.verified, is_public: row.is_public });
      toast("Teacher saved."); reload();
    });
    $("#trp").onclick = async (e) => { btn(e.target, "loading"); try { const r = await fn("reset_password", { user_id: t.id }); btn(e.target, null); $("#tout").innerHTML = credBox({ Email: t.email, "New password": r.password }, t.phone, `Your Nexlyr teacher panel password was reset.\nEmail: ${t.email}\nPassword: ${r.password}\n${location.origin}`); } catch (er) { btn(e.target, "error", 1500); toast(er.message); } };
    $("#tsus").onclick = async (e) => { btn(e.target, "loading"); try { await fn("set_status", { user_id: t.id, status: t.status === "active" ? "suspended" : "active" }); close(); toast("Done."); reload(); } catch (er) { btn(e.target, "error", 1500); toast(er.message); } };
  }

  // ───────── billing ─────────
  async function billing(el) {
    const m = new Date(); m.setDate(1); m.setMonth(m.getMonth() - 1);
    el.innerHTML = `<div class="note note-accent"><span>On the 1st of each month, bill teachers for last month: students in their class during that month × their rate. Re-running a month only adds teachers that weren't billed yet.</span></div>
      <div class="bar"><div class="row"><label class="sr" for="bm">Month</label><input class="input" id="bm" type="month" value="${m.toISOString().slice(0, 7)}" style="min-width:0"><button class="btn btn-primary" id="gen">Create invoices for this month</button></div></div><div id="iT"></div>`;
    async function load() {
      const rows = live ? must(await db.from("invoices").select("*, teachers(display_name)").order("month", { ascending: false }).order("created_at", { ascending: false }).limit(300)).map((i) => ({ ...i, teacher: i.teachers && i.teachers.display_name })) : P.invoices;
      $("#iT").innerHTML = table([
        { h: "Month", v: (i) => esc(date(i.month, { month: "long", year: "numeric" })) }, { h: "Teacher", v: (i) => `<b>${esc(i.teacher)}</b>` },
        { h: "Students × rate", v: (i) => `<span class="num">${i.students} × ${esc(rs(i.rate))}</span>` }, { h: "Amount", v: (i) => `<b class="num">${esc(rs(i.amount_pkr))}</b>` },
        { h: "Status", v: (i) => pill(i.status) },
        { h: "", cls: "acts-cell", v: (i) => i.status === "unpaid" ? `<div class="acts"><button class="btn btn-line btn-sm" data-paid="${i.id}">Mark paid</button><button class="btn btn-ghost btn-sm" data-waive="${i.id}">Waive</button></div>` : "" }
      ], rows, "No invoices yet.");
      $("#iT").onclick = async (e) => {
        const id = +(e.target.dataset.paid || e.target.dataset.waive); if (!id) return; const st = e.target.dataset.paid ? "paid" : "waived";
        if (live) must(await db.from("invoices").update({ status: st }).eq("id", id)); else P.invoices.find((x) => x.id === id).status = st;
        toast(st === "paid" ? "Marked paid." : "Invoice waived."); load();
      };
    }
    $("#gen").addEventListener("click", async (e) => {
      btn(e.target, "loading");
      try { const n = live ? must(await db.rpc("generate_invoices", { p_month: $("#bm").value + "-01" })) : 0; btn(e.target, "success", 1500); toast(n ? `${n} invoice${n > 1 ? "s" : ""} created and sent to teachers.` : "No new invoices: every teacher with students is already billed for that month."); load(); }
      catch (er) { btn(e.target, "error", 1500); toast(er.message); }
    });
    load();
  }

  // ───────── checks ─────────
  async function checks(el, params) {
    el.innerHTML = `<div class="bar"><div class="filters-row"><select class="select" id="cs"><option value="">All checks</option><option value="class">Teacher classes</option><option value="plan">Paid plans</option><option value="free">Free plan</option><option value="failed">Failed</option></select></div><span class="muted" id="cc"></span></div><div id="cT"></div>`;
    async function load() {
      const f = $("#cs").value;
      let rows;
      if (live) {
        let q = db.from("checks").select("id, created_at, subject_id, question_label, max_marks, marks_awarded, status, model, cost_pkr, source, is_demo, student:profiles!checks_student_id_fkey(full_name, code)").order("created_at", { ascending: false }).limit(200);
        if (params.student) q = q.eq("student_id", params.student);
        if (f === "failed") q = q.eq("status", "failed"); else if (f) q = q.eq("source", f);
        rows = must(await q).map((c) => ({ ...c, student: c.student && c.student.full_name, code: c.student && c.student.code }));
      } else rows = P.checks.filter((c) => (!f || c.source === f || (f === "failed" && c.status === "failed")) && (!params.student || c.student_id === params.student));
      await subjects();
      $("#cc").textContent = `${rows.length} shown · ${rs(Math.round(rows.reduce((a, c) => a + (+c.cost_pkr || 0), 0)))} AI cost`;
      $("#cT").innerHTML = table([
        { h: "When", v: (c) => esc(ago(c.created_at)) }, { h: "Student", v: (c) => `<div class="cell-main"><b>${esc(c.student)}</b><small class="mono">${esc(c.code)}</small></div>` },
        { h: "Subject", v: (c) => `${esc(subName(c.subject_id))}<br><small class="muted">${esc(c.question_label || "")}</small>` },
        { h: "Marks", v: (c) => c.status === "done" ? `<b class="num">${c.marks_awarded} / ${c.max_marks}</b>` : pill(c.status) },
        { h: "Model · cost", v: (c) => `<small class="mono">${esc((c.model || "").replace("claude-", ""))}</small><br><small class="muted">${c.is_demo ? "preview" : esc(rs(c.cost_pkr))}</small>` },
        { h: "", cls: "acts-cell", v: (c) => c.status === "done" ? `<button class="btn btn-line btn-sm" data-c="${c.id}">Open</button>` : "" }
      ], rows, "No checks yet.");
    }
    $("#cs").addEventListener("change", load);
    $("#cT").addEventListener("click", (e) => { if (e.target.dataset.c) openCheck(e.target.dataset.c); });
    load();
  }
  async function openCheck(id) {
    const c = live ? must(await db.from("checks").select("*, student:profiles!checks_student_id_fkey(full_name, code)").eq("id", id).single()) : P.checks.find((x) => x.id === id);
    if (live) { const { data: rv } = await db.from("check_reviews").select("marks_awarded, comment").eq("check_id", id).order("created_at", { ascending: false }).limit(1); c.review = rv && rv[0]; }
    await subjects();
    const body = modal("Examiner report", `${(c.student && c.student.full_name) || c.student || ""} · ${subName(c.subject_id)}`,
      `<form class="form" id="rv" style="margin-bottom:16px"><div class="grid-2"><div class="field"><label for="rvM">Your mark, out of ${c.max_marks}</label><input class="input num" id="rvM" name="m" type="number" step="0.5" min="0" max="${c.max_marks}" value="${c.review ? c.review.marks_awarded : c.marks_awarded}"></div><div class="field"><label for="rvC">Comment for the student</label><input class="input" id="rvC" name="c" value="${esc(c.review ? c.review.comment || "" : "")}"></div></div><button class="btn btn-primary btn-sm" type="submit">Save review</button><p class="hint">Corrections also teach the AI examiner to mark this subject more like you.</p></form><div id="rvSheet"></div>`, { wide: true });
    window.NX_REPORT.render(body.querySelector("#rvSheet"), { ...c, subject: subName(c.subject_id), student_code: c.code || (c.student && c.student.code) });
    body.querySelector("#rv").addEventListener("submit", async (e) => {
      e.preventDefault(); const b = e.target.querySelector("button"), m = +e.target.m.value;
      if (!(m >= 0 && m <= c.max_marks)) { e.target.m.closest(".field").classList.add("invalid"); return; }
      btn(b, "loading"); try { if (live) must(await db.rpc("review_check", { p_check: c.id, p_marks: m, p_comment: e.target.c.value })); btn(b, "success", 1500); toast("Review saved. The student has been notified."); } catch (er) { btn(b, "error", 1500); toast(er.message); }
    });
  }

  // ───────── notes & lectures (admin and teacher share these) ─────────
  async function notesView(el, opts = {}) {
    const mine = opts.teacher;
    el.innerHTML = `<div class="bar"><p class="muted">${mine ? "Your notes appear on your public page and in the notes library." : "All notes on the platform. Upload Nexlyr's own, or on behalf of a teacher."}</p><button class="btn btn-primary btn-sm" id="nn">Upload a note</button></div><div id="nT"></div>`;
    const subs = await subjects();
    async function load() {
      let rows = live ? must(await (mine ? db.from("notes").select("*").eq("teacher_id", N.me.id) : db.from("notes").select("*, teachers(display_name)")).order("created_at", { ascending: false })) : P.notes.filter((n) => !mine || n.teacher_id === "t-0001");
      rows = rows.map((n) => ({ ...n, teacher: n.teachers ? n.teachers.display_name : n.teacher || "Nexlyr" }));
      $("#nT").innerHTML = table([
        { h: "Note", v: (n) => `<div class="cell-main"><b>${esc(n.title)}</b><small>${esc(subName(n.subject_id))}${n.topic ? " · " + esc(n.topic) : ""}</small></div>` },
        ...(mine ? [] : [{ h: "Teacher", v: (n) => esc(n.teacher_id ? n.teacher : "Nexlyr") }]),
        { h: "Who can read", v: (n) => n.visibility === "members" ? pill("pending", "Members") : pill("active", "Everyone") },
        { h: "Views", v: (n) => `<span class="num">${n.views || 0}</span>` }, { h: "Added", v: (n) => esc(short(n.created_at)) },
        { h: "", cls: "acts-cell", v: (n) => `<div class="acts"><button class="btn btn-line btn-sm" data-pub="${n.id}">${n.published ? "Hide" : "Publish"}</button><button class="btn btn-ghost btn-sm" data-del="${n.id}">Delete</button></div>` }
      ], rows, mine ? "You haven't uploaded notes yet." : "No notes yet.");
      $("#nT").onclick = async (e) => {
        const pub = +e.target.dataset.pub, del = +e.target.dataset.del, n = rows.find((x) => x.id === (pub || del)); if (!n) return;
        if (pub) { if (live) must(await db.from("notes").update({ published: !n.published }).eq("id", n.id)); else P.notes.find((x) => x.id === n.id).published = !n.published; toast(n.published ? "Hidden from students." : "Published."); load(); return; }
        // delete with undo: the row goes now, the file goes after the undo window
        let undone = false;
        if (live) must(await db.from("notes").update({ published: false }).eq("id", n.id));
        e.target.closest("tr").style.opacity = "0.35";
        toast("Note deleted.", { label: "Undo", run: async () => { undone = true; if (live) await db.from("notes").update({ published: n.published }).eq("id", n.id); load(); } });
        setTimeout(async () => { if (undone) return; if (live) { await db.storage.from(n.visibility === "members" ? "members-notes" : "notes").remove([n.file_path]); await db.from("notes").delete().eq("id", n.id); } else P.notes = P.notes.filter((x) => x.id !== n.id); load(); }, 6200);
      };
    }
    $("#nn").addEventListener("click", async () => {
      const ts = mine ? [] : await teachersLite();
      modal("Upload a note", "PDF up to 30 MB. Students read it page by page in the browser.", formHtml([
        { name: "title", label: "Title", required: true, full: true }, { name: "subject_id", label: "Subject", type: "select", options: subs.map((s) => [s.id, `${s.level} · ${s.name} ${s.code}`]) },
        { name: "topic", label: "Topic", placeholder: "Electricity" },
        ...(mine ? [] : [{ name: "teacher_id", label: "Shown as", type: "select", options: [["", "Nexlyr Solutions"], ...ts.map((t) => [t.id, t.name])] }]),
        { name: "visibility", label: "Who can read it", type: "select", options: [["public", "Everyone (free)"], ["members", "Members only (paid plans and the teacher's class)"]] },
        { name: "summary", label: "One-line summary", full: true }, { name: "file", label: "PDF file", type: "file", accept: "application/pdf", required: true, full: true }], "Upload note"));
      onForm(async (d, form) => {
        const file = form.file.files[0]; if (file.type !== "application/pdf") throw new Error("Choose a PDF file.");
        if (file.size > 30 * 1024 * 1024) throw new Error("That PDF is over 30 MB. Compress it first.");
        const owner = mine ? N.me.id : d.teacher_id || null, bucket = d.visibility === "members" ? "members-notes" : "notes";
        let pages = null; try { const txt = await file.slice(0, Math.min(file.size, 4e6)).text(); const m = txt.match(/\/Type\s*\/Page[^s]/g); pages = m ? m.length : null; } catch (er) {}
        if (live) {
          const path = `${owner || "nexlyr"}/${Date.now()}-${file.name.replace(/[^\w.-]+/g, "-").slice(-60)}`;
          const up = await db.storage.from(bucket).upload(path, file, { contentType: "application/pdf" }); if (up.error) throw new Error("Upload failed: " + up.error.message);
          must(await db.from("notes").insert({ teacher_id: owner, subject_id: +d.subject_id, title: d.title.trim(), topic: d.topic.trim() || null, summary: d.summary.trim() || null, file_path: path, visibility: d.visibility, pages, size_kb: Math.round(file.size / 1024) }));
        } else P.notes.unshift({ id: Date.now(), title: d.title, topic: d.topic, subject_id: +d.subject_id, visibility: d.visibility, teacher_id: owner, published: true, views: 0, created_at: new Date().toISOString() });
        toast("Note published."); load();
      });
    });
    load();
  }
  const ytId = (s) => { const m = String(s).match(/(?:youtu\.be\/|v=|embed\/|shorts\/|live\/)([A-Za-z0-9_-]{11})/) || String(s).match(/^([A-Za-z0-9_-]{11})$/); return m && m[1]; };
  async function lecturesView(el, opts = {}) {
    const mine = opts.teacher;
    el.innerHTML = `<div class="note note-accent"><span>Upload the video to YouTube as <b>Unlisted</b>, then paste its link here. Students only ever get it through the protected player, never as a link.</span></div>
      <div class="bar"><span></span><button class="btn btn-primary btn-sm" id="nl">Add a lecture</button></div><div id="lT"></div>`;
    const subs = await subjects();
    async function load() {
      let rows = live ? must(await (mine ? db.from("lectures").select("*").eq("teacher_id", N.me.id) : db.from("lectures").select("*, teachers(display_name)")).order("created_at", { ascending: false })) : P.lectures.filter((l) => !mine || l.teacher_id === "t-0001");
      $("#lT").innerHTML = table([
        { h: "Lecture", v: (l) => `<div class="cell-main"><b>${esc(l.title)}</b><small>${esc(subName(l.subject_id))}${l.topic ? " · " + esc(l.topic) : ""}</small></div>` },
        ...(mine ? [] : [{ h: "Teacher", v: (l) => esc(l.teachers ? l.teachers.display_name : l.teacher_id ? "Sample Physics Teacher" : "Nexlyr") }]),
        { h: "Who can watch", v: (l) => l.audience === "class" ? "Teacher's class" : "Paid plans + class" }, { h: "Length", v: (l) => l.duration_min ? `<span class="num">${l.duration_min} min</span>` : "—" },
        { h: "", cls: "acts-cell", v: (l) => `<div class="acts">${l.published ? "" : pill("paused", "Hidden")}<button class="btn btn-line btn-sm" data-pub="${l.id}">${l.published ? "Hide" : "Publish"}</button><button class="btn btn-ghost btn-sm" data-del="${l.id}">Delete</button></div>` }
      ], rows, mine ? "No lectures yet." : "No lectures yet.");
      $("#lT").onclick = async (e) => {
        const pub = +e.target.dataset.pub, del = +e.target.dataset.del, l = rows.find((x) => x.id === (pub || del)); if (!l) return;
        if (pub) { if (live) must(await db.from("lectures").update({ published: !l.published }).eq("id", l.id)); else l.published = !l.published; load(); return; }
        let undone = false; e.target.closest("tr").style.opacity = "0.35";
        toast("Lecture deleted.", { label: "Undo", run: () => { undone = true; load(); } });
        setTimeout(async () => { if (undone) return; if (live) await db.from("lectures").delete().eq("id", l.id); else P.lectures = P.lectures.filter((x) => x.id !== l.id); load(); }, 6200);
      };
    }
    $("#nl").addEventListener("click", async () => {
      const ts = mine ? [] : await teachersLite();
      modal("Add a lecture", "", formHtml([
        { name: "title", label: "Title", required: true, full: true }, { name: "url", label: "Unlisted YouTube link", required: true, full: true, placeholder: "https://youtu.be/…", err: "Paste a YouTube link." },
        { name: "subject_id", label: "Subject", type: "select", options: subs.map((s) => [s.id, `${s.level} · ${s.name} ${s.code}`]) }, { name: "topic", label: "Topic" },
        ...(mine ? [] : [{ name: "teacher_id", label: "Teacher", type: "select", options: [["", "Nexlyr Solutions"], ...ts.map((t) => [t.id, t.name])] }]),
        { name: "audience", label: "Who can watch", type: "select", options: mine ? [["class", "Only my class"], ["subscribers", "My class and paid-plan students"]] : [["subscribers", "Paid plans and the teacher's class"], ["class", "Only the teacher's class"]] },
        { name: "duration_min", label: "Length in minutes", type: "number", min: 1 }], "Add lecture"));
      onForm(async (d) => {
        const id = ytId(d.url); if (!id) throw new Error("That doesn't look like a YouTube link.");
        const row = { title: d.title.trim(), youtube_id: id, subject_id: +d.subject_id, topic: d.topic.trim() || null, audience: d.audience, duration_min: +d.duration_min || null, teacher_id: mine ? N.me.id : d.teacher_id || null };
        if (live) must(await db.from("lectures").insert(row)); else P.lectures.unshift({ ...row, id: Date.now(), published: true, created_at: new Date().toISOString() });
        toast("Lecture added."); load();
      });
    });
    load();
  }

  // ───────── plans & subjects ─────────
  async function plans(el) {
    const rows = live ? must(await db.from("plans").select("*").order("sort")) : N.D.plans;
    el.innerHTML = `<p class="muted">Prices, limits and features shown on the student site. Changes apply to new checks straight away.</p>` + table([
      { h: "Plan", v: (p) => `<div class="cell-main"><b>${esc(p.name)}</b><small>${esc(p.tagline || "")}</small></div>` },
      { h: "Price", v: (p) => `<b class="num">${esc(rs(p.price_pkr))}</b><br><small class="muted">${esc(p.price_note || "")}</small>` },
      { h: "Checks / month", v: (p) => `<span class="num">${p.checks_per_month}${p.audience === "teacher" ? " each" : ""}</span>` },
      { h: "Longest", v: (p) => p.max_marks_per_check ? `${p.max_marks_per_check} marks` : "Any" },
      { h: "", cls: "acts-cell", v: (p) => `<button class="btn btn-line btn-sm" data-p="${esc(p.id)}">Edit</button>` }], rows);
    el.onclick = (e) => {
      const p = rows.find((x) => x.id === e.target.dataset.p); if (!p) return;
      modal(`Edit ${p.name}`, p.audience === "teacher" ? "New teachers get this rate and check limit; change existing teachers on their page." : "", formHtml([
        { name: "name", label: "Name", value: p.name, required: true }, { name: "tagline", label: "Tagline", value: p.tagline },
        { name: "price_pkr", label: "Price (Rs)", type: "number", value: p.price_pkr, min: 0 }, { name: "price_note", label: "Price note", value: p.price_note },
        { name: "checks_per_month", label: "Checks a month", type: "number", value: p.checks_per_month, min: 0 }, { name: "max_marks_per_check", label: "Longest question (marks)", type: "number", value: p.max_marks_per_check || "", hint: "empty = any" },
        { name: "lectures", label: "Recorded lectures", type: "switch", value: p.lectures }, { name: "photo_answers", label: "Photo answers", type: "switch", value: p.photo_answers },
        { name: "members_notes", label: "Members-only notes", type: "switch", value: p.members_notes }, { name: "active", label: "Shown on the site", type: "switch", value: p.active !== false },
        { name: "features", label: "Feature lines, one per line", type: "textarea", value: (p.features || []).join("\n"), full: true, rows: 6 }], "Save plan"));
      onForm(async (d) => {
        const row = { name: d.name.trim(), tagline: d.tagline, price_pkr: +d.price_pkr, price_note: d.price_note, checks_per_month: +d.checks_per_month, max_marks_per_check: d.max_marks_per_check ? +d.max_marks_per_check : null,
          lectures: d.lectures, photo_answers: d.photo_answers, members_notes: d.members_notes, active: d.active, features: d.features.split("\n").map((s) => s.trim()).filter(Boolean) };
        if (live) must(await db.from("plans").update(row).eq("id", p.id)); else Object.assign(p, row);
        toast("Plan saved."); plans(el);
      });
    };
  }
  async function subjectsView(el) {
    const rows = live ? must(await db.from("subjects").select("*").order("level", { ascending: false }).order("sort")) : N.D.subjects;
    el.innerHTML = `<div class="bar"><p class="muted">${rows.length} syllabuses. Hidden ones disappear from the checker and notes filters.</p><button class="btn btn-primary btn-sm" id="ns">Add a subject</button></div>` + table([
      { h: "Level", v: (s) => s.level === "A" ? "AS & A" : "O" }, { h: "Code", v: (s) => `<span class="code">${esc(s.code)}</span>` }, { h: "Subject", v: (s) => `<b>${esc(s.name)}</b>` },
      { h: "Papers", v: (s) => `<small class="muted">${esc((s.papers || []).join(" · "))}</small>` },
      { h: "", cls: "acts-cell", v: (s) => `<button class="btn btn-line btn-sm" data-s="${s.id}">Edit</button>` }], rows);
    const edit = (s) => {
      modal(s ? `Edit ${s.name}` : "Add a subject", "", formHtml([
        { name: "level", label: "Level", type: "select", value: s ? s.level : "O", options: [["O", "O Level"], ["A", "AS & A Level"]] }, { name: "code", label: "Syllabus code", value: s ? s.code : "", required: true, mono: true },
        { name: "name", label: "Subject name", value: s ? s.name : "", required: true, full: true }, { name: "papers", label: "Papers, one per line", type: "textarea", value: s ? (s.papers || []).join("\n") : "Paper 1\nPaper 2", full: true },
        { name: "sort", label: "Order", type: "number", value: s ? s.sort : 99 }, { name: "active", label: "Shown to students", type: "switch", value: s ? s.active !== false : true }], s ? "Save subject" : "Add subject"));
      onForm(async (d) => {
        const row = { level: d.level, code: d.code.trim(), name: d.name.trim(), papers: d.papers.split("\n").map((x) => x.trim()).filter(Boolean), sort: +d.sort || 0, active: d.active };
        if (live) must(await (s ? db.from("subjects").update(row).eq("id", s.id) : db.from("subjects").insert(row))); else if (s) Object.assign(s, row); else N.D.subjects.push({ ...row, id: Date.now() });
        N._subs = null; toast("Saved."); subjectsView(el);
      });
    };
    $("#ns").onclick = () => edit(null);
    el.onclick = (e) => { const s = rows.find((x) => String(x.id) === e.target.dataset.s); if (s) edit(s); };
  }

  // ───────── AI settings ─────────
  async function ai(el) {
    const s = live ? must(await db.from("settings").select("*").eq("id", 1).single()) : P.settings;
    const o = live ? must(await db.rpc("admin_overview")) : { ai_cost_month: 1310, checks_month: 142, budget: s.monthly_budget_pkr };
    el.innerHTML = `
      <div class="kpis"><div class="kpi"><span>AI cost this month</span><b>${esc(rs(Math.round(o.ai_cost_month)))}</b><small>${pct(o.ai_cost_month, s.monthly_budget_pkr)}% of budget</small></div>
        <div class="kpi"><span>Checks this month</span><b>${o.checks_month}</b><small>${o.checks_month ? esc(rs(Math.round(o.ai_cost_month / o.checks_month * 10) / 10)) + " average each" : ""}</small></div></div>
      <section class="panel stack">
        <label class="switch"><input type="checkbox" id="pause" ${s.ai_paused ? "checked" : ""}> Pause the AI checker for everyone</label>
        <p class="hint">Students see the message below instead of being charged a check. It also pauses itself when the monthly budget is used up.</p>
      </section>
      <section class="panel">${formHtml([
        { name: "pause_message", label: "Pause message students see", type: "textarea", value: s.pause_message, rows: 2, full: true },
        { name: "model_main", label: "Main model (long answers, photos)", value: s.model_main, mono: true }, { name: "model_light", label: "Light model (short typed answers)", value: s.model_light, mono: true },
        { name: "light_max_marks", label: "Light model up to (marks)", type: "number", value: s.light_max_marks, min: 0, max: 100 }, { name: "monthly_budget_pkr", label: "Monthly AI budget (Rs)", type: "number", value: s.monthly_budget_pkr, min: 0 },
        { name: "main_in_usd_mtok", label: "Main model input $ / million tokens", type: "number", value: s.main_in_usd_mtok }, { name: "main_out_usd_mtok", label: "Main model output $ / million tokens", type: "number", value: s.main_out_usd_mtok },
        { name: "light_in_usd_mtok", label: "Light model input $ / million tokens", type: "number", value: s.light_in_usd_mtok }, { name: "light_out_usd_mtok", label: "Light model output $ / million tokens", type: "number", value: s.light_out_usd_mtok },
        { name: "usd_pkr", label: "Rs per US dollar", type: "number", value: s.usd_pkr }], "Save AI settings").replace('id="mForm"', 'id="aiForm"').replace('id="mErr"', 'id="aiErr"')}</section>
      <div class="note"><span><b>The Anthropic API key</b> is never stored in the database or this panel. Set it once as a Supabase secret: <span class="mono">supabase secrets set ANTHROPIC_API_KEY=sk-ant-…</span>. Until it is set, every check returns a labelled preview report and nothing is charged.</span></div>`;
    $("#pause").addEventListener("change", async (e) => {
      const on = e.target.checked;
      if (live) { const { error } = await db.from("settings").update({ ai_paused: on, updated_at: new Date().toISOString() }).eq("id", 1); if (error) { e.target.checked = !on; toast(error.message); return; } } else P.settings.ai_paused = on;
      toast(on ? "AI checker paused for everyone." : "AI checker is on again.", on ? { label: "Undo", run: () => { e.target.checked = false; e.target.dispatchEvent(new Event("change")); } } : null);
    });
    $("#aiForm").addEventListener("submit", async (e) => {
      e.preventDefault(); const b = e.target.querySelector("[type=submit]"); btn(b, "loading");
      const d = {}; new FormData(e.target).forEach((v, k) => (d[k] = v));
      const row = { pause_message: d.pause_message, model_main: d.model_main.trim(), model_light: d.model_light.trim(), light_max_marks: +d.light_max_marks, monthly_budget_pkr: +d.monthly_budget_pkr,
        main_in_usd_mtok: +d.main_in_usd_mtok, main_out_usd_mtok: +d.main_out_usd_mtok, light_in_usd_mtok: +d.light_in_usd_mtok, light_out_usd_mtok: +d.light_out_usd_mtok, usd_pkr: +d.usd_pkr, updated_at: new Date().toISOString() };
      try { if (live) must(await db.from("settings").update(row).eq("id", 1)); else Object.assign(P.settings, row); btn(b, "success", 1500); } catch (er) { btn(b, "error", 1500); toast(er.message); }
    });
  }

  // ───────── settings: payment accounts, contact, announcements, admins ─────────
  async function settings(el) {
    const s = live ? must(await db.from("settings").select("payment_accounts, whatsapp, support_email").eq("id", 1).single()) : P.settings;
    let accts = (s.payment_accounts || []).slice();
    const row = (a, i) => `<div class="acct-row" data-i="${i}">
      <select class="select" data-k="method" aria-label="Method">${["Bank transfer", "JazzCash", "Easypaisa", "Raast", "Card / abroad"].map((m) => `<option ${a.method === m ? "selected" : ""}>${m}</option>`).join("")}</select>
      <input class="input" data-k="title" placeholder="Bank / wallet name" value="${esc(a.title || "")}" aria-label="Bank or wallet">
      <input class="input mono" data-k="number" placeholder="Account / IBAN / number" value="${esc(a.number || "")}" aria-label="Account number">
      <input class="input" data-k="holder" placeholder="Account holder" value="${esc(a.holder || "")}" aria-label="Holder">
      <input class="input" data-k="note" placeholder="Note (optional)" value="${esc(a.note || "")}" aria-label="Note">
      <button class="btn btn-ghost btn-sm" type="button" data-rm="${i}" aria-label="Remove account">Remove</button></div>`;
    el.innerHTML = `
      <section class="panel stack"><h2>Payment accounts</h2><p class="muted">Shown on the plans page, sign-up and the student billing tab.</p>
        <div class="accts-edit" id="accts"></div><div class="row"><button class="btn btn-line btn-sm" id="addA" type="button">Add an account</button><button class="btn btn-primary btn-sm" id="saveA" type="button">Save accounts</button></div></section>
      <section class="panel stack"><h2>Contact</h2>
        <form class="form" id="ctF"><div class="grid-2"><div class="field"><label for="ctW">WhatsApp shown to students</label><input class="input" id="ctW" name="w" value="${esc(s.whatsapp)}"></div><div class="field"><label for="ctE">Support email</label><input class="input" id="ctE" name="e" type="email" value="${esc(s.support_email)}"></div></div><button class="btn btn-primary btn-sm" type="submit">Save contact</button></form></section>
      <section class="panel stack"><h2>Announcement</h2><p class="muted">Lands in the notification bell of everyone you choose.</p>
        <form class="form" id="anF"><div class="grid-2"><div class="field"><label for="anTo">Send to</label><select class="select" id="anTo" name="to"><option value="student">All students</option><option value="teacher">All teachers</option><option value="all">Everyone</option></select></div><div class="field"><label for="anT">Title</label><input class="input" id="anT" name="t" required maxlength="120"></div></div>
        <div class="field"><label for="anB">Message</label><textarea class="textarea" id="anB" name="b" rows="3" maxlength="600"></textarea></div><button class="btn btn-primary btn-sm" type="submit">Send announcement</button></form></section>
      <section class="panel stack"><h2>Admins</h2><p class="muted">Admins can approve payments, add teachers and change settings. Only add people you trust.</p><button class="btn btn-line btn-sm" id="addAdmin" type="button" style="justify-self:start">Add an admin</button></section>`;
    const paintA = () => { $("#accts").innerHTML = accts.length ? accts.map(row).join("") : `<p class="hint">No accounts yet. Students see "Account details coming soon" and a WhatsApp button.</p>`; };
    paintA();
    $("#accts").addEventListener("input", (e) => { const r = e.target.closest(".acct-row"); if (r) accts[+r.dataset.i][e.target.dataset.k] = e.target.value; });
    $("#accts").addEventListener("click", (e) => { if (e.target.dataset.rm != null) { accts.splice(+e.target.dataset.rm, 1); paintA(); } });
    $("#addA").onclick = () => { accts.push({ method: "Bank transfer", title: "", number: "", holder: "", note: "" }); paintA(); $("#accts .acct-row:last-child [data-k=title]").focus(); };
    $("#saveA").onclick = async (e) => {
      const clean = accts.filter((a) => a.number && a.number.trim()); btn(e.target, "loading");
      try { if (live) must(await db.from("settings").update({ payment_accounts: clean, updated_at: new Date().toISOString() }).eq("id", 1)); else P.settings.payment_accounts = clean; accts = clean; paintA(); btn(e.target, "success", 1500); } catch (er) { btn(e.target, "error", 1500); toast(er.message); }
    };
    $("#ctF").onsubmit = async (e) => { e.preventDefault(); const b = e.target.querySelector("button"); btn(b, "loading"); try { if (live) must(await db.from("settings").update({ whatsapp: e.target.w.value, support_email: e.target.e.value }).eq("id", 1)); btn(b, "success", 1500); } catch (er) { btn(b, "error", 1500); toast(er.message); } };
    $("#anF").onsubmit = async (e) => {
      e.preventDefault(); if (!e.target.t.value.trim()) { e.target.t.closest(".field").classList.add("invalid"); return; }
      const b = e.target.querySelector("button"); btn(b, "loading");
      try { const n = live ? must(await db.rpc("notify", { p_to: e.target.to.value, p_title: e.target.t.value, p_body: e.target.b.value })) : 9; btn(b, "success", 1500); toast(`Sent to ${n} ${n === 1 ? "person" : "people"}.`); e.target.reset(); } catch (er) { btn(b, "error", 1500); toast(er.message); }
    };
    $("#addAdmin").onclick = () => {
      modal("Add an admin", "They get full access to this panel.", formHtml([{ name: "name", label: "Name", required: true }, { name: "email", label: "Email", type: "email", required: true }], "Create admin login"));
      onForm(async (d) => { const r = await fn("create_admin", { name: d.name, email: d.email }); modal("Admin created", "Send these details privately.", `<div class="cred"><div><span>Email</span><b>${esc(r.email)}</b></div><div><span>Password</span><b>${esc(r.password)}</b></div><div><span>ID</span><b>${esc(r.code)}</b></div></div><p class="hint">Ask them to change the password after signing in.</p>`); return false; });
    };
  }

  N.adminViews = {
    overview: { title: "Overview", run: overview },
    payments: { title: "Payment slips", run: payments, count: "pending_payments" },
    students: { title: "Students", run: students },
    teachers: { title: "Teachers", run: teachers, count: "pending_teachers" },
    billing: { title: "Teacher billing", run: billing },
    checks: { title: "AI checks", run: checks },
    notes: { title: "Notes", run: (el) => notesView(el) },
    lectures: { title: "Lectures", run: (el) => lecturesView(el) },
    plans: { title: "Plans", run: plans },
    subjects: { title: "Subjects", run: subjectsView },
    ai: { title: "AI settings", run: ai },
    settings: { title: "Settings", run: settings }
  };
  N.adminGroups = [["Today", ["overview", "payments", "teachers"]], ["People", ["students", "billing"]], ["Learning", ["checks", "notes", "lectures"]], ["Setup", ["plans", "subjects", "ai", "settings"]]];
  Object.assign(N, { notesView, lecturesView, openCheck, subjectsList: subjects, credBox });
})();

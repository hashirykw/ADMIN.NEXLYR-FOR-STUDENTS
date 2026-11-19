/* Teacher views: their class, its checks, their notes and lectures, billing and public page. */
(function () {
  const N = window.NX;
  const { live, db, P, $, $$, esc, date, short, ago, rs, btn, toast, modal, close, formHtml, onForm, table, pill, copy, wa, must, subName } = N;

  async function overview(el) {
    const o = live ? must(await db.rpc("teacher_overview")) : { name: "Sample Physics Teacher", slug: "sample-physics", class_code: "PHY7Q2", rate: 500, checks_per_student: 20, billing_status: "active", students: 2, this_month_bill: 1000, checks_this_month: 23, avg_percent: 64, notes: 2, lectures: 3, unpaid: 1000 };
    const link = `${N.C.STUDENT_SITE}/join?class=${o.class_code}`;
    const msg = `Join my class on Nexlyr for Students to get your answers marked like a Cambridge examiner.\n\n1. Open ${link}\n2. Create your free account (class code ${o.class_code} is filled in)\n\nYou get 20 AI checks a month, my notes and my recorded lectures.`;
    el.innerHTML = `
      ${o.billing_status !== "active" ? `<div class="note note-bad"><span><b>Your class is paused</b> until the unpaid invoice is settled. Students can't use Academy checks meanwhile. <a class="link" href="#billing">Pay now</a></span></div>` : ""}
      <section class="panel two">
        <div class="stack"><h2>Your class code</h2><p class="big-code">${esc(o.class_code)}</p><p class="muted">Students type this when they sign up, or under Class in their portal.</p></div>
        <div class="stack"><p class="muted">Or send them this link; the code fills in by itself.</p><p class="mono" style="word-break:break-all">${esc(link)}</p>
          <div class="row"><button class="btn btn-line btn-sm" type="button" id="cpL">Copy link</button><button class="btn btn-line btn-sm" type="button" id="cpM">Copy invite message</button><a class="btn btn-primary btn-sm" target="_blank" rel="noopener" href="https://wa.me/?text=${encodeURIComponent(msg)}">Share on WhatsApp</a></div></div>
      </section>
      <div class="kpis">
        <a class="kpi" href="#students"><span>Students in your class</span><b>${o.students}</b><small>${o.checks_per_student} AI checks each a month</small></a>
        <a class="kpi" href="#checks"><span>Checks this month</span><b>${o.checks_this_month}</b><small>${o.avg_percent != null ? `average ${o.avg_percent}%, last 30 days` : "no marks yet"}</small></a>
        <a class="kpi" href="#billing"><span>This month so far</span><b>${esc(rs(o.this_month_bill))}</b><small>${o.students} × ${esc(rs(o.rate))}</small></a>
        <a class="kpi ${o.unpaid ? "kpi-warn" : ""}" href="#billing"><span>Unpaid invoices</span><b>${esc(rs(o.unpaid))}</b><small>${o.unpaid ? "pay with a slip" : "all settled"}</small></a>
        <a class="kpi" href="#notes"><span>Notes published</span><b>${o.notes}</b><small>on your public page</small></a>
        <a class="kpi" href="#lectures"><span>Recorded lectures</span><b>${o.lectures}</b><small>for your class</small></a>
      </div>
      <a class="link" target="_blank" rel="noopener" href="${esc(N.C.STUDENT_SITE)}/teachers?t=${esc(o.slug)}">See your public page ↗</a>`;
    $("#cpL").onclick = () => copy(link); $("#cpM").onclick = () => copy(msg);
  }

  async function students(el) {
    const rows = live ? must(await db.rpc("teacher_students")) : P.students.filter((s) => s.teacher).map((s) => ({ student_id: s.id, code: s.code, name: s.name, phone: s.phone, level: s.level, joined_at: s.created_at, checks_month: s.checks_month, avg_percent: 61, last_check: s.created_at }));
    el.innerHTML = `<p class="muted">${rows.length} student${rows.length === 1 ? "" : "s"} · each counts once on this month's invoice.</p>` + table([
      { h: "Student", v: (s) => `<div class="cell-main"><b>${esc(s.name)}</b><small class="mono">${esc(s.code)}</small></div>` },
      { h: "Level", v: (s) => esc(s.level) }, { h: "Checks this month", v: (s) => `<span class="num">${s.checks_month}</span>` },
      { h: "Average", v: (s) => s.avg_percent != null ? `<span class="num">${s.avg_percent}%</span>` : "—" }, { h: "Last check", v: (s) => s.last_check ? esc(ago(s.last_check)) : "—" },
      { h: "", cls: "acts-cell", v: (s) => `<div class="acts">${s.phone ? `<a class="btn btn-ghost btn-sm" target="_blank" rel="noopener" href="${esc(wa(s.phone, "Hi " + s.name + ", "))}">WhatsApp</a>` : ""}<a class="btn btn-line btn-sm" href="#checks?student=${esc(s.student_id)}">Reports</a><button class="btn btn-ghost btn-sm" data-rm="${esc(s.student_id)}">Remove</button></div>` }
    ], rows, "No students yet. Share your class code from the overview.");
    el.onclick = (e) => {
      const id = e.target.dataset.rm; if (!id) return; const tr = e.target.closest("tr"); tr.style.opacity = "0.35";
      let undone = false;
      toast("Student removed from your class.", { label: "Undo", run: () => { undone = true; tr.style.opacity = ""; } });
      setTimeout(async () => { if (undone) return; if (live) must(await db.rpc("remove_student", { p_student: id })); tr.remove(); }, 6200);
    };
  }

  async function checks(el, params) {
    let rows;
    if (live) {
      let q = db.from("checks").select("id, created_at, subject_id, question_label, max_marks, marks_awarded, status, student_id, student:profiles!checks_student_id_fkey(full_name, code)").eq("status", "done").order("created_at", { ascending: false }).limit(200);
      if (params.student) q = q.eq("student_id", params.student);
      rows = must(await q).map((c) => ({ ...c, student: c.student && c.student.full_name, code: c.student && c.student.code }));
    } else rows = P.checks.filter((c) => c.status === "done" && (!params.student || c.student_id === params.student));
    await N.subjectsList();
    el.innerHTML = `<p class="muted">Every report from your class. Open one to correct the mark; the student sees your review and the AI learns from it.</p>` + table([
      { h: "When", v: (c) => esc(ago(c.created_at)) }, { h: "Student", v: (c) => `<div class="cell-main"><b>${esc(c.student)}</b><small class="mono">${esc(c.code)}</small></div>` },
      { h: "Subject", v: (c) => `${esc(subName(c.subject_id))}<br><small class="muted">${esc(c.question_label || "")}</small>` },
      { h: "AI mark", v: (c) => `<b class="num">${c.marks_awarded} / ${c.max_marks}</b>` }, { h: "", cls: "acts-cell", v: (c) => `<button class="btn btn-line btn-sm" data-c="${c.id}">Open and review</button>` }
    ], rows, "No reports yet.");
    el.onclick = (e) => { if (e.target.dataset.c) N.openCheck(e.target.dataset.c); };
  }

  async function billing(el) {
    const inv = live ? must(await db.from("invoices").select("*").order("month", { ascending: false })) : P.invoices;
    const pays = live ? must(await db.from("payments").select("id, invoice_id, status, amount_pkr, created_at").eq("kind", "teacher_invoice").order("created_at", { ascending: false })) : P.payments.filter((p) => p.kind === "teacher_invoice");
    const pending = (id) => pays.some((p) => p.invoice_id === id && p.status === "pending");
    el.innerHTML = `<p class="muted">One invoice a month: students in your class during that month × your rate. Pay by bank transfer, JazzCash or Easypaisa and upload the slip.</p>` + table([
      { h: "Month", v: (i) => esc(date(i.month, { month: "long", year: "numeric" })) }, { h: "Students", v: (i) => `<span class="num">${i.students} × ${esc(rs(i.rate))}</span>` },
      { h: "Amount", v: (i) => `<b class="num">${esc(rs(i.amount_pkr))}</b>` }, { h: "Status", v: (i) => i.status === "unpaid" && pending(i.id) ? pill("pending", "Slip under review") : pill(i.status) },
      { h: "", cls: "acts-cell", v: (i) => i.status === "unpaid" && !pending(i.id) ? `<button class="btn btn-primary btn-sm" data-pay="${i.id}">Pay with slip</button>` : "" }
    ], inv, "No invoices yet. The first one arrives on the 1st of next month.");
    el.onclick = (e) => {
      const i = inv.find((x) => x.id === +e.target.dataset.pay); if (!i) return;
      modal(`Pay ${rs(i.amount_pkr)}`, date(i.month, { month: "long", year: "numeric" }), formHtml([
        { name: "method", label: "Paid by", type: "select", options: ["Bank transfer", "JazzCash", "Easypaisa", "Raast"] }, { name: "reference", label: "Transaction ID", mono: true },
        { name: "proof", label: "Slip or screenshot", type: "file", accept: "image/*,application/pdf", full: true }], "Send slip"));
      onForm(async (d, form) => {
        const file = form.proof.files[0]; if (!file && !d.reference.trim()) throw new Error("Add the slip, or type the transaction ID.");
        if (live) {
          const fd = new FormData(); fd.set("invoice_id", i.id); fd.set("method", d.method); fd.set("reference", d.reference); if (file) fd.set("proof", file);
          const { data: s } = await db.auth.getSession();
          const r = await fetch(`${N.C.SUPABASE_URL}/functions/v1/payment`, { method: "POST", headers: { apikey: N.C.SUPABASE_KEY, Authorization: "Bearer " + s.session.access_token }, body: fd }).then((x) => x.json()).catch(() => ({ ok: false }));
          if (!r.ok) throw new Error(r.reason === "already_pending" ? "A slip for this invoice is already under review." : "Couldn't send it. Try again.");
        } else pays.push({ invoice_id: i.id, status: "pending" });
        toast("Slip sent. Nexlyr will confirm it soon."); billing(el);
      });
    };
  }

  async function page(el) {
    const t = live ? must(await db.from("teachers").select("*").eq("id", N.me.id).single()) : { ...P.teachers[0], display_name: P.teachers[0].name };
    const subs = await N.subjectsList();
    el.innerHTML = `<section class="panel"><form class="form" id="pg">
      <div class="grid-2"><div class="field"><label for="pgT">Title under your name</label><input class="input" id="pgT" name="title" value="${esc(t.title || "")}" placeholder="O & A Level Physics · 12 years"></div><div class="field"><label for="pgC">City</label><input class="input" id="pgC" name="city" value="${esc(t.city || "")}"></div></div>
      <div class="field"><label for="pgB">About you</label><textarea class="textarea" id="pgB" name="bio" rows="6" maxlength="1500">${esc(t.bio || "")}</textarea></div>
      <div class="field"><span class="label">Subjects you teach</span><div class="chips">${subs.map((s) => `<label class="chip"><input type="checkbox" name="sub" value="${esc(s.code)}" ${(t.subjects || []).includes(s.code) ? "checked" : ""}><span>${esc(s.name)} <i>${esc(s.level)} ${esc(s.code)}</i></span></label>`).join("")}</div></div>
      <div class="field"><span class="label">Photo</span><input class="input" type="file" name="photo" accept="image/*" style="padding-top:12px"><small>Square photo works best. It shows on your public page.</small></div>
      <label class="switch ok"><input type="checkbox" name="pub" ${t.is_public ? "checked" : ""}> Show my page publicly</label>
      <button class="btn btn-primary" type="submit">Save my page</button></form></section>
      <a class="link" target="_blank" rel="noopener" href="${esc(N.C.STUDENT_SITE)}/teachers?t=${esc(t.slug)}">See your public page ↗</a>`;
    $("#pg").onsubmit = async (e) => {
      e.preventDefault(); const f = e.target, b = f.querySelector("[type=submit]"); btn(b, "loading");
      const codes = $$("input[name=sub]:checked", f).map((x) => x.value), levels = [...new Set(subs.filter((s) => codes.includes(s.code)).map((s) => s.level))];
      try {
        if (live) {
          must(await db.rpc("update_my_teacher_page", { p_title: f.title.value, p_bio: f.bio.value, p_subjects: codes, p_levels: levels, p_city: f.city.value, p_public: f.pub.checked }));
          const ph = f.photo.files[0];
          if (ph) { const path = `${N.me.id}/photo-${Date.now()}.${(ph.type.split("/")[1] || "jpg").replace("jpeg", "jpg")}`; const up = await db.storage.from("avatars").upload(path, ph, { contentType: ph.type }); if (up.error) throw new Error("Photo didn't upload: " + up.error.message); must(await db.rpc("set_my_teacher_photo", { p_path: path })); }
        }
        btn(b, "success", 1500);
      } catch (er) { btn(b, "error", 1500); toast(er.message); }
    };
  }

  N.teacherViews = {
    overview: { title: "My class", run: overview },
    students: { title: "Students", run: students },
    checks: { title: "Reports to review", run: checks },
    notes: { title: "My notes", run: (el) => N.notesView(el, { teacher: true }) },
    lectures: { title: "My lectures", run: (el) => N.lecturesView(el, { teacher: true }) },
    billing: { title: "Billing", run: billing },
    page: { title: "My public page", run: page }
  };
  N.teacherGroups = [["Class", ["overview", "students", "checks"]], ["Teaching", ["notes", "lectures"]], ["Account", ["billing", "page"]]];
})();

/* Admin panel boot: sign-in, role, side rail, hash router, notification bell. */
(async function () {
  const N = window.NX;
  const { live, db, P, $, $$, esc, ago, btn, toast, must } = N;
  let views = null, groups = null, counts = {};
  $("#siteLink").href = N.C.STUDENT_SITE;

  async function whoAmI() {
    if (!live) { try { return JSON.parse(sessionStorage.getItem("nx-admin-preview")); } catch (e) { return null; } }
    const { data } = await db.auth.getSession(); if (!data.session) return null;
    const { data: p } = await db.from("profiles").select("id, role, code, full_name, email, status").eq("id", data.session.user.id).maybeSingle();
    return p;
  }

  // ───────── sign in ─────────
  const form = $("#loginForm");
  form.addEventListener("submit", async (e) => {
    e.preventDefault(); const b = form.querySelector("[type=submit]"); $("#lErr").hidden = true;
    if (!live) { $("#lErr").textContent = "Preview mode: no database connected. Use the buttons below to look around."; $("#lErr").hidden = false; return; }
    btn(b, "loading");
    const { error } = await db.auth.signInWithPassword({ email: $("#lEmail").value.trim(), password: $("#lPass").value });
    btn(b, null);
    if (error) { $("#lErr").textContent = "That email and password don't match."; $("#lErr").hidden = false; return; }
    boot();
  });
  if (!live) { $("#previewRoles").hidden = false; $$("[data-preview]").forEach((b) => b.addEventListener("click", () => {
    const admin = b.dataset.preview === "admin";
    sessionStorage.setItem("nx-admin-preview", JSON.stringify(admin ? { id: "a-1", role: "admin", code: "NXA-1", full_name: "Hashir", email: "nexlyr.solutions@gmail.com", status: "active" } : { id: "t-0001", role: "teacher", code: "NXT-101", full_name: "Sample Physics Teacher", email: "physics@example.com", status: "active" }));
    boot();
  })); }
  $("#signOut").addEventListener("click", async () => { if (live) await db.auth.signOut(); sessionStorage.removeItem("nx-admin-preview"); location.hash = ""; location.reload(); });

  // ───────── rail ─────────
  function rail() {
    $("#railNav").innerHTML = groups.map(([g, keys]) => `<div class="grp">${esc(g)}</div>` + keys.map((k) => `<a href="#${k}" data-v="${k}"><span>${esc(views[k].title)}</span>${views[k].count && counts[views[k].count] ? `<span class="cnt">${counts[views[k].count]}</span>` : ""}</a>`).join("")).join("");
    mark();
  }
  const mark = () => { const v = route().v; $$("#railNav a").forEach((a) => a.setAttribute("aria-current", a.dataset.v === v ? "page" : "false")); };
  N.refreshCounts = async () => {
    if (N.me.role !== "admin") return;
    try { counts = live ? must(await db.rpc("admin_overview")) : { pending_payments: P.payments.filter((p) => p.status === "pending").length, pending_teachers: P.applications.filter((a) => a.status === "pending").length }; } catch (e) {}
    rail();
  };
  const toggle = $("#railToggle");
  toggle.addEventListener("click", () => { const o = $("#rail").classList.toggle("open"); toggle.setAttribute("aria-expanded", o); });
  $("#railNav").addEventListener("click", () => { $("#rail").classList.remove("open"); toggle.setAttribute("aria-expanded", "false"); });

  // ───────── router ─────────
  function route() {
    const [v, q] = location.hash.slice(1).split("?");
    return { v: views && views[v] ? v : "overview", params: Object.fromEntries(new URLSearchParams(q || "")) };
  }
  let token = 0;
  async function show() {
    const { v, params } = route(), my = ++token, el = $("#view");
    $("#viewTitle").textContent = views[v].title; document.title = `${views[v].title} · Nexlyr for Students admin`; mark();
    el.innerHTML = `<div class="skel" style="height:96px"></div><div class="skel" style="height:320px"></div>`;
    try { await views[v].run(el, params); if (my !== token) return; }
    catch (e) { if (my === token) el.innerHTML = `<div class="note note-bad"><span><b>This page didn't load.</b> ${esc(e.message || "")} <button class="link" type="button" onclick="location.reload()">Reload</button></span></div>`; }
    el.focus({ preventScroll: true }); window.scrollTo(0, 0);
  }
  window.addEventListener("hashchange", () => { if (views) show(); });

  // ───────── bell ─────────
  let notes = [];
  async function bell() {
    notes = live ? (await db.from("notifications").select("id, title, body, link, created_at, read_at").order("created_at", { ascending: false }).limit(30)).data || [] : P.notifications;
    const un = notes.filter((n) => !n.read_at).length;
    $("#bellN").hidden = !un; $("#bellN").textContent = un > 9 ? "9+" : un;
    $("#bellList").innerHTML = notes.length ? notes.map((n) => `<li class="${n.read_at ? "" : "un"}" data-link="${esc(n.link || "")}"><b>${esc(n.title)}</b>${n.body ? `<br>${esc(n.body)}` : ""}<small>${esc(ago(n.created_at))}</small></li>`).join("") : `<li>Nothing yet.</li>`;
  }
  async function readAll() { const ids = notes.filter((n) => !n.read_at).map((n) => n.id); notes.forEach((n) => (n.read_at = n.read_at || new Date().toISOString())); if (live && ids.length) await db.from("notifications").update({ read_at: new Date().toISOString() }).in("id", ids); bell(); }
  $("#bell").addEventListener("click", (e) => { e.stopPropagation(); const p = $("#bellPanel"); p.hidden = !p.hidden; });
  document.addEventListener("click", (e) => { if (!e.target.closest("#bellPanel, #bell")) $("#bellPanel").hidden = true; });
  $("#bellRead").addEventListener("click", readAll);
  $("#bellList").addEventListener("click", (e) => { const li = e.target.closest("[data-link]"); if (li && li.dataset.link) { location.hash = li.dataset.link.replace(/^\/?#?/, ""); $("#bellPanel").hidden = true; readAll(); } });

  // ───────── boot ─────────
  async function boot() {
    const me = await whoAmI();
    if (!me) { $("#login").hidden = false; $("#shell").hidden = true; return; }
    if (me.role === "student" || me.status !== "active") {
      $("#login").hidden = false; $("#shell").hidden = true;
      $("#lErr").innerHTML = me.role === "student" ? `This is a student account. Students use <a class="link" href="${esc(N.C.STUDENT_SITE)}/portal">the student portal</a>.` : "This account is paused. Contact Nexlyr.";
      $("#lErr").hidden = false; if (live) await db.auth.signOut(); return;
    }
    N.me = me;
    views = me.role === "admin" ? N.adminViews : N.teacherViews; groups = me.role === "admin" ? N.adminGroups : N.teacherGroups;
    $("#roleLabel").textContent = me.role === "admin" ? "Admin" : "Teacher panel";
    $("#meName").textContent = me.full_name || me.code; $("#meMail").textContent = me.email || "";
    $("#login").hidden = true; $("#shell").hidden = false;
    rail(); show(); bell(); N.refreshCounts();
    if (live) db.channel("bell:" + me.id).on("postgres_changes", { event: "INSERT", schema: "public", table: "notifications", filter: "recipient_id=eq." + me.id }, (p) => { toast(p.new.title); bell(); N.refreshCounts(); }).subscribe();
  }
  boot();
})();

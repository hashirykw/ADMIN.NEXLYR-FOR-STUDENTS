/* Draws an examiner report sheet. NX_REPORT.render(el, check) where check = { report, question, answer_text,
   subject, paper, question_label, max_marks, created_at, id, review, student_code }. */
(function () {
  const { esc, date } = window.NX;
  const PEN = { tick: "✓", cross: "✗", bod: "BOD", rep: "REP", irrelevant: "IRR", caret: "^", ecf: "ECF" };
  const LABEL = { tick: "Credited", cross: "Not credited", bod: "Benefit of the doubt", rep: "Repetition", irrelevant: "Irrelevant", caret: "Something missing here", ecf: "Error carried forward" };

  // Find each excerpt in the answer (ignoring case and spacing) and wrap it, numbered, with a pen mark.
  function annotate(text, notes) {
    const src = String(text || "");
    const norm = []; let flat = "";
    for (let i = 0; i < src.length; i++) {           // map flattened (single-spaced, lower-case) index → source index
      const ch = src[i];
      if (/\s/.test(ch)) { if (flat.endsWith(" ")) continue; flat += " "; norm.push(i); }
      else { flat += ch.toLowerCase(); norm.push(i); }
    }
    const spans = [];
    notes.forEach((n, k) => {
      const ex = String(n.excerpt || "").trim().replace(/\s+/g, " ").toLowerCase(); if (ex.length < 2) return;
      let from = 0, at = -1;
      while ((at = flat.indexOf(ex, from)) !== -1) {
        const s = norm[at], e = norm[at + ex.length - 1] + 1;
        if (!spans.some((x) => s < x.e && e > x.s)) { spans.push({ s, e, k, mark: n.mark }); break; }
        from = at + 1;
      }
    });
    spans.sort((a, b) => a.s - b.s);
    let out = "", pos = 0;
    for (const sp of spans) {
      out += esc(src.slice(pos, sp.s));
      out += `<mark data-k="${esc(sp.mark)}">${esc(src.slice(sp.s, sp.e))}</mark><sup class="pen" aria-label="${esc(LABEL[sp.mark] || sp.mark)}, note ${sp.k + 1}">${PEN[sp.mark] || "•"}${sp.k + 1}</sup>`;
      pos = sp.e;
    }
    return out + esc(src.slice(pos));
  }

  const list = (arr, cls) => arr && arr.length ? `<ul class="${cls || ""}">${arr.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>` : `<p class="annot-empty">None.</p>`;

  function render(el, c) {
    const r = c.report || {};
    const max = r.max_marks || c.max_marks, got = r.marks_awarded ?? c.marks_awarded ?? 0;
    const pc = max ? Math.round((got / max) * 100) : 0;
    const notes = Array.isArray(r.annotations) ? r.annotations : [];
    const answer = c.answer_text || r.transcript || "";
    const title = [c.subject, c.paper, c.question_label ? "Question " + c.question_label.replace(/^Q/i, "") : ""].filter(Boolean).join(" · ");
    const crit = (r.criteria || []).map((x) => `<tr><td>${esc(x.name)}</td><td>${esc(x.awarded)} / ${esc(x.max)}</td><td>${esc(x.comment)}</td></tr>`).join("");
    el.innerHTML = `
    <article class="sheet" aria-label="Examiner report">
      <header class="sheet-head">
        <div class="sheet-mast"><span class="sheet-kind">Examiner Report</span>
          <span class="sheet-meta">${esc(c.student_code || "")}${c.student_code ? " · " : ""}${esc(date(c.created_at))}${c.id && !c.sample ? " · " + esc(String(c.id).slice(0, 8)) : ""}</span></div>
        <h3 class="sheet-title">${esc(title || "Answer report")}</h3>
        ${c.question ? `<p class="sheet-q">${esc(c.question)}</p>` : ""}
        ${r.demo || c.is_demo ? `<span class="sheet-demo">Preview report · AI not connected yet</span>` : c.sample ? `<span class="sheet-demo">Sample report</span>` : ""}
      </header>
      <div class="sheet-score">
        <div class="score" aria-label="${esc(got)} out of ${esc(max)} marks"><b>${esc(got)}</b><span>/ ${esc(max)}</span></div>
        <div>
          <p class="band">${esc(r.band || "")}</p>
          <div class="meter" role="img" aria-label="${pc} percent"><i style="width:${pc}%"></i></div>
          <p class="score-sub"><span>${pc}%</span><span class="${r.confidence === "low" ? "conf-low" : ""}">Marking confidence: ${esc(r.confidence || "—")}</span></p>
        </div>
      </div>
      ${c.review ? `<section class="sheet-sec"><div class="review-box"><b>Teacher review: ${esc(c.review.marks_awarded)} / ${esc(max)}</b>${c.review.comment ? `<p>${esc(c.review.comment)}</p>` : ""}</div></section>` : ""}
      <section class="sheet-sec"><h4>Key messages</h4>${list(r.key_messages)}</section>
      <section class="sheet-sec"><h4>General comments</h4><p>${esc(r.general_comment || "")}</p></section>
      ${crit ? `<section class="sheet-sec"><h4>Mark breakdown</h4><div class="crit-wrap"><table class="crit"><thead><tr><th>Part / criterion</th><th>Marks</th><th>Examiner comment</th></tr></thead><tbody>${crit}</tbody></table></div></section>` : ""}
      <section class="sheet-sec"><h4>Your answer, marked</h4>
        ${r.transcript && !c.answer_text ? `<p class="transcript-note">Read from your handwriting. If a word was read wrongly, tell your teacher.</p>` : ""}
        <div class="annot">
          <div class="annot-text">${answer ? annotate(answer, notes) : '<span class="annot-empty">Answer not shown.</span>'}</div>
          <ol class="annot-margin">${notes.map((n, i) => `<li><b>${PEN[n.mark] || "•"}${i + 1}</b><span>${esc(n.note)}</span></li>`).join("") || '<li><span class="annot-empty">No margin notes.</span></li>'}</ol>
        </div>
      </section>
      <section class="sheet-sec sheet-two">
        <div><h4>Credited</h4>${list(r.credited, "list-ticks")}</div>
        <div><h4>Needed for more marks</h4>${list(r.missed, "list-miss")}</div>
      </section>
      <section class="sheet-sec"><h4>How to improve</h4>${r.improve && r.improve.length ? `<ol>${r.improve.map((x) => `<li>${esc(x)}</li>`).join("")}</ol>` : '<p class="annot-empty">Nothing to add.</p>'}</section>
      ${r.model_answer ? `<section class="sheet-sec"><h4>Model answer</h4><div class="model-box">${esc(r.model_answer)}</div></section>` : ""}
      ${r.flags && r.flags.length && !r.demo ? `<section class="sheet-sec"><h4>For your teacher</h4><div class="flags">${r.flags.map((f) => `<span>${esc(f)}</span>`).join("")}</div></section>` : ""}
      <footer class="sheet-foot"><span>Marked by Nexlyr AI examiner${c.model && c.model !== "sample" ? " · " + esc(c.model) : ""}</span><span>AI marks are a guide. Teachers can review any mark.</span></footer>
    </article>`;
  }
  window.NX_REPORT = { render, annotate };
})();

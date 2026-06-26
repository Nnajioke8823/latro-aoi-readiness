/* app.js — populates choice fields and the use-case grid live from Dataverse,
 * then submits. Talks only to same-origin /api routes (no CORS, no browser tokens).
 * Choice option VALUES come straight from your global Choices via /api/choices,
 * so there is no hand-maintained value map. */
(function () {
  "use strict";
  const form = document.getElementById("surveyForm");
  const grid = document.getElementById("ucGrid");
  const ucStatus = document.getElementById("ucStatus");
  const errBox = document.getElementById("formError");
  const submitBtn = document.getElementById("submitBtn");
  let CHOICES = {};

  // ---- Load choices + use cases together ----
  Promise.all([
    fetch("/api/choices").then(r => r.ok ? r.json() : Promise.reject("choices " + r.status)),
    fetch("/api/usecases").then(r => r.ok ? r.json() : Promise.reject("usecases " + r.status))
  ]).then(function (res) {
    CHOICES = res[0] || {};
    populateChoices();
    renderGrid(res[1] || []);
  }).catch(function (e) {
    ucStatus.textContent = "Could not load options from Dataverse (" + e + ").";
  });

  function populateChoices() {
    document.querySelectorAll("select[data-choice]").forEach(function (sel) {
      (CHOICES[sel.dataset.choice] || []).forEach(function (o) {
        const opt = document.createElement("option");
        opt.value = o.value; opt.textContent = o.label;
        sel.appendChild(opt);
      });
    });
    document.querySelectorAll("[data-choice-radios]").forEach(function (box) {
      const key = box.dataset.choiceRadios;
      (CHOICES[key] || []).forEach(function (o) {
        const lbl = document.createElement("label");
        lbl.className = "opt-row";
        lbl.innerHTML = '<input type="radio" name="' + key + '" value="' + o.value + '"><span>' + esc(o.label) + '</span>';
        box.appendChild(lbl);
      });
    });
  }

  function renderGrid(groups) {
    if (!groups.length) { ucStatus.textContent = "No use cases found."; return; }
    const resp = CHOICES.lts_ucresponse || [];
    ucStatus.hidden = true;
    const rows = ['<table><thead><tr><th>Ref</th><th>Use case</th><th>What it does</th><th>Your response</th></tr></thead><tbody>'];
    groups.forEach(function (g) {
      rows.push('<tr class="grp"><td colspan="4">' + esc(g.domain) + '</td></tr>');
      g.items.forEach(function (u) {
        const nm = "uc::" + u.reference;
        const pills = resp.map(function (o) {
          return '<label class="pill"><input type="radio" name="' + esc(nm) + '" value="' + o.value + '"><span>' + esc(o.label) + '</span></label>';
        }).join("");
        rows.push('<tr><td class="ref">' + esc(u.reference) + '</td><td class="t">' + esc(u.name) +
          '</td><td class="d">' + esc(u.description || "") + '</td><td>' + pills + '</td></tr>');
      });
    });
    rows.push('</tbody></table>');
    grid.innerHTML = rows.join("");
  }

  // ---- Submit ----
  form.addEventListener("submit", function (e) {
    e.preventDefault();
    errBox.hidden = true;
    const assessment = {}, seen = {};
    form.querySelectorAll("[name^='lts_']").forEach(function (el) {
      if (el.type === "radio" && !el.checked) return;
      const v = el.value;
      if (v === "" || v == null) return;
      // selects + radios are choice values or 1–5 ratings → numeric; text stays string
      assessment[el.name] = (el.tagName === "SELECT" || el.type === "radio") ? Number(v) : v;
      seen[el.name] = true;
    });

    const missing = ["lts_businessunit", "lts_function"].filter(k => !seen[k]);
    if (missing.length) return showError("Please complete Business unit and Function before submitting.");

    const ratings = [];
    form.querySelectorAll("input[name^='uc::']:checked").forEach(function (el) {
      ratings.push({ reference: el.name.slice(4), response: Number(el.value) });
    });

    submitBtn.disabled = true; submitBtn.textContent = "Submitting…";
    fetch("/api/submit", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ assessment: assessment, ratings: ratings })
    }).then(r => r.ok ? r.json() : r.text().then(t => Promise.reject(t)))
      .then(function () {
        form.hidden = true;
        document.getElementById("thankYou").hidden = false;
        window.scrollTo(0, 0);
      }).catch(function (msg) {
        submitBtn.disabled = false; submitBtn.textContent = "Submit response";
        showError("Sorry — your response could not be saved. " + (typeof msg === "string" ? msg : ""));
      });
  });

  function showError(m) { errBox.textContent = m; errBox.hidden = false; window.scrollTo(0, document.body.scrollHeight); }
  function esc(s) { return String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])); }
})();

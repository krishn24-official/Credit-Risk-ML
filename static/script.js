(() => {
  "use strict";

  // Same origin when served by FastAPI. If you host the UI separately,
  // set this to your Render URL, e.g. "https://your-app.onrender.com".
  const API_BASE = "";

  const PRESETS = {
    strong: {
      person_age: 35, person_income: 90000, person_emp_length: 8, cb_person_cred_hist_length: 10,
      person_home_ownership: "MORTGAGE", cb_person_default_on_file: "N",
      loan_amnt: 5000, loan_intent: "HOMEIMPROVEMENT", loan_int_rate: 7.5, loan_grade: "A",
    },
    average: {
      person_age: 27, person_income: 45000, person_emp_length: 3, cb_person_cred_hist_length: 4,
      person_home_ownership: "RENT", cb_person_default_on_file: "N",
      loan_amnt: 12000, loan_intent: "MEDICAL", loan_int_rate: 13.5, loan_grade: "C",
    },
    risky: {
      person_age: 22, person_income: 25000, person_emp_length: 1, cb_person_cred_hist_length: 2,
      person_home_ownership: "RENT", cb_person_default_on_file: "Y",
      loan_amnt: 15000, loan_intent: "DEBTCONSOLIDATION", loan_int_rate: 18.5, loan_grade: "E",
    },
  };

  const INTENT_LABELS = {
    PERSONAL: "Personal", EDUCATION: "Education", MEDICAL: "Medical", VENTURE: "Venture",
    HOMEIMPROVEMENT: "Home improvement", DEBTCONSOLIDATION: "Debt consolidation",
  };

  const $ = (sel) => document.querySelector(sel);
  const form = $("#loanForm");
  const resultCard = $(".result-card");
  const submitBtn = $("#submitBtn");
  const formError = $("#formError");
  const rate = $("#loan_int_rate");
  const rateOut = $("#rateOut");
  const ratioOut = $("#ratioOut");
  const ratioFill = $("#ratioFill");
  const gaugeFill = $("#gaugeFill");
  const thresholdMark = $("#thresholdMark");
  const probOut = $("#probOut");
  const verdict = $("#verdict");
  const verdictTitle = $("#verdictTitle");
  const verdictSub = $("#verdictSub");
  const thresholdOut = $("#thresholdOut");
  const marginOut = $("#marginOut");
  const historyList = $("#historyList");
  const historyEmpty = $("#historyEmpty");
  const clearHistoryBtn = $("#clearHistory");
  const apiStatus = $("#apiStatus");

  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

  // ---------- Helpers ----------
  const fmtPct = (p) => {
    const v = p * 100;
    if (v > 0 && v < 0.1) return "<0.1%";
    return `${v.toFixed(1)}%`;
  };

  const storage = {
    get(key, fallback) {
      try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; } catch { return fallback; }
    },
    set(key, value) {
      try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* storage unavailable */ }
    },
  };

  // ---------- Theme ----------
  $("#themeToggle").addEventListener("click", () => {
    const root = document.documentElement;
    const current = root.getAttribute("data-theme")
      || (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
    const next = current === "dark" ? "light" : "dark";
    root.setAttribute("data-theme", next);
    try { localStorage.setItem("cr-theme", next); } catch { /* ignore */ }
  });

  // ---------- API status ----------
  async function checkHealth() {
    try {
      const res = await fetch(`${API_BASE}/health`);
      const data = await res.json();
      const ok = res.ok && data.model_loaded;
      apiStatus.dataset.state = ok ? "online" : "offline";
      apiStatus.querySelector(".api-label").textContent = ok ? "Model online" : "Model not loaded";
    } catch {
      apiStatus.dataset.state = "offline";
      apiStatus.querySelector(".api-label").textContent = "API offline";
    }
  }

  // ---------- Live form feedback ----------
  function updateRate() {
    const min = +rate.min, max = +rate.max, v = +rate.value;
    rate.style.setProperty("--pct", `${((v - min) / (max - min)) * 100}%`);
    rateOut.textContent = `${v.toFixed(1)}%`;
  }

  function getRatio() {
    const income = parseFloat(form.person_income.value);
    const amount = parseFloat(form.loan_amnt.value);
    if (!(income > 0) || !(amount > 0)) return null;
    return amount / income;
  }

  function updateRatio() {
    const r = getRatio();
    if (r === null) {
      ratioOut.textContent = "–";
      ratioFill.style.width = "0";
      return;
    }
    ratioOut.textContent = `${(r * 100).toFixed(0)}%`;
    ratioFill.style.width = `${Math.min(r, 1) * 100}%`;
    ratioFill.classList.toggle("warn", r >= 0.3);
  }

  function setRadio(name, value) {
    const el = form.querySelector(`input[name="${name}"][value="${value}"]`);
    if (el) el.checked = true;
  }

  function fillForm(values) {
    for (const [key, value] of Object.entries(values)) {
      const el = form.elements[key];
      if (!el) continue;
      if (el instanceof RadioNodeList) setRadio(key, value);
      else el.value = value;
    }
    form.querySelectorAll(".field.invalid").forEach((f) => f.classList.remove("invalid"));
    formError.hidden = true;
    updateRate();
    updateRatio();
  }

  document.querySelectorAll("[data-preset]").forEach((btn) => {
    btn.addEventListener("click", () => fillForm(PRESETS[btn.dataset.preset]));
  });

  rate.addEventListener("input", updateRate);
  form.person_income.addEventListener("input", updateRatio);
  form.loan_amnt.addEventListener("input", updateRatio);
  form.addEventListener("input", (e) => {
    const field = e.target.closest(".field");
    if (field) field.classList.remove("invalid");
  });

  // ---------- Validation ----------
  function validate() {
    const errors = [];
    const mark = (name, msg) => {
      const el = form.elements[name];
      const node = el instanceof RadioNodeList ? el[0] : el;
      const field = node && node.closest(".field");
      if (field) {
        field.classList.remove("invalid");
        void field.offsetWidth; // restart shake animation
        field.classList.add("invalid");
      }
      errors.push(msg);
    };

    const num = (name) => parseFloat(form.elements[name].value);
    const age = num("person_age");
    const income = num("person_income");
    const emp = num("person_emp_length");
    const hist = num("cb_person_cred_hist_length");
    const amount = num("loan_amnt");

    if (!(age >= 18 && age <= 100)) mark("person_age", "Age must be between 18 and 100.");
    if (!(income > 0)) mark("person_income", "Enter an annual income.");
    if (!(emp >= 0)) mark("person_emp_length", "Enter employment length in years.");
    else if (age >= 18 && emp > age - 14) mark("person_emp_length", "Employment length is too long for this age.");
    if (!(hist >= 0)) mark("cb_person_cred_hist_length", "Enter credit history length in years.");
    if (!(amount > 0)) mark("loan_amnt", "Enter a loan amount.");
    ["person_home_ownership", "cb_person_default_on_file", "loan_grade"].forEach((name) => {
      if (!form.elements[name].value) mark(name, "Please complete every choice.");
    });

    return errors;
  }

  function buildPayload() {
    const f = form.elements;
    return {
      person_age: parseInt(f.person_age.value, 10),
      person_income: parseFloat(f.person_income.value),
      person_home_ownership: f.person_home_ownership.value,
      person_emp_length: parseFloat(f.person_emp_length.value),
      loan_intent: f.loan_intent.value,
      loan_grade: f.loan_grade.value,
      loan_amnt: parseFloat(f.loan_amnt.value),
      loan_int_rate: parseFloat(f.loan_int_rate.value),
      loan_percent_income: Math.round(getRatio() * 100) / 100,
      cb_person_default_on_file: f.cb_person_default_on_file.value,
      cb_person_cred_hist_length: parseInt(f.cb_person_cred_hist_length.value, 10),
    };
  }

  // ---------- Result rendering ----------
  function animateNumber(el, to, duration = 1200) {
    if (reduceMotion) { el.textContent = fmtPct(to); return; }
    const from = parseFloat(el.dataset.value || "0");
    const start = performance.now();
    const step = (now) => {
      const t = Math.min((now - start) / duration, 1);
      const eased = 1 - Math.pow(1 - t, 4);
      el.textContent = fmtPct(from + (to - from) * eased);
      if (t < 1) requestAnimationFrame(step);
      else el.textContent = fmtPct(to);
    };
    requestAnimationFrame(step);
    el.dataset.value = String(to);
  }

  function renderResult(data) {
    const p = data.default_probability;
    const t = data.threshold;
    const high = data.default_prediction === 1;
    const state = high ? "high" : "low";

    resultCard.dataset.state = state;
    gaugeFill.style.strokeDasharray = `${Math.max(p * 100, 0.5)} 200`;
    thresholdMark.setAttribute("transform", `rotate(${(t - 0.5) * 180} 120 120)`);
    animateNumber(probOut, p);

    verdict.dataset.state = state;
    verdict.classList.remove("pop");
    void verdict.offsetWidth;
    verdict.classList.add("pop");
    verdictTitle.textContent = data.result;
    verdictSub.textContent = high
      ? `Probability is at or above the ${fmtPct(t)} cutoff. Likely to default.`
      : `Probability is below the ${fmtPct(t)} cutoff. Unlikely to default.`;

    thresholdOut.textContent = fmtPct(t);
    const margin = (p - t) * 100;
    marginOut.textContent = `${margin >= 0 ? "+" : "−"}${Math.abs(margin).toFixed(1)} pts`;
  }

  // ---------- History ----------
  let history = storage.get("cr-history", []);

  function renderHistory() {
    historyList.innerHTML = "";
    history.forEach((h) => {
      const li = document.createElement("li");
      const tag = document.createElement("span");
      tag.className = `tag ${h.high ? "high" : "low"}`;
      tag.textContent = h.high ? "High" : "Low";
      const desc = document.createElement("span");
      desc.className = "h-desc";
      desc.textContent = `${usd.format(h.amount)} · Grade ${h.grade} · ${INTENT_LABELS[h.intent] || h.intent}`;
      const prob = document.createElement("span");
      prob.className = "h-prob";
      prob.textContent = fmtPct(h.p);
      li.append(tag, desc, prob);
      historyList.append(li);
    });
    historyEmpty.hidden = history.length > 0;
    clearHistoryBtn.hidden = history.length === 0;
  }

  function addHistory(payload, data) {
    history.unshift({
      amount: payload.loan_amnt,
      grade: payload.loan_grade,
      intent: payload.loan_intent,
      p: data.default_probability,
      high: data.default_prediction === 1,
    });
    history = history.slice(0, 5);
    storage.set("cr-history", history);
    renderHistory();
  }

  clearHistoryBtn.addEventListener("click", () => {
    history = [];
    storage.set("cr-history", history);
    renderHistory();
  });

  // ---------- Submit ----------
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    formError.hidden = true;

    const errors = validate();
    if (errors.length) {
      formError.textContent = errors[0];
      formError.hidden = false;
      return;
    }

    const payload = buildPayload();
    submitBtn.classList.add("loading");
    submitBtn.querySelector(".btn-label").textContent = "Assessing…";

    try {
      const res = await fetch(`${API_BASE}/predict`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error(`Server responded with ${res.status}`);
      const data = await res.json();
      renderResult(data);
      addHistory(payload, data);
      if (window.innerWidth <= 920) resultCard.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth" });
    } catch (err) {
      formError.textContent = `Could not get a prediction (${err.message}). The server may be waking up — try again in a few seconds.`;
      formError.hidden = false;
    } finally {
      submitBtn.classList.remove("loading");
      submitBtn.querySelector(".btn-label").textContent = "Assess risk";
    }
  });

  // ---------- Init ----------
  fillForm(PRESETS.average);
  renderHistory();
  checkHealth();
})();

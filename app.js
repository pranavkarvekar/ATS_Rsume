/* ═══════════════════════════════════════════════
   ATS Resume Analyzer — Frontend Logic
   ═══════════════════════════════════════════════ */

(function () {
  'use strict';

  // ── DOM References ────────────────────────────
  const dropZone       = document.getElementById('dropZone');
  const dropZoneInner  = document.getElementById('dropZoneInner');
  const fileChosen     = document.getElementById('fileChosen');
  const fileChosenName = document.getElementById('fileChosenName');
  const fileInput      = document.getElementById('fileInput');
  const btnRemoveFile  = document.getElementById('btnRemoveFile');
  const jobDesc        = document.getElementById('jobDescription');
  const analyzeBtn     = document.getElementById('analyzeBtn');
  const btnText        = document.getElementById('btnText');
  const btnLoader      = document.getElementById('btnLoader');
  const inputSection   = document.getElementById('inputSection');
  const resultsSection = document.getElementById('resultsSection');
  const scoreFg        = document.getElementById('scoreFg');
  const scoreValue     = document.getElementById('scoreValue');
  const scoreLabel     = document.getElementById('scoreLabel');
  const keywordsList   = document.getElementById('keywordsList');
  const optList        = document.getElementById('optList');
  const resetBtn       = document.getElementById('resetBtn');
  const toast          = document.getElementById('toast');
  const toastMsg       = document.getElementById('toastMsg');
  const navTabs        = document.querySelectorAll('.nav-tab');

  // ── State ─────────────────────────────────────
  let selectedFile   = null;
  let resumeText     = '';

  // ── Inject gradient <defs> into score ring SVG ─
  (function injectScoreGradient() {
    const svg = document.querySelector('.score-ring');
    if (!svg) return;
    const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
    defs.innerHTML = `
      <linearGradient id="scoreGrad" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stop-color="#a78bfa"/>
        <stop offset="100%" stop-color="#38bdf8"/>
      </linearGradient>`;
    svg.prepend(defs);
  })();

  // ── Nav Tab Switching ─────────────────────────
  navTabs.forEach(tab => {
    tab.addEventListener('click', () => {
      navTabs.forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
    });
  });

  // ── Drag & Drop + Click ───────────────────────
  dropZone.addEventListener('click', () => fileInput.click());
  dropZone.addEventListener('keydown', e => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileInput.click(); }
  });

  ['dragenter', 'dragover'].forEach(evt =>
    dropZone.addEventListener(evt, e => { e.preventDefault(); dropZone.classList.add('drag-over'); })
  );
  ['dragleave', 'drop'].forEach(evt =>
    dropZone.addEventListener(evt, e => { e.preventDefault(); dropZone.classList.remove('drag-over'); })
  );

  dropZone.addEventListener('drop', e => {
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  });

  fileInput.addEventListener('change', () => {
    if (fileInput.files[0]) handleFile(fileInput.files[0]);
  });

  btnRemoveFile.addEventListener('click', e => {
    e.stopPropagation();
    clearFile();
  });

  // ── File Handling ─────────────────────────────
  function handleFile(file) {
    const ext = file.name.split('.').pop().toLowerCase();
    if (!['pdf', 'txt'].includes(ext)) {
      showToast('Unsupported file type. Please upload a PDF or TXT file.');
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      showToast('File too large. Maximum size is 5 MB.');
      return;
    }
    selectedFile = file;
    fileChosenName.textContent = file.name;
    dropZoneInner.classList.add('hidden');
    fileChosen.classList.remove('hidden');
    updateAnalyzeBtn();
  }

  function clearFile() {
    selectedFile = null;
    resumeText = '';
    fileInput.value = '';
    dropZoneInner.classList.remove('hidden');
    fileChosen.classList.add('hidden');
    updateAnalyzeBtn();
  }

  // ── JD Listener ───────────────────────────────
  jobDesc.addEventListener('input', updateAnalyzeBtn);

  function updateAnalyzeBtn() {
    analyzeBtn.disabled = !(selectedFile && jobDesc.value.trim().length > 10);
  }

  // ── Extract Text from PDF / TXT ───────────────
  async function extractText(file) {
    const ext = file.name.split('.').pop().toLowerCase();
    if (ext === 'txt') {
      return file.text();
    }
    // PDF extraction using pdf.js
    const arrayBuf = await file.arrayBuffer();
    pdfjsLib.GlobalWorkerOptions.workerSrc =
      'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/2.16.105/pdf.worker.min.js';
    const pdf = await pdfjsLib.getDocument({ data: arrayBuf }).promise;
    let text = '';
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const content = await page.getTextContent();
      text += content.items.map(item => item.str).join(' ') + '\n';
    }
    return text;
  }

  // ── Analyze Button ────────────────────────────
  analyzeBtn.addEventListener('click', async () => {
    if (analyzeBtn.disabled) return;
    setLoading(true);

    try {
      resumeText = await extractText(selectedFile);
      if (!resumeText.trim()) {
        throw new Error('Could not extract any text from the resume. Try a different file.');
      }

      const res = await fetch('/api/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          resume_text: resumeText.substring(0, 12000),     // cap length
          job_description: jobDesc.value.trim().substring(0, 6000)
        })
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `Server error (${res.status})`);
      }

      const data = await res.json();
      renderResults(data);
    } catch (err) {
      showToast(err.message || 'Something went wrong. Please try again.');
    } finally {
      setLoading(false);
    }
  });

  // ── Render Results ────────────────────────────
  function renderResults(data) {
    const score    = Math.round(Number(data.ats_score) || 0);
    const keywords = Array.isArray(data.missing_keywords) ? data.missing_keywords : [];
    const opts     = Array.isArray(data.optimizations) ? data.optimizations : [];

    // Score ring
    const circumference = 2 * Math.PI * 70; // r = 70
    const offset = circumference - (score / 100) * circumference;
    scoreFg.style.strokeDasharray = circumference;
    scoreFg.style.strokeDashoffset = circumference; // start full
    requestAnimationFrame(() => {
      scoreFg.style.strokeDashoffset = offset;
    });

    // Animated counter
    animateCounter(scoreValue, score);

    // Label color
    if (score >= 75)      { scoreLabel.textContent = 'Excellent match!'; scoreLabel.style.color = 'var(--green)'; }
    else if (score >= 50) { scoreLabel.textContent = 'Decent — needs improvement.'; scoreLabel.style.color = 'var(--amber)'; }
    else                  { scoreLabel.textContent = 'Significant gaps found.'; scoreLabel.style.color = 'var(--red)'; }

    // Keywords
    if (keywords.length) {
      keywordsList.innerHTML = keywords.map((kw, i) =>
        `<span class="chip" style="animation-delay:${i * .06}s">${escapeHTML(kw)}</span>`
      ).join('');
    } else {
      keywordsList.innerHTML = '<p class="placeholder-text">No missing keywords — great job!</p>';
    }

    // Optimizations
    if (opts.length) {
      optList.innerHTML = opts.map((o, i) =>
        `<li style="animation-delay:${i * .08}s">${escapeHTML(o)}</li>`
      ).join('');
    } else {
      optList.innerHTML = '<li class="placeholder-text">No suggestions — your resume looks solid!</li>';
    }

    // Toggle sections
    inputSection.classList.add('hidden');
    resultsSection.classList.remove('hidden');
  }

  // ── Animated Counter ──────────────────────────
  function animateCounter(el, target) {
    const duration = 1200;
    const start = performance.now();
    function tick(now) {
      const t = Math.min((now - start) / duration, 1);
      el.textContent = Math.round(t * target);
      if (t < 1) requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
  }

  // ── Reset ─────────────────────────────────────
  resetBtn.addEventListener('click', () => {
    resultsSection.classList.add('hidden');
    inputSection.classList.remove('hidden');
    clearFile();
    jobDesc.value = '';
    updateAnalyzeBtn();
  });

  // ── Helpers ───────────────────────────────────
  function setLoading(on) {
    analyzeBtn.disabled = on;
    btnLoader.classList.toggle('hidden', !on);
    btnText.textContent = on ? 'Analyzing…' : 'Analyze Resume';
  }

  function showToast(msg) {
    toastMsg.textContent = msg;
    toast.classList.remove('hidden');
    toast.classList.add('show');
    setTimeout(() => {
      toast.classList.remove('show');
      setTimeout(() => toast.classList.add('hidden'), 300);
    }, 4500);
  }

  function escapeHTML(str) {
    const d = document.createElement('div');
    d.textContent = str;
    return d.innerHTML;
  }
})();

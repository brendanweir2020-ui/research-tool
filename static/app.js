// ── State ──
let currentResult = null;
let activeTab = 'exercise';

// ── Init ──
document.addEventListener('DOMContentLoaded', () => {
  setupDropZone();
  setupFileInput();
  setupUrlInput();
  loadHistory();
});

// ── View Switching ──
function showView(id) {
  ['uploadView', 'loadingView', 'resultsView'].forEach(v => {
    document.getElementById(v).style.display = v === id ? '' : 'none';
  });
}

function showUpload() {
  showView('uploadView');
  document.getElementById('errorBox').style.display = 'none';
  document.getElementById('urlInput').value = '';
  // Clear active history selection
  document.querySelectorAll('.history-item').forEach(el => el.classList.remove('active'));
}

// ── File Drop Zone ──
function setupDropZone() {
  const zone = document.getElementById('dropZone');

  zone.addEventListener('dragover', e => {
    e.preventDefault();
    zone.classList.add('drag-over');
  });

  zone.addEventListener('dragleave', () => zone.classList.remove('drag-over'));

  zone.addEventListener('drop', e => {
    e.preventDefault();
    zone.classList.remove('drag-over');
    const file = e.dataTransfer.files[0];
    if (file) processFile(file);
  });

  zone.addEventListener('click', () => document.getElementById('fileInput').click());
}

function setupFileInput() {
  document.getElementById('fileInput').addEventListener('change', e => {
    const file = e.target.files[0];
    if (file) processFile(file);
    e.target.value = ''; // reset so same file can be re-selected
  });
}

function setupUrlInput() {
  const input = document.getElementById('urlInput');
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter') analyzeUrl();
  });
}

// ── File Processing ──
async function processFile(file) {
  const allowed = ['pdf', 'docx', 'txt'];
  const ext = file.name.split('.').pop().toLowerCase();
  if (!allowed.includes(ext)) {
    showError(`Unsupported file type (.${ext}). Please upload a PDF, Word document, or text file.`);
    return;
  }

  showLoading();
  animateLoadingSteps();

  const formData = new FormData();
  formData.append('file', file);

  try {
    const res = await fetch('/process', { method: 'POST', body: formData });
    const data = await res.json();

    if (!res.ok) {
      showUpload();
      showError(data.error || 'An unexpected error occurred.');
      return;
    }

    currentResult = data;
    renderResults(data);
    loadHistory();

  } catch (err) {
    showUpload();
    showError('Could not connect to the app. Please make sure the app is running.');
  }
}

// ── URL Processing ──
async function analyzeUrl() {
  const url = document.getElementById('urlInput').value.trim();
  if (!url) {
    showError('Please enter a URL.');
    return;
  }
  if (!url.startsWith('http://') && !url.startsWith('https://')) {
    showError('Please enter a valid URL starting with http:// or https://');
    return;
  }

  showLoading();
  animateLoadingSteps();

  try {
    const res = await fetch('/process', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url })
    });
    const data = await res.json();

    if (!res.ok) {
      showUpload();
      showError(data.error || 'An unexpected error occurred.');
      return;
    }

    currentResult = data;
    renderResults(data);
    loadHistory();

  } catch (err) {
    showUpload();
    showError('Could not connect to the app. Please make sure the app is running.');
  }
}

// ── Loading Animation ──
function showLoading() {
  showView('loadingView');
  document.getElementById('errorBox').style.display = 'none';
  ['step1', 'step2', 'step3'].forEach(id => {
    const el = document.getElementById(id);
    el.classList.remove('active', 'done');
  });
  document.getElementById('step1').classList.add('active');
}

function animateLoadingSteps() {
  setTimeout(() => {
    document.getElementById('step1').classList.remove('active');
    document.getElementById('step1').classList.add('done');
    document.getElementById('step2').classList.add('active');
  }, 4000);

  setTimeout(() => {
    document.getElementById('step2').classList.remove('active');
    document.getElementById('step2').classList.add('done');
    document.getElementById('step3').classList.add('active');
  }, 12000);
}

// ── Render Results ──
function renderResults(data) {
  const a = data.analysis;
  showView('resultsView');
  activeTab = 'exercise';

  // Reset tabs
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.tab')[0].classList.add('active');
  document.querySelectorAll('.tab-content').forEach((tc, i) => {
    tc.style.display = i === 0 ? '' : 'none';
  });

  // Source + title
  document.getElementById('resultsSource').textContent = truncate(data.source, 60);
  document.getElementById('resultsTitle').textContent = a.title || data.source;

  // Evidence badge
  const eq = a.evidence_quality || {};
  const score = eq.score || 1;
  const badge = document.getElementById('evidenceBadge');
  badge.textContent = eq.level || 'Unknown Evidence Level';
  badge.className = `evidence-badge evidence-${Math.min(5, Math.max(1, Math.round(score)))}`;

  // Stars in badge
  const stars = '★'.repeat(score) + '☆'.repeat(5 - score);
  badge.textContent = `${stars} ${eq.level || 'Unknown'}`;

  // Evidence detail
  document.getElementById('evidenceDetail').textContent = eq.explanation || '';

  // Bottom line
  const bottomLine = a.clinical_bottom_line || '';
  document.getElementById('bottomLineText').textContent = bottomLine;
  document.getElementById('bottomLineCard').style.display = bottomLine ? '' : 'none';

  // Clinical summary
  document.getElementById('clinicalSummary').textContent = a.clinical_summary || '';

  // Key findings
  const kf = document.getElementById('keyFindings');
  kf.innerHTML = '';
  (a.key_findings || []).forEach((f, i) => {
    kf.innerHTML += `<div class="finding-item">
      <span class="finding-bullet">${i + 1}</span>
      <span>${escapeHtml(f)}</span>
    </div>`;
  });

  // Population
  const pop = document.getElementById('populationTag');
  if (a.population_studied) {
    pop.textContent = '👥 ' + a.population_studied;
    pop.style.display = '';
  } else {
    pop.style.display = 'none';
  }

  // Exercise protocols
  renderExerciseTab(a.exercise_protocols || []);

  // Patient education
  const pe = document.getElementById('patientContent');
  pe.innerHTML = '';
  (a.patient_education || []).forEach(pt => {
    pe.innerHTML += `<li>${escapeHtml(pt)}</li>`;
  });

  // Clinical decisions
  renderClinicalTab(a.clinical_decision_points || {});

  // Limitations
  const lim = document.getElementById('limitationsContent');
  lim.innerHTML = '';
  (a.limitations || []).forEach(l => {
    lim.innerHTML += `<li>${escapeHtml(l)}</li>`;
  });
}

function renderExerciseTab(protocols) {
  const container = document.getElementById('exerciseContent');
  container.innerHTML = '';

  if (!protocols || protocols.length === 0) {
    container.innerHTML = `<div class="no-protocols">
      ⚠️ <strong>No specific exercise protocols were identified in this document.</strong><br><br>
      This may be a review article, editorial, or document focused on diagnosis/theory rather than treatment protocols.
      The Patient Education and Clinical Decisions tabs may still contain useful information.
    </div>`;
    return;
  }

  protocols.forEach(protocol => {
    let exerciseHtml = '';
    (protocol.exercises || []).forEach(ex => {
      exerciseHtml += `
        <div class="exercise-item">
          <div class="exercise-name">${escapeHtml(ex.name || '')}</div>
          <div class="exercise-params">
            ${ex.parameters ? `<span class="param-tag">📊 ${escapeHtml(ex.parameters)}</span>` : ''}
          </div>
          ${ex.progression ? `<div class="exercise-progression">${escapeHtml(ex.progression)}</div>` : ''}
          ${ex.notes ? `<div class="exercise-notes">${escapeHtml(ex.notes)}</div>` : ''}
        </div>`;
    });

    container.innerHTML += `
      <div class="protocol-card">
        <div class="protocol-header">
          <span class="protocol-condition">${escapeHtml(protocol.condition_or_goal || 'Protocol')}</span>
          ${protocol.program_duration ? `<span class="protocol-duration">⏱ ${escapeHtml(protocol.program_duration)}</span>` : ''}
        </div>
        ${protocol.outcome_measures ? `<div class="protocol-outcomes">✓ Evidence for: ${escapeHtml(protocol.outcome_measures)}</div>` : ''}
        <div class="exercise-list">${exerciseHtml}</div>
      </div>`;
  });
}

function renderClinicalTab(cdp) {
  const container = document.getElementById('clinicalContent');
  container.innerHTML = '<div class="decisions-grid"></div>';
  const grid = container.querySelector('.decisions-grid');

  const sections = [
    { key: 'indications', label: '✓ Indications', icon: '✓', cls: 'ds-green', bullet: '✓' },
    { key: 'contraindications', label: '✗ Contraindications', icon: '✗', cls: 'ds-red', bullet: '✗' },
    { key: 'red_flags', label: '🚩 Red Flags', icon: '🚩', cls: 'ds-amber', bullet: '•' },
    { key: 'when_to_refer', label: '→ When to Refer', icon: '→', cls: 'ds-purple', bullet: '→' },
    { key: 'dosage_considerations', label: '💊 Dosage & Frequency', icon: '💊', cls: 'ds-blue', bullet: '•' },
  ];

  sections.forEach(s => {
    const items = cdp[s.key] || [];
    if (items.length === 0) return;

    let itemsHtml = items.map(item =>
      `<div class="decision-item"><span class="decision-item-bullet">${s.bullet}</span>${escapeHtml(item)}</div>`
    ).join('');

    grid.innerHTML += `
      <div class="decision-section ${s.cls}">
        <div class="decision-header">${s.label}</div>
        <div class="decision-body">${itemsHtml}</div>
      </div>`;
  });

  if (!grid.innerHTML.trim()) {
    grid.innerHTML = '<div class="no-protocols">No specific clinical decision data was identified in this document.</div>';
  }
}

// ── Tab Switching ──
function switchTab(tab) {
  activeTab = tab;
  document.querySelectorAll('.tab').forEach((t, i) => {
    const tabs = ['exercise', 'patient', 'clinical', 'limitations'];
    t.classList.toggle('active', tabs[i] === tab);
  });
  document.querySelectorAll('.tab-content').forEach(tc => {
    tc.style.display = tc.id === `tab-${tab}` ? '' : 'none';
  });
}

// ── History ──
async function loadHistory() {
  try {
    const res = await fetch('/history');
    const items = await res.json();

    const list = document.getElementById('historyList');
    if (items.length === 0) {
      list.innerHTML = '<div class="history-empty">No documents yet.<br>Upload your first research paper above.</div>';
      return;
    }

    list.innerHTML = items.map(item => {
      const date = formatDate(item.date);
      const scoreNum = parseInt(item.evidence_score) || 1;
      const stars = '★'.repeat(scoreNum) + '☆'.repeat(5 - scoreNum);
      const isActive = currentResult && currentResult.id === item.id;

      return `<div class="history-item${isActive ? ' active' : ''}" onclick="loadResult('${item.id}', this)">
        <div class="history-item-title">${escapeHtml(item.title || item.source)}</div>
        <div class="history-item-meta">
          <span>${date}</span>
          <span class="history-item-badge">${stars}</span>
        </div>
        <button class="history-delete" onclick="deleteResult(event, '${item.id}')" title="Delete">×</button>
      </div>`;
    }).join('');
  } catch (e) {
    console.error('Failed to load history:', e);
  }
}

async function loadResult(id, el) {
  document.querySelectorAll('.history-item').forEach(item => item.classList.remove('active'));
  if (el) el.classList.add('active');

  try {
    const res = await fetch(`/result/${id}`);
    const data = await res.json();
    if (data.error) return;
    currentResult = data;
    renderResults(data);
  } catch (e) {
    console.error('Failed to load result:', e);
  }
}

async function deleteResult(event, id) {
  event.stopPropagation();
  if (!confirm('Delete this result from history?')) return;

  try {
    await fetch(`/delete/${id}`, { method: 'DELETE' });
    if (currentResult && currentResult.id === id) {
      showUpload();
      currentResult = null;
    }
    loadHistory();
  } catch (e) {
    console.error('Failed to delete result:', e);
  }
}

// ── Export ──
function exportResults() {
  window.print();
}

// ── Error Display ──
function showError(msg) {
  const box = document.getElementById('errorBox');
  box.textContent = msg;
  box.style.display = '';
  box.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

// ── Utilities ──
function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function truncate(str, max) {
  if (!str) return '';
  return str.length > max ? str.slice(0, max) + '…' : str;
}

function formatDate(isoString) {
  if (!isoString) return '';
  const d = new Date(isoString);
  const now = new Date();
  const diffMs = now - d;
  const diffH = diffMs / 3600000;
  const diffD = diffMs / 86400000;

  if (diffH < 1) return 'Just now';
  if (diffH < 24) return `${Math.floor(diffH)}h ago`;
  if (diffD < 7) return `${Math.floor(diffD)}d ago`;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

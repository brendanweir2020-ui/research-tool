// ── State ──
let currentResult = null;
let currentSynthesis = null;
let currentTags = [];
let allTags = [];  // all tags used across papers
let activeTab = 'exercise';

// ── Init ──
document.addEventListener('DOMContentLoaded', () => {
  setupDropZone();
  setupFileInput();
  setupUrlInput();
  setupTagInput();
  setupChatInput();
  loadHistory();
  loadConditionLibrary();
});

// ── View Switching ──
function showView(id) {
  ['uploadView','loadingView','synthesizeLoadingView','resultsView','synthesisView'].forEach(v => {
    document.getElementById(v).style.display = v === id ? '' : 'none';
  });
}

function showUpload() {
  showView('uploadView');
  document.getElementById('errorBox').style.display = 'none';
  document.getElementById('urlInput').value = '';
  document.querySelectorAll('.history-item').forEach(el => el.classList.remove('active'));
  currentResult = null;
}

function switchSidebarTab(tab) {
  document.querySelectorAll('.sidebar-tab').forEach(t => t.classList.remove('active'));
  document.getElementById('stab-' + tab).classList.add('active');
  document.getElementById('sidebar-library').style.display = tab === 'library' ? '' : 'none';
  document.getElementById('sidebar-recent').style.display = tab === 'recent' ? '' : 'none';
}

// ── Drop Zone ──
function setupDropZone() {
  const zone = document.getElementById('dropZone');
  zone.addEventListener('dragover', e => { e.preventDefault(); zone.classList.add('drag-over'); });
  zone.addEventListener('dragleave', () => zone.classList.remove('drag-over'));
  zone.addEventListener('drop', e => { e.preventDefault(); zone.classList.remove('drag-over'); const f = e.dataTransfer.files[0]; if (f) processFile(f); });
  zone.addEventListener('click', () => document.getElementById('fileInput').click());
}

function setupFileInput() {
  document.getElementById('fileInput').addEventListener('change', e => {
    const f = e.target.files[0]; if (f) processFile(f); e.target.value = '';
  });
}

function setupUrlInput() {
  document.getElementById('urlInput').addEventListener('keydown', e => { if (e.key === 'Enter') analyzeUrl(); });
}

// ── File / URL Processing ──
async function processFile(file) {
  const ext = file.name.split('.').pop().toLowerCase();
  if (!['pdf','docx','txt'].includes(ext)) { showError(`Unsupported file type (.${ext}). Use PDF, Word, or text.`); return; }
  showLoading(); animateLoadingSteps();
  const fd = new FormData(); fd.append('file', file);
  try {
    const res = await fetch('/process', { method: 'POST', body: fd });
    const data = await res.json();
    if (!res.ok) { showUpload(); showError(data.error || 'An error occurred.'); return; }
    currentResult = data; renderResults(data); loadHistory(); loadConditionLibrary();
  } catch { showUpload(); showError('Could not connect to the app. Is it running?'); }
}

async function analyzeUrl() {
  const url = document.getElementById('urlInput').value.trim();
  if (!url) { showError('Please enter a URL.'); return; }
  if (!url.startsWith('http')) { showError('Please enter a valid URL starting with http:// or https://'); return; }
  showLoading(); animateLoadingSteps();
  try {
    const res = await fetch('/process', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({url}) });
    const data = await res.json();
    if (!res.ok) { showUpload(); showError(data.error || 'An error occurred.'); return; }
    currentResult = data; renderResults(data); loadHistory(); loadConditionLibrary();
  } catch { showUpload(); showError('Could not connect to the app.'); }
}

// ── Loading ──
function showLoading() {
  showView('loadingView');
  document.getElementById('errorBox').style.display = 'none';
  ['step1','step2','step3'].forEach(id => { const el = document.getElementById(id); el.classList.remove('active','done'); });
  document.getElementById('step1').classList.add('active');
}

function animateLoadingSteps() {
  setTimeout(() => { document.getElementById('step1').classList.replace('active','done'); document.getElementById('step2').classList.add('active'); }, 5000);
  setTimeout(() => { document.getElementById('step2').classList.replace('active','done'); document.getElementById('step3').classList.add('active'); }, 15000);
}

// ── Render Single Paper Results ──
function renderResults(data) {
  const a = data.analysis;
  showView('resultsView');
  activeTab = 'exercise';

  // Reset tabs
  document.querySelectorAll('#resultsView .tab').forEach((t,i) => t.classList.toggle('active', i===0));
  document.querySelectorAll('#resultsView .tab-content').forEach((tc,i) => tc.style.display = i===0 ? '' : 'none');

  document.getElementById('resultsSource').textContent = truncate(data.source, 60);
  document.getElementById('resultsTitle').textContent = a.title || data.source;

  // Evidence badge
  const eq = a.evidence_quality || {};
  const score = Math.min(5, Math.max(1, Math.round(eq.score || 1)));
  const badge = document.getElementById('evidenceBadge');
  badge.textContent = '★'.repeat(score) + '☆'.repeat(5-score) + ' ' + (eq.level || 'Unknown');
  badge.className = `evidence-badge evidence-${score}`;
  document.getElementById('evidenceDetail').textContent = eq.explanation || '';

  // Bottom line
  const bl = a.clinical_bottom_line || '';
  document.getElementById('bottomLineText').textContent = bl;
  document.getElementById('bottomLineCard').style.display = bl ? '' : 'none';

  // Summary
  document.getElementById('clinicalSummary').textContent = a.clinical_summary || '';
  const kf = document.getElementById('keyFindings'); kf.innerHTML = '';
  (a.key_findings || []).forEach((f,i) => { kf.innerHTML += `<div class="finding-item"><span class="finding-bullet">${i+1}</span><span>${escapeHtml(f)}</span></div>`; });
  const pop = document.getElementById('populationTag');
  if (a.population_studied) { pop.textContent = '👥 ' + a.population_studied; pop.style.display = ''; } else { pop.style.display = 'none'; }

  // Tags — load existing tags and show AI-suggested condition
  currentTags = [...(data.tags || [])];
  renderTagChips();
  const aiCondition = a.condition || '';
  const hint = document.getElementById('aiConditionHint');
  if (aiCondition && !currentTags.includes(aiCondition)) {
    hint.innerHTML = `💡 AI suggests: <button class="tag-suggestion" onclick="addTagFromSuggestion('${escapeAttr(aiCondition)}')">${escapeHtml(aiCondition)}</button>`;
  } else { hint.textContent = ''; }

  // Exercise protocols
  renderExerciseTab(a.exercise_protocols || [], a.outcome_measures_used || []);

  // Patient education
  const pe = document.getElementById('patientContent'); pe.innerHTML = '';
  (a.patient_education || []).forEach(pt => { pe.innerHTML += `<li>${escapeHtml(pt)}</li>`; });

  // Clinical decisions
  renderClinicalTab(a.clinical_decision_points || {});

  // Limitations
  const lim = document.getElementById('limitationsContent'); lim.innerHTML = '';
  (a.limitations || []).forEach(l => { lim.innerHTML += `<li>${escapeHtml(l)}</li>`; });

  // Mark active in sidebar
  document.querySelectorAll('.history-item').forEach(el => el.classList.toggle('active', el.dataset.id === data.id));
}

function renderExerciseTab(protocols, outcomeMeasures) {
  const container = document.getElementById('exerciseContent'); container.innerHTML = '';

  if (!protocols || protocols.length === 0) {
    container.innerHTML = `<div class="no-protocols">⚠️ <strong>No specific exercise protocols found.</strong><br><br>This may be a review or diagnostic article. Check Patient Education and Clinical Decisions tabs.</div>`;
    return;
  }

  protocols.forEach(protocol => {
    let exHtml = '';
    (protocol.exercises || []).forEach(ex => {
      exHtml += `<div class="exercise-item">
        <div class="exercise-name">${escapeHtml(ex.name || '')}</div>
        <div class="exercise-params">
          ${ex.parameters ? `<span class="param-tag">📊 ${escapeHtml(ex.parameters)}</span>` : ''}
          ${ex.tempo ? `<span class="param-tag tempo">⏱ Tempo: ${escapeHtml(ex.tempo)}</span>` : ''}
        </div>
        ${ex.progression ? `<div class="exercise-progression">${escapeHtml(ex.progression)}</div>` : ''}
        ${ex.notes ? `<div class="exercise-notes">${escapeHtml(ex.notes)}</div>` : ''}
      </div>`;
    });

    const outcomePills = outcomeMeasures.length ? `<div class="outcome-pills">${outcomeMeasures.map(o => `<span class="outcome-pill">${escapeHtml(o)}</span>`).join('')}</div>` : '';

    container.innerHTML += `<div class="protocol-card">
      <div class="protocol-header">
        <span class="protocol-condition">${escapeHtml(protocol.condition_or_goal || 'Protocol')}</span>
        <div style="display:flex;gap:6px;flex-wrap:wrap">
          ${protocol.phase ? `<span class="protocol-phase">${escapeHtml(protocol.phase)}</span>` : ''}
          ${protocol.program_duration ? `<span class="protocol-duration">⏱ ${escapeHtml(protocol.program_duration)}</span>` : ''}
        </div>
      </div>
      ${protocol.outcome_measures ? `<div class="protocol-outcomes">✓ ${escapeHtml(protocol.outcome_measures)}</div>` : ''}
      <div class="exercise-list">${exHtml}</div>
      ${outcomePills}
    </div>`;
  });
}

function renderClinicalTab(cdp) {
  const container = document.getElementById('clinicalContent'); container.innerHTML = '<div class="decisions-grid"></div>';
  const grid = container.querySelector('.decisions-grid');

  const sections = [
    { key:'indications', label:'✓ Indications', cls:'ds-green', bullet:'✓' },
    { key:'contraindications', label:'✗ Contraindications', cls:'ds-red', bullet:'✗' },
    { key:'red_flags', label:'🚩 Red Flags', cls:'ds-amber', bullet:'•' },
    { key:'when_to_refer', label:'→ When to Refer', cls:'ds-purple', bullet:'→' },
    { key:'dosage_considerations', label:'💊 Dosage & Frequency', cls:'ds-blue', bullet:'•' },
  ];

  sections.forEach(s => {
    const items = cdp[s.key] || []; if (!items.length) return;
    grid.innerHTML += `<div class="decision-section ${s.cls}">
      <div class="decision-header">${s.label}</div>
      <div class="decision-body">${items.map(item => `<div class="decision-item"><span>${s.bullet}</span>${escapeHtml(item)}</div>`).join('')}</div>
    </div>`;
  });

  if (cdp.pain_guidelines && cdp.pain_guidelines.toLowerCase() !== 'not addressed in this document') {
    grid.innerHTML += `<div class="decision-section ds-teal">
      <div class="decision-header">🩹 Pain Monitoring Guidelines</div>
      <div class="decision-body"><div class="pain-guideline-box">${escapeHtml(cdp.pain_guidelines)}</div></div>
    </div>`;
  }

  if (!grid.innerHTML.trim()) grid.innerHTML = '<div class="no-protocols">No specific clinical decision data identified.</div>';
}

// ── Tab Switching ──
function switchTab(tab) {
  activeTab = tab;
  const view = tab.startsWith('syn-') ? '#synthesisView' : '#resultsView';
  document.querySelectorAll(`${view} .tab`).forEach(t => {
    const tabs = tab.startsWith('syn-')
      ? ['syn-consensus','syn-protocol','syn-patient','syn-clinical','syn-gaps']
      : ['exercise','patient','clinical','limitations'];
    t.classList.toggle('active', tabs[Array.from(document.querySelectorAll(`${view} .tab`)).indexOf(t)] === tab);
  });
  document.querySelectorAll(`${view} .tab-content`).forEach(tc => {
    tc.style.display = tc.id === `tab-${tab}` ? '' : 'none';
  });
}

// ── Tag System ──
function setupTagInput() {
  const input = document.getElementById('tagInput');
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); addTagFromInput(); }
    if (e.key === 'Backspace' && !input.value && currentTags.length) { removeTag(currentTags.length - 1); }
  });
  input.addEventListener('input', showTagSuggestions);
}

function showTagSuggestions() {
  const val = document.getElementById('tagInput').value.toLowerCase();
  const container = document.getElementById('tagSuggestions'); container.innerHTML = '';
  if (!val || !allTags.length) return;
  const matches = allTags.filter(t => t.toLowerCase().includes(val) && !currentTags.includes(t)).slice(0, 6);
  matches.forEach(t => {
    const btn = document.createElement('button');
    btn.className = 'tag-suggestion'; btn.textContent = t;
    btn.onclick = () => addTagFromSuggestion(t);
    container.appendChild(btn);
  });
}

function addTagFromInput() {
  const input = document.getElementById('tagInput');
  const val = input.value.trim().replace(/,+$/, '');
  if (val && !currentTags.includes(val)) {
    currentTags.push(val); renderTagChips(); saveTags();
    if (!allTags.includes(val)) allTags.push(val);
  }
  input.value = '';
  document.getElementById('tagSuggestions').innerHTML = '';
  document.getElementById('aiConditionHint').textContent = '';
}

function addTagFromSuggestion(tag) {
  if (!currentTags.includes(tag)) { currentTags.push(tag); renderTagChips(); saveTags(); }
  document.getElementById('tagSuggestions').innerHTML = '';
  document.getElementById('aiConditionHint').textContent = '';
}

function removeTag(index) {
  currentTags.splice(index, 1); renderTagChips(); saveTags();
}

function renderTagChips() {
  const container = document.getElementById('tagChips'); container.innerHTML = '';
  currentTags.forEach((tag, i) => {
    container.innerHTML += `<div class="tag-chip">${escapeHtml(tag)}<button class="tag-chip-remove" onclick="removeTag(${i})">×</button></div>`;
  });
}

async function saveTags() {
  if (!currentResult) return;
  try {
    await fetch(`/tag/${currentResult.id}`, { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({tags: currentTags}) });
    loadHistory(); loadConditionLibrary();
  } catch(e) { console.error('Failed to save tags', e); }
}

// ── Condition Library ──
async function loadConditionLibrary() {
  try {
    const res = await fetch('/tags');
    const tagMap = await res.json();
    renderConditionTree(tagMap);

    // Collect all tags for autocomplete
    allTags = [];
    Object.entries(tagMap).forEach(([condition, subtypes]) => {
      Object.keys(subtypes).forEach(sub => {
        if (sub === '__all__') allTags.push(condition);
        else allTags.push(`${condition} / ${sub}`);
      });
    });
  } catch(e) { console.error('Failed to load library', e); }
}

function renderConditionTree(tagMap) {
  const container = document.getElementById('conditionTree'); container.innerHTML = '';
  const conditions = Object.keys(tagMap);
  if (!conditions.length) {
    container.innerHTML = '<div class="history-empty">Tag papers with conditions<br>to build your library.</div>';
    return;
  }

  conditions.forEach(condition => {
    const subtypes = tagMap[condition];
    const totalPapers = Object.values(subtypes).flat().length;
    const subtypeKeys = Object.keys(subtypes).filter(k => k !== '__all__');
    const allPapers = subtypes['__all__'] || [];
    const groupId = 'cg-' + condition.replace(/\W/g,'');

    let subtypesHtml = '';
    subtypeKeys.forEach(sub => {
      const papers = subtypes[sub] || [];
      const subId = 'sg-' + (condition + sub).replace(/\W/g,'');
      const fullTag = `${condition} / ${sub}`;
      let papersHtml = papers.map(p => `
        <div class="history-item" data-id="${p.id}" onclick="loadResult('${p.id}', this)">
          <div class="history-item-title">${escapeHtml(p.title)}</div>
          <div class="history-item-meta"><span>${formatDate(p.date)}</span><span class="history-item-badge">${'★'.repeat(p.evidence_score||1)}</span></div>
        </div>`).join('');

      const synthesizeBtn = papers.length >= 2
        ? `<button class="synthesize-btn-small" onclick="runSynthesis('${escapeAttr(fullTag)}', '${escapeAttr(condition)}')">⚗ Synthesize ${papers.length} papers →</button>`
        : '';

      subtypesHtml += `<div class="subtype-item">
        <div class="subtype-header" onclick="toggleNode('${subId}')">
          <span class="subtype-name">${escapeHtml(sub)}</span>
          <span class="subtype-count">${papers.length}</span>
        </div>
        <div class="subtype-papers" id="${subId}">
          ${synthesizeBtn}${papersHtml}
        </div>
      </div>`;
    });

    // Papers tagged with condition only (no subtype)
    let directPapersHtml = allPapers.map(p => `
      <div class="history-item" data-id="${p.id}" onclick="loadResult('${p.id}', this)">
        <div class="history-item-title">${escapeHtml(p.title)}</div>
        <div class="history-item-meta"><span>${formatDate(p.date)}</span></div>
      </div>`).join('');

    const synthesizeConditionBtn = totalPapers >= 2
      ? `<button class="synthesize-btn-small" onclick="runSynthesis('', '${escapeAttr(condition)}')">⚗ Synthesize all ${totalPapers} papers →</button>`
      : '';

    container.innerHTML += `<div class="condition-group">
      <div class="condition-group-header" onclick="toggleNode('${groupId}')">
        <span class="condition-group-name">${escapeHtml(condition)}</span>
        <div style="display:flex;align-items:center;gap:6px">
          <span class="condition-group-count">${totalPapers}</span>
          <span class="condition-group-arrow" id="arr-${groupId}">▶</span>
        </div>
      </div>
      <div class="condition-subtypes" id="${groupId}">
        ${synthesizeConditionBtn}
        ${subtypesHtml}
        ${directPapersHtml}
      </div>
    </div>`;
  });
}

function toggleNode(id) {
  const el = document.getElementById(id); if (!el) return;
  const isOpen = el.classList.toggle('open');
  const arr = document.getElementById('arr-' + id);
  if (arr) arr.classList.toggle('open', isOpen);
}

// ── Synthesis ──
async function runSynthesis(tag, condition) {
  document.getElementById('synthesizeLoadingMsg').textContent = `Compiling papers on "${tag || condition}"...`;
  showView('synthesizeLoadingView');

  try {
    const res = await fetch('/synthesize', {
      method: 'POST', headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ tag, condition })
    });
    const data = await res.json();
    if (!res.ok) { showUpload(); showError(data.error || 'Synthesis failed.'); return; }
    renderSynthesis(data);
  } catch(e) { showUpload(); showError('Synthesis failed. Please try again.'); }
}

function renderSynthesis(data) {
  currentSynthesis = data;
  const s = data.synthesis;
  showView('synthesisView');

  // Reset tabs
  document.querySelectorAll('#synthesisView .tab').forEach((t,i) => t.classList.toggle('active', i===0));
  document.querySelectorAll('#synthesisView .tab-content').forEach((tc,i) => tc.style.display = i===0 ? '' : 'none');

  document.getElementById('synthesisSource').textContent = `${data.paper_count} papers`;
  document.getElementById('synthesisTitle').textContent = data.condition;
  document.getElementById('synthesisMeta').textContent = `Synthesized from ${data.paper_count} papers`;
  document.getElementById('synthesisBottomLine').textContent = s.clinical_bottom_line || '';
  document.getElementById('synthesisEvidence').textContent = s.overall_evidence_strength || '';

  // Consensus
  const cc = document.getElementById('consensusContent'); cc.innerHTML = '';
  if ((s.consensus_findings||[]).length) {
    cc.innerHTML += '<div class="section-subheading">Where Papers Agree</div>';
    (s.consensus_findings||[]).forEach(f => { cc.innerHTML += `<div class="consensus-card">${escapeHtml(f)}</div>`; });
  }
  if ((s.conflicting_findings||[]).length) {
    cc.innerHTML += '<div class="section-subheading">Where Papers Conflict</div>';
    (s.conflicting_findings||[]).forEach(f => { cc.innerHTML += `<div class="conflict-card"><div class="conflict-label">⚡ Conflict</div>${escapeHtml(f)}</div>`; });
  }

  // Master Protocol
  const mp = document.getElementById('masterProtocolContent'); mp.innerHTML = '';
  (s.master_exercise_protocol||[]).forEach(phase => {
    let exHtml = (phase.exercises||[]).map(ex => `
      <div class="exercise-item">
        <div class="exercise-name">${escapeHtml(ex.name||'')}</div>
        <div class="exercise-params">${ex.parameters ? `<span class="param-tag">📊 ${escapeHtml(ex.parameters)}</span>` : ''}</div>
        ${ex.progression ? `<div class="exercise-progression">${escapeHtml(ex.progression)}</div>` : ''}
        ${ex.notes ? `<div class="exercise-notes">${escapeHtml(ex.notes)}</div>` : ''}
        ${ex.evidence_source ? `<div class="evidence-source-tag">Source: ${escapeHtml(ex.evidence_source)}</div>` : ''}
      </div>`).join('');
    mp.innerHTML += `<div class="master-phase-card">
      <div class="master-phase-header">
        <span class="master-phase-name">${escapeHtml(phase.phase||'')}</span>
        <span class="master-phase-time">${escapeHtml(phase.timeframe||'')}</span>
      </div>
      <div class="exercise-list">${exHtml}</div>
    </div>`;
  });

  // Patient Ed
  const sp = document.getElementById('synthesisPatientContent'); sp.innerHTML = '';
  (s.combined_patient_education||[]).forEach(pt => { sp.innerHTML += `<li>${escapeHtml(pt)}</li>`; });

  // Clinical Decisions
  const scdp = s.combined_clinical_decisions || {};
  const scont = document.getElementById('synthesisClinicalContent'); scont.innerHTML = '<div class="decisions-grid"></div>';
  const sgrid = scont.querySelector('.decisions-grid');
  [
    { key:'indications', label:'✓ Indications', cls:'ds-green', bullet:'✓' },
    { key:'contraindications', label:'✗ Contraindications', cls:'ds-red', bullet:'✗' },
    { key:'red_flags', label:'🚩 Red Flags', cls:'ds-amber', bullet:'•' },
    { key:'when_to_refer', label:'→ When to Refer', cls:'ds-purple', bullet:'→' },
  ].forEach(s2 => {
    const items = scdp[s2.key]||[]; if (!items.length) return;
    sgrid.innerHTML += `<div class="decision-section ${s2.cls}"><div class="decision-header">${s2.label}</div><div class="decision-body">${items.map(i=>`<div class="decision-item"><span>${s2.bullet}</span>${escapeHtml(i)}</div>`).join('')}</div></div>`;
  });
  if (scdp.pain_guidelines) sgrid.innerHTML += `<div class="decision-section ds-teal"><div class="decision-header">🩹 Pain Guidelines</div><div class="decision-body"><div class="pain-guideline-box">${escapeHtml(scdp.pain_guidelines)}</div></div></div>`;

  // Gaps
  const gaps = document.getElementById('synthesisGapsContent'); gaps.innerHTML = '';
  (s.research_gaps||[]).forEach(g => { gaps.innerHTML += `<li>${escapeHtml(g)}</li>`; });
}

// ── History ──
async function loadHistory() {
  try {
    const res = await fetch('/history');
    const items = await res.json();
    const list = document.getElementById('historyList');
    if (!items.length) { list.innerHTML = '<div class="history-empty">No documents yet.<br>Upload your first paper above.</div>'; return; }
    list.innerHTML = items.map(item => {
      const score = parseInt(item.evidence_score)||1;
      const tag = (item.tags||[])[0] || '';
      const isActive = currentResult && currentResult.id === item.id;
      return `<div class="history-item${isActive?' active':''}" data-id="${item.id}" onclick="loadResult('${item.id}', this)">
        <div class="history-item-title">${escapeHtml(item.title||item.source)}</div>
        <div class="history-item-meta">
          <span>${formatDate(item.date)}</span>
          <span class="history-item-badge">${'★'.repeat(score)}</span>
          ${tag ? `<span class="history-item-tag">${escapeHtml(tag)}</span>` : ''}
        </div>
        <button class="history-delete" onclick="deleteResult(event,'${item.id}')">×</button>
      </div>`;
    }).join('');
  } catch(e) { console.error('Failed to load history', e); }
}

async function loadResult(id, el) {
  document.querySelectorAll('.history-item').forEach(i => i.classList.remove('active'));
  if (el) el.classList.add('active');
  try {
    const res = await fetch(`/result/${id}`);
    const data = await res.json();
    if (data.error) return;
    currentResult = data; renderResults(data);
  } catch(e) { console.error('Failed to load result', e); }
}

async function deleteResult(event, id) {
  event.stopPropagation();
  if (!confirm('Delete this result?')) return;
  await fetch(`/delete/${id}`, { method: 'DELETE' });
  if (currentResult && currentResult.id === id) { showUpload(); currentResult = null; }
  loadHistory(); loadConditionLibrary();
}

function setupChatInput() {
  const input = document.getElementById('chatInput');
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendChatMessage(); }
  });
  // Auto-resize textarea
  input.addEventListener('input', () => {
    input.style.height = 'auto';
    input.style.height = Math.min(input.scrollHeight, 120) + 'px';
  });
}

// ── Chat ──
let chatHistory = [];
let chatContext = null;

const PAPER_SUGGESTIONS = [
  "Which exercises should I start with for a new patient?",
  "What's the recommended pain level during exercise?",
  "How would I explain this condition to a patient in simple terms?",
  "What are the biggest red flags I should watch for?",
  "How strong is the evidence and should I trust these results clinically?",
];

const SYNTHESIS_SUGGESTIONS = [
  "Summarize the most important takeaways across all these papers.",
  "Where do these papers disagree and which evidence should I follow?",
  "Build me a week-by-week rehab plan based on this research.",
  "What questions does this research leave unanswered?",
  "What would you tell a patient about their prognosis based on this research?",
];

function openChat(type) {
  chatHistory = [];
  const panel = document.getElementById('chatPanel');
  const overlay = document.getElementById('chatOverlay');
  const messages = document.getElementById('chatMessages');
  const input = document.getElementById('chatInput');

  if (type === 'synthesis' && currentSynthesis) {
    chatContext = { type: 'synthesis', ...currentSynthesis };
    document.getElementById('chatContextLabel').textContent = '📚 ' + (currentSynthesis.condition || 'Synthesis');
    renderChatSuggestions(SYNTHESIS_SUGGESTIONS);
  } else if (currentResult) {
    chatContext = { type: 'paper', ...currentResult };
    const title = currentResult.analysis?.title || currentResult.source || 'Paper';
    document.getElementById('chatContextLabel').textContent = '📄 ' + truncate(title, 55);
    renderChatSuggestions(PAPER_SUGGESTIONS);
  } else { return; }

  messages.innerHTML = `<div class="chat-welcome"><p>Ask me anything about this research. For example:</p><div class="chat-suggestions" id="chatSuggestions"></div></div>`;
  renderChatSuggestions(type === 'synthesis' ? SYNTHESIS_SUGGESTIONS : PAPER_SUGGESTIONS);

  panel.classList.add('open');
  overlay.classList.add('open');
  setTimeout(() => input.focus(), 300);
}

function closeChat() {
  document.getElementById('chatPanel').classList.remove('open');
  document.getElementById('chatOverlay').classList.remove('open');
}

function renderChatSuggestions(suggestions) {
  const container = document.getElementById('chatSuggestions');
  if (!container) return;
  container.innerHTML = suggestions.map(s =>
    `<button class="chat-suggestion-btn" onclick="useSuggestion(this)">${escapeHtml(s)}</button>`
  ).join('');
}

function useSuggestion(btn) {
  document.getElementById('chatInput').value = btn.textContent;
  sendChatMessage();
}

async function sendChatMessage() {
  const input = document.getElementById('chatInput');
  const message = input.value.trim();
  if (!message || !chatContext) return;

  input.value = '';
  input.style.height = 'auto';

  // Clear welcome screen on first message
  const welcome = document.querySelector('.chat-welcome');
  if (welcome) welcome.remove();

  appendChatMsg('user', message);
  const typing = appendTyping();

  document.getElementById('chatSendBtn').disabled = true;

  try {
    const res = await fetch('/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message, history: chatHistory, context: chatContext })
    });
    const data = await res.json();
    typing.remove();

    if (!res.ok) {
      appendChatMsg('assistant', '⚠️ ' + (data.error || 'Something went wrong. Please try again.'));
    } else {
      chatHistory.push({ role: 'user', content: message });
      chatHistory.push({ role: 'assistant', content: data.reply });
      appendChatMsg('assistant', data.reply);
    }
  } catch {
    typing.remove();
    appendChatMsg('assistant', '⚠️ Could not reach the server. Make sure the app is running.');
  }

  document.getElementById('chatSendBtn').disabled = false;
  input.focus();
}

function appendChatMsg(role, text) {
  const container = document.getElementById('chatMessages');
  const div = document.createElement('div');
  div.className = `chat-msg ${role}`;
  div.innerHTML = `<div class="chat-bubble">${escapeHtml(text)}</div>`;
  container.appendChild(div);
  container.scrollTop = container.scrollHeight;
  return div;
}

function appendTyping() {
  const container = document.getElementById('chatMessages');
  const div = document.createElement('div');
  div.className = 'chat-msg assistant';
  div.innerHTML = `<div class="chat-typing"><div class="chat-dot"></div><div class="chat-dot"></div><div class="chat-dot"></div></div>`;
  container.appendChild(div);
  container.scrollTop = container.scrollHeight;
  return div;
}

// ── Export ──
function exportResults() { window.print(); }

// ── Error ──
function showError(msg) {
  const box = document.getElementById('errorBox');
  box.textContent = msg; box.style.display = '';
  box.scrollIntoView({ behavior:'smooth', block:'center' });
}

// ── Utilities ──
function escapeHtml(str) {
  if (!str) return '';
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
function escapeAttr(str) { return String(str||'').replace(/'/g,"\\'"); }
function truncate(str, max) { return str && str.length > max ? str.slice(0,max)+'…' : (str||''); }
function formatDate(iso) {
  if (!iso) return '';
  const d = new Date(iso), now = new Date(), diffH = (now-d)/3600000;
  if (diffH < 1) return 'Just now';
  if (diffH < 24) return `${Math.floor(diffH)}h ago`;
  if (diffH < 168) return `${Math.floor(diffH/24)}d ago`;
  return d.toLocaleDateString('en-US',{month:'short',day:'numeric'});
}

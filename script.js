// ─── Monaco init ──────────────────────────────────────────────────────────────

require.config({ paths: { vs: 'https://cdnjs.cloudflare.com/ajax/libs/monaco-editor/0.44.0/min/vs' } });

require(['vs/editor/editor.main'], function () {
  monaco.editor.defineTheme('vakya-dark', {
    base: 'vs-dark', inherit: true,
    rules: [
      { token: 'comment',  foreground: '3d3d5c', fontStyle: 'italic' },
      { token: 'keyword',  foreground: '7C6BFF' },
      { token: 'string',   foreground: '4ade80' },
      { token: 'number',   foreground: 'fbbf24' },
      { token: 'type',     foreground: '67e8f9' },
      { token: 'function', foreground: 'c084fc' },
    ],
    colors: {
      'editor.background':              '#0e0e12',
      'editor.foreground':              '#e8e8f0',
      'editor.lineHighlightBackground': '#13131a',
      'editor.selectionBackground':     '#7C6BFF33',
      'editorLineNumber.foreground':    '#2a2a3d',
      'editorLineNumber.activeForeground': '#7070a0',
      'editorCursor.foreground':        '#7C6BFF',
      'editorIndentGuide.background':   '#1a1a24',
      'editorIndentGuide.activeBackground': '#2a2a3d',
    }
  });

  window.editor = monaco.editor.create(
    document.getElementById('editor-container'),
    {
      value: restoreEditorContent(),
      language: restoreEditorLanguage(),
      theme: 'vakya-dark',
      fontSize: 14,
      fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
      fontLigatures: true,
      lineHeight: 22,
      minimap: { enabled: false },
      automaticLayout: true,
      scrollBeyondLastLine: false,
      renderLineHighlight: 'line',
      padding: { top: 16, bottom: 16 },
      smoothScrolling: true,
      cursorBlinking: 'smooth',
      cursorSmoothCaretAnimation: 'on',
      bracketPairColorization: { enabled: true },
    }
  );

  // ── Monaco diff editor (for the sidebar diff panel) ──────────────────────
  window.diffEditor = monaco.editor.createDiffEditor(
    document.getElementById('diff-preview-area'),
    {
      renderSideBySide: false,       // inline diff (like GitHub's unified view)
      readOnly: true,
      theme: 'vakya-dark',
      fontSize: 12,
      fontFamily: "'JetBrains Mono', monospace",
      lineNumbers: 'on',
      minimap: { enabled: false },
      scrollBeyondLastLine: false,
      automaticLayout: true,
      renderOverviewRuler: false,
    }
  );

  // ── Persist code on every change (debounced 800 ms) ──────────────────────
  let _saveTimer = null;
  window.editor.onDidChangeModelContent(() => {
    clearTimeout(_saveTimer);
    _saveTimer = setTimeout(persistEditorContent, 800);
  });

  // Restore language select to match persisted value
  const savedLang = restoreEditorLanguage();
  if (savedLang !== 'python') {
    languageSelect.value = savedLang;
    monaco.editor.setModelLanguage(window.editor.getModel(), savedLang);
  }
});

// ─── DOM refs ─────────────────────────────────────────────────────────────────

const micBtn         = document.getElementById('mic-btn');
const micIcon        = document.getElementById('mic-icon');
const stopIcon       = document.getElementById('stop-icon');
const statusText     = document.getElementById('status-text');
const statusSub      = document.getElementById('status-sub');
const liveDot        = document.getElementById('transcript-live-dot');
const historyArea    = document.getElementById('history-area');
const transcriptArea = document.getElementById('transcript-area');
const languageSelect = document.getElementById('language-select');
const openFileBtn    = document.getElementById('open-file-btn');
const fileInput      = document.getElementById('file-input');
const fileName       = document.getElementById('file-name');

// ─── Config ───────────────────────────────────────────────────────────────────

// ── Backend URL: set window.VAKYA_API_BASE in config.js for production ────────
const API_BASE = (typeof window.VAKYA_API_BASE !== 'undefined' && window.VAKYA_API_BASE)
  ? window.VAKYA_API_BASE
  : "http://localhost:8000";

// ─── localStorage persistence ─────────────────────────────────────────────────

const STORAGE_KEYS = {
  code:     'vakya_editor_code',
  language: 'vakya_editor_language',
  filename: 'vakya_editor_filename',
};

const DEFAULT_CODE = [
  'def read_file(path):',
  '    with open(path) as f:',
  '        return f.read()',
  '',
  '',
  'def write_file(path, content):',
  '    with open(path, "w") as f:',
  '        f.write(content)',
].join('\n');

function restoreEditorContent() {
  return localStorage.getItem(STORAGE_KEYS.code) || DEFAULT_CODE;
}

function restoreEditorLanguage() {
  return localStorage.getItem(STORAGE_KEYS.language) || 'python';
}

function persistEditorContent() {
  if (!window.editor) return;
  localStorage.setItem(STORAGE_KEYS.code, window.editor.getValue());
  localStorage.setItem(STORAGE_KEYS.language, languageSelect.value);
  localStorage.setItem(STORAGE_KEYS.filename, fileName.textContent);
}

// Restore filename on load
(function () {
  const saved = localStorage.getItem(STORAGE_KEYS.filename);
  if (saved) fileName.textContent = saved;
})();

// ─── State machine ────────────────────────────────────────────────────────────

const STATES = {
  idle:       { text: 'Ready',      sub: 'Click mic or press Space to speak', bodyClass: '' },
  recording:  { text: 'Listening',  sub: 'Speak your command...',             bodyClass: 'recording' },
  processing: { text: 'Processing', sub: 'Thinking...',                        bodyClass: 'processing' },
};

let currentState = 'idle';

function setState(newState) {
  const prev = STATES[currentState];
  const next = STATES[newState];
  currentState = newState;
  if (prev.bodyClass) document.body.classList.remove(prev.bodyClass);
  if (next.bodyClass) document.body.classList.add(next.bodyClass);
  statusText.textContent = next.text;
  statusSub.textContent  = next.sub;
  const rec = newState === 'recording';
  micIcon.style.display  = rec ? 'none'  : 'block';
  stopIcon.style.display = rec ? 'block' : 'none';
  liveDot.classList.toggle('active', rec);
}

// ─── Audio Recording — AudioWorklet (replaces deprecated ScriptProcessorNode) ─

let audioContext   = null;
let workletNode    = null;
let sourceNode     = null;
let globalStream   = null;
let audioSamples   = [];
let currentSampleRate = 16000;

async function startAudioRecording() {
  audioSamples = [];
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    globalStream = stream;

    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    audioContext = new AudioCtx({ sampleRate: 16000 });
    currentSampleRate = audioContext.sampleRate;

    // Load the worklet module (must be served same-origin)
    await audioContext.audioWorklet.addModule('./audio-processor.worklet.js');

    sourceNode  = audioContext.createMediaStreamSource(stream);
    workletNode = new AudioWorkletNode(audioContext, 'vakya-recorder-processor');

    workletNode.port.onmessage = (e) => {
      if (e.data.type === 'audio') {
        audioSamples.push(e.data.samples);
      }
    };

    sourceNode.connect(workletNode);
    workletNode.connect(audioContext.destination);
  } catch (err) {
    // Graceful fallback to ScriptProcessorNode if worklet fails
    console.warn('AudioWorklet unavailable, falling back to ScriptProcessorNode:', err);
    await startAudioRecordingFallback();
  }
}

// Fallback for browsers/environments where AudioWorklet is blocked
async function startAudioRecordingFallback() {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  globalStream = stream;
  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  audioContext = new AudioCtx({ sampleRate: 16000 });
  currentSampleRate = audioContext.sampleRate;
  const input = audioContext.createMediaStreamSource(stream);
  const proc  = audioContext.createScriptProcessor(4096, 1, 1);
  proc.onaudioprocess = (e) => {
    audioSamples.push(new Float32Array(e.inputBuffer.getChannelData(0)));
  };
  input.connect(proc);
  proc.connect(audioContext.destination);
  workletNode = proc;  // reuse cleanup path
  sourceNode  = input;
}

function stopAudioRecording() {
  if (workletNode) { workletNode.disconnect(); }
  if (sourceNode)  { sourceNode.disconnect(); }
  if (audioContext){ audioContext.close(); }
  if (globalStream){ globalStream.getTracks().forEach(t => t.stop()); }

  let total = 0;
  for (const chunk of audioSamples) total += chunk.length;
  const merged = new Float32Array(total);
  let off = 0;
  for (const chunk of audioSamples) { merged.set(chunk, off); off += chunk.length; }

  return float32ToWav(merged, currentSampleRate);
}

function float32ToWav(buffer, sampleRate) {
  const wavBuf = new ArrayBuffer(44 + buffer.length * 2);
  const view   = new DataView(wavBuf);
  const str    = (o, s) => { for (let i = 0; i < s.length; i++) view.setUint8(o + i, s.charCodeAt(i)); };
  str(0, 'RIFF'); view.setUint32(4, 36 + buffer.length * 2, true);
  str(8, 'WAVE'); str(12, 'fmt ');
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true); view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true); view.setUint16(34, 16, true);
  str(36, 'data'); view.setUint32(40, buffer.length * 2, true);
  let off = 44;
  for (let i = 0; i < buffer.length; i++, off += 2) {
    const s = Math.max(-1, Math.min(1, buffer[i]));
    view.setInt16(off, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
  }
  return new Blob([view], { type: 'audio/wav' });
}

// ─── Speech Recognition (live feedback only) ─────────────────────────────────

const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
let recognition = null, finalTranscript = '', interimEntry = null;

if (SpeechRecognition) {
  recognition = new SpeechRecognition();
  recognition.continuous = true;
  recognition.interimResults = true;
  recognition.lang = 'en-US';

  recognition.onresult = (event) => {
    let interim = '';
    for (let i = event.resultIndex; i < event.results.length; i++) {
      const r = event.results[i];
      if (r.isFinal) finalTranscript += r[0].transcript;
      else interim += r[0].transcript;
    }
    statusSub.textContent = (finalTranscript + interim).trim() || 'Speak your command...';
    updateInterimEntry(finalTranscript + interim);
  };

  recognition.onend = () => {
    if (currentState === 'recording') recognition.start();
  };

  recognition.onerror = (e) => { if (e.error !== 'aborted') console.error('SpeechRecognition:', e.error); };
}

// ─── Mic button ───────────────────────────────────────────────────────────────

micBtn.addEventListener('click', () => {
  if (currentState === 'idle') startRecording();
  else if (currentState === 'recording') stopRecording();
});

async function startRecording() {
  finalTranscript = '';
  interimEntry = null;
  setState('recording');
  createInterimEntry();
  await startAudioRecording();
  if (recognition) { try { recognition.start(); } catch(e) {} }
}

async function stopRecording() {
  setState('processing');
  if (recognition) { try { recognition.stop(); } catch(e) {} }
  const wavBlob = stopAudioRecording();
  setTimeout(() => handleCommandAudio(wavBlob), 100);
}

// ─── Live transcript entry ────────────────────────────────────────────────────

function createInterimEntry() {
  transcriptArea.querySelector('.transcript-placeholder')?.remove();
  interimEntry = document.createElement('div');
  interimEntry.className = 'transcript-entry interim';
  interimEntry.innerHTML = `
    <div class="entry-time">${timestamp()}</div>
    <div class="entry-text" style="color:var(--text-secondary);font-style:italic;">Listening…</div>
  `;
  transcriptArea.appendChild(interimEntry);
  transcriptArea.scrollTop = transcriptArea.scrollHeight;
}

function updateInterimEntry(text) {
  if (!interimEntry) return;
  const el = interimEntry.querySelector('.entry-text');
  if (el) { el.style.color = 'var(--text-primary)'; el.style.fontStyle = 'normal'; el.textContent = text || 'Listening…'; }
  transcriptArea.scrollTop = transcriptArea.scrollHeight;
}

function commitInterimEntry(finalText) {
  if (!interimEntry) return null;
  if (!finalText) { interimEntry.remove(); interimEntry = null; return null; }
  interimEntry.classList.remove('interim');
  const el = interimEntry.querySelector('.entry-text');
  if (el) el.textContent = finalText;
  const node = interimEntry;
  interimEntry = null;
  transcriptArea.scrollTop = transcriptArea.scrollHeight;
  return node;
}

// ─── Backend router ───────────────────────────────────────────────────────────

async function handleCommandAudio(wavBlob) {
  statusSub.textContent = 'Transcribing and thinking…';
  showDiffSkeleton();
  const fd = new FormData();
  fd.append('file', wavBlob, 'audio.wav');
  fd.append('code', window.editor ? window.editor.getValue() : '');
  fd.append('language', languageSelect.value);
  await _postCommand(fd);
}

// ── Text command — now has a real UI (see index.html changes) ─────────────────
async function handleCommandText(text) {
  if (!text || !text.trim()) return;
  setState('processing');
  statusSub.textContent = 'Calling AI…';
  showDiffSkeleton();
  createInterimEntry();
  updateInterimEntry(text);
  const fd = new FormData();
  fd.append('command', text);
  fd.append('code', window.editor ? window.editor.getValue() : '');
  fd.append('language', languageSelect.value);
  await _postCommand(fd);
}

async function _postCommand(formData) {
  try {
    const res = await fetch(`${API_BASE}/command`, { method: 'POST', body: formData });
    if (!res.ok) { const e = await res.json(); throw new Error(e.detail || 'Server error'); }
    processBackendResponse(await res.json());
  } catch (err) {
    hideDiff();
    commitInterimEntry(null);
    addToHistory('Error: ' + err.message, 'cancelled');
    appendTranscript('❌ ' + (err.message.includes('Failed to fetch')
      ? "Backend offline. Run `uvicorn main:app` in the backend folder."
      : err.message));
    setState('idle');
  }
}

function processBackendResponse(data) {
  const { command, intent, confidence, action, result } = data;
  const entryEl = commitInterimEntry(command);

  if (entryEl) {
    const meta = document.createElement('div');
    meta.className = 'meta-row';
    meta.innerHTML = `
      <span class="intent-badge ${intent.toLowerCase()}">${intent}</span>
      <span class="confidence-badge">${Math.round(confidence * 100)}% conf</span>
    `;
    entryEl.appendChild(meta);

    // ── Replay button on each history entry ──────────────────────────────────
    const replayBtn = document.createElement('button');
    replayBtn.className = 'replay-btn';
    replayBtn.title = 'Re-run this command';
    replayBtn.innerHTML = '▶';
    replayBtn.addEventListener('click', () => handleCommandText(command));
    entryEl.appendChild(replayBtn);
  }

  addToHistory(`Voice: "${command}" [${intent}]`);

  if (action === 'undo') {
    window.editor?.getModel().undo();
    hideDiff();
    addToHistory('Undid last change', 'applied');
    appendTranscript('✓ Reverted last edit via Undo');
    setState('idle');
  } else if (action === 'navigate') {
    hideDiff();
    const line = result.startLine || 1;
    if (window.editor) {
      window.editor.focus();
      window.editor.setPosition({ lineNumber: line, column: 1 });
      window.editor.revealLineInCenter(line);
    }
    addToHistory(`Navigated to line ${line}`, 'applied');
    appendTranscript(`✓ Navigated to line ${line}: ${result.explanation}`);
    setState('idle');
  } else if (action === 'explain') {
    hideDiff();
    addToHistory('Explained code', 'applied');
    appendTranscript(result.explanation, true /* isMarkdown */);
    setState('idle');
  } else {
    if (result.newCode) {
      showDiff(result.newCode, result.startLine, result.endLine, command, result.explanation);
    } else {
      hideDiff();
      appendTranscript(result.explanation, true);
      setState('idle');
    }
  }
}

// ─── Edit API ─────────────────────────────────────────────────────────────────

function applyEdit(newCode, startLine, endLine) {
  const model = window.editor.getModel();
  const lc = model.getLineCount();
  let sL = Math.max(1, Math.min(startLine, lc));
  let eL = Math.max(1, Math.min(endLine, lc));
  if (sL > eL) { const t = sL; sL = eL; eL = t; }
  window.editor.executeEdits('ai-edit', [{
    range: new monaco.Range(sL, 1, eL, model.getLineMaxColumn(eL)),
    text: newCode,
  }]);
  window.editor.focus();
}

// ─── Monaco diff panel ────────────────────────────────────────────────────────

const diffSection  = document.getElementById('diff-section');
const diffLineRange = document.getElementById('diff-line-range');
const applyBtn     = document.getElementById('apply-btn');
const cancelBtn    = document.getElementById('cancel-btn');

function showDiffSkeleton() {
  diffLineRange.textContent = 'Loading proposed edit…';
  // Clear any previous diff models
  if (window.diffEditor) {
    window.diffEditor.setModel(null);
  }
  // Show a loading placeholder text inside the diff panel container
  const area = document.getElementById('diff-preview-area');
  area.dataset.loading = '1';
  diffSection.style.display = 'flex';
  document.getElementById('diff-actions').style.opacity = '0.4';
  applyBtn.disabled = cancelBtn.disabled = true;
}

function showDiff(newCode, startLine, endLine, command = '', explanation = '') {
  diffLineRange.textContent = `lines ${startLine}–${endLine}`;

  const area = document.getElementById('diff-preview-area');
  delete area.dataset.loading;

  // ── Real Monaco inline diff ───────────────────────────────────────────────
  const currentCode = window.editor ? window.editor.getValue() : '';
  const currentLines = currentCode.split('\n');
  // Extract only the original range for the diff (to show a focused comparison)
  const origSlice = currentLines.slice(startLine - 1, endLine).join('\n');
  const lang = languageSelect.value;

  window.diffEditor.setModel({
    original: monaco.editor.createModel(origSlice, lang),
    modified: monaco.editor.createModel(newCode,   lang),
  });

  document.getElementById('diff-actions').style.opacity = '1';
  applyBtn.disabled = cancelBtn.disabled = false;

  applyBtn.onclick = () => {
    applyEdit(newCode, startLine, endLine);
    hideDiff();
    addToHistory(`Applied: "${command || `lines ${startLine}–${endLine}`}"`, 'applied');
    appendTranscript(`✓ Applied edit to lines ${startLine}–${endLine}.\n\n${explanation}`, true);
    setState('idle');
  };

  cancelBtn.onclick = () => {
    hideDiff();
    addToHistory('Discarded edit', 'cancelled');
    setState('idle');
  };
}

function hideDiff() {
  diffSection.style.display = 'none';
  if (window.diffEditor) window.diffEditor.setModel(null);
}

// ─── Transcript (with real markdown via marked.js) ────────────────────────────

function appendTranscript(text, isMarkdown = false) {
  transcriptArea.querySelector('.transcript-placeholder')?.remove();
  const entry = document.createElement('div');
  entry.className = 'transcript-entry';

  let body;
  if (isMarkdown && window.marked) {
    body = window.marked.parse(text);
  } else {
    body = escapeHtml(text)
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/\n/g, '<br/>');
  }

  entry.innerHTML = `<div class="entry-time">${timestamp()}</div><div class="entry-text">${body}</div>`;
  transcriptArea.appendChild(entry);
  transcriptArea.scrollTop = transcriptArea.scrollHeight;
}

// ─── History ──────────────────────────────────────────────────────────────────

document.getElementById('clear-history-btn').addEventListener('click', () => {
  historyArea.innerHTML = '<div class="history-placeholder">No commands yet</div>';
});

function addToHistory(message, type = '') {
  historyArea.querySelector('.history-placeholder')?.remove();
  const entry = document.createElement('div');
  entry.className = `history-entry${type ? ' ' + type : ''}`;
  entry.innerHTML = `
    <div class="h-dot"></div>
    <div class="h-time">${timestamp(true)}</div>
    <div>${escapeHtml(message)}</div>
  `;
  historyArea.prepend(entry);
}

// ─── Language selector ────────────────────────────────────────────────────────

languageSelect.addEventListener('change', () => {
  if (!window.editor) return;
  const lang = languageSelect.value;
  monaco.editor.setModelLanguage(window.editor.getModel(), lang);
  const extMap = { python: 'py', javascript: 'js', typescript: 'ts', go: 'go', rust: 'rs', java: 'java', cpp: 'cpp', sql: 'sql' };
  const base = fileName.textContent.split('.')[0] || 'untitled';
  fileName.textContent = `${base}.${extMap[lang] || 'txt'}`;
  persistEditorContent();
});

// ─── Open file ────────────────────────────────────────────────────────────────

openFileBtn.addEventListener('click', () => fileInput.click());

fileInput.addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (!file) return;
  fileName.textContent = file.name;
  const reader = new FileReader();
  reader.onload = (ev) => {
    if (!window.editor) return;
    window.editor.setValue(ev.target.result);
    const ext = file.name.split('.').pop().toLowerCase();
    const extLangMap = { py: 'python', js: 'javascript', ts: 'typescript', go: 'go', rs: 'rust', java: 'java', cpp: 'cpp', sql: 'sql' };
    const lang = extLangMap[ext];
    if (lang) { languageSelect.value = lang; monaco.editor.setModelLanguage(window.editor.getModel(), lang); }
    persistEditorContent();
  };
  reader.readAsText(file);
});

// ─── Save file (download) ─────────────────────────────────────────────────────

document.getElementById('save-file-btn')?.addEventListener('click', () => {
  if (!window.editor) return;
  const code = window.editor.getValue();
  const name = fileName.textContent || 'untitled.txt';
  const blob = new Blob([code], { type: 'text/plain' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url; a.download = name; a.click();
  URL.revokeObjectURL(url);
});

// ─── Text command input UI ────────────────────────────────────────────────────

const textInput    = document.getElementById('text-command-input');
const textSendBtn  = document.getElementById('text-command-send');

function submitTextCommand() {
  if (!textInput || !textInput.value.trim() || currentState !== 'idle') return;
  const txt = textInput.value.trim();
  textInput.value = '';
  handleCommandText(txt);
}

textSendBtn?.addEventListener('click', submitTextCommand);
textInput?.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); submitTextCommand(); } });

// ─── Keyboard shortcut (Space) ────────────────────────────────────────────────

document.addEventListener('keydown', (e) => {
  if (e.code === 'Space') {
    if (window.editor?.hasTextFocus()) return;
    if (['INPUT','SELECT','TEXTAREA'].includes(document.activeElement.tagName)) return;
    e.preventDefault();
    if (currentState === 'idle') startRecording();
    else if (currentState === 'recording') stopRecording();
  }
});

// ─── Utility ──────────────────────────────────────────────────────────────────

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function timestamp(short = false) {
  return new Date().toLocaleTimeString([], short
    ? { hour: '2-digit', minute: '2-digit' }
    : { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

// ─── Expose for console testing ───────────────────────────────────────────────

window.showDiff          = showDiff;
window.applyEdit         = applyEdit;
window.addToHistory      = addToHistory;
window.appendTranscript  = appendTranscript;
window.setState          = setState;
window.handleCommandText = handleCommandText;

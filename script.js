/**
 * NCAA Championship Box Pool — script.js  (v2.0 — production fix)
 *
 * KEY ARCHITECTURAL CHANGE from v1:
 *   localStorage  →  JSONBin.io (shared cloud storage)
 *
 * Why: localStorage is per-device, per-browser. A box pool requires shared
 * global state visible to all 50+ users across all devices simultaneously.
 * JSONBin provides a free, zero-backend JSON store reachable from GitHub Pages.
 *
 * SETUP (one-time, ~2 minutes):
 *   1. Go to https://jsonbin.io  →  Sign up free
 *   2. Click "Create Bin"  →  paste in:
 *        {"boxes":{},"colDigits":null,"rowDigits":null,"lastUpdated":null}
 *   3. Copy the Bin ID from the URL (the long hex string after /b/)
 *   4. Go to Account → API Keys  →  create a key  →  copy it
 *   5. Paste both values into CONFIG below, then redeploy
 *
 * All reads/writes go to one canonical URL. Every device sees the same state.
 */

// ── CONFIG — FILL THESE IN ──────────────────────────────────────────────────

const CONFIG = {
  // Your JSONBin.io Bin ID (from the bin URL: /b/YOUR_BIN_ID)
  BIN_ID:  '69c2d47caa77b81da916332c',

  // Your JSONBin.io API key (from Account → API Keys)
  API_KEY: '$2a$10$e1.gLu8GETT7vzSHCE9poeJH4svpc3B0sF056PQE6wWbxShF9dH6S',

  // Venmo username for payments
  VENMO_USER: 'cakes2015',
};

// ── CONSTANTS ──────────────────────────────────────────────────────────────

const TOTAL_BOXES   = 100;
const API_BASE      = 'https://api.jsonbin.io/v3/b';
const POLL_INTERVAL = 15000; // ms — refresh every 15s to show other users' claims

// ── STATE ──────────────────────────────────────────────────────────────────

/**
 * state shape:
 * {
 *   boxes:       { [boxNumber: string]: { name: string, claimedAt: string } },
 *   colDigits:   number[] | null,
 *   rowDigits:   number[] | null,
 *   lastUpdated: string | null
 * }
 *
 * CRITICAL: box keys are ALWAYS strings ("1"–"100") to survive JSON round-trips.
 * Using number keys causes silent lookup failures after localStorage/JSON parse.
 */
let state     = makeEmptyState();
let activeBox = null;    // string key of box being claimed, e.g. "42"
let isSaving  = false;   // prevents concurrent writes
let pollTimer = null;

function makeEmptyState() {
  return { boxes: {}, colDigits: null, rowDigits: null, lastUpdated: null };
}

// Normalize any box number to the string key used throughout
function boxKey(n) { return String(n); }

// ── API LAYER ──────────────────────────────────────────────────────────────

async function fetchState() {
  try {
    const res = await fetch(`${API_BASE}/${CONFIG.BIN_ID}/latest`, {
      headers: { 'X-Master-Key': CONFIG.API_KEY }
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    // JSONBin v3 wraps the record in { record: {...} }
    return data.record ?? data;
  } catch (err) {
    console.error('[BoxPool] fetchState failed:', err);
    return null;
  }
}

async function persistState(newState) {
  if (isSaving) return false;
  isSaving = true;
  try {
    const res = await fetch(`${API_BASE}/${CONFIG.BIN_ID}`, {
      method:  'PUT',
      headers: {
        'Content-Type': 'application/json',
        'X-Master-Key': CONFIG.API_KEY,
      },
      body: JSON.stringify(newState),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return true;
  } catch (err) {
    console.error('[BoxPool] persistState failed:', err);
    return false;
  } finally {
    isSaving = false;
  }
}

// ── STATE SANITIZER ────────────────────────────────────────────────────────

/**
 * Normalize incoming state from any source (API, localStorage, old schema).
 * Coerces all box keys to strings, validates array lengths, fills missing fields.
 */
function sanitizeState(raw) {
  const s = makeEmptyState();
  if (!raw || typeof raw !== 'object') return s;

  if (raw.boxes && typeof raw.boxes === 'object') {
    for (const [k, v] of Object.entries(raw.boxes)) {
      if (v && typeof v.name === 'string' && v.name.trim()) {
        s.boxes[boxKey(k)] = {
          name:      v.name.trim(),
          claimedAt: typeof v.claimedAt === 'string' ? v.claimedAt : new Date().toISOString()
        };
      }
    }
  }
  if (Array.isArray(raw.colDigits) && raw.colDigits.length === 10) s.colDigits = raw.colDigits;
  if (Array.isArray(raw.rowDigits) && raw.rowDigits.length === 10) s.rowDigits = raw.rowDigits;
  if (typeof raw.lastUpdated === 'string') s.lastUpdated = raw.lastUpdated;
  return s;
}

// ── LOCAL STORAGE FALLBACK ─────────────────────────────────────────────────
// Used: (a) when config not set, (b) as a cache when API fails

const LS_KEY = 'ncaa_box_pool_v2';

function loadFromLocalStorage() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) state = sanitizeState(JSON.parse(raw));
  } catch (e) { /* silently ignore */ }
}

function saveToLocalStorage() {
  try { localStorage.setItem(LS_KEY, JSON.stringify(state)); } catch (e) { /* ignore */ }
}

// ── DOM REFS ───────────────────────────────────────────────────────────────

const gridEl         = document.getElementById('grid-container');
const claimedCountEl = document.getElementById('claimed-count');
const remainingEl    = document.getElementById('remaining-count');
const lastUpdatedEl  = document.getElementById('last-updated');

const modalOverlay   = document.getElementById('modal-overlay');
const modalClose     = document.getElementById('modal-close');
const resetOverlay   = document.getElementById('reset-overlay');

const stepName       = document.getElementById('step-name');
const stepPay        = document.getElementById('step-pay');
const stepDone       = document.getElementById('step-done');

const modalBoxNum    = document.getElementById('modal-box-number');
const modalBoxNum2   = document.getElementById('modal-box-number-2');
const nameInput      = document.getElementById('name-input');
const nameError      = document.getElementById('name-error');
const venmoLink      = document.getElementById('venmo-link');
const venmoNoteDisp  = document.getElementById('venmo-note-display');
const payConfirmed   = document.getElementById('payment-confirmed');
const btnLockBox     = document.getElementById('btn-lock-box');
const btnGoPay       = document.getElementById('btn-go-pay');
const btnBackName    = document.getElementById('btn-back-name');
const btnDoneClose   = document.getElementById('btn-done-close');
const doneMessage    = document.getElementById('done-message');

const btnRandomize   = document.getElementById('btn-randomize');
const btnExport      = document.getElementById('btn-export');
const btnReset       = document.getElementById('btn-reset');
const btnResetConf   = document.getElementById('btn-reset-confirm');
const btnResetCancel = document.getElementById('btn-reset-cancel');

const loadingOverlay = document.getElementById('loading-overlay');
const loadingMsg     = document.getElementById('loading-message');
const configWarning  = document.getElementById('config-warning');
const networkWarning = document.getElementById('network-warning');

// ── INITIALIZATION ─────────────────────────────────────────────────────────

async function init() {
  if (!isConfigured()) {
    if (configWarning) configWarning.style.display = 'block';
    // Still functional via localStorage for single-device dev/testing
    loadFromLocalStorage();
    buildGrid();
    return;
  }

  setLoadingOverlay(true, 'Loading board…');
  const remote = await fetchState();

  if (remote) {
    state = sanitizeState(remote);
    saveToLocalStorage(); // keep local cache fresh
  } else {
    // Network failure on load — show cached state so page isn't blank
    loadFromLocalStorage();
    if (networkWarning) {
      networkWarning.style.display = 'block';
      setTimeout(() => { networkWarning.style.display = 'none'; }, 7000);
    }
  }

  buildGrid();
  setLoadingOverlay(false);
  startPolling();
}

function isConfigured() {
  return typeof CONFIG.BIN_ID  === 'string' && CONFIG.BIN_ID.length  > 10
      && typeof CONFIG.API_KEY === 'string' && CONFIG.API_KEY.length > 10
      && !CONFIG.BIN_ID.includes('PASTE')
      && !CONFIG.API_KEY.includes('PASTE');

}

// ── POLLING ────────────────────────────────────────────────────────────────

function startPolling() {
  stopPolling();
  pollTimer = setInterval(async () => {
    // Pause polling while user has a modal open — avoid jarring mid-flow rebuilds
    if (modalOverlay.classList.contains('active')) return;
    if (resetOverlay.classList.contains('active')) return;

    const remote = await fetchState();
    if (!remote) return;

    const fresh = sanitizeState(remote);
    if (JSON.stringify(fresh) !== JSON.stringify(state)) {
      state = fresh;
      saveToLocalStorage();
      buildGrid();
    }
  }, POLL_INTERVAL);
}

function stopPolling() {
  if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
}

// ── GRID BUILDER ────────────────────────────────────────────────────────────

/**
 * Full declarative grid rebuild from state.
 * Uses event delegation on the container — NO per-cell listeners.
 * This means we never have the removeEventListener-with-anonymous-function bug,
 * and we can safely call buildGrid() at any time without leaking handlers.
 */
function buildGrid() {
  gridEl.innerHTML = '';

  const colNums = state.colDigits;
  const rowNums = state.rowDigits;

  // Corner
  gridEl.appendChild(el('div', 'grid-corner'));

  // Column header row
  for (let c = 0; c < 10; c++) {
    const hdr = el('div', colNums ? 'grid-header' : 'grid-header unset');
    hdr.textContent = colNums ? colNums[c] : '?';
    hdr.setAttribute('aria-label', colNums ? `Winning digit: ${colNums[c]}` : 'Not yet assigned');
    gridEl.appendChild(hdr);
  }

  // 10 data rows
  for (let r = 0; r < 10; r++) {
    const rowHdr = el('div', rowNums ? 'grid-header' : 'grid-header unset');
    rowHdr.textContent = rowNums ? rowNums[r] : '?';
    rowHdr.setAttribute('aria-label', rowNums ? `Losing digit: ${rowNums[r]}` : 'Not yet assigned');
    gridEl.appendChild(rowHdr);

    for (let c = 0; c < 10; c++) {
      const num  = r * 10 + c + 1;    // 1–100
      const key  = boxKey(num);        // "1"–"100" — always string
      const data = state.boxes[key];   // lookup by string key

      const cell = el('div', data ? 'grid-cell claimed' : 'grid-cell');
      cell.setAttribute('data-box', key);
      cell.setAttribute('role', data ? 'img' : 'button');

      if (!data) {
        cell.setAttribute('tabindex', '0');
        cell.setAttribute('aria-label', `Box ${num} — unclaimed. Tap to claim.`);
      } else {
        cell.setAttribute('aria-label', `Box ${num} claimed by ${data.name}`);
      }

      const numLabel = el('span', 'box-number');
      numLabel.textContent = num;
      cell.appendChild(numLabel);

      if (data) {
        const nameSpan = el('span', 'owner-name');
        nameSpan.textContent = data.name;
        cell.appendChild(nameSpan);

        const lockSpan = el('span', 'claimed-lock');
        lockSpan.textContent = '🔒';
        cell.appendChild(lockSpan);
      }

      gridEl.appendChild(cell);
    }
  }

  updateStats();
}

function el(tag, className) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  return node;
}

// ── GRID EVENT DELEGATION ─────────────────────────────────────────────────
// Single listener on container handles all cell interactions.
// touch-action: manipulation on cells (in CSS) eliminates 300ms iOS tap delay.

gridEl.addEventListener('click', e => {
  const cell = e.target.closest('[data-box]');
  if (!cell) return;
  const key = cell.getAttribute('data-box');
  if (!state.boxes[key]) openModal(key);
});

gridEl.addEventListener('keydown', e => {
  if (e.key !== 'Enter' && e.key !== ' ') return;
  const cell = e.target.closest('[data-box]');
  if (!cell) return;
  e.preventDefault();
  const key = cell.getAttribute('data-box');
  if (!state.boxes[key]) openModal(key);
});

// ── STATS ──────────────────────────────────────────────────────────────────

function updateStats() {
  const claimed = Object.keys(state.boxes).length;
  claimedCountEl.textContent = claimed;
  remainingEl.textContent    = TOTAL_BOXES - claimed;

  if (state.lastUpdated) {
    try {
      const d = new Date(state.lastUpdated);
      lastUpdatedEl.textContent = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    } catch (e) { lastUpdatedEl.textContent = '—'; }
  }

  btnRandomize.disabled = false;
}

// ── MODAL ──────────────────────────────────────────────────────────────────

function openModal(key) {
  if (state.boxes[key]) return;
  activeBox = key;

  showStep('name');
  nameInput.value       = '';
  nameError.textContent = '';
  payConfirmed.checked  = false;
  btnLockBox.disabled   = true;
  btnLockBox.textContent = '🔒 Lock My Box';

  const displayNum = key.padStart(2, '0');
  modalBoxNum.textContent  = `BOX #${displayNum}`;
  modalBoxNum2.textContent = `BOX #${displayNum}`;

  modalOverlay.classList.add('active');
  modalOverlay.setAttribute('aria-hidden', 'false');
  document.body.style.overflow = 'hidden'; // prevent background scroll on iOS

  setTimeout(() => nameInput.focus(), 120);
}

function closeModal() {
  modalOverlay.classList.remove('active');
  modalOverlay.setAttribute('aria-hidden', 'true');
  document.body.style.overflow = '';
  activeBox = null;
}

function showStep(step) {
  stepName.classList.toggle('hidden', step !== 'name');
  stepPay.classList.toggle('hidden',  step !== 'pay');
  stepDone.classList.toggle('hidden', step !== 'done');
}

// ── MODAL ACTIONS ──────────────────────────────────────────────────────────

btnGoPay.addEventListener('click', () => {
  const name = nameInput.value.trim();
  if (!name) {
    nameError.textContent = 'Please enter your name.';
    nameInput.focus();
    return;
  }
  if (name.length < 2) {
    nameError.textContent = 'Name must be at least 2 characters.';
    nameInput.focus();
    return;
  }
  nameError.textContent = '';

  const note = encodeURIComponent(`NCAA Box Pool - Box ${activeBox}`);
  venmoLink.href = `https://venmo.com/${CONFIG.VENMO_USER}?txn=pay&note=${note}`;
  venmoNoteDisp.textContent = `Note: NCAA Box Pool – Box #${activeBox}`;

  showStep('pay');
});

nameInput.addEventListener('keydown', e => { if (e.key === 'Enter') btnGoPay.click(); });
btnBackName.addEventListener('click', () => showStep('name'));

payConfirmed.addEventListener('change', () => {
  btnLockBox.disabled = !payConfirmed.checked;
});

btnLockBox.addEventListener('click', async () => {
  if (!activeBox) return;
  const name = nameInput.value.trim();
  if (!name) { showStep('name'); return; }

  // Disable immediately to prevent double-submit on slow connections
  btnLockBox.disabled   = true;
  btnLockBox.textContent = '⏳ Saving…';

  // Fetch latest state to catch race conditions (two users picking same box)
  let latestState = state;
  if (isConfigured()) {
    const remote = await fetchState();
    if (remote) latestState = sanitizeState(remote);
  }

  // Re-check: was this box claimed while the modal was open?
  if (latestState.boxes[activeBox]) {
    alert(`Box #${activeBox} was just claimed by someone else. Please choose a different box!`);
    state = latestState;
    closeModal();
    buildGrid();
    return;
  }

  // Claim it
  latestState.boxes[activeBox] = {
    name,
    claimedAt: new Date().toISOString()
  };
  latestState.lastUpdated = new Date().toISOString();

  // Persist
  let saved = true;
  if (isConfigured()) {
    saved = await persistState(latestState);
  }

  if (!saved) {
    btnLockBox.disabled   = false;
    btnLockBox.textContent = '🔒 Lock My Box';
    alert('Could not save — please check your connection and try again.');
    return;
  }

  // Commit locally
  state = latestState;
  saveToLocalStorage();

  // Update the grid cell immediately (in-place, no full rebuild)
  applyClaimedCell(activeBox, name);
  updateStats();

  // Show done step
  showStep('done');
  doneMessage.textContent = `You've claimed Box #${activeBox}. Good luck, ${name}!`;

  // Auto-randomize if board is now full
  const claimed = Object.keys(state.boxes).length;
  if (claimed === TOTAL_BOXES && !state.colDigits) {
    setTimeout(randomizeNumbers, 800);
  }
});

/**
 * Update a single cell to claimed state in place — avoids full grid rebuild
 * and preserves the claim animation for the user who just locked.
 */
function applyClaimedCell(key, name) {
  const cell = gridEl.querySelector(`[data-box="${key}"]`);
  if (!cell) return;

  cell.className = 'grid-cell claimed claim-animate';
  cell.setAttribute('role', 'img');
  cell.removeAttribute('tabindex');
  cell.setAttribute('aria-label', `Box ${key} claimed by ${name}`);
  cell.innerHTML = '';

  const numLabel = el('span', 'box-number');
  numLabel.textContent = key;
  cell.appendChild(numLabel);

  const nameSpan = el('span', 'owner-name');
  nameSpan.textContent = name;
  cell.appendChild(nameSpan);

  const lockSpan = el('span', 'claimed-lock');
  lockSpan.textContent = '🔒';
  cell.appendChild(lockSpan);

  cell.addEventListener('animationend', () => {
    cell.classList.remove('claim-animate');
  }, { once: true });
}

// Close handlers
btnDoneClose.addEventListener('click', closeModal);
modalClose.addEventListener('click', closeModal);
modalOverlay.addEventListener('click', e => { if (e.target === modalOverlay) closeModal(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeModal(); });

// ── RANDOMIZE ──────────────────────────────────────────────────────────────

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

async function randomizeNumbers() {
  state.colDigits   = shuffle([0,1,2,3,4,5,6,7,8,9]);
  state.rowDigits   = shuffle([0,1,2,3,4,5,6,7,8,9]);
  state.lastUpdated = new Date().toISOString();

  if (isConfigured()) await persistState(state);
  saveToLocalStorage();
  buildGrid();
}

btnRandomize.addEventListener('click', randomizeNumbers);

// ── EXPORT CSV ─────────────────────────────────────────────────────────────

btnExport.addEventListener('click', () => {
  const rows = [['Box Number', 'Name', 'Claimed At']];
  for (let i = 1; i <= TOTAL_BOXES; i++) {
    const b = state.boxes[boxKey(i)];
    rows.push([
      i,
      b ? b.name : '',
      b ? new Date(b.claimedAt).toLocaleString() : ''
    ]);
  }
  const csv  = rows.map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = `ncaa-box-pool-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
});

// ── RESET ──────────────────────────────────────────────────────────────────

btnReset.addEventListener('click', () => {
  resetOverlay.classList.add('active');
  resetOverlay.setAttribute('aria-hidden', 'false');
  document.body.style.overflow = 'hidden';
});

btnResetCancel.addEventListener('click', () => {
  resetOverlay.classList.remove('active');
  resetOverlay.setAttribute('aria-hidden', 'true');
  document.body.style.overflow = '';
});

btnResetConf.addEventListener('click', async () => {
  state = makeEmptyState();
  state.lastUpdated = new Date().toISOString();

  if (isConfigured()) await persistState(state);
  saveToLocalStorage();

  resetOverlay.classList.remove('active');
  resetOverlay.setAttribute('aria-hidden', 'true');
  document.body.style.overflow = '';
  buildGrid();
});

// ── LOADING OVERLAY HELPER ─────────────────────────────────────────────────

function setLoadingOverlay(visible, message) {
  if (!loadingOverlay) return;
  if (loadingMsg && message) loadingMsg.textContent = message;
  loadingOverlay.classList.toggle('active', visible);
  loadingOverlay.setAttribute('aria-hidden', String(!visible));
}

// ── BOOT ───────────────────────────────────────────────────────────────────

init();

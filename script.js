/**
 * NCAA Championship Box Pool — script.js
 * Fully client-side. No backend required.
 * Data persisted via localStorage.
 */

// ── CONSTANTS ──────────────────────────────────────────────────────────────

const STORAGE_KEY  = 'ncaa_box_pool_v1';
const VENMO_USER   = 'cakes2015';
const TOTAL_BOXES  = 100;

// ── STATE ──────────────────────────────────────────────────────────────────

/**
 * state shape:
 * {
 *   boxes: { [boxNumber]: { name: string, claimedAt: string } },
 *   colDigits: number[] | null,   // winning team digits (10 values)
 *   rowDigits: number[] | null,   // losing  team digits (10 values)
 *   lastUpdated: string | null
 * }
 */
let state = loadState();

// Active modal context
let activeBox = null; // box number currently being claimed

// ── PERSISTENCE ────────────────────────────────────────────────────────────

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch (e) { /* ignore */ }
  return { boxes: {}, colDigits: null, rowDigits: null, lastUpdated: null };
}

function saveState() {
  state.lastUpdated = new Date().toISOString();
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

// ── DOM REFS ───────────────────────────────────────────────────────────────

const gridEl         = document.getElementById('grid-container');
const claimedCountEl = document.getElementById('claimed-count');
const remainingEl    = document.getElementById('remaining-count');
const lastUpdatedEl  = document.getElementById('last-updated');

const modalOverlay   = document.getElementById('modal-overlay');
const modalClose     = document.getElementById('modal-close');
const resetOverlay   = document.getElementById('reset-overlay');

// Step elements
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

// ── GRID BUILDER ────────────────────────────────────────────────────────────

function buildGrid() {
  gridEl.innerHTML = '';

  const colNums = state.colDigits; // null until randomized
  const rowNums = state.rowDigits;

  // ── Corner cell ──
  const corner = document.createElement('div');
  corner.className = 'grid-corner';
  gridEl.appendChild(corner);

  // ── Column header row ──
  for (let c = 0; c < 10; c++) {
    const hdr = document.createElement('div');
    hdr.className = colNums ? 'grid-header' : 'grid-header unset';
    hdr.textContent = colNums ? colNums[c] : '?';
    hdr.setAttribute('aria-label', colNums ? `Winning digit ${colNums[c]}` : 'Unassigned');
    gridEl.appendChild(hdr);
  }

  // ── Rows 0–9 ──
  for (let r = 0; r < 10; r++) {
    // Row header
    const rowHdr = document.createElement('div');
    rowHdr.className = rowNums ? 'grid-header' : 'grid-header unset';
    rowHdr.textContent = rowNums ? rowNums[r] : '?';
    rowHdr.setAttribute('aria-label', rowNums ? `Losing digit ${rowNums[r]}` : 'Unassigned');
    gridEl.appendChild(rowHdr);

    // 10 box cells
    for (let c = 0; c < 10; c++) {
      const boxNum = r * 10 + c + 1; // 1–100
      const cell = document.createElement('div');
      cell.className = 'grid-cell';
      cell.setAttribute('data-box', boxNum);
      cell.setAttribute('role', 'button');
      cell.setAttribute('tabindex', '0');

      const numLabel = document.createElement('span');
      numLabel.className = 'box-number';
      numLabel.textContent = boxNum;
      cell.appendChild(numLabel);

      const boxData = state.boxes[boxNum];
      if (boxData) {
        cell.classList.add('claimed');
        cell.setAttribute('aria-label', `Box ${boxNum} claimed by ${boxData.name}`);

        const nameEl = document.createElement('span');
        nameEl.className = 'owner-name';
        nameEl.textContent = boxData.name;
        cell.appendChild(nameEl);

        const lockEl = document.createElement('span');
        lockEl.className = 'claimed-lock';
        lockEl.textContent = '🔒';
        cell.appendChild(lockEl);
      } else {
        cell.setAttribute('aria-label', `Box ${boxNum} - unclaimed, click to claim`);
        cell.addEventListener('click', () => openModal(boxNum));
        cell.addEventListener('keydown', e => {
          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openModal(boxNum); }
        });
      }

      gridEl.appendChild(cell);
    }
  }

  updateStats();
  updateRandomizeBtn();
}

// ── STATS ──────────────────────────────────────────────────────────────────

function updateStats() {
  const claimed = Object.keys(state.boxes).length;
  claimedCountEl.textContent = claimed;
  remainingEl.textContent    = TOTAL_BOXES - claimed;

  if (state.lastUpdated) {
    const d = new Date(state.lastUpdated);
    lastUpdatedEl.textContent = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }
}

function updateRandomizeBtn() {
  const claimed = Object.keys(state.boxes).length;
  // Enable if all 100 filled, or allow manual trigger any time (we keep it enabled always
  // but show a note about when numbers officially randomize)
  btnRandomize.disabled = false; // admin can always trigger
}

// ── MODAL ──────────────────────────────────────────────────────────────────

function openModal(boxNum) {
  // Don't open if already claimed
  if (state.boxes[boxNum]) return;

  activeBox = boxNum;

  // Reset to step 1
  showStep('name');
  nameInput.value = '';
  nameError.textContent = '';
  payConfirmed.checked = false;
  btnLockBox.disabled = true;

  // Set box badges
  modalBoxNum.textContent  = `BOX #${String(boxNum).padStart(2, '0')}`;
  modalBoxNum2.textContent = `BOX #${String(boxNum).padStart(2, '0')}`;

  // Show overlay
  modalOverlay.classList.add('active');
  modalOverlay.setAttribute('aria-hidden', 'false');
  setTimeout(() => nameInput.focus(), 80);
}

function closeModal() {
  modalOverlay.classList.remove('active');
  modalOverlay.setAttribute('aria-hidden', 'true');
  activeBox = null;
}

function showStep(step) {
  stepName.classList.add('hidden');
  stepPay.classList.add('hidden');
  stepDone.classList.add('hidden');

  if (step === 'name') stepName.classList.remove('hidden');
  if (step === 'pay')  stepPay.classList.remove('hidden');
  if (step === 'done') stepDone.classList.remove('hidden');
}

// ── MODAL ACTIONS ──────────────────────────────────────────────────────────

// Step 1 → Step 2: Go to payment
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

  // Build Venmo URL
  const note = encodeURIComponent(`NCAA Box Pool - Box ${activeBox}`);
  const url  = `https://venmo.com/${VENMO_USER}?txn=pay&note=${note}`;
  venmoLink.href = url;
  venmoNoteDisp.textContent = `Note: NCAA Box Pool – Box #${activeBox}`;

  showStep('pay');
});

// Also allow Enter in name field
nameInput.addEventListener('keydown', e => {
  if (e.key === 'Enter') btnGoPay.click();
});

// Step 2 ← back
btnBackName.addEventListener('click', () => showStep('name'));

// Payment checkbox enables lock button
payConfirmed.addEventListener('change', () => {
  btnLockBox.disabled = !payConfirmed.checked;
});

// Lock the box
btnLockBox.addEventListener('click', () => {
  if (!activeBox) return;
  const name = nameInput.value.trim();
  if (!name) { showStep('name'); return; }

  // Save
  state.boxes[activeBox] = {
    name,
    claimedAt: new Date().toISOString()
  };
  saveState();

  // Update UI
  showStep('done');
  doneMessage.textContent = `You've claimed Box #${activeBox}. Good luck, ${name}!`;

  // Update the grid cell immediately (without full rebuild for animation)
  const cell = gridEl.querySelector(`[data-box="${activeBox}"]`);
  if (cell) {
    cell.classList.add('claimed', 'claim-animate');
    cell.removeEventListener('click', () => openModal(activeBox));
    cell.setAttribute('aria-label', `Box ${activeBox} claimed by ${name}`);

    // Remove click listener by replacing node
    const fresh = cell.cloneNode(false);
    fresh.className = 'grid-cell claimed claim-animate';
    fresh.setAttribute('data-box', activeBox);
    fresh.setAttribute('aria-label', `Box ${activeBox} claimed by ${name}`);

    const numLabel = document.createElement('span');
    numLabel.className = 'box-number';
    numLabel.textContent = activeBox;
    fresh.appendChild(numLabel);

    const nameEl = document.createElement('span');
    nameEl.className = 'owner-name';
    nameEl.textContent = name;
    fresh.appendChild(nameEl);

    const lockEl = document.createElement('span');
    lockEl.className = 'claimed-lock';
    lockEl.textContent = '🔒';
    fresh.appendChild(lockEl);

    cell.replaceWith(fresh);
  }

  updateStats();
  updateRandomizeBtn();

  // Auto-randomize if all 100 filled and not yet done
  const claimed = Object.keys(state.boxes).length;
  if (claimed === TOTAL_BOXES && !state.colDigits) {
    setTimeout(randomizeNumbers, 600);
  }
});

// Step 3 close
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

function randomizeNumbers() {
  state.colDigits = shuffle([0,1,2,3,4,5,6,7,8,9]);
  state.rowDigits = shuffle([0,1,2,3,4,5,6,7,8,9]);
  saveState();
  buildGrid(); // full rebuild to show numbers
}

btnRandomize.addEventListener('click', randomizeNumbers);

// ── EXPORT CSV ─────────────────────────────────────────────────────────────

btnExport.addEventListener('click', () => {
  const rows = [['Box Number', 'Name', 'Claimed At']];
  for (let i = 1; i <= TOTAL_BOXES; i++) {
    const b = state.boxes[i];
    rows.push([i, b ? b.name : '', b ? new Date(b.claimedAt).toLocaleString() : '']);
  }
  const csv = rows.map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = `ncaa-box-pool-${new Date().toISOString().slice(0,10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
});

// ── RESET ──────────────────────────────────────────────────────────────────

btnReset.addEventListener('click', () => {
  resetOverlay.classList.add('active');
  resetOverlay.setAttribute('aria-hidden', 'false');
});

btnResetCancel.addEventListener('click', () => {
  resetOverlay.classList.remove('active');
  resetOverlay.setAttribute('aria-hidden', 'true');
});

btnResetConf.addEventListener('click', () => {
  state = { boxes: {}, colDigits: null, rowDigits: null, lastUpdated: null };
  saveState();
  resetOverlay.classList.remove('active');
  resetOverlay.setAttribute('aria-hidden', 'true');
  buildGrid();
});

// ── INIT ───────────────────────────────────────────────────────────────────

buildGrid();

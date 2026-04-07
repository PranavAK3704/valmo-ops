/**
 * process-detection.js
 * =====================
 * Passive click-sequence detector for automatic PCT measurement.
 *
 * Watches DOM clicks against known process step sequences loaded from Supabase.
 * Pseudo-timer starts at step 1, confirmed at step 3 (or mid-point for short processes).
 * End detection at last step. Hands off to captainTimerSystem for sync + hub coordination.
 *
 * No manual start/stop needed — process timing is objective and click-verified.
 */

(function () {
  'use strict';

  const SB_URL = 'https://wfnmltorfvaokqbzggkn.supabase.co';
  const SB_KEY = 'sb_publishable_kVRokdcfNT-egywk-KbQ3g_mEs5QVGW';

  // ── Config ────────────────────────────────────────────────────────────────────
  const CONFIRMATION_STEP    = 3;          // confirm start at this step (minimum — never confirm before step 3)
  const SEQUENCE_TIMEOUT_MS  = 30 * 60 * 1000; // reset sequence after 30min inactivity
  const MIN_PROCESS_SECONDS  = 20;         // reject PCT below this — likely a test click
  const RELOAD_INTERVAL_MS   = 5 * 60 * 1000;  // reload process definitions every 5min

  // ── State ─────────────────────────────────────────────────────────────────────
  let processes      = [];   // [{id, process_name, steps: [{elementText, urlPattern, isSafeAction}]}]
  let sequences      = {};   // processId → {step, pseudoStart, confirmedStart, confirmed, timeoutId}
  let activeId       = null; // only one process active at a time
  let initialized    = false;

  // ── Supabase helpers ──────────────────────────────────────────────────────────
  async function sbGet(path) {
    const res = await fetch(`${SB_URL}/rest/v1/${path}`, {
      headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, Accept: 'application/json' }
    });
    return res.json();
  }

  // ── Load process definitions ──────────────────────────────────────────────────
  async function loadProcesses() {
    try {
      const rows = await sbGet('simulations?published=eq.true&select=id,title,process_name,steps_json');
      const loaded = [];
      for (const row of rows) {
        if (!Array.isArray(row.steps_json)) continue;
        const steps = row.steps_json.filter(s => s.elementText && s.elementText.trim());
        if (!steps.length) continue;
        loaded.push({
          id:           row.id,
          process_name: row.process_name || row.title,
          steps,
        });
      }
      processes = loaded;
      console.log(`[ProcessDetection] ${processes.length} process(es) loaded`);
    } catch (e) {
      console.warn('[ProcessDetection] Failed to load processes:', e);
    }
  }

  // ── Element text matching (3-tier) ────────────────────────────────────────────
  function getElementText(el) {
    // Walk up max 2 parents to get meaningful text (handles <button><span>text</span></button>)
    let node = el;
    for (let i = 0; i < 3; i++) {
      const t = (node.textContent || node.innerText || node.value || node.getAttribute?.('aria-label') || '').trim();
      if (t) return t;
      if (!node.parentElement) break;
      node = node.parentElement;
    }
    return '';
  }

  function matchesStep(el, step) {
    if (!step.elementText) return false;
    const clicked = getElementText(el).toLowerCase();
    const target  = step.elementText.trim().toLowerCase();
    if (!clicked || !target) return false;

    // 1. Exact
    if (clicked === target) return true;
    // 2. Contains (target is a clean word, clicked might have surrounding text)
    if (clicked.includes(target) && target.length >= 2) return true;
    // 3. Target contains clicked (e.g. clicked = "RTO", target = "RTO Bagging")
    if (target.includes(clicked) && clicked.length >= 3) return true;
    return false;
  }

  // ── Sequence management ───────────────────────────────────────────────────────
  function getSeq(processId) {
    if (!sequences[processId]) {
      sequences[processId] = { step: 0, pseudoStart: null, confirmedStart: null, confirmed: false, timeoutId: null };
    }
    return sequences[processId];
  }

  function resetSeq(processId) {
    const seq = sequences[processId];
    if (seq?.timeoutId) clearTimeout(seq.timeoutId);
    delete sequences[processId];
    if (activeId === processId) activeId = null;
  }

  function armTimeout(processId) {
    const seq = sequences[processId];
    if (seq.timeoutId) clearTimeout(seq.timeoutId);
    seq.timeoutId = setTimeout(() => {
      console.log(`[ProcessDetection] ${processId}: sequence timed out`);
      resetSeq(processId);
    }, SEQUENCE_TIMEOUT_MS);
  }

  // ── Silent warning pill ───────────────────────────────────────────────────────
  function showSilentWarning(procName) {
    removeEl('vt-pd-silent-warn');
    const el = document.createElement('div');
    el.id = 'vt-pd-silent-warn';
    el.className = 'vt-pd-silent-warn';
    el.textContent = `⏱ ${procName} — timer running (unconfirmed)`;
    document.body.appendChild(el);
  }

  function hideSilentWarning() {
    removeEl('vt-pd-silent-warn');
  }

  // ── Main click handler ────────────────────────────────────────────────────────
  function handleClick(e) {
    if (!processes.length) return;

    let matched = false;

    for (const proc of processes) {
      const seq = getSeq(proc.id);

      // If another process is active (confirmed or pseudo-started), ignore others
      const anyPseudoActive = Object.entries(sequences).some(([id, s]) => s.pseudoStart && id !== proc.id);
      if (activeId && activeId !== proc.id) continue;
      if (anyPseudoActive && !sequences[proc.id]?.pseudoStart) continue;

      // If this process is already confirmed+complete, skip
      if (seq.confirmed && seq.step >= proc.steps.length) continue;

      const nextStep = proc.steps[seq.step];
      if (!nextStep) continue;

      // URL guard — skip if wrong page
      if (nextStep.urlPattern && !window.location.href.includes(nextStep.urlPattern)) continue;

      // Click match
      if (!matchesStep(e.target, nextStep)) continue;

      matched = true;

      // ── Step matched ──
      seq.step++;
      armTimeout(proc.id);

      if (seq.step === 1) {
        seq.pseudoStart = Date.now();
        console.log(`[ProcessDetection] "${proc.process_name}": step 1 matched → pseudo-timer started`);
      } else {
        console.log(`[ProcessDetection] "${proc.process_name}": step ${seq.step} matched`);
      }

      // ── Confirmation point ──
      const confirmAt = proc.steps.length <= 4 ? 2 : CONFIRMATION_STEP;
      if (seq.step === confirmAt && !seq.confirmed && !seq.silentMode) {
        showStartConfirmation(proc, seq);
      }

      // ── Show silent warning if in silent mode ──
      if (seq.silentMode) showSilentWarning(proc.process_name);

      // ── End detection — fires for confirmed OR silentMode sequences ──
      if ((seq.confirmed || seq.silentMode) && seq.step >= proc.steps.length) {
        hideSilentWarning();
        showEndConfirmation(proc, seq);
      }

      sequences[proc.id] = seq;
      break;
    }

    // Case 3: click outside sequence while in silent mode → stop pseudo-timer
    if (!matched) {
      const silentEntry = Object.entries(sequences).find(([, s]) => s.silentMode && s.pseudoStart);
      if (silentEntry) {
        const [procId, seq] = silentEntry;
        const elapsed = Math.round((Date.now() - seq.pseudoStart) / 1000);
        console.log(`[ProcessDetection] Off-sequence click in silent mode — stopping after ${elapsed}s`);
        hideSilentWarning();
        delete sequences[procId];
        activeId = null;
      }
    }
  }

  // ── Start confirmation toast ──────────────────────────────────────────────────
  function showStartConfirmation(proc, seq) {
    removeEl('vt-pd-start');

    const div = document.createElement('div');
    div.id = 'vt-pd-start';
    div.className = 'vt-pd-confirm';
    div.innerHTML = `
      <div class="vt-pd-confirm-body">
        <div class="vt-pd-confirm-icon">▶</div>
        <div class="vt-pd-confirm-text">
          <strong>${proc.process_name}</strong>
          <span>Starting this process?</span>
        </div>
      </div>
      <div class="vt-pd-confirm-actions">
        <button class="vt-pd-btn-yes">Yes, start timing</button>
        <button class="vt-pd-btn-no">Not this</button>
      </div>
    `;
    document.body.appendChild(div);

    // Animate in
    requestAnimationFrame(() => div.classList.add('vt-pd-visible'));

    div.querySelector('.vt-pd-btn-yes').addEventListener('click', (e) => {
      e.stopPropagation();
      confirmStart(proc, seq);
      div.remove();
    });
    div.querySelector('.vt-pd-btn-no').addEventListener('click', (e) => {
      e.stopPropagation();
      // Keep tracking silently — if they complete the process, record it anyway
      seq.silentMode = true;
      sequences[proc.id] = seq;
      div.remove();
    });

    // Auto-dismiss after 12s — treat as silent mode (assume they're doing it)
    setTimeout(() => {
      if (div.isConnected) {
        seq.silentMode = true;
        sequences[proc.id] = seq;
        div.remove();
      }
    }, 12000);
  }

  function confirmStart(proc, seq) {
    seq.confirmed     = true;
    seq.confirmedStart = seq.pseudoStart || Date.now();
    activeId          = proc.id;
    sequences[proc.id] = seq;

    // captainTimerSystem lives in the page world — use postMessage to reach it
    window.postMessage({ type: 'PD_START_PROCESS', processName: proc.process_name }, '*');

    // Open panel + switch to Videos tab (timer lives there) after CTS starts
    setTimeout(() => {
      const panel = document.getElementById('valmo-panel');
      if (panel && !panel.classList.contains('open')) {
        document.getElementById('valmo-tab')?.click();
      }
      // Switch to Videos tab which contains the active process card + pause button
      document.querySelector('[data-tab="videos"]')?.click();
    }, 600);

    showToast(`⏱ ${proc.process_name} — timer started`);
    console.log(`[ProcessDetection] "${proc.process_name}": confirmed start at step ${seq.step}`);
  }

  // ── End confirmation toast ────────────────────────────────────────────────────
  function showEndConfirmation(proc, seq) {
    removeEl('vt-pd-end');

    const startTime = seq.confirmedStart || seq.pseudoStart || Date.now();
    const elapsed = Math.round((Date.now() - startTime) / 1000);
    const timeStr = elapsed >= 60
      ? `${Math.floor(elapsed / 60)}m ${elapsed % 60}s`
      : `${elapsed}s`;

    const div = document.createElement('div');
    div.id = 'vt-pd-end';
    div.className = 'vt-pd-confirm vt-pd-confirm--end';
    div.innerHTML = `
      <div class="vt-pd-confirm-body">
        <div class="vt-pd-confirm-icon">✓</div>
        <div class="vt-pd-confirm-text">
          <strong>${proc.process_name}</strong>
          <span>Process done? &nbsp;·&nbsp; ${timeStr}</span>
        </div>
      </div>
      <div class="vt-pd-confirm-actions">
        <button class="vt-pd-btn-yes">Yes, complete</button>
        <button class="vt-pd-btn-no">Not yet</button>
      </div>
    `;
    document.body.appendChild(div);
    requestAnimationFrame(() => div.classList.add('vt-pd-visible'));

    div.querySelector('.vt-pd-btn-yes').addEventListener('click', (e) => {
      e.stopPropagation();
      confirmEnd(proc, seq, elapsed);
      div.remove();
    });
    div.querySelector('.vt-pd-btn-no').addEventListener('click', (e) => {
      e.stopPropagation();
      // Reset to step 1 so they can re-trigger end detection
      seq.step = proc.steps.length - 1;
      div.remove();
    });

    setTimeout(() => div?.remove(), 15000);
  }

  function confirmEnd(proc, seq, elapsed) {
    if (elapsed < MIN_PROCESS_SECONDS) {
      showToast(`⚠ Too fast (${elapsed}s) — not recorded`);
      resetSeq(proc.id);
      return;
    }

    if (seq.silentMode) {
      // Was never formally started — start then immediately stop to record PCT
      window.postMessage({ type: 'PD_SILENT_RECORD', processName: proc.process_name, elapsed }, '*');
    } else {
      window.postMessage({ type: 'PD_STOP_PROCESS' }, '*');
    }

    console.log(`[ProcessDetection] "${proc.process_name}": confirmed end — ${elapsed}s (silentMode=${!!seq.silentMode})`);
    // Full wipe so process can be re-detected immediately
    delete sequences[proc.id];
    activeId = null;
  }

  // ── Toast helper ──────────────────────────────────────────────────────────────
  function showToast(msg) {
    const t = document.createElement('div');
    t.className = 'vt-pd-toast';
    t.textContent = msg;
    document.body.appendChild(t);
    requestAnimationFrame(() => t.classList.add('vt-pd-toast--visible'));
    setTimeout(() => { t.classList.remove('vt-pd-toast--visible'); setTimeout(() => t.remove(), 300); }, 3000);
  }

  function removeEl(id) {
    document.getElementById(id)?.remove();
  }

  // ── Init ──────────────────────────────────────────────────────────────────────
  async function init() {
    if (initialized) return;
    initialized = true;

    await loadProcesses();
    document.addEventListener('click', handleClick, { capture: true, passive: true });
    setInterval(loadProcesses, RELOAD_INTERVAL_MS);

    console.log('[ProcessDetection] Running');
  }

  // Reset all detection state when process is stopped (from any source)
  window.addEventListener('message', (e) => {
    if (e.data?.type === 'PD_STOP_PROCESS') {
      sequences = {};
      activeId = null;
      removeEl('vt-pd-start');
      removeEl('vt-pd-end');
      console.log('[ProcessDetection] State reset on stop');
    }
  });

  // Reset unconfirmed sequences when URL changes away from their expected page
  let _lastUrl = location.href;
  setInterval(() => {
    if (location.href === _lastUrl) return;
    _lastUrl = location.href;
    for (const proc of processes) {
      const seq = sequences[proc.id];
      if (!seq?.pseudoStart || seq.confirmed) continue; // only unconfirmed pseudo-timers
      // Check if the current next step's urlPattern still matches
      const nextStep = proc.steps[seq.step] || proc.steps[0];
      if (nextStep?.urlPattern && !location.href.includes(nextStep.urlPattern)) {
        console.log(`[ProcessDetection] "${proc.process_name}": URL changed, resetting unconfirmed sequence`);
        hideSilentWarning();
        resetSeq(proc.id);
      }
    }
  }, 300);

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    setTimeout(init, 1500); // wait for captainTimerSystem to be ready
  }
})();

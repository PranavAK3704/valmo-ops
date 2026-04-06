(function () {
  'use strict';

  // ─── Constants ───────────────────────────────────────────────────────────────
  const SUPA_URL = 'https://wfnmltorfvaokqbzggkn.supabase.co';
  const SUPA_KEY = 'sb_publishable_kVRokdcfNT-egywk-KbQ3g_mEs5QVGW';

  // ─── State ───────────────────────────────────────────────────────────────────
  let state = 'idle'; // idle | nav_check | spotlighting | waiting_click | dry_run | complete
  let currentSim = null;
  let currentStepIndex = 0;
  let navPollTimer = null;
  let captureHandler = null;
  let elementClickHandler = null;
  let targetElement = null;
  let findRetryCount = 0;
  let findRetryTimer = null;

  // ─── Supabase helpers ────────────────────────────────────────────────────────
  function supaFetch(path, options) {
    const url = SUPA_URL + path;
    const headers = Object.assign({
      'apikey': SUPA_KEY,
      'Authorization': 'Bearer ' + SUPA_KEY,
      'Content-Type': 'application/json'
    }, options && options.headers ? options.headers : {});
    return fetch(url, Object.assign({}, options, { headers }));
  }

  // ─── User context ────────────────────────────────────────────────────────────
  function getUserCtx() {
    const u = window.__valmoUser || {};
    return {
      email: u.email || '',
      hubCode: u.hubCode || '',
      hub: u.hub || ''
    };
  }

  // ─── DOM element finder ──────────────────────────────────────────────────────

  // Returns true only for elements with real, visible dimensions — filters out
  // decorative indicators, borders, empty containers, and off-screen nodes.
  function isUsableElement(el) {
    const r = el.getBoundingClientRect();
    if (r.width < 24 || r.height < 12) return false;          // too small to be a real target
    if (r.top < 0 || r.left < 0) return false;                // off-screen
    if (r.top > window.innerHeight) return false;              // below viewport
    const style = window.getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
    return true;
  }

  // Returns the own text of an element, ignoring deeply nested children.
  // A sidebar item like <li>Inventory<span class="icon">…</span></li> should
  // match "Inventory" even though textContent includes the icon text.
  function ownText(el) {
    return [...el.childNodes]
      .filter(n => n.nodeType === Node.TEXT_NODE)
      .map(n => n.textContent.trim())
      .join(' ')
      .trim()
      .toLowerCase();
  }

  function findElement(elementText) {
    if (!elementText) return null;
    const text = elementText.trim().toLowerCase();

    // Tier 1 — semantic interactive elements only (no div/span — too broad)
    const tier1 = [...document.querySelectorAll(
      'button, a, [role="tab"], [role="button"], [role="menuitem"], [role="option"], li, td, th, input, select'
    )].filter(isUsableElement);

    // 1a. Exact own-text match (ignores icon/badge text inside the element)
    let el = tier1.find(e => ownText(e) === text);

    // 1b. Full textContent exact, case-insensitive
    if (!el) el = tier1.find(e => e.textContent.trim().toLowerCase() === text);

    // 1c. Contains match — but element text must not be much longer than the target
    //     (prevents matching huge container elements)
    if (!el) el = tier1.find(e => {
      const t = e.textContent.trim().toLowerCase();
      return t.includes(text) && t.length <= text.length * 2.5;
    });

    // Tier 2 — fall back to spans/divs only if tier 1 failed
    if (!el) {
      const tier2 = [...document.querySelectorAll('span, div')].filter(isUsableElement)
        .filter(e => e.children.length <= 3); // skip container divs with many children

      el = tier2.find(e => e.textContent.trim().toLowerCase() === text);
      if (!el) el = tier2.find(e => {
        const t = e.textContent.trim().toLowerCase();
        return t.includes(text) && t.length <= text.length * 2;
      });
    }

    return el || null;
  }

  // ─── Spotlight ───────────────────────────────────────────────────────────────
  function removeSpotlight() {
    const old = document.getElementById('vt-spotlight-root');
    if (old) old.remove();
  }

  function drawSpotlight(el) {
    const rect = el.getBoundingClientRect();
    const pad = 6;

    removeSpotlight();

    const overlay = document.createElement('div');
    overlay.id = 'vt-spotlight-root';
    overlay.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:2147483620;';

    const top = 'position:fixed;background:rgba(0,0,0,0.55);pointer-events:none;';
    const panels = [
      // top
      `${top}top:0;left:0;right:0;height:${rect.top - pad}px`,
      // bottom
      `${top}top:${rect.bottom + pad}px;left:0;right:0;bottom:0`,
      // left
      `${top}top:${rect.top - pad}px;left:0;width:${rect.left - pad}px;height:${rect.height + pad * 2}px`,
      // right
      `${top}top:${rect.top - pad}px;left:${rect.right + pad}px;right:0;height:${rect.height + pad * 2}px`,
    ];

    panels.forEach(css => {
      const d = document.createElement('div');
      d.style.cssText = css;
      overlay.appendChild(d);
    });

    // Ring — enforce minimum visible size regardless of element dimensions
    const ringW = Math.max(rect.width + pad * 2, 80);
    const ringH = Math.max(rect.height + pad * 2, 32);
    const ringLeft = rect.left + (rect.width / 2) - (ringW / 2);
    const ringTop  = rect.top  + (rect.height / 2) - (ringH / 2);
    const ring = document.createElement('div');
    ring.style.cssText = `position:fixed;top:${ringTop}px;left:${ringLeft}px;width:${ringW}px;height:${ringH}px;border:2px solid #F43397;border-radius:6px;box-shadow:0 0 0 2px rgba(244,51,151,0.3),0 0 12px rgba(244,51,151,0.4);pointer-events:none;animation:vt-pulse 2s infinite;`;
    overlay.appendChild(ring);

    document.body.appendChild(overlay);
  }

  // ─── Cleanup all training UI ─────────────────────────────────────────────────
  function cleanupAll() {
    removeSpotlight();
    removeNavBanner();
    removeInstructionCard();
    removeDryRunModal();
    removeCompleteCard();
    clearNavPoll();
    removeCaptureListener();
    removeElementClickListener();
    clearFindRetry();
    state = 'idle';
    currentSim = null;
    currentStepIndex = 0;
    targetElement = null;
  }

  function clearNavPoll() {
    if (navPollTimer) { clearInterval(navPollTimer); navPollTimer = null; }
  }

  function clearFindRetry() {
    if (findRetryTimer) { clearTimeout(findRetryTimer); findRetryTimer = null; }
    findRetryCount = 0;
  }

  function removeCaptureListener() {
    if (captureHandler) {
      document.removeEventListener('click', captureHandler, { capture: true });
      captureHandler = null;
    }
  }

  function removeElementClickListener() {
    if (elementClickHandler && targetElement) {
      targetElement.removeEventListener('click', elementClickHandler);
      elementClickHandler = null;
    }
  }

  // ─── Nav banner ──────────────────────────────────────────────────────────────
  function removeNavBanner() {
    const b = document.getElementById('vt-nav-banner');
    if (b) b.remove();
  }

  function showNavBanner(urlPattern, onSkip) {
    removeNavBanner();
    const banner = document.createElement('div');
    banner.id = 'vt-nav-banner';
    banner.innerHTML = `
      <span>📍 Go to the <strong>${urlPattern}</strong> section first — waiting for navigation...</span>
      <button id="vt-nav-skip">Skip</button>
    `;
    document.body.appendChild(banner);
    document.getElementById('vt-nav-skip').addEventListener('click', function () {
      clearNavPoll();
      removeNavBanner();
      onSkip();
    });
  }

  // ─── Instruction card ────────────────────────────────────────────────────────
  function removeInstructionCard() {
    const c = document.getElementById('vt-instruction-card');
    if (c) c.remove();
  }

  function showInstructionCard(step, stepIndex, totalSteps, onSkip, onExit) {
    removeInstructionCard();
    const card = document.createElement('div');
    card.id = 'vt-instruction-card';

    const hasHint = step.hint && step.hint.trim().length > 0;
    const slideHtml = step.slideImage
      ? `<div class="vt-slide-preview"><img src="${step.slideImage}" alt="Step reference" /></div>`
      : '';

    card.innerHTML = `
      <div class="vt-card-header">
        <span class="vt-step-counter">Step ${stepIndex + 1} of ${totalSteps}</span>
        <div class="vt-progress-bar"><div class="vt-progress-fill" style="width:${Math.round(((stepIndex + 1) / totalSteps) * 100)}%"></div></div>
      </div>
      ${slideHtml}
      <div class="vt-instruction-text">${step.instruction}</div>
      ${hasHint ? `<div class="vt-hint-toggle" id="vt-hint-toggle">💡 Show hint</div><div class="vt-hint-text" id="vt-hint-text" style="display:none">${step.hint}</div>` : ''}
      <div class="vt-card-actions">
        <button id="vt-skip-step">⏭ Skip step</button>
        <button id="vt-exit-sim" class="vt-btn-danger">✕ Exit</button>
      </div>
    `;

    document.body.appendChild(card);

    if (hasHint) {
      document.getElementById('vt-hint-toggle').addEventListener('click', function () {
        const hintEl = document.getElementById('vt-hint-text');
        if (hintEl.style.display === 'none') {
          hintEl.style.display = 'block';
          this.textContent = '💡 Hide hint';
        } else {
          hintEl.style.display = 'none';
          this.textContent = '💡 Show hint';
        }
      });
    }

    document.getElementById('vt-skip-step').addEventListener('click', function () {
      onSkip();
    });

    document.getElementById('vt-exit-sim').addEventListener('click', function () {
      onExit();
    });
  }

  // ─── Dry-run modal ───────────────────────────────────────────────────────────
  function removeDryRunModal() {
    const m = document.getElementById('vt-dry-run-modal');
    if (m) m.remove();
  }

  function showDryRunModal(step, onGotIt, onExit) {
    removeDryRunModal();
    const modal = document.createElement('div');
    modal.id = 'vt-dry-run-modal';
    modal.innerHTML = `
      <div class="vt-dry-run-box">
        <div class="vt-dry-run-title">⚠️ Dry Run Mode</div>
        <div class="vt-dry-run-body">
          <p>This action would: <strong>${step.instruction}</strong></p>
          <p class="vt-dry-run-note">In a real session, this would submit/create/delete data.</p>
        </div>
        <div class="vt-dry-run-actions">
          <button id="vt-dry-run-gotit">✓ Got it — Next Step</button>
          <button id="vt-dry-run-exit" class="vt-btn-danger">✕ Exit Simulation</button>
        </div>
      </div>
    `;
    document.body.appendChild(modal);

    document.getElementById('vt-dry-run-gotit').addEventListener('click', function () {
      removeDryRunModal();
      onGotIt();
    });

    document.getElementById('vt-dry-run-exit').addEventListener('click', function () {
      removeDryRunModal();
      onExit();
    });
  }

  // ─── Complete card ───────────────────────────────────────────────────────────
  function removeCompleteCard() {
    const c = document.getElementById('vt-complete-card');
    if (c) c.remove();
  }

  function showCompleteCard(sim) {
    removeCompleteCard();
    const card = document.createElement('div');
    card.id = 'vt-complete-card';
    card.innerHTML = `
      <div class="vt-complete-icon">✅</div>
      <div class="vt-complete-title">Simulation Complete!</div>
      <div class="vt-complete-sim-name">${sim.title}</div>
      <div class="vt-complete-steps">${sim.step_count} steps completed</div>
    `;
    document.body.appendChild(card);
  }

  // ─── Step state machine ──────────────────────────────────────────────────────
  function runStep(stepIndex) {
    if (!currentSim) return;
    const steps = currentSim.steps_json;

    if (stepIndex >= steps.length) {
      completeSimulation();
      return;
    }

    currentStepIndex = stepIndex;
    const step = steps[stepIndex];

    // Clean up previous step UI
    removeSpotlight();
    removeNavBanner();
    removeInstructionCard();
    removeDryRunModal();
    clearNavPoll();
    removeCaptureListener();
    removeElementClickListener();
    clearFindRetry();
    targetElement = null;

    // nav_check state
    if (step.urlPattern && step.urlPattern.trim() !== '' && !window.location.href.includes(step.urlPattern)) {
      state = 'nav_check';
      showNavBanner(step.urlPattern, function () {
        doSpotlighting(step, stepIndex);
      });
      navPollTimer = setInterval(function () {
        if (window.location.href.includes(step.urlPattern)) {
          clearNavPoll();
          removeNavBanner();
          doSpotlighting(step, stepIndex);
        }
      }, 1000);
    } else {
      doSpotlighting(step, stepIndex);
    }
  }

  function doSpotlighting(step, stepIndex) {
    state = 'spotlighting';
    clearFindRetry();
    findRetryCount = 0;
    tryFindAndSpotlight(step, stepIndex);
  }

  function tryFindAndSpotlight(step, stepIndex) {
    const el = findElement(step.elementText);

    if (el) {
      targetElement = el;
      drawSpotlight(el);
      state = 'waiting_click';

      showInstructionCard(
        step,
        stepIndex,
        currentSim.steps_json.length,
        function onSkip() {
          advanceStep(stepIndex);
        },
        function onExit() {
          cleanupAll();
        }
      );

      attachClickHandler(el, step, stepIndex);
    } else {
      findRetryCount++;
      if (findRetryCount <= 8) {
        findRetryTimer = setTimeout(function () {
          tryFindAndSpotlight(step, stepIndex);
        }, 500);
      } else {
        // Fallback: couldn't find element
        showFallbackUI(step, stepIndex);
      }
    }
  }

  function showFallbackUI(step, stepIndex) {
    removeInstructionCard();
    const card = document.createElement('div');
    card.id = 'vt-instruction-card';
    card.innerHTML = `
      <div class="vt-card-header">
        <span class="vt-step-counter">Step ${stepIndex + 1} of ${currentSim.steps_json.length}</span>
      </div>
      <div class="vt-instruction-text">${step.instruction}</div>
      <div class="vt-fallback-notice">⚠️ Couldn't find the element automatically — click it yourself, then press Continue.</div>
      <div class="vt-card-actions">
        <button id="vt-fallback-continue">Continue</button>
        <button id="vt-exit-sim" class="vt-btn-danger">✕ Exit</button>
      </div>
    `;
    document.body.appendChild(card);

    document.getElementById('vt-fallback-continue').addEventListener('click', function () {
      advanceStep(stepIndex);
    });
    document.getElementById('vt-exit-sim').addEventListener('click', function () {
      cleanupAll();
    });
  }

  function attachClickHandler(el, step, stepIndex) {
    if (step.isSafeAction !== false) {
      // Safe action: simple one-time listener
      elementClickHandler = function () {
        removeElementClickListener();
        advanceStep(stepIndex);
      };
      el.addEventListener('click', elementClickHandler, { once: true });
    } else {
      // Unsafe action: capture-phase intercept
      captureHandler = function (e) {
        if (el.contains(e.target) || e.target === el) {
          e.preventDefault();
          e.stopPropagation();
          removeCaptureListener();
          state = 'dry_run';
          showDryRunModal(
            step,
            function onGotIt() {
              advanceStep(stepIndex);
            },
            function onExit() {
              cleanupAll();
            }
          );
        }
      };
      document.addEventListener('click', captureHandler, { capture: true });
    }
  }

  function advanceStep(currentIndex) {
    removeSpotlight();
    removeInstructionCard();
    removeDryRunModal();
    removeCaptureListener();
    removeElementClickListener();
    clearFindRetry();
    runStep(currentIndex + 1);
  }

  // ─── Complete simulation ─────────────────────────────────────────────────────
  function completeSimulation() {
    state = 'complete';
    removeSpotlight();
    removeNavBanner();
    removeInstructionCard();
    removeDryRunModal();
    clearNavPoll();
    removeCaptureListener();
    removeElementClickListener();
    clearFindRetry();

    const sim = currentSim;
    const stepCount = sim.steps_json.length;
    const user = getUserCtx();

    showCompleteCard(sim);

    // POST completion record
    supaFetch('/rest/v1/sim_completions', {
      method: 'POST',
      headers: {
        'Prefer': 'return=minimal'
      },
      body: JSON.stringify({
        sim_id: sim.id,
        user_email: user.email,
        hub_code: user.hubCode,
        steps_completed: stepCount,
        total_steps: stepCount
      })
    }).catch(function (err) {
      console.warn('[Training] Failed to record completion:', err);
    });

    // Auto-dismiss after 4 seconds
    setTimeout(function () {
      removeCompleteCard();
      state = 'idle';
      currentSim = null;
      currentStepIndex = 0;
      targetElement = null;
    }, 4000);
  }

  // ─── Start a simulation ──────────────────────────────────────────────────────
  function startSimulation(simId) {
    supaFetch('/rest/v1/simulations?id=eq.' + simId + '&select=*&limit=1')
      .then(function (r) { return r.json(); })
      .then(function (data) {
        if (!data || !data.length) {
          console.warn('[Training] Simulation not found:', simId);
          return;
        }
        currentSim = data[0];
        currentStepIndex = 0;
        runStep(0);
      })
      .catch(function (err) {
        console.error('[Training] Failed to fetch simulation:', err);
      });
  }

  // ─── Search modal ────────────────────────────────────────────────────────────
  let searchDebounceTimer = null;

  function removeSearchModal() {
    const m = document.getElementById('vt-search-modal');
    if (m) m.remove();
    if (searchDebounceTimer) { clearTimeout(searchDebounceTimer); searchDebounceTimer = null; }
  }

  function showSearchModal() {
    removeSearchModal();

    const modal = document.createElement('div');
    modal.id = 'vt-search-modal';
    modal.innerHTML = `
      <div class="vt-search-box">
        <div class="vt-search-header">
          <span class="vt-search-title">🎓 Training Simulations</span>
          <button id="vt-search-close">×</button>
        </div>
        <input type="text" id="vt-search-input" placeholder="Search simulations..." autocomplete="off" />
        <div id="vt-search-results" class="vt-search-results">
          <div class="vt-search-empty">Start typing to search simulations...</div>
        </div>
      </div>
    `;
    document.body.appendChild(modal);

    document.getElementById('vt-search-close').addEventListener('click', removeSearchModal);

    // Close on backdrop click
    modal.addEventListener('click', function (e) {
      if (e.target === modal) removeSearchModal();
    });

    const input = document.getElementById('vt-search-input');
    input.focus();
    input.addEventListener('input', function () {
      const term = input.value.trim();
      if (searchDebounceTimer) clearTimeout(searchDebounceTimer);
      searchDebounceTimer = setTimeout(function () {
        doSearch(term);
      }, 400);
    });
  }

  function doSearch(term) {
    const resultsEl = document.getElementById('vt-search-results');
    if (!resultsEl) return;

    if (term.length === 0) {
      resultsEl.innerHTML = '<div class="vt-search-empty">Start typing to search simulations...</div>';
      return;
    }

    resultsEl.innerHTML = '<div class="vt-search-empty">Searching...</div>';

    const encoded = encodeURIComponent('*' + term + '*');
    supaFetch('/rest/v1/simulations?published=eq.true&process_name=ilike.' + encoded + '&select=id,title,process_name,hub,step_count')
      .then(function (r) { return r.json(); })
      .then(function (results) {
        if (!resultsEl.isConnected) return;
        if (!results || results.length === 0) {
          resultsEl.innerHTML = '<div class="vt-search-empty">No simulations found for "' + term + '"</div>';
          return;
        }
        resultsEl.innerHTML = '';
        results.forEach(function (sim) {
          const item = document.createElement('div');
          item.className = 'vt-search-item';
          item.innerHTML = `
            <div class="vt-sim-info">
              <div class="vt-sim-title">${sim.title}</div>
              <div class="vt-sim-meta">${sim.process_name}${sim.hub ? ' · ' + sim.hub : ''} · ${sim.step_count} steps</div>
            </div>
            <button class="vt-start-btn" data-id="${sim.id}">▶ Start</button>
          `;
          item.querySelector('.vt-start-btn').addEventListener('click', function () {
            removeSearchModal();
            startSimulation(sim.id);
          });
          resultsEl.appendChild(item);
        });
      })
      .catch(function (err) {
        if (!resultsEl.isConnected) return;
        resultsEl.innerHTML = '<div class="vt-search-empty vt-search-error">Search failed. Please try again.</div>';
        console.error('[Training] Search error:', err);
      });
  }

  // ─── Launcher widget ─────────────────────────────────────────────────────────
  function injectLauncher() {
    if (document.getElementById('vt-launcher')) return;
    const btn = document.createElement('button');
    btn.id = 'vt-launcher';
    btn.textContent = '🎓 Training';
    btn.addEventListener('click', function () {
      if (document.getElementById('vt-search-modal')) {
        removeSearchModal();
      } else {
        showSearchModal();
      }
    });
    document.body.appendChild(btn);
  }

  // ─── Init ────────────────────────────────────────────────────────────────────
  function init() {
    injectLauncher();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();

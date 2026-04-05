/**
 * process-timer-tab.js - Captain Process Timer UI
 *
 * Injects search + active-process card into the Videos tab (no separate Timer tab).
 * Displays start/pause timestamps instead of a running clock for cleaner UX.
 */

class ProcessTimerTab {
  constructor() {
    this.syncInterval = null;
    this.initialized = false;
  }

  /**
   * Initialize and inject content into the Videos tab
   */
  async init() {
    console.log('[Timer Tab] Initializing...');

    await this.waitForSidebar();
    this.injectContent();
    this.attachEventListeners();
    this.startSyncLoop();

    this.initialized = true;
    console.log('[Timer Tab] ✅ Initialized');
  }

  /**
   * Wait for sidebar to be injected
   */
  async waitForSidebar() {
    return new Promise((resolve) => {
      const check = setInterval(() => {
        if (document.querySelector('.valmo-nav')) {
          clearInterval(check);
          resolve();
        }
      }, 100);
      setTimeout(() => { clearInterval(check); resolve(); }, 10000);
    });
  }

  /**
   * Inject search + active-process card into #videos-view (before the process list)
   */
  injectContent() {
    const videosView = document.getElementById('videos-view');
    if (!videosView) {
      console.warn('[Timer Tab] #videos-view not found');
      return;
    }

    if (document.getElementById('timer-integrated')) {
      console.log('[Timer Tab] Content already exists');
      return;
    }

    const wrapper = document.createElement('div');
    wrapper.id = 'timer-integrated';
    wrapper.innerHTML = this.getHTML();

    // Insert before the process list so search appears at the top
    const processList = document.getElementById('valmo-process-list');
    if (processList) {
      videosView.insertBefore(wrapper, processList);
    } else {
      videosView.prepend(wrapper);
    }

    console.log('[Timer Tab] ✅ Content injected into Videos tab');
  }

  /**
   * HTML for the search bar + active process card
   */
  getHTML() {
    const isOperator = window.captainTimerSystem?.sessionRole === 'operator';
    const completeLabel = isOperator ? "✓ I'm Done" : '✓ Complete';

    return `
      <!-- Process Search (always visible; Operators can watch videos but Start is hidden) -->
      <div class="timer-search-section" id="timer-search-section">
        <input
          type="text"
          id="timer-process-search"
          class="timer-search-input"
          placeholder="🔍 Search & start a process..."
        />
        <div id="timer-search-results" class="timer-search-results" style="display:none;"></div>
      </div>

      <!-- Active Process Card -->
      <div id="timer-active-card" class="timer-active-card" style="display:none;">
        <div class="timer-active-header">
          <span class="timer-active-icon">⚙️</span>
          <span class="timer-active-title" id="timer-active-process">—</span>
        </div>

        <div class="timer-timestamps" id="timer-timestamps">
          <div class="timer-ts-row">
            <span class="timer-ts-label">Started</span>
            <span class="timer-ts-value" id="timer-start-ts">—</span>
          </div>
          <div class="timer-ts-row" id="timer-pause-ts-row" style="display:none;">
            <span class="timer-ts-label">Paused at</span>
            <span class="timer-ts-value" id="timer-pause-ts">—</span>
          </div>
        </div>

        <div class="timer-status" id="timer-status">
          <span class="timer-status-badge running">● Running</span>
        </div>

        <div class="timer-actions">
          <button id="timer-pause-btn" class="timer-btn timer-btn-pause">⏸ Pause</button>
          <button id="timer-resume-btn" class="timer-btn timer-btn-resume" style="display:none;">▶️ Resume</button>
          <button id="timer-complete-btn" class="timer-btn timer-btn-complete">${completeLabel}</button>
        </div>

        <div class="timer-metrics">
          <div class="timer-metric">
            <span class="timer-metric-label">Pauses</span>
            <span class="timer-metric-value" id="timer-pause-count">0</span>
          </div>
          <div class="timer-metric">
            <span class="timer-metric-label">Queries</span>
            <span class="timer-metric-value" id="timer-query-count">0</span>
          </div>
        </div>
      </div>

      <!-- No Active Process placeholder -->
      <div id="timer-no-process" class="timer-no-process">
        ${isOperator
          ? `<div class="timer-empty-icon">🔗</div>
             <p>Waiting for Captain to start a process</p>
             <button id="timer-join-btn" class="timer-btn" style="background:linear-gradient(135deg,#F43397,#9747FF);color:#fff;margin-top:12px;width:100%;padding:12px;">
               Join Active Process
             </button>`
          : `<div class="timer-empty-icon">🎯</div>
             <p>Search above to start a process</p>`
        }
      </div>

      <!-- Personal Sequence (not shown for Operators) -->
      ${!isOperator ? `
      <div class="timer-sequence-section">
        <div class="timer-sequence-header">
          <span>📋 Your Sequence</span>
          <span id="timer-sequence-count" class="timer-sequence-count">0</span>
        </div>
        <div id="timer-sequence-list" class="timer-sequence-list">
          <p class="timer-sequence-empty">Your workflow sequence will appear here as you work</p>
        </div>
      </div>` : ''}
    `;
  }

  /**
   * Attach event listeners (no tab-switching needed — we're inside Videos tab)
   */
  attachEventListeners() {
    // Search input
    const searchInput = document.getElementById('timer-process-search');
    if (searchInput) {
      searchInput.addEventListener('input', (e) => this.handleSearch(e.target.value));
      searchInput.addEventListener('focus', () => {
        if (searchInput.value) {
          document.getElementById('timer-search-results').style.display = 'block';
        }
      });
    }

    // Pause button
    document.getElementById('timer-pause-btn')?.addEventListener('click', () => this.handlePause());

    // Resume button
    document.getElementById('timer-resume-btn')?.addEventListener('click', () => this.handleResume());

    // Complete button
    document.getElementById('timer-complete-btn')?.addEventListener('click', () => this.handleComplete());

    // Operator: Join button
    document.getElementById('timer-join-btn')?.addEventListener('click', () => this.handleJoin());

    // Click outside search to close results
    document.addEventListener('click', (e) => {
      const section = document.getElementById('timer-search-section');
      if (section && !section.contains(e.target)) {
        const results = document.getElementById('timer-search-results');
        if (results) results.style.display = 'none';
      }
    });

    console.log('[Timer Tab] ✅ Event listeners attached');
  }

  /**
   * Handle process search
   */
  handleSearch(query) {
    const resultsEl = document.getElementById('timer-search-results');
    if (!resultsEl) return;

    if (!query) {
      resultsEl.style.display = 'none';
      return;
    }

    const results = window.captainTimerSystem?.searchProcesses(query) || [];
    resultsEl.style.display = 'block';

    if (results.length === 0) {
      resultsEl.innerHTML = '<div class="timer-search-empty">No processes found</div>';
      return;
    }

    const isOperator = window.captainTimerSystem?.sessionRole === 'operator';
    resultsEl.innerHTML = results.slice(0, 5).map(proc => `
      <div class="timer-search-result">
        <div class="timer-search-result-name">${this.escape(proc.process_name)}</div>
        <div class="timer-search-result-meta">📂 ${this.escape(proc.url_module || 'General')}</div>
        <div class="timer-search-result-actions">
          ${proc.video_link ? `<button class="timer-result-watch-btn" data-link="${this.escape(proc.video_link)}">🎥 Watch</button>` : ''}
          ${!isOperator ? `<button class="timer-result-start-btn" data-process="${this.escape(proc.process_name)}">▶ Start</button>` : ''}
        </div>
      </div>
    `).join('');

    resultsEl.querySelectorAll('.timer-result-start-btn').forEach(btn => {
      btn.addEventListener('click', (e) => { e.stopPropagation(); this.startProcess(btn.dataset.process); });
    });
    resultsEl.querySelectorAll('.timer-result-watch-btn').forEach(btn => {
      btn.addEventListener('click', (e) => { e.stopPropagation(); window.open(btn.dataset.link, '_blank'); });
    });
  }

  /**
   * Start a process
   */
  async startProcess(processName) {
    const success = await window.captainTimerSystem?.startProcess(processName);

    if (!success) {
      alert('Please complete the current process first');
      return;
    }

    document.getElementById('timer-process-search').value = '';
    document.getElementById('timer-search-results').style.display = 'none';
    this.updateUI();

    console.log('[Timer Tab] Started:', processName);
  }

  /**
   * Handle pause button
   */
  async handlePause() {
    const pause = await window.captainTimerSystem?.pauseProcess('Paused to resolve issue');

    if (!pause) {
      alert('Failed to pause process');
      return;
    }

    if (window.captainPauseModal) {
      window.captainPauseModal.show(pause);
    }

    this.updateUI();
    console.log('[Timer Tab] Paused');
  }

  /**
   * Handle resume button (direct resume without pause modal)
   */
  async handleResume() {
    await window.captainTimerSystem?.resumeProcess('manual', true);
    this.updateUI();
    console.log('[Timer Tab] Resumed');
  }

  /**
   * Handle complete button
   */
  async handleComplete() {
    const isOperator = window.captainTimerSystem?.sessionRole === 'operator';
    const msg = isOperator
      ? "Mark your portion as complete?\nThe hub process continues until all operators finish."
      : 'Mark this process as complete?';
    if (!confirm(msg)) return;
    await window.captainTimerSystem?.stopProcess();
    this.updateUI();
    console.log('[Timer Tab] Completed');
  }

  /**
   * Operator: join the active hub process for this hub.
   */
  async handleJoin() {
    const joinBtn = document.getElementById('timer-join-btn');
    if (joinBtn) { joinBtn.textContent = 'Joining…'; joinBtn.disabled = true; }

    const success = await window.captainTimerSystem?.joinProcess();

    if (!success) {
      if (joinBtn) { joinBtn.textContent = 'Join Active Process'; joinBtn.disabled = false; }
      return;
    }

    this.updateUI();
    console.log('[Timer Tab] Operator joined process');
  }

  /**
   * Format a timestamp as "2:45 PM, 27 Mar"
   */
  formatTimestamp(ms) {
    return new Date(ms).toLocaleString('en-IN', {
      hour: '2-digit', minute: '2-digit',
      day: 'numeric', month: 'short'
    });
  }

  /**
   * Update UI based on current session state
   */
  updateUI() {
    const session = window.captainTimerSystem?.getCurrentSession();

    const activeCard = document.getElementById('timer-active-card');
    const noProcess = document.getElementById('timer-no-process');

    if (!activeCard || !noProcess) return;

    if (session) {
      activeCard.style.display = 'block';
      noProcess.style.display = 'none';

      document.getElementById('timer-active-process').textContent = session.process_name;

      // Timestamps instead of running clock
      document.getElementById('timer-start-ts').textContent = this.formatTimestamp(session.start_time);

      const pauseRow = document.getElementById('timer-pause-ts-row');
      if (!session.timer_running && session.pauses.length > 0) {
        const lastPause = session.pauses[session.pauses.length - 1];
        document.getElementById('timer-pause-ts').textContent = this.formatTimestamp(lastPause.pause_time);
        pauseRow.style.display = 'flex';
      } else {
        pauseRow.style.display = 'none';
      }

      // Status + buttons
      const statusEl = document.getElementById('timer-status');
      const pauseBtn = document.getElementById('timer-pause-btn');
      const resumeBtn = document.getElementById('timer-resume-btn');

      if (session.timer_running) {
        statusEl.innerHTML = '<span class="timer-status-badge running">● Running</span>';
        pauseBtn.style.display = 'inline-block';
        resumeBtn.style.display = 'none';
      } else {
        statusEl.innerHTML = '<span class="timer-status-badge paused">⏸ Paused</span>';
        pauseBtn.style.display = 'none';
        resumeBtn.style.display = 'inline-block';
      }

      document.getElementById('timer-pause-count').textContent = session.pauses.length;
      document.getElementById('timer-query-count').textContent = session.queries.length;

    } else {
      activeCard.style.display = 'none';
      noProcess.style.display = 'block';
    }

    this.updateSequenceDisplay();
  }

  /**
   * Update personal sequence display
   */
  updateSequenceDisplay() {
    const sequence = window.captainTimerSystem?.getPersonalSequence() || [];
    const listEl = document.getElementById('timer-sequence-list');
    const countEl = document.getElementById('timer-sequence-count');

    if (!listEl || !countEl) return;

    countEl.textContent = sequence.length;

    if (sequence.length === 0) {
      listEl.innerHTML = '<p class="timer-sequence-empty">Your workflow sequence will appear here as you work</p>';
      return;
    }

    listEl.innerHTML = sequence.map((proc, index) => `
      <div class="timer-sequence-item" data-process="${this.escape(proc)}">
        <span class="timer-sequence-number">${index + 1}</span>
        <span class="timer-sequence-name">${this.escape(proc)}</span>
      </div>
    `).join('');

    listEl.querySelectorAll('.timer-sequence-item').forEach(item => {
      item.addEventListener('click', () => this.startProcess(item.dataset.process));
    });
  }

  /**
   * Sync UI every 30s (no per-second ticking needed since we show timestamps)
   */
  startSyncLoop() {
    this.syncInterval = setInterval(() => this.updateUI(), 30000);
  }

  escape(str) {
    const div = document.createElement('div');
    div.textContent = str || '';
    return div.innerHTML;
  }
}

// Global instance
window.processTimerTab = new ProcessTimerTab();

// Auto-initialization is triggered by captain-timer-system.js after INIT_CAPTAIN_TIMER
console.log('[Timer Tab] Script loaded');

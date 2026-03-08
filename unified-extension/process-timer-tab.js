/**
 * process-timer-tab.js - Captain Process Timer UI
 * 
 * Adds "⏱️ Timer" tab to Captain sidebar with:
 * - Process search bar
 * - Active process card with live timer
 * - Pause/Resume/Complete buttons
 * - Personal sequence display
 */

class ProcessTimerTab {
  constructor() {
    this.timerInterval = null;
    this.initialized = false;
  }

  /**
   * Initialize and inject tab into sidebar
   */
  async init() {
    console.log('[Timer Tab] Initializing...');

    // Wait for sidebar to exist
    await this.waitForSidebar();

    // Inject tab button
    this.injectTabButton();

    // Inject tab content
    this.injectTabContent();

    // Attach event listeners
    this.attachEventListeners();

    // Start UI update loop
    this.startUIUpdateLoop();

    this.initialized = true;
    console.log('[Timer Tab] ✅ Initialized');
  }

  /**
   * Wait for sidebar to be injected
   */
  async waitForSidebar() {
    return new Promise((resolve) => {
      const check = setInterval(() => {
        const nav = document.querySelector('.valmo-nav');
        if (nav) {
          clearInterval(check);
          resolve();
        }
      }, 100);

      // Timeout after 10 seconds
      setTimeout(() => {
        clearInterval(check);
        resolve();
      }, 10000);
    });
  }

  /**
   * Inject tab button into navigation
   */
  injectTabButton() {
    const nav = document.querySelector('.valmo-nav');
    if (!nav) {
      console.warn('[Timer Tab] Navigation not found');
      return;
    }

    // Check if already exists
    if (document.querySelector('[data-tab="timer"]')) {
      console.log('[Timer Tab] Tab button already exists');
      return;
    }

    const timerBtn = document.createElement('button');
    timerBtn.className = 'valmo-nav-btn';
    timerBtn.dataset.tab = 'timer';
    timerBtn.innerHTML = '⏱️ Timer';

    // Insert after Videos tab
    const videosBtn = document.querySelector('[data-tab="videos"]');
    if (videosBtn) {
      videosBtn.insertAdjacentElement('afterend', timerBtn);
    } else {
      nav.appendChild(timerBtn);
    }

    console.log('[Timer Tab] ✅ Tab button injected');
  }

  /**
   * Inject tab content area
   */
  injectTabContent() {
    const content = document.querySelector('.valmo-content');
    if (!content) {
      console.warn('[Timer Tab] Content area not found');
      return;
    }

    // Check if already exists
    if (document.getElementById('timer-view')) {
      console.log('[Timer Tab] Tab content already exists');
      return;
    }

    const timerView = document.createElement('div');
    timerView.id = 'timer-view';
    timerView.className = 'valmo-view';
    timerView.innerHTML = this.getTabHTML();

    content.appendChild(timerView);

    console.log('[Timer Tab] ✅ Tab content injected');
  }

  /**
   * Get tab HTML
   */
  getTabHTML() {
    return `
      <!-- Search Bar -->
      <div class="timer-search-section">
        <input 
          type="text" 
          id="timer-process-search" 
          class="timer-search-input" 
          placeholder="🔍 Search processes..."
        />
        <div id="timer-search-results" class="timer-search-results"></div>
      </div>

      <!-- Active Process Card -->
      <div id="timer-active-card" class="timer-active-card" style="display: none;">
        <div class="timer-active-header">
          <span class="timer-active-icon">⏱️</span>
          <span class="timer-active-title" id="timer-active-process">No Process</span>
        </div>
        
        <div class="timer-display" id="timer-display">00:00</div>
        
        <div class="timer-status" id="timer-status">
          <span class="timer-status-badge running">● Running</span>
        </div>

        <div class="timer-actions">
          <button id="timer-pause-btn" class="timer-btn timer-btn-pause">
            ⏸ Pause
          </button>
          <button id="timer-resume-btn" class="timer-btn timer-btn-resume" style="display: none;">
            ▶️ Resume
          </button>
          <button id="timer-complete-btn" class="timer-btn timer-btn-complete">
            ✓ Complete
          </button>
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

      <!-- No Active Process -->
      <div id="timer-no-process" class="timer-no-process">
        <div class="timer-empty-icon">🎯</div>
        <h3>No Active Process</h3>
        <p>Search and start a process above</p>
      </div>

      <!-- Personal Sequence -->
      <div class="timer-sequence-section">
        <div class="timer-sequence-header">
          <span>📋 Your Sequence</span>
          <span id="timer-sequence-count" class="timer-sequence-count">0</span>
        </div>
        <div id="timer-sequence-list" class="timer-sequence-list">
          <p class="timer-sequence-empty">Your workflow sequence will appear here as you work</p>
        </div>
      </div>
    `;
  }

  /**
   * Attach event listeners
   */
  attachEventListeners() {
    // Tab switching
    const timerTabBtn = document.querySelector('[data-tab="timer"]');
    if (timerTabBtn) {
      timerTabBtn.addEventListener('click', () => {
        document.querySelectorAll('.valmo-nav-btn').forEach(b => b.classList.remove('active'));
        document.querySelectorAll('.valmo-view').forEach(v => v.classList.remove('active'));

        timerTabBtn.classList.add('active');
        document.getElementById('timer-view').classList.add('active');
      });
    }

    // Search input
    const searchInput = document.getElementById('timer-process-search');
    if (searchInput) {
      searchInput.addEventListener('input', (e) => this.handleSearch(e.target.value));
      searchInput.addEventListener('focus', () => {
        document.getElementById('timer-search-results').style.display = 'block';
      });
    }

    // Pause button
    const pauseBtn = document.getElementById('timer-pause-btn');
    if (pauseBtn) {
      pauseBtn.addEventListener('click', () => this.handlePause());
    }

    // Resume button
    const resumeBtn = document.getElementById('timer-resume-btn');
    if (resumeBtn) {
      resumeBtn.addEventListener('click', () => this.handleResume());
    }

    // Complete button
    const completeBtn = document.getElementById('timer-complete-btn');
    if (completeBtn) {
      completeBtn.addEventListener('click', () => this.handleComplete());
    }

    // Click outside search to close results
    document.addEventListener('click', (e) => {
      const searchSection = document.querySelector('.timer-search-section');
      if (searchSection && !searchSection.contains(e.target)) {
        document.getElementById('timer-search-results').style.display = 'none';
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
      resultsEl.innerHTML = '<div class="timer-search-empty">Type to search processes...</div>';
      return;
    }

    const results = window.captainTimerSystem.searchProcesses(query);

    if (results.length === 0) {
      resultsEl.innerHTML = '<div class="timer-search-empty">No processes found</div>';
      return;
    }

    resultsEl.innerHTML = results.slice(0, 5).map(proc => `
      <div class="timer-search-result" data-process="${this.escape(proc.process_name)}">
        <div class="timer-search-result-name">${this.escape(proc.process_name)}</div>
        <div class="timer-search-result-meta">📂 ${this.escape(proc.url_module || 'General')}</div>
      </div>
    `).join('');

    // Add click handlers
    resultsEl.querySelectorAll('.timer-search-result').forEach(result => {
      result.addEventListener('click', () => {
        const processName = result.dataset.process;
        this.startProcess(processName);
      });
    });

    resultsEl.style.display = 'block';
  }

  /**
   * Start a process
   */
  async startProcess(processName) {
    const success = await window.captainTimerSystem.startProcess(processName);

    if (!success) {
      alert('Please complete the current process first');
      return;
    }

    // Clear search
    document.getElementById('timer-process-search').value = '';
    document.getElementById('timer-search-results').style.display = 'none';

    // Update UI
    this.updateUI();

    console.log('[Timer Tab] Started:', processName);
  }

  /**
   * Handle pause button
   */
  async handlePause() {
    // Pause the timer
    const pause = await window.captainTimerSystem.pauseProcess('Paused to resolve issue');

    if (!pause) {
      alert('Failed to pause process');
      return;
    }

    // Show pause modal
    if (window.captainPauseModal) {
      window.captainPauseModal.show(pause);
    } else {
      console.error('[Timer Tab] Pause modal not loaded');
      
      // Fallback: show simple prompt
      const reason = prompt('Why are you pausing?\n(This helps track knowledge gaps)');
      if (reason) {
        // Update pause reason
        pause.reason = reason;
      }
    }

    // Update UI
    this.updateUI();

    console.log('[Timer Tab] Paused');
  }

  /**
   * Handle resume button
   */
  async handleResume() {
    // For now, simple resume
    // TODO: Integrate with pause modal resolution (Phase 3)
    await window.captainTimerSystem.resumeProcess('manual', true);

    // Update UI
    this.updateUI();

    console.log('[Timer Tab] Resumed');
  }

  /**
   * Handle complete button
   */
  async handleComplete() {
    const confirmed = confirm('Mark this process as complete?');

    if (!confirmed) return;

    await window.captainTimerSystem.stopProcess();

    // Update UI
    this.updateUI();

    console.log('[Timer Tab] Completed');
  }

  /**
   * Update UI based on current session state
   */
  updateUI() {
    const session = window.captainTimerSystem.getCurrentSession();

    const activeCard = document.getElementById('timer-active-card');
    const noProcess = document.getElementById('timer-no-process');

    if (session) {
      // Show active card
      activeCard.style.display = 'block';
      noProcess.style.display = 'none';

      // Update process name
      document.getElementById('timer-active-process').textContent = session.process_name;

      // Update timer display
      const elapsed = window.captainTimerSystem.getElapsedTime();
      document.getElementById('timer-display').textContent = 
        window.captainTimerSystem.formatTime(elapsed);

      // Update status
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

      // Update metrics
      document.getElementById('timer-pause-count').textContent = session.pauses.length;
      document.getElementById('timer-query-count').textContent = session.queries.length;

    } else {
      // No active session
      activeCard.style.display = 'none';
      noProcess.style.display = 'block';
    }

    // Update personal sequence
    this.updateSequenceDisplay();
  }

  /**
   * Update personal sequence display
   */
  updateSequenceDisplay() {
    const sequence = window.captainTimerSystem.getPersonalSequence();
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

    // Add click handlers
    listEl.querySelectorAll('.timer-sequence-item').forEach(item => {
      item.addEventListener('click', () => {
        const processName = item.dataset.process;
        this.startProcess(processName);
      });
    });
  }

  /**
   * Start UI update loop
   */
  startUIUpdateLoop() {
    // Update UI every second
    this.timerInterval = setInterval(() => {
      const session = window.captainTimerSystem.getCurrentSession();

      if (session && session.timer_running) {
        const elapsed = window.captainTimerSystem.getElapsedTime();
        const displayEl = document.getElementById('timer-display');
        if (displayEl) {
          displayEl.textContent = window.captainTimerSystem.formatTime(elapsed);
        }
      }
    }, 1000);
  }

  /**
   * Escape HTML
   */
  escape(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }
}

// Global instance
window.processTimerTab = new ProcessTimerTab();

// Auto-initialize is handled by content.js
// This file just provides the ProcessTimerTab class

console.log('[Timer Tab] Script loaded');
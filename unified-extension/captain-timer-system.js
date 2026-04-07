/**
 * captain-timer-system.js - Simple Process Timer & Sequence Tracker
 * 
 * Simplified approach:
 * - Search bar to find and start any process
 * - Automatically tracks sequence per captain
 * - Next process notification after completion
 * - Full metrics tracking (pKRT, PCT, iPER)
 */

/**
 * Storage helper - uses localStorage instead of chrome.storage
 * (because this script runs in page context)
 */
const timerStorage = {
  async get(keys) {
    const result = {};
    keys.forEach(key => {
      const value = localStorage.getItem(key);
      if (value) {
        try {
          result[key] = JSON.parse(value);
        } catch {
          result[key] = value;
        }
      }
    });
    return result;
  },
  
  async set(items) {
    Object.keys(items).forEach(key => {
      localStorage.setItem(key, JSON.stringify(items[key]));
    });
  },

  async remove(keys) {
    keys.forEach(key => {
      localStorage.removeItem(key);
    });
  }
};

class CaptainTimerSystem {
  constructor() {
    this.currentSession = null;
    this.allProcesses = [];
    this.processFrequency = {}; // { processName: { count, lastUsed } } — decay-scored
    this.userEmail = null;
    this.hubType = 'LM';           // 'FM' | 'LM'
    this.sessionRole = 'captain';  // 'captain' | 'operator'
    this.expectedOperators = 1;
    this.hubProcessId = null;      // set when FM Captain starts or Operator joins
    this.hubPollInterval = null;   // polls hub_process_executions for FM Captain
    this.sbUrl = '';
    this.sbKey = '';
    this.initialized = false;
  }

  /**
   * Initialize timer system for captain
   */
  async init(userEmail, processes = [], sequenceData = {}, hubCode = null, savedHistory = [], savedActiveSession = null, hubType = 'LM', sessionRole = 'captain', expectedOperators = 1, sbUrl = '', sbKey = '') {
    this.userEmail         = userEmail;
    this.hubCode           = hubCode           || null;
    this.hubType           = hubType           || 'LM';
    this.sessionRole       = sessionRole       || 'captain';
    this.expectedOperators = expectedOperators || 1;
    this.sbUrl             = sbUrl             || '';
    this.sbKey             = sbKey             || '';

    console.log('[Captain Timer] Initializing for:', userEmail);

    // Use provided processes (from content script) or load them
    if (processes && processes.length > 0) {
      this.allProcesses = processes;
      console.log('[Captain Timer] Loaded', this.allProcesses.length, 'processes (from content script)');
    } else {
      await this.loadAllProcesses();
    }

    // Load captain's personal sequence from chrome.storage.local data (passed via init message)
    this.loadPersonalSequenceFromData(sequenceData);

    // Restore session history to localStorage if missing (e.g. new tab, cleared storage)
    const historyKey = `captain_session_history_${userEmail}`;
    if (!localStorage.getItem(historyKey) && savedHistory && savedHistory.length > 0) {
      localStorage.setItem(historyKey, JSON.stringify(savedHistory));
      console.log('[Captain Timer] Restored', savedHistory.length, 'sessions from chrome.storage');
    }

    // Restore active session to localStorage if missing
    if (!localStorage.getItem('captain_current_session') && savedActiveSession && savedActiveSession.captain_email === userEmail) {
      localStorage.setItem('captain_current_session', JSON.stringify(savedActiveSession));
      console.log('[Captain Timer] Restored active session from chrome.storage:', savedActiveSession.process_name);
    }

    // Check for existing active session
    await this.restoreActiveSession();

    this.initialized = true;
    console.log('[Captain Timer] ✅ Initialized');
  }

  /**
   * Load all available processes from Training_Videos
   */
  async loadAllProcesses() {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage(
        { type: 'GET_ALL_PROCESSES' },
        (response) => {
          if (response && response.processes) {
            this.allProcesses = response.processes;
            console.log(`[Captain Timer] Loaded ${this.allProcesses.length} processes`);
          } else {
            console.warn('[Captain Timer] No processes loaded');
            this.allProcesses = [];
          }
          resolve();
        }
      );
    });
  }

  /**
   * Load captain's personal sequence from the data passed in the INIT message
   * (which was pre-loaded from chrome.storage.local by the content script).
   */
  loadPersonalSequenceFromData(data) {
    if (!data || typeof data !== 'object') {
      this.processFrequency = {};
      console.log('[Captain Timer] No saved sequence — starting fresh');
      return;
    }
    if (Array.isArray(data)) {
      // Migrate old array format
      const now = Date.now();
      this.processFrequency = {};
      data.forEach((name, i) => {
        this.processFrequency[name] = { count: data.length - i, lastUsed: now - i * 86400000 };
      });
      console.log(`[Captain Timer] Migrated old sequence: ${Object.keys(this.processFrequency).length} processes`);
    } else {
      this.processFrequency = data;
      console.log(`[Captain Timer] Loaded sequence from chrome.storage: ${Object.keys(this.processFrequency).length} processes`);
    }
  }

  /**
   * Save captain's personal sequence via postMessage bridge.
   * Content script receives this and saves to chrome.storage.local (persistent).
   */
  savePersonalSequence() {
    // Write to localStorage synchronously first — survives hard refresh guaranteed
    const seqKey = `captain_sequence_${this.userEmail}`;
    try { localStorage.setItem(seqKey, JSON.stringify(this.processFrequency)); } catch (e) {}

    // Also bridge to chrome.storage.local via content script
    window.postMessage({
      type: 'CAPTAIN_SAVE_SEQUENCE',
      email: this.userEmail,
      data: this.processFrequency
    }, '*');
  }

  /**
   * Restore active session if exists
   */
  async restoreActiveSession() {
    const result = await timerStorage.get(['captain_current_session']);

    if (result.captain_current_session && result.captain_current_session.captain_email === this.userEmail) {
      const session = result.captain_current_session;
      const ageMs = Date.now() - session.start_time;
      const eightHours = 8 * 60 * 60 * 1000;

      if (ageMs > eightHours) {
        // Stale session from a previous day/shift — discard it
        console.log('[Captain Timer] Discarding stale session:', session.process_name);
        await timerStorage.remove(['captain_current_session']);
        return;
      }

      // Always restore as paused — hard refresh interrupts the timer.
      // User must explicitly hit Resume to continue.
      session.timer_running = false;
      await timerStorage.set({ captain_current_session: session });

      this.currentSession = session;

      // Restore hub process ID and restart completion poll for FM Captain
      if (session.hub_process_id) {
        this.hubProcessId = session.hub_process_id;
        if (this.hubType === 'FM' && this.sessionRole === 'captain') {
          this._startHubCompletionPolling();
          console.log('[Captain Timer] Restarted hub completion poll after refresh');
        }
      }

      console.log('[Captain Timer] Restored session (paused on refresh):', this.currentSession.process_name);
    }
  }

  /**
   * Search processes by name
   */
  searchProcesses(query) {
    if (!query) return this.allProcesses;
    
    const lowerQuery = query.toLowerCase();
    return this.allProcesses.filter(p => 
      p.process_name.toLowerCase().includes(lowerQuery)
    );
  }

  /**
   * Get all processes (for displaying in UI)
   */
  getAllProcesses() {
    return this.allProcesses;
  }

  /**
   * Get next suggested process based on decay-sorted sequence
   */
  getNextProcess() {
    const sequence = this.getPersonalSequence();
    if (sequence.length === 0) return null;

    const lastCompleted = this.getLastCompletedProcessSync();
    if (!lastCompleted) return sequence[0];

    const lastIndex = sequence.indexOf(lastCompleted);
    if (lastIndex === -1 || lastIndex === sequence.length - 1) return sequence[0];
    return sequence[lastIndex + 1];
  }

  /**
   * Get last completed process name synchronously from localStorage
   */
  getLastCompletedProcessSync() {
    try {
      const historyKey = `captain_session_history_${this.userEmail}`;
      const stored = localStorage.getItem(historyKey);
      if (stored) {
        const history = JSON.parse(stored);
        if (history.length > 0) return history[0].process_name;
      }
    } catch (e) {}
    return null;
  }

  /**
   * Start a process
   */
  async startProcess(processName, { fromAutoDetect = false } = {}) {
    if (!this.hubCode) {
      this._showToast('⚠️ No hub code set. Log out and log back in — your hub code must be configured before tracking processes.', '#ef4444');
      console.warn('[Captain Timer] startProcess blocked — no hub_code set');
      return false;
    }

    if (this.sessionRole === 'operator' && !fromAutoDetect) {
      this._showToast('⚠️ Operators use "Join Active Process" — you cannot start a process directly.', '#ef4444');
      console.warn('[Captain Timer] startProcess blocked — operator must use joinProcess()');
      return false;
    }

    if (this.currentSession) {
      console.warn('[Captain Timer] Already tracking a process');
      return false;
    }

    // For FM Captain: create a hub process execution in Supabase
    let hubProcessId = null;
    if (this.hubType === 'FM' && this.sessionRole === 'captain') {
      hubProcessId = await this._createHubExecution(processName);
      if (!hubProcessId) {
        this._showToast('⚠️ Could not create hub process. Check your connection and try again.', '#ef4444');
        return false;
      }
    }

    const session = {
      session_id:    this.generateUUID(),
      captain_email: this.userEmail,
      hub_code:      this.hubCode || null,
      process_name:  processName,
      hub_process_id: hubProcessId,
      session_role:  this.sessionRole,
      start_time:    Date.now(),
      end_time:      null,
      pauses:        [],
      queries:       [],
      errors:        [],
      timer_running: true,
      elapsed_time:  0
    };

    session.fromAutoDetect = fromAutoDetect;
    this.currentSession = session;
    if (hubProcessId) this.hubProcessId = hubProcessId;
    await this.saveCurrentSession();

    // Update sequence
    await this.updateSequence(processName);

    // Start timer
    this.startTimer();

    // FM Captain polls every 15s for operator completion
    if (this.hubType === 'FM' && this.sessionRole === 'captain' && hubProcessId) {
      this._startHubCompletionPolling();
    }

    // Log analytics
    if (typeof analytics !== 'undefined') {
      analytics.log('process_started', {
        process: processName,
        captain: this.userEmail,
        timestamp: session.start_time
      });
    }

    console.log('[Captain Timer] ✅ Started:', processName);
    return true;
  }

  /**
   * Update captain's frequency map (called each time a process is started)
   */
  async updateSequence(processName) {
    const now = Date.now();
    if (!this.processFrequency[processName]) {
      this.processFrequency[processName] = { count: 0, lastUsed: now };
    }
    this.processFrequency[processName].count += 1;
    this.processFrequency[processName].lastUsed = now;
    this.savePersonalSequence();
    console.log('[Captain Timer] Updated frequency for:', processName);
  }

  /**
   * Pause process with reason
   */
  async pauseProcess(reason) {
    if (!this.currentSession || !this.currentSession.timer_running) {
      console.warn('[Captain Timer] No active session to pause');
      return null;
    }

    const pause = {
      pause_id: this.generateUUID(),
      pause_time: Date.now(),
      resume_time: null,
      pkrt: null, // Will be calculated on resume
      reason: reason,
      resolution_method: null, // 'jarvis' or 'video'
      resolution_successful: null,
      chat_transcript: [],
      video_watched: null
    };

    this.currentSession.pauses.push(pause);
    this.currentSession.timer_running = false;
    
    // Stop timer
    this.stopTimer();

    await this.saveCurrentSession();

    // Log analytics
    if (typeof analytics !== 'undefined') {
      analytics.log('process_paused', {
        process: this.currentSession.process_name,
        reason: reason,
        pause_count: this.currentSession.pauses.length,
        timestamp: pause.pause_time
      });
    }

    console.log('[Captain Timer] ⏸ Paused:', reason);
    return pause;
  }

  /**
   * Resume process after resolution
   */
  async resumeProcess(resolutionMethod, resolutionSuccessful, additionalData = {}) {
    if (!this.currentSession || this.currentSession.timer_running) {
      console.warn('[Captain Timer] No paused session to resume');
      return false;
    }

    // Get current pause
    const currentPause = this.currentSession.pauses[this.currentSession.pauses.length - 1];
    
    if (!currentPause || currentPause.resume_time) {
      console.warn('[Captain Timer] No active pause found');
      return false;
    }

    // Complete pause data
    currentPause.resume_time = Date.now();
    currentPause.pkrt = Math.floor((currentPause.resume_time - currentPause.pause_time) / 1000); // seconds
    currentPause.resolution_method = resolutionMethod;
    currentPause.resolution_successful = resolutionSuccessful;
    
    // Add chat transcript or video info
    if (resolutionMethod === 'jarvis' && additionalData.chatTranscript) {
      currentPause.chat_transcript = additionalData.chatTranscript;
    } else if (resolutionMethod === 'video' && additionalData.videoWatched) {
      currentPause.video_watched = additionalData.videoWatched;
    }

    // Resume timer
    this.currentSession.timer_running = true;
    this.startTimer();

    await this.saveCurrentSession();

    // Log analytics
    if (typeof analytics !== 'undefined') {
      analytics.log('process_resumed', {
        process: this.currentSession.process_name,
        pkrt: currentPause.pkrt,
        resolution_method: resolutionMethod,
        successful: resolutionSuccessful,
        timestamp: currentPause.resume_time
      });
    }

    console.log('[Captain Timer] ▶ Resumed. pKRT:', currentPause.pkrt, 'seconds');
    return true;
  }

  /**
   * Add query/question to current session
   */
  addQuery(query, response, satisfied) {
    if (!this.currentSession) return;

    const queryRecord = {
      query: query,
      response: response,
      satisfied: satisfied,
      timestamp: Date.now()
    };

    this.currentSession.queries.push(queryRecord);
    this.saveCurrentSession();

    // Log analytics
    if (typeof analytics !== 'undefined') {
      analytics.log('jarvis_query', {
        process: this.currentSession.process_name,
        query: query,
        satisfied: satisfied,
        query_count: this.currentSession.queries.length
      });
    }
  }

  /**
   * Add error to current session
   */
  addError(errorType, errorDetails) {
    if (!this.currentSession) return;

    const errorRecord = {
      error_time: Date.now(),
      error_type: errorType,
      error_details: errorDetails,
      flagged_by: 'system'
    };

    this.currentSession.errors.push(errorRecord);
    this.saveCurrentSession();
  }

  /**
   * Stop and complete process
   */
  async stopProcess() {
    if (!this.currentSession) {
      console.warn('[Captain Timer] No active session to stop');
      return null;
    }

    // Stop timer
    this.stopTimer();

    // Complete session
    this.currentSession.end_time = Date.now();
    this.currentSession.timer_running = false;

    // Calculate metrics
    const metrics = this.calculateSessionMetrics();

    // Save to history
    await this.saveToHistory(metrics);

    // Log analytics
    if (typeof analytics !== 'undefined') {
      analytics.log('process_completed', {
        process: this.currentSession.process_name,
        pct: metrics.pct,
        pkrt: metrics.total_pkrt,
        pauses: this.currentSession.pauses.length,
        queries: this.currentSession.queries.length,
        errors: this.currentSession.errors.length
      });
    }

    console.log('[Captain Timer] ✅ Completed:', this.currentSession.process_name);
    console.log('[Captain Timer] Metrics:', metrics);

    const completedSession = this.currentSession;
    this.currentSession = null;

    // Clear storage
    await timerStorage.remove(['captain_current_session']);

    // Clear FM Captain poll (manual stop or LM hub)
    if (this.hubPollInterval) {
      clearInterval(this.hubPollInterval);
      this.hubPollInterval = null;
    }

    // Sync completed session + per-pause detail to Supabase via content script bridge
    window.postMessage({
      type: 'SUPABASE_CAPTAIN_SESSION',
      data: {
        session_id:     completedSession.session_id,
        email:          completedSession.captain_email,
        hub_code:       completedSession.hub_code      || null,
        hub_process_id: completedSession.hub_process_id || null,
        session_role:   completedSession.session_role   || 'captain',
        process_name:   completedSession.process_name,
        pct:            metrics.pct,
        total_pkrt:     metrics.total_pkrt,
        pause_count:    metrics.pause_count,
        query_count:    metrics.query_count,
        error_count:    metrics.error_count,
        started_at:     new Date(completedSession.start_time).toISOString(),
        completed_at:   new Date(completedSession.end_time).toISOString(),
        pauses:         completedSession.pauses
      }
    }, '*');

    // FM Operator: notify hub after the session write has been dispatched
    // Fire-and-forget — hub notification is best-effort, never blocks UI
    if (this.hubType === 'FM' && this.sessionRole === 'operator' && this.hubProcessId) {
      this._notifyOperatorDone(metrics.pct);
    }

    // Show next process notification
    this.showNextProcessNotification();

    return completedSession;
  }

  /**
   * Show notification for next process
   */
  showNextProcessNotification() {
    const nextProcess = this.getNextProcess();
    
    if (!nextProcess) {
      console.log('[Captain Timer] No next process to suggest');
      return;
    }

    // Show animated notification
    const notification = document.createElement('div');
    notification.className = 'captain-next-process-notification';
    notification.innerHTML = `
      <div class="captain-next-process-content">
        <div class="captain-next-process-icon">🎯</div>
        <div class="captain-next-process-text">
          <strong>Next Process Ready</strong>
          <span>${nextProcess}</span>
        </div>
        <button class="captain-next-process-start" data-process="${nextProcess}">
          ▶️ Start Now
        </button>
        <button class="captain-next-process-dismiss">✕</button>
      </div>
    `;

    document.body.appendChild(notification);

    // Animate in
    setTimeout(() => notification.classList.add('visible'), 100);

    // Event listeners
    notification.querySelector('.captain-next-process-start').addEventListener('click', async () => {
      await this.startProcess(nextProcess);
      notification.remove();
    });

    notification.querySelector('.captain-next-process-dismiss').addEventListener('click', () => {
      notification.classList.remove('visible');
      setTimeout(() => notification.remove(), 300);
    });

    // Auto-dismiss after 30 seconds
    setTimeout(() => {
      if (document.body.contains(notification)) {
        notification.classList.remove('visible');
        setTimeout(() => notification.remove(), 300);
      }
    }, 30000);
  }

  /**
   * Calculate session metrics
   */
  calculateSessionMetrics() {
    const pct = Math.floor((this.currentSession.end_time - this.currentSession.start_time) / 1000); // seconds
    
    // Calculate total pKRT (sum of all pause durations)
    const total_pkrt = this.currentSession.pauses.reduce((sum, pause) => {
      return sum + (pause.pkrt || 0);
    }, 0);

    // Unobserved time (working time)
    const unobserved_time = pct - total_pkrt;

    // Average pKRT per pause
    const avg_pkrt = this.currentSession.pauses.length > 0 
      ? Math.floor(total_pkrt / this.currentSession.pauses.length)
      : 0;

    // iPER (In-Process Error Rate)
    const iper = this.currentSession.errors.length;

    return {
      pct: pct,
      total_pkrt: total_pkrt,
      avg_pkrt: avg_pkrt,
      unobserved_time: unobserved_time,
      pause_count: this.currentSession.pauses.length,
      query_count: this.currentSession.queries.length,
      error_count: this.currentSession.errors.length,
      iper: iper
    };
  }

  /**
   * Save completed session to history
   */
  async saveToHistory(metrics) {
    const historyEntry = {
      ...this.currentSession,
      metrics: metrics,
      completed_at: Date.now()
    };

    // Get existing history
    const historyKey = `captain_session_history_${this.userEmail}`;
    const result = await timerStorage.get([historyKey]);
    const history = result[historyKey] || [];

    // Add new entry
    history.unshift(historyEntry);

    // Keep last 100 sessions
    if (history.length > 100) {
      history.splice(100);
    }

    // Save back
    await timerStorage.set({
      [historyKey]: history
    });

    // Bridge to chrome.storage.local so history survives page reload / new tabs
    window.postMessage({
      type:  'CAPTAIN_SAVE_HISTORY',
      email: this.userEmail,
      data:  history
    }, '*');

    console.log('[Captain Timer] 💾 Saved to history');
  }

  /**
   * Timer logic
   */
  startTimer() {
    if (this.timerInterval) {
      clearInterval(this.timerInterval);
    }

    this.timerInterval = setInterval(() => {
      if (this.currentSession && this.currentSession.timer_running) {
        this.currentSession.elapsed_time++;
        
        // Update UI if callback exists
        if (this.onTimerTick) {
          this.onTimerTick(this.currentSession.elapsed_time);
        }
      }
    }, 1000);
  }

  stopTimer() {
    if (this.timerInterval) {
      clearInterval(this.timerInterval);
      this.timerInterval = null;
    }
  }

  /**
   * Get current elapsed time
   */
  getElapsedTime() {
    if (!this.currentSession) return 0;
    return this.currentSession.elapsed_time;
  }

  /**
   * Format time for display (MM:SS or HH:MM:SS)
   */
  formatTime(seconds) {
    const hrs = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;

    if (hrs > 0) {
      return `${hrs.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    }
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  }

  /**
   * Save current session to storage
   */
  async saveCurrentSession() {
    if (!this.currentSession) return;

    await timerStorage.set({
      captain_current_session: this.currentSession
    });

    // Bridge to chrome.storage.local so active session survives page reload
    window.postMessage({
      type:  'CAPTAIN_SAVE_CURRENT_SESSION',
      email: this.userEmail,
      data:  this.currentSession
    }, '*');
  }

  /**
   * Show a brief toast notification inside the page
   */
  _showToast(message, color = '#1a1a2e') {
    const id = 'captain-timer-toast';
    const existing = document.getElementById(id);
    if (existing) existing.remove();
    const toast = document.createElement('div');
    toast.id = id;
    toast.style.cssText = `position:fixed;bottom:88px;right:20px;background:${color};color:#fff;padding:12px 16px;border-radius:10px;font-size:13px;font-weight:600;z-index:2147483647;max-width:300px;box-shadow:0 4px 16px rgba(0,0,0,0.3);line-height:1.4`;
    toast.textContent = message;
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 6000);
  }

  // ─── Hub Process Execution (FM hubs) ─────────────────────────────────────────

  /**
   * FM Operator: find the active hub process for this hub and join it.
   * Sets hub_process_id on the new session.
   */
  async joinProcess() {
    if (!this.hubCode) {
      this._showToast('⚠️ No hub code set. Log out and log back in.', '#ef4444');
      return false;
    }
    if (this.currentSession) {
      this._showToast('You already have an active process running.', '#888');
      return false;
    }

    const execution = await this._fetchActiveHubExecution();
    if (!execution) {
      this._showToast('No active process found for your hub. Wait for the Captain to start one.', '#888');
      return false;
    }

    const session = {
      session_id:     this.generateUUID(),
      captain_email:  this.userEmail,
      hub_code:       this.hubCode || null,
      process_name:   execution.process_name,
      hub_process_id: execution.id,
      session_role:   'operator',
      start_time:     Date.now(),
      end_time:       null,
      pauses:         [],
      queries:        [],
      errors:         [],
      timer_running:  true,
      elapsed_time:   0
    };

    this.currentSession = session;
    this.hubProcessId   = execution.id;
    await this.saveCurrentSession();
    await this.updateSequence(execution.process_name);
    this.startTimer();

    this._showToast(`Joined: ${execution.process_name}`, '#22c55e');
    console.log('[Captain Timer] Operator joined hub process:', execution.process_name, execution.id);
    return true;
  }

  /**
   * FM Captain: auto-complete hub process using aggregated PCT from operators.
   * Called by the completion poll when all operators are done.
   */
  async autoCompleteHubProcess(aggregated_pct) {
    if (!this.currentSession || this.sessionRole !== 'captain') return;

    console.log('[Captain Timer] Auto-completing hub process. Aggregated PCT:', aggregated_pct);

    if (this.hubPollInterval) {
      clearInterval(this.hubPollInterval);
      this.hubPollInterval = null;
    }

    this.stopTimer();
    this.currentSession.end_time      = Date.now();
    this.currentSession.timer_running = false;

    const metrics = this.calculateSessionMetrics();
    if (aggregated_pct && aggregated_pct > 0) metrics.pct = aggregated_pct;

    await this.saveToHistory(metrics);

    const completedSession = this.currentSession;
    this.currentSession    = null;
    this.hubProcessId      = null;
    await timerStorage.remove(['captain_current_session']);

    window.postMessage({
      type: 'SUPABASE_CAPTAIN_SESSION',
      data: {
        session_id:     completedSession.session_id,
        email:          completedSession.captain_email,
        hub_code:       completedSession.hub_code       || null,
        hub_process_id: completedSession.hub_process_id || null,
        session_role:   'captain',
        process_name:   completedSession.process_name,
        pct:            metrics.pct,
        total_pkrt:     metrics.total_pkrt,
        pause_count:    metrics.pause_count,
        query_count:    metrics.query_count,
        error_count:    metrics.error_count,
        started_at:     new Date(completedSession.start_time).toISOString(),
        completed_at:   new Date(completedSession.end_time).toISOString(),
        pauses:         completedSession.pauses
      }
    }, '*');

    this._showToast('All operators done — hub process complete!', '#22c55e');
    this.showNextProcessNotification();

    if (window.processTimerTab) window.processTimerTab.updateUI();
  }

  /**
   * FM Captain: create a hub_process_executions row in Supabase.
   * Returns the new row's UUID, or null on failure.
   */
  async _createHubExecution(processName) {
    if (!this.sbUrl || !this.sbKey) return null;
    try {
      const res = await fetch(`${this.sbUrl}/rest/v1/hub_process_executions`, {
        method: 'POST',
        headers: {
          'Content-Type':  'application/json',
          'apikey':        this.sbKey,
          'Authorization': `Bearer ${this.sbKey}`,
          'Prefer':        'return=representation'
        },
        body: JSON.stringify({
          hub_code:           this.hubCode,
          process_name:       processName,
          captain_email:      this.userEmail,
          expected_operators: this.expectedOperators,
          started_at:         new Date().toISOString()
        })
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
      const rows = await res.json();
      return rows[0]?.id || null;
    } catch (e) {
      console.error('[Captain Timer] _createHubExecution error:', e.message);
      return null;
    }
  }

  /**
   * FM Operator: fetch the most recent uncompleted hub execution for this hub.
   */
  async _fetchActiveHubExecution() {
    if (!this.sbUrl || !this.sbKey || !this.hubCode) return null;
    try {
      const url = `${this.sbUrl}/rest/v1/hub_process_executions?hub_code=eq.${encodeURIComponent(this.hubCode)}&completed_at=is.null&order=started_at.desc&limit=1`;
      const res = await fetch(url, {
        headers: { 'apikey': this.sbKey, 'Authorization': `Bearer ${this.sbKey}` }
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const rows = await res.json();
      return rows[0] || null;
    } catch (e) {
      console.error('[Captain Timer] _fetchActiveHubExecution error:', e.message);
      return null;
    }
  }

  /**
   * FM Captain: poll for completion every 15s.
   * Stops and auto-completes when aggregated_pct is written (all operators done).
   */
  _startHubCompletionPolling() {
    if (this.hubPollInterval) clearInterval(this.hubPollInterval);
    this.hubPollInterval = setInterval(async () => {
      if (!this.hubProcessId || !this.currentSession || this.sessionRole !== 'captain') {
        clearInterval(this.hubPollInterval);
        this.hubPollInterval = null;
        return;
      }
      try {
        const url = `${this.sbUrl}/rest/v1/hub_process_executions?id=eq.${this.hubProcessId}&select=aggregated_pct,operators_done,expected_operators`;
        const res = await fetch(url, {
          headers: { 'apikey': this.sbKey, 'Authorization': `Bearer ${this.sbKey}` }
        });
        if (!res.ok) return;
        const rows = await res.json();
        const exec = rows[0];
        if (exec && exec.aggregated_pct != null) {
          clearInterval(this.hubPollInterval);
          this.hubPollInterval = null;
          await this.autoCompleteHubProcess(exec.aggregated_pct);
        }
      } catch (e) {
        console.warn('[Captain Timer] Hub poll error:', e.message);
      }
    }, 15000);
    console.log('[Captain Timer] Started hub completion polling for', this.hubProcessId);
  }

  /**
   * FM Operator: increment operators_done on the hub execution.
   * If this is the last operator, compute geometric mean PCT and write aggregated_pct.
   */
  async _notifyOperatorDone(myPct) {
    if (!this.hubProcessId || !this.sbUrl || !this.sbKey) return;
    try {
      // Fetch current execution state
      const fetchRes = await fetch(
        `${this.sbUrl}/rest/v1/hub_process_executions?id=eq.${this.hubProcessId}&select=operators_done,expected_operators,projected_volume`,
        { headers: { 'apikey': this.sbKey, 'Authorization': `Bearer ${this.sbKey}` } }
      );
      const rows = await fetchRes.json();
      if (!rows[0]) return;

      const newDone = rows[0].operators_done + 1;
      const isLast  = newDone >= rows[0].expected_operators;

      const patchData = { operators_done: newDone };

      if (isLast) {
        // Allow 1.5s for this operator's session to finish writing to Supabase
        await new Promise(r => setTimeout(r, 1500));

        // Fetch all other operator PCTs for this hub process
        const sessRes = await fetch(
          `${this.sbUrl}/rest/v1/captain_sessions?hub_process_id=eq.${this.hubProcessId}&session_role=eq.operator&select=pct`,
          { headers: { 'apikey': this.sbKey, 'Authorization': `Bearer ${this.sbKey}` } }
        );
        const sessions = await sessRes.json();

        // Combine saved PCTs with current operator's PCT (guards against write lag)
        const savedPcts = (sessions || []).map(s => s.pct).filter(p => p > 0);
        const allPcts   = savedPcts.includes(myPct) ? savedPcts : [...savedPcts, myPct];

        if (allPcts.length > 0) {
          const projVol = rows[0].projected_volume;
          let aggregated_pct;
          if (projVol && projVol > 0) {
            // Path A: volume-normalized (Σ operator times / total projected volume)
            aggregated_pct = Math.round(allPcts.reduce((a, b) => a + b, 0) / projVol);
          } else {
            // Path B: geometric mean (volume-robust, no extra data needed)
            aggregated_pct = Math.round(Math.exp(allPcts.reduce((s, t) => s + Math.log(t), 0) / allPcts.length));
          }
          patchData.aggregated_pct = aggregated_pct;
          patchData.completed_at   = new Date().toISOString();
          console.log('[Captain Timer] Hub process complete. PCTs:', allPcts, '→ aggregated_pct:', aggregated_pct, projVol ? `(Path A, vol=${projVol})` : '(Path B, geometric mean)');
        }
      }

      await fetch(
        `${this.sbUrl}/rest/v1/hub_process_executions?id=eq.${this.hubProcessId}`,
        {
          method:  'PATCH',
          headers: { 'Content-Type': 'application/json', 'apikey': this.sbKey, 'Authorization': `Bearer ${this.sbKey}`, 'Prefer': 'return=minimal' },
          body:    JSON.stringify(patchData)
        }
      );
    } catch (e) {
      console.error('[Captain Timer] _notifyOperatorDone error:', e.message);
    }
  }

  // ─── end hub methods ─────────────────────────────────────────────────────────

  /**
   * Generate UUID
   */
  generateUUID() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
      const r = Math.random() * 16 | 0;
      const v = c === 'x' ? r : (r & 0x3 | 0x8);
      return v.toString(16);
    });
  }

  /**
   * Get session history
   */
  async getHistory(limit = 30) {
    const historyKey = `captain_session_history_${this.userEmail}`;
    const result = await timerStorage.get([historyKey]);
    const history = result[historyKey] || [];
    return history.slice(0, limit);
  }

  /**
   * Get current session
   */
  getCurrentSession() {
    return this.currentSession;
  }

  /**
   * Get personal sequence sorted by exponential decay score.
   * score = count * exp(-0.1 * daysSinceLastUse)
   * Higher count + more recent = higher score = appears first.
   */
  getPersonalSequence() {
    const now = Date.now();
    const lambda = 0.1; // ~7-day half-life
    return Object.entries(this.processFrequency)
      .map(([name, { count, lastUsed }]) => {
        const daysSince = (now - lastUsed) / 86400000;
        return { name, score: count * Math.exp(-lambda * daysSince) };
      })
      .sort((a, b) => b.score - a.score)
      .map(({ name }) => name);
  }
}

// Global instance
window.captainTimerSystem = new CaptainTimerSystem();

// Listen for init message from content script
window.addEventListener('message', async (event) => {
  if (event.data.type === 'INIT_CAPTAIN_TIMER') {
    console.log('[Captain Timer] Received init message');
    try {
      // Store Groq credentials so pause modal can make real AI calls
      window.captainGroqApiKey = event.data.groqApiKey || '';
      window.captainSystemPrompt = event.data.systemPrompt || '';

      // Init with email and processes from content script
      await window.captainTimerSystem.init(
        event.data.email,
        event.data.processes     || [],
        event.data.sequence      || {},
        event.data.hubCode       || null,
        event.data.history       || [],
        event.data.activeSession || null,
        event.data.hubType           || 'LM',
        event.data.sessionRole       || 'captain',
        event.data.expectedOperators || 1,
        event.data.supabaseUrl       || '',
        event.data.supabaseKey       || ''
      );
      
      // Initialize UI components
      if (window.processTimerTab) {
        await window.processTimerTab.init();
      }
      
      // Metrics dashboard is Captain-only — Operators don't track their own metrics
      if (window.captainMetricsDashboard && event.data.sessionRole !== 'operator') {
        await window.captainMetricsDashboard.init(event.data.email, event.data.hub, event.data.supabaseUrl, event.data.supabaseKey, event.data.hubCode);
      }
      
      // Mark as ready
      document.body.setAttribute('data-timer-ready', 'true');
      
      console.log('[Captain Timer] ✅ All systems initialized');
    } catch (error) {
      console.error('[Captain Timer] Init error:', error);
    }
  }

  // ── Process detection bridge (content script → page world) ───────────────────
  if (event.data.type === 'PD_START_PROCESS') {
    (async () => {
      const cts = window.captainTimerSystem;
      if (!cts) return;
      if (cts.currentSession) await cts.stopProcess();
      await cts.startProcess(event.data.processName, { fromAutoDetect: true });
    })();
  }

  if (event.data.type === 'PD_STOP_PROCESS') {
    const cts = window.captainTimerSystem;
    if (!cts?.currentSession) return;
    // Ignore if session just started — likely a late-arriving stop from previous cycle
    if (Date.now() - cts.currentSession.start_time < 2000) return;
    cts.stopProcess();
  }
});

console.log('[Captain Timer] System loaded');
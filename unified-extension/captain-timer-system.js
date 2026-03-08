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
const storage = {
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
  }
};

class CaptainTimerSystem {
  constructor() {
    this.currentSession = null;
    this.allProcesses = [];
    this.processSequence = []; // Auto-built sequence for this captain
    this.userEmail = null;
    this.initialized = false;
  }

  /**
   * Initialize timer system for captain
   */
  async init(userEmail, processes = []) {
    this.userEmail = userEmail;
    
    console.log('[Captain Timer] Initializing for:', userEmail);

    // Use provided processes (from content script) or load them
    if (processes && processes.length > 0) {
      this.allProcesses = processes;
      console.log('[Captain Timer] Loaded', this.allProcesses.length, 'processes (from content script)');
    } else {
      await this.loadAllProcesses();
    }

    // Load captain's personal sequence
    await this.loadPersonalSequence();

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
   * Load captain's personal sequence from storage
   */
  async loadPersonalSequence() {
    const key = `captain_sequence_${this.userEmail}`;
    const result = await storage.get([key]);
    
    if (result[key]) {
      this.processSequence = result[key];
      console.log(`[Captain Timer] Loaded sequence: ${this.processSequence.length} processes`);
    } else {
      this.processSequence = [];
      console.log('[Captain Timer] No sequence yet - will build as captain works');
    }
  }

  /**
   * Save captain's personal sequence
   */
  async savePersonalSequence() {
    const key = `captain_sequence_${this.userEmail}`;
    await storage.set({
      [key]: this.processSequence
    });
  }

  /**
   * Restore active session if exists
   */
  async restoreActiveSession() {
    const result = await storage.get(['captain_current_session']);
    
    if (result.captain_current_session && result.captain_current_session.captain_email === this.userEmail) {
      this.currentSession = result.captain_current_session;
      console.log('[Captain Timer] Restored active session:', this.currentSession.process_name);
      
      // Resume timer
      this.startTimer();
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
   * Get next suggested process based on sequence
   */
  getNextProcess() {
    if (this.processSequence.length === 0) {
      return null; // No sequence yet
    }

    // Get last completed process from history
    const lastCompleted = this.getLastCompletedProcess();
    
    if (!lastCompleted) {
      // First process - suggest first in sequence
      return this.processSequence[0];
    }

    // Find index of last completed
    const lastIndex = this.processSequence.indexOf(lastCompleted);
    
    if (lastIndex === -1 || lastIndex === this.processSequence.length - 1) {
      // Not in sequence or last one - suggest first (loop around)
      return this.processSequence[0];
    }

    // Suggest next in sequence
    return this.processSequence[lastIndex + 1];
  }

  /**
   * Get last completed process name
   */
  getLastCompletedProcess() {
    const historyKey = `captain_session_history_${this.userEmail}`;
    const result = storage.get([historyKey]);
    
    if (result[historyKey] && result[historyKey].length > 0) {
      return result[historyKey][0].process_name;
    }
    
    return null;
  }

  /**
   * Start a process
   */
  async startProcess(processName) {
    if (this.currentSession) {
      console.warn('[Captain Timer] Already tracking a process');
      return false;
    }

    const session = {
      session_id: this.generateUUID(),
      captain_email: this.userEmail,
      process_name: processName,
      start_time: Date.now(),
      end_time: null,
      pauses: [],
      queries: [],
      errors: [],
      timer_running: true,
      elapsed_time: 0 // in seconds
    };

    this.currentSession = session;
    await this.saveCurrentSession();

    // Update sequence
    await this.updateSequence(processName);

    // Start timer
    this.startTimer();

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
   * Update captain's personal sequence
   */
  async updateSequence(processName) {
    // Add to sequence if not already there
    if (!this.processSequence.includes(processName)) {
      this.processSequence.push(processName);
      await this.savePersonalSequence();
      console.log('[Captain Timer] Updated sequence:', this.processSequence);
    }
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
    await storage.remove(['captain_current_session']);

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
    const result = await storage.get([historyKey]);
    const history = result[historyKey] || [];

    // Add new entry
    history.unshift(historyEntry);

    // Keep last 100 sessions
    if (history.length > 100) {
      history.splice(100);
    }

    // Save back
    await storage.set({
      [historyKey]: history
    });

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
    
    if (this.currentSession.timer_running) {
      return Math.floor((Date.now() - this.currentSession.start_time) / 1000);
    } else {
      return this.currentSession.elapsed_time;
    }
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

    await storage.set({
      captain_current_session: this.currentSession
    });
  }

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
    const result = await storage.get([historyKey]);
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
   * Get personal sequence
   */
  getPersonalSequence() {
    return this.processSequence;
  }
}

// Global instance
window.captainTimerSystem = new CaptainTimerSystem();

// Listen for init message from content script
window.addEventListener('message', async (event) => {
  if (event.data.type === 'INIT_CAPTAIN_TIMER') {
    console.log('[Captain Timer] Received init message');
    try {
      // Init with email and processes from content script
      await window.captainTimerSystem.init(event.data.email, event.data.processes || []);
      
      // Initialize UI components
      if (window.processTimerTab) {
        await window.processTimerTab.init();
      }
      
      if (window.captainMetricsDashboard) {
        await window.captainMetricsDashboard.init(event.data.email);
      }
      
      // Mark as ready
      document.body.setAttribute('data-timer-ready', 'true');
      
      console.log('[Captain Timer] ✅ All systems initialized');
    } catch (error) {
      console.error('[Captain Timer] Init error:', error);
    }
  }
});

console.log('[Captain Timer] System loaded');
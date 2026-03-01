/**
 * captain-process-overlay.js - Process Training Interruption System
 * 
 * Shows blocking overlays when Captains open Log10 and there are:
 * - NEW processes they haven't seen
 * - UPDATED processes (new version)
 * - MUST_KNOW processes not yet completed
 * 
 * Integrates with process-progress.js for tracking
 */

class ProcessOverlay {
  constructor() {
    this.currentProcess = null;
    this.pendingProcesses = [];
    this.isShowing = false;
  }

  /**
   * Initialize and check for processes that need attention
   */
  async init(userEmail) {
    console.log('[Process Overlay] Initializing for user:', userEmail);

    // Initialize progress tracking
    await processProgress.init(userEmail);

    // Get all processes from background
    chrome.runtime.sendMessage({ type: 'GET_ALL_PROCESSES' }, async (response) => {
      if (!response || !response.processes) {
        console.log('[Process Overlay] No processes found');
        return;
      }

      console.log('[Process Overlay] Got', response.processes.length, 'processes');

      // Filter to processes that need to be shown
      this.pendingProcesses = response.processes.filter(proc => 
        processProgress.shouldShowProcess(proc)
      );

      console.log('[Process Overlay] Found', this.pendingProcesses.length, 'processes needing attention');

      // Sort by priority (MUST_KNOW first)
      this.pendingProcesses.sort((a, b) => {
        if (a.priority === 'MUST_KNOW' && b.priority !== 'MUST_KNOW') return -1;
        if (a.priority !== 'MUST_KNOW' && b.priority === 'MUST_KNOW') return 1;
        
        // Then by status (NEW before UPDATED)
        if (a.status === 'NEW' && b.status !== 'NEW') return -1;
        if (a.status !== 'NEW' && b.status === 'NEW') return 1;
        
        return 0;
      });

      // Show first pending process
      if (this.pendingProcesses.length > 0) {
        this.showNext();
      }
    });
  }

  /**
   * Show next pending process overlay
   */
  showNext() {
    if (this.isShowing || this.pendingProcesses.length === 0) return;

    this.currentProcess = this.pendingProcesses.shift();
    this.show(this.currentProcess);
  }

  /**
   * Show overlay for a specific process
   */
  show(process) {
    console.log('[Process Overlay] Showing overlay for:', process.process_name);
    this.isShowing = true;

    // Create overlay container
    const overlay = document.createElement('div');
    overlay.id = 'captain-process-overlay';
    overlay.className = 'captain-process-overlay';

    // Determine if this is blocking (MUST_KNOW + completion_required)
    const isBlocking = process.priority === 'MUST_KNOW' && process.completion_required;

    // Build overlay HTML
    overlay.innerHTML = `
      <div class="captain-process-overlay-backdrop ${isBlocking ? 'blocking' : ''}"></div>
      <div class="captain-process-overlay-content">
        <div class="captain-process-overlay-header">
          <div class="captain-process-overlay-icon">
            ${process.status === 'NEW' ? '🎯' : '📢'}
          </div>
          <h2 class="captain-process-overlay-title">
            ${process.status === 'NEW' ? 'NEW TRAINING REQUIRED' : 'TRAINING UPDATED'}
          </h2>
        </div>

        <div class="captain-process-overlay-body">
          <h3 class="captain-process-overlay-process-name">
            🎥 ${process.process_name}
          </h3>

          <div class="captain-process-overlay-badge ${process.priority === 'MUST_KNOW' ? 'must-know' : 'good-to-know'}">
            ${process.priority === 'MUST_KNOW' ? '🔴 MUST KNOW' : '🟡 GOOD TO KNOW'}
          </div>

          <div class="captain-process-overlay-version">
            Version ${process.version}
            ${process.date_updated ? `• Updated ${this.formatDate(process.date_updated)}` : ''}
          </div>

          <p class="captain-process-overlay-description">
            ${this.getDescription(process)}
          </p>

          ${this.pendingProcesses.length > 0 ? `
            <div class="captain-process-overlay-queue">
              📚 ${this.pendingProcesses.length} more training${this.pendingProcesses.length === 1 ? '' : 's'} pending
            </div>
          ` : ''}
        </div>

        <div class="captain-process-overlay-actions">
          <button class="captain-process-overlay-btn captain-process-overlay-btn-primary" 
                  data-action="watch">
            ▶️ Watch Now
          </button>

          ${!isBlocking ? `
            <button class="captain-process-overlay-btn captain-process-overlay-btn-secondary" 
                    data-action="later">
              ⏰ Remind Me Later
            </button>
            <button class="captain-process-overlay-btn captain-process-overlay-btn-text" 
                    data-action="skip">
              ✕ Skip
            </button>
          ` : `
            <p class="captain-process-overlay-warning">
              ⚠️ This training is required. You cannot dismiss it without watching.
            </p>
          `}
        </div>

        ${!isBlocking ? `
          <button class="captain-process-overlay-close" data-action="skip">✕</button>
        ` : ''}
      </div>
    `;

    document.body.appendChild(overlay);

    // Add event listeners
    this.attachEventListeners(overlay, process, isBlocking);

    // Animate in
    setTimeout(() => overlay.classList.add('visible'), 10);
  }

  /**
   * Attach event listeners to overlay buttons
   */
  attachEventListeners(overlay, process, isBlocking) {
    const buttons = overlay.querySelectorAll('[data-action]');

    buttons.forEach(btn => {
      btn.addEventListener('click', async (e) => {
        const action = e.target.dataset.action;

        switch (action) {
          case 'watch':
            await this.handleWatch(process);
            break;
          case 'later':
            await this.handleLater(process);
            break;
          case 'skip':
            await this.handleSkip(process);
            break;
        }

        this.hide(overlay);
      });
    });
  }

  /**
   * Handle "Watch Now" action
   */
  async handleWatch(process) {
    console.log('[Process Overlay] Watch:', process.process_name);

    // Mark as viewed
    await processProgress.markViewed(
      process.process_name,
      process.version,
      process.video_link
    );

    // Open video in new tab
    window.open(process.video_link, '_blank');

    // Show completion tracking
    this.showVideoTracker(process);
  }

  /**
   * Handle "Remind Me Later" action
   */
  async handleLater(process) {
    console.log('[Process Overlay] Remind later:', process.process_name);

    // Postpone for 1 hour
    const postponeUntil = Date.now() + (60 * 60 * 1000);
    await processProgress.markPostponed(process.process_name, postponeUntil);
  }

  /**
   * Handle "Skip" action
   */
  async handleSkip(process) {
    console.log('[Process Overlay] Skip:', process.process_name);

    // Mark as viewed (but not completed)
    await processProgress.markViewed(
      process.process_name,
      process.version,
      process.video_link
    );
  }

  /**
   * Show video completion tracker
   */
  showVideoTracker(process) {
    // Create small tracker notification
    const tracker = document.createElement('div');
    tracker.className = 'captain-process-video-tracker';
    tracker.innerHTML = `
      <div class="captain-process-video-tracker-content">
        <span>🎥 Watching: ${process.process_name}</span>
        <button class="captain-process-video-tracker-complete">✓ Mark as Complete</button>
      </div>
    `;

    document.body.appendChild(tracker);

    // Handle completion
    tracker.querySelector('.captain-process-video-tracker-complete').addEventListener('click', async () => {
      await processProgress.markCompleted(
        process.process_name,
        process.version,
        process.video_link
      );
      tracker.remove();
      
      // Show success message
      this.showSuccessMessage(process);
    });

    // Auto-remove after 5 minutes
    setTimeout(() => tracker.remove(), 5 * 60 * 1000);
  }

  /**
   * Show success message
   */
  showSuccessMessage(process) {
    const success = document.createElement('div');
    success.className = 'captain-process-success';
    success.innerHTML = `
      <div class="captain-process-success-content">
        ✅ Training completed: ${process.process_name}
      </div>
    `;

    document.body.appendChild(success);

    // Auto-remove after 3 seconds
    setTimeout(() => {
      success.classList.add('fade-out');
      setTimeout(() => success.remove(), 300);
    }, 3000);
  }

  /**
   * Hide overlay
   */
  hide(overlay) {
    overlay.classList.remove('visible');
    setTimeout(() => {
      overlay.remove();
      this.isShowing = false;

      // Show next pending process
      this.showNext();
    }, 300);
  }

  /**
   * Get description text based on process status
   */
  getDescription(process) {
    if (process.status === 'NEW') {
      return `A new training has been added for ${process.process_name}. Please watch this video to stay updated on the latest procedures.`;
    } else if (process.status === 'UPDATED') {
      return `This training has been updated with new information. Please review the changes in version ${process.version}.`;
    } else {
      return `This training is required for ${process.process_name}. Please complete it to proceed.`;
    }
  }

  /**
   * Format date for display
   */
  formatDate(dateStr) {
    if (!dateStr) return '';
    
    const date = new Date(dateStr);
    const now = new Date();
    const diffDays = Math.floor((now - date) / (1000 * 60 * 60 * 24));

    if (diffDays === 0) return 'today';
    if (diffDays === 1) return 'yesterday';
    if (diffDays < 7) return `${diffDays} days ago`;
    
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }
}

// Global instance
const processOverlay = new ProcessOverlay();

// Auto-initialize when on Log10
if (window.location.hostname.includes('console.valmo.in')) {
  // Wait for DOM and process-progress to be ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      setTimeout(() => {
        // TODO: Get user email from page/API
        const userEmail = 'captain@valmo.com'; // Replace with actual user detection
        processOverlay.init(userEmail);
      }, 1000);
    });
  } else {
    setTimeout(() => {
      const userEmail = 'captain@valmo.com'; // Replace with actual user detection
      processOverlay.init(userEmail);
    }, 1000);
  }
}
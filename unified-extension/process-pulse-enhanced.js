/**
 * process-pulse-enhanced.js - PHASE 3 Enhancement
 * 
 * Replaces the renderProcesses() method in ProcessPulseOverlay
 * with categorized view showing:
 * - MUST KNOW section
 * - GOOD TO KNOW section  
 * - THIS WEEK section
 * - Progress tracking
 */

// ═══════════════════════════════════════════════════════════════
// ENHANCED ProcessPulseOverlay Class
// ═══════════════════════════════════════════════════════════════

class ProcessPulseOverlayEnhanced extends ProcessPulseOverlay {
  constructor() {
    super();
    this.allProcesses = [];
    this.userProgress = null;
  }

  /**
   * Override inject to add progress stats section
   */
  inject() {
    super.inject();
    
    // Initialize progress tracking
    this.initProgressTracking();
  }

  /**
   * Initialize progress tracking for current user
   */
  async initProgressTracking() {
    // TODO: Get actual user email from page
    const userEmail = this.getCurrentUserEmail();
    
    await processProgress.init(userEmail);
    this.userProgress = processProgress;
    
    // Load all processes (not just current tab matches)
    chrome.runtime.sendMessage({ type: 'GET_ALL_PROCESSES' }, (response) => {
      if (response?.processes) {
        this.allProcesses = response.processes;
        this.renderProgressStats();
      }
    });
  }

  /**
   * Get current user email from page
   * Override this based on your actual user detection
   */
  getCurrentUserEmail() {
    // Try localStorage first
    const storedEmail = localStorage.getItem('user_email');
    if (storedEmail) return storedEmail;
    
    // Try to extract from page DOM
    const emailEl = document.querySelector('[data-user-email]');
    if (emailEl) return emailEl.textContent;
    
    // Fallback
    return 'captain@valmo.com';
  }

  /**
   * Enhanced render with categories
   */
  renderProcesses(matches) {
    const list = document.getElementById('valmo-process-list');
    if (!list) return;

    if (!matches || matches.length === 0) {
      list.innerHTML = `
        <div class="valmo-empty">
          <div class="valmo-empty-icon">📂</div>
          <h3>No processes for this tab</h3>
          <p>Switch to another tab to see available training videos.</p>
          ${this.allProcesses.length > 0 ? `
            <button class="valmo-view-all-btn" onclick="processOverlayInstance.showAllProcesses()">
              📚 View All ${this.allProcesses.length} Processes
            </button>
          ` : ''}
        </div>
      `;
      return;
    }

    // Categorize matches
    const categorized = this.categorizeProcesses(matches);
    
    let html = '';

    // MUST KNOW Section
    if (categorized.mustKnow.length > 0) {
      const pending = categorized.mustKnow.filter(p => !this.userProgress?.hasCompleted(p.process_name)).length;
      
      html += `
        <div class="valmo-category-section">
          <div class="valmo-category-header must-know">
            <span class="valmo-category-icon">🔴</span>
            <span class="valmo-category-title">MUST KNOW</span>
            ${pending > 0 ? `<span class="valmo-category-badge">${pending} pending</span>` : ''}
          </div>
          <div class="valmo-category-list">
            ${categorized.mustKnow.map(p => this.renderProcessCard(p)).join('')}
          </div>
        </div>
      `;
    }

    // GOOD TO KNOW Section
    if (categorized.goodToKnow.length > 0) {
      html += `
        <div class="valmo-category-section">
          <div class="valmo-category-header good-to-know">
            <span class="valmo-category-icon">🟡</span>
            <span class="valmo-category-title">GOOD TO KNOW</span>
          </div>
          <div class="valmo-category-list">
            ${categorized.goodToKnow.map(p => this.renderProcessCard(p)).join('')}
          </div>
        </div>
      `;
    }

    // THIS WEEK Section (if any)
    if (categorized.thisWeek.length > 0) {
      html += `
        <div class="valmo-category-section">
          <div class="valmo-category-header this-week">
            <span class="valmo-category-icon">📅</span>
            <span class="valmo-category-title">THIS WEEK</span>
            <span class="valmo-category-count">${categorized.thisWeek.length}</span>
          </div>
          <div class="valmo-category-list compact">
            ${categorized.thisWeek.map(p => this.renderProcessCardCompact(p)).join('')}
          </div>
        </div>
      `;
    }

    list.innerHTML = html;
  }

  /**
   * Categorize processes by priority and time
   */
  categorizeProcesses(processes) {
    const now = Date.now();
    const oneWeek = 7 * 24 * 60 * 60 * 1000;

    const mustKnow = [];
    const goodToKnow = [];
    const thisWeek = [];

    processes.forEach(proc => {
      // Add to priority lists
      if (proc.priority === 'MUST_KNOW') {
        mustKnow.push(proc);
      } else {
        goodToKnow.push(proc);
      }

      // Add to time-based lists
      const addedDate = new Date(proc.date_added || proc.date_updated).getTime();
      const updatedDate = new Date(proc.date_updated || proc.date_added).getTime();
      const latestDate = Math.max(addedDate, updatedDate);
      
      if (now - latestDate < oneWeek) {
        thisWeek.push(proc);
      }
    });

    return { mustKnow, goodToKnow, thisWeek };
  }

  /**
   * Render individual process card
   */
  renderProcessCard(proc) {
    const completed = this.userProgress?.hasCompleted(proc.process_name);
    const statusIcon = completed ? '✅' : '❌';
    const statusClass = completed ? 'completed' : 'pending';
    const isNew = proc.status === 'NEW';
    const isUpdated = proc.status === 'UPDATED';

    return `
      <div class="valmo-process-card enhanced ${statusClass}">
        <div class="valmo-process-header">
          <span class="valmo-process-status">${statusIcon}</span>
          <div class="valmo-process-name">${this.escape(proc.process_name)}</div>
          ${isNew ? '<span class="valmo-badge new">NEW</span>' : ''}
          ${isUpdated ? '<span class="valmo-badge updated">UPDATED</span>' : ''}
        </div>
        
        <div class="valmo-process-meta">
          <span>📂 ${this.escape(proc.start_tab || proc.url_module || 'General')}</span>
          ${proc.version ? `<span>v${this.escape(proc.version)}</span>` : ''}
        </div>
        
        <div class="valmo-process-actions">
          <button class="valmo-video-btn" data-video-link="${this.escape(proc.video_link || '')}" data-process-name="${this.escape(proc.process_name)}" data-process-version="${this.escape(proc.version || '1.0')}">
            🎥 ${completed ? 'Watch Again' : 'Watch Video'}
          </button>
          ${completed ? '' : `
            <button class="valmo-mark-complete-btn" data-process-name="${this.escape(proc.process_name)}" data-process-version="${this.escape(proc.version || '1.0')}" data-video-link="${this.escape(proc.video_link || '')}">
              ✓ Mark Complete
            </button>
          `}
        </div>
      </div>
    `;
  }

  /**
   * Render compact process card (for time-based lists)
   */
  renderProcessCardCompact(proc) {
    const completed = this.userProgress?.hasCompleted(proc.process_name);
    const statusIcon = completed ? '✅' : '📌';
    const isNew = proc.status === 'NEW';
    const isUpdated = proc.status === 'UPDATED';

    return `
      <div class="valmo-process-card-compact">
        <span class="valmo-process-status-small">${statusIcon}</span>
        <div class="valmo-process-info">
          <div class="valmo-process-name-small">${this.escape(proc.process_name)}</div>
          ${isNew ? '<span class="valmo-badge-small new">NEW</span>' : ''}
          ${isUpdated ? '<span class="valmo-badge-small updated">UPDATED</span>' : ''}
        </div>
        <button class="valmo-video-btn-small" data-video-link="${this.escape(proc.video_link || '')}" data-process-name="${this.escape(proc.process_name)}" data-process-version="${this.escape(proc.version || '1.0')}">
          ▶
        </button>
      </div>
    `;
  }

  /**
   * Render progress stats at top of sidebar
   */
  renderProgressStats() {
    if (!this.userProgress || this.allProcesses.length === 0) return;

    const stats = this.userProgress.getStats(this.allProcesses);
    
    // Find or create progress section
    let progressSection = document.getElementById('valmo-progress-stats');
    
    if (!progressSection) {
      // Insert before videos view
      const videosView = document.getElementById('videos-view');
      if (!videosView) return;

      progressSection = document.createElement('div');
      progressSection.id = 'valmo-progress-stats';
      progressSection.className = 'valmo-progress-stats';
      videosView.insertBefore(progressSection, videosView.firstChild);
    }

    const completionPercent = stats.completionPercentage || 0;
    const barFill = Math.min(100, completionPercent);

    progressSection.innerHTML = `
      <div class="valmo-progress-header">
        <span class="valmo-progress-icon">📊</span>
        <span class="valmo-progress-title">Your Progress</span>
      </div>
      
      <div class="valmo-progress-bar-container">
        <div class="valmo-progress-bar">
          <div class="valmo-progress-bar-fill" style="width: ${barFill}%"></div>
        </div>
        <div class="valmo-progress-text">${stats.completedCount}/${stats.totalProcesses} (${completionPercent}%)</div>
      </div>

      ${stats.mustKnowPending > 0 ? `
        <div class="valmo-progress-alert">
          ⚠️ ${stats.mustKnowPending} MUST KNOW training${stats.mustKnowPending === 1 ? '' : 's'} pending
        </div>
      ` : ''}

      <div class="valmo-progress-stats-grid">
        <div class="valmo-stat">
          <div class="valmo-stat-value">${stats.newPending || 0}</div>
          <div class="valmo-stat-label">New</div>
        </div>
        <div class="valmo-stat">
          <div class="valmo-stat-value">${stats.updatedPending || 0}</div>
          <div class="valmo-stat-label">Updated</div>
        </div>
        <div class="valmo-stat">
          <div class="valmo-stat-value">${stats.completedCount}</div>
          <div class="valmo-stat-label">Completed</div>
        </div>
      </div>
    `;
  }

  /**
   * Override attachListeners to handle new buttons
   */
  attachListeners() {
    super.attachListeners();

    // Delegate for mark complete buttons
    document.getElementById('valmo-process-list')?.addEventListener('click', async (e) => {
      const markBtn = e.target.closest('.valmo-mark-complete-btn');
      if (markBtn) {
        const processName = markBtn.dataset.processName;
        const version = markBtn.dataset.processVersion;
        const videoLink = markBtn.dataset.videoLink;

        await this.userProgress.markCompleted(processName, version, videoLink);
        
        // Re-render to update UI
        this.renderProcesses(this.matches);
        this.renderProgressStats();
        
        // Show success
        this.showSuccessToast(`✅ Marked "${processName}" as complete!`);
      }

      // Handle watch button with completion tracking
      const watchBtn = e.target.closest('.valmo-video-btn, .valmo-video-btn-small');
      if (watchBtn) {
        const processName = watchBtn.dataset.processName;
        const version = watchBtn.dataset.processVersion;
        const videoLink = watchBtn.dataset.videoLink;

        // Mark as viewed (not necessarily completed)
        if (processName && version) {
          await this.userProgress.markViewed(processName, version, videoLink);
        }
      }
    });
  }

  /**
   * Show success toast notification
   */
  showSuccessToast(message) {
    const toast = document.createElement('div');
    toast.className = 'valmo-toast success';
    toast.textContent = message;
    document.body.appendChild(toast);

    setTimeout(() => toast.classList.add('show'), 10);
    setTimeout(() => {
      toast.classList.remove('show');
      setTimeout(() => toast.remove(), 300);
    }, 3000);
  }

  /**
   * Show all processes (when clicked from empty state)
   */
  showAllProcesses() {
    this.renderProcesses(this.allProcesses);
  }
}

// ═══════════════════════════════════════════════════════════════
// AUTO-REPLACEMENT - Makes this work without editing content.js
// ═══════════════════════════════════════════════════════════════

(function() {
  console.log('[Phase 3] Initializing enhanced overlay system...');
  
  // Strategy 0: Patch ProcessPulseOverlay.inject() to expose instance globally
  const patchInject = setInterval(() => {
    if (typeof ProcessPulseOverlay !== 'undefined' && 
        ProcessPulseOverlay.prototype.inject && 
        !ProcessPulseOverlay.prototype.__exposed) {
      
      clearInterval(patchInject);
      
      const originalInject = ProcessPulseOverlay.prototype.inject;
      
      ProcessPulseOverlay.prototype.inject = function() {
        console.log('[Phase 3] Inject called, exposing instance...');
        const result = originalInject.apply(this, arguments);
        
        // Expose globally
        window.overlayInstance = this;
        window.processOverlayInstance = this;
        
        console.log('[Phase 3] ✅ Instance exposed globally:', this.constructor.name);
        
        return result;
      };
      
      ProcessPulseOverlay.prototype.__exposed = true;
      console.log('[Phase 3] ✅ Inject method patched to expose instance');
    }
  }, 10);
  
  // Strategy 1: Replace the ProcessPulseOverlay class BEFORE it's used
  const waitForClass = setInterval(() => {
    if (typeof ProcessPulseOverlay !== 'undefined' && !window.__phase3_replaced) {
      clearInterval(waitForClass);
      
      console.log('[Phase 3] Found ProcessPulseOverlay class, replacing...');
      
      // Save original
      window.OriginalProcessPulseOverlay = ProcessPulseOverlay;
      
      // Replace globally
      window.ProcessPulseOverlay = ProcessPulseOverlayEnhanced;
      window.__phase3_replaced = true;
      
      console.log('[Phase 3] ✅ Class replacement complete');
    }
  }, 50);
  
  // Strategy 2: Monitor overlayInstance and upgrade if needed
  let lastInstance = null;
  const monitorInstance = setInterval(() => {
    const instance = window.overlayInstance;
    
    // Skip if no instance or already processed this instance
    if (!instance || instance === lastInstance) return;
    
    // Skip if already enhanced
    if (instance instanceof ProcessPulseOverlayEnhanced) {
      console.log('[Phase 3] Instance is already enhanced ✅');
      lastInstance = instance;
      clearInterval(monitorInstance); // Stop monitoring
      return;
    }
    
    // Check if it's a basic ProcessPulseOverlay
    if (instance.constructor.name === 'ProcessPulseOverlay' || 
        (instance.matches !== undefined && instance.renderProcesses !== undefined)) {
      
      console.log('[Phase 3] Detected basic overlay instance, upgrading NOW...');
      
      // Create enhanced version
      const enhanced = new ProcessPulseOverlayEnhanced();
      
      // Copy all state
      enhanced.matches = instance.matches || [];
      enhanced.isPanelOpen = instance.isPanelOpen || false;
      
      // Replace global reference
      window.overlayInstance = enhanced;
      lastInstance = enhanced;
      
      // Re-attach event listeners with enhanced version
      enhanced.attachListeners();
      
      // Re-render with enhanced UI
      setTimeout(() => {
        const list = document.getElementById('valmo-process-list');
        if (list) {
          console.log('[Phase 3] Re-rendering with enhanced UI...');
          enhanced.renderProcesses(enhanced.matches);
          
          // Initialize progress tracking
          enhanced.initProgressTracking();
          
          console.log('[Phase 3] ✅ Enhanced UI active!');
        }
      }, 200);
      
      console.log('[Phase 3] ✅ Instance upgraded to enhanced version');
    }
  }, 100);
  
   // Clean up after 15 seconds
  setTimeout(() => {
    clearInterval(patchInject);
    clearInterval(waitForClass);
    clearInterval(monitorInstance);

    // FINAL CHECK: Force enhanced UI rendering if DOM exists
    const processList = document.getElementById('valmo-process-list');

    if (processList) {
      console.log('[Phase 3] Found process list, rendering enhanced UI...');

      chrome.runtime.sendMessage({ type: 'GET_ALL_PROCESSES' }, async (response) => {
        if (response?.processes && response.processes.length > 0) {
          console.log('[Phase 3] Received', response.processes.length, 'processes, rendering...');

          const temp = new ProcessPulseOverlayEnhanced();
          temp.allProcesses = response.processes;
          temp.matches = response.processes;

          const userEmail =
            localStorage.getItem('user_email') || 'captain@valmo.com';

          await processProgress.init(userEmail);
          temp.userProgress = processProgress;

          temp.renderProcesses(response.processes);
          temp.renderProgressStats();

          console.log('[Phase 3] ✅ Enhanced UI rendered');
        } else {
          console.log('[Phase 3] ⚠️ No processes received from API');
        }
      });
    }

    console.log('[Phase 3] Monitoring complete');
  }, 3000);
})();

/**
 * EMERGENCY PATCH - Add to process-pulse-enhanced.js
 * 
 * This fixes:
 * 1. Expose overlayInstance globally
 * 2. Fix play button handlers
 * 3. Fix complete button handlers
 * 4. Fix browse training button
 */

// Add this at the END of process-pulse-enhanced.js file:

(function() {
  console.log('[PATCH] Applying emergency fixes...');

  // Wait for DOM and overlay to be ready
  setTimeout(() => {
    
    // ═══════════════════════════════════════════════════════════════
    // FIX 1: Expose overlay instance globally
    // ═══════════════════════════════════════════════════════════════
    
    const panel = document.getElementById('valmo-panel');
    if (panel && !window.overlayInstance) {
      // Create a minimal overlay instance for backward compatibility
      window.overlayInstance = {
        openPanel: () => {
          const p = document.getElementById('valmo-panel');
          if (p) p.classList.add('open');
        },
        closePanel: () => {
          const p = document.getElementById('valmo-panel');
          if (p) p.classList.remove('open');
        },
        switchToTab: (tabName) => {
          const tab = document.querySelector(`[data-tab="${tabName}"]`);
          if (tab) tab.click();
        }
      };
      console.log('[PATCH] ✅ Created window.overlayInstance');
    }

    // ═══════════════════════════════════════════════════════════════
    // FIX 2 & 3: Add click handlers for all buttons
    // ═══════════════════════════════════════════════════════════════
    
    // Get process list container
    const processList = document.getElementById('valmo-process-list');
    if (!processList) {
      console.warn('[PATCH] Process list not found');
      return;
    }

    // Add event delegation for all clicks
    processList.addEventListener('click', async (e) => {
      
      // ═══════════════════════════════════════════════════════════
      // PLAY BUTTON (Watch Video)
      // ═══════════════════════════════════════════════════════════
      
      const playBtn = e.target.closest('.valmo-video-btn, .valmo-video-btn-small');
      if (playBtn) {
        e.preventDefault();
        e.stopPropagation();
        
        const processName = playBtn.dataset.processName || playBtn.getAttribute('data-process-name');
        const videoLink = playBtn.dataset.videoLink || playBtn.getAttribute('data-video-link');
        
        console.log('[PATCH] Play button clicked:', processName, videoLink);
        
        if (videoLink) {
          // Open video
          window.open(videoLink, '_blank');
          
          // Award XP if gamification is ready
          if (window.gamificationSystem && window.gamificationSystem.initialized) {
            try {
              await window.gamificationSystem.watchVideo(processName, false, false);
              console.log('[PATCH] ✅ XP awarded for watching video');
            } catch (err) {
              console.warn('[PATCH] Could not award XP:', err);
            }
          }
        } else {
          console.warn('[PATCH] No video link found');
        }
        
        return;
      }

      // ═══════════════════════════════════════════════════════════
      // COMPLETE BUTTON (Mark Complete)
      // ═══════════════════════════════════════════════════════════
      
      const completeBtn = e.target.closest('.valmo-complete-btn');
      if (completeBtn) {
        e.preventDefault();
        e.stopPropagation();
        
        const processName = completeBtn.dataset.processName || completeBtn.getAttribute('data-process-name');
        const version = completeBtn.dataset.processVersion || completeBtn.getAttribute('data-process-version');
        const videoLink = completeBtn.dataset.videoLink || completeBtn.getAttribute('data-video-link');
        
        console.log('[PATCH] Complete button clicked:', processName);
        
        // Mark as completed in process progress
        if (window.processProgress) {
          try {
            await window.processProgress.markCompleted(processName, version, videoLink);
            console.log('[PATCH] ✅ Marked as completed');
            
            // Refresh the UI
            window.location.reload();
          } catch (err) {
            console.error('[PATCH] Error marking complete:', err);
          }
        } else {
          console.warn('[PATCH] processProgress not available');
        }
        
        return;
      }

      // ═══════════════════════════════════════════════════════════
      // THIS WEEK PLAY BUTTON (bottom section)
      // ═══════════════════════════════════════════════════════════
      
      const thisWeekPlayBtn = e.target.closest('.valmo-thisweek-play');
      if (thisWeekPlayBtn) {
        e.preventDefault();
        e.stopPropagation();
        
        const processName = thisWeekPlayBtn.dataset.processName || thisWeekPlayBtn.getAttribute('data-process-name');
        const videoLink = thisWeekPlayBtn.dataset.videoLink || thisWeekPlayBtn.getAttribute('data-video-link');
        
        console.log('[PATCH] This Week play clicked:', processName, videoLink);
        
        if (videoLink) {
          window.open(videoLink, '_blank');
          
          // Award XP
          if (window.gamificationSystem && window.gamificationSystem.initialized) {
            try {
              await window.gamificationSystem.watchVideo(processName, false, false);
            } catch (err) {
              console.warn('[PATCH] Could not award XP:', err);
            }
          }
        }
        
        return;
      }

    });

    console.log('[PATCH] ✅ Event delegation added to process list');

    // ═══════════════════════════════════════════════════════════════
    // FIX 4: Fix Browse Training button in My Stats
    // ═══════════════════════════════════════════════════════════════
    
    // This will be handled by the updated my-stats-tab.js
    // But add a backup handler just in case
    document.addEventListener('click', (e) => {
      if (e.target.id === 'browse-training-btn' || 
          e.target.closest('#browse-training-btn')) {
        e.preventDefault();
        
        // Switch to Videos tab
        const videosTab = document.querySelector('[data-tab="videos"]');
        if (videosTab) {
          videosTab.click();
        }
        
        // Open panel
        const panel = document.getElementById('valmo-panel');
        if (panel && !panel.classList.contains('open')) {
          panel.classList.add('open');
        }
        
        console.log('[PATCH] ✅ Browse Training clicked');
      }
    });

  }, 1000); // Wait 1 second for everything to load

})();

console.log('[PATCH] Emergency patch loaded');
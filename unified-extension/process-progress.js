/**
 * process-progress.js - User Progress Tracking System
 * 
 * Tracks which processes each Captain has viewed/completed
 * Stores data in chrome.storage.local per user
 */

class ProcessProgress {
  constructor() {
    this.userEmail = null;
    this.progress = null;
  }

  /**
   * Initialize with current user
   */
  async init(userEmail) {
    this.userEmail = userEmail;
    await this.loadProgress();
  }

  /**
   * Load user's progress from storage
   */
  async loadProgress() {
    if (!this.userEmail) {
      console.warn('[Process Progress] No user email set');
      return;
    }

    const storageKey = `process_progress_${this.userEmail}`;
    
    try {
      const result = await chrome.storage.local.get([storageKey]);
      this.progress = result[storageKey] || {
        viewedProcesses: {},
        postponedProcesses: {},
        completedProcesses: {},
        lastUpdated: Date.now()
      };
      
      console.log('[Process Progress] Loaded for', this.userEmail);
      console.log('[Process Progress]   - Viewed:', Object.keys(this.progress.viewedProcesses).length);
      console.log('[Process Progress]   - Completed:', Object.keys(this.progress.completedProcesses).length);
      console.log('[Process Progress]   - Postponed:', Object.keys(this.progress.postponedProcesses).length);
    } catch (error) {
      console.error('[Process Progress] Failed to load:', error);
      this.progress = {
        viewedProcesses: {},
        postponedProcesses: {},
        completedProcesses: {},
        lastUpdated: Date.now()
      };
    }
  }

  /**
   * Save progress to storage
   */
  async saveProgress() {
    if (!this.userEmail || !this.progress) return;

    const storageKey = `process_progress_${this.userEmail}`;
    this.progress.lastUpdated = Date.now();

    try {
      await chrome.storage.local.set({
        [storageKey]: this.progress
      });
      console.log('[Process Progress] Saved for', this.userEmail);
    } catch (error) {
      console.error('[Process Progress] Failed to save:', error);
    }
  }

  /**
   * Check if user has seen a specific version of a process
   */
  hasSeenVersion(processName, version) {
    if (!this.progress) return false;
    
    const viewed = this.progress.viewedProcesses[processName];
    if (!viewed) return false;
    
    return viewed.version === version;
  }

  /**
   * Check if user has completed a process
   */
  hasCompleted(processName) {
    if (!this.progress) return false;
    return !!this.progress.completedProcesses[processName];
  }

  /**
   * Check if process is postponed
   */
  isPostponed(processName) {
    if (!this.progress) return false;
    
    const postponed = this.progress.postponedProcesses[processName];
    if (!postponed) return false;
    
    // Check if postpone period has expired
    return Date.now() < postponed.postponedUntil;
  }

  /**
   * Mark process as viewed
   */
  async markViewed(processName, version, videoLink) {
    if (!this.progress) return;

    this.progress.viewedProcesses[processName] = {
      version: version,
      viewedAt: Date.now(),
      videoLink: videoLink,
      status: 'viewed'
    };

    await this.saveProgress();
    console.log(`[Process Progress] Marked ${processName} v${version} as viewed`);
  }

  /**
   * Mark process as completed (watched entire video)
   */
  async markCompleted(processName, version, videoLink) {
    if (!this.progress) return;

    // Add to completed
    this.progress.completedProcesses[processName] = {
      version: version,
      completedAt: Date.now(),
      videoLink: videoLink
    };

    // Also update viewed
    this.progress.viewedProcesses[processName] = {
      version: version,
      viewedAt: Date.now(),
      videoLink: videoLink,
      status: 'completed'
    };

    // Remove from postponed if it was there
    delete this.progress.postponedProcesses[processName];

    await this.saveProgress();
    console.log(`[Process Progress] ✓ Completed ${processName} v${version}`);
  }

  /**
   * Mark process as postponed
   */
  async markPostponed(processName, postponeUntil) {
    if (!this.progress) return;

    this.progress.postponedProcesses[processName] = {
      postponedAt: Date.now(),
      postponedUntil: postponeUntil
    };

    await this.saveProgress();
    
    const hours = Math.round((postponeUntil - Date.now()) / (1000 * 60 * 60));
    console.log(`[Process Progress] Postponed ${processName} for ${hours} hours`);
  }

  /**
   * Check if process needs to be shown to user
   */
  shouldShowProcess(process) {
    if (!this.progress) return true;

    // If postponed and still within postpone period, don't show
    if (this.isPostponed(process.process_name)) {
      return false;
    }

    // If user has seen this exact version, don't show again
    if (this.hasSeenVersion(process.process_name, process.version)) {
      return false;
    }

    // If it's MUST_KNOW and completion_required, show if not completed
    if (process.priority === 'MUST_KNOW' && process.completion_required) {
      return !this.hasCompleted(process.process_name);
    }

    // If process is NEW or UPDATED, show it
    if (process.status === 'NEW' || process.status === 'UPDATED') {
      return true;
    }

    // Otherwise, don't show
    return false;
  }

  /**
   * Get list of processes that need user attention
   */
  getRequiredProcesses(allProcesses) {
    if (!allProcesses || !this.progress) return [];

    return allProcesses.filter(proc => this.shouldShowProcess(proc));
  }

  /**
   * Get completion statistics
   */
  getStats(allProcesses) {
    if (!allProcesses || !this.progress) {
      return {
        totalProcesses: 0,
        viewedCount: 0,
        completedCount: 0,
        mustKnowPending: 0,
        newPending: 0,
        updatedPending: 0
      };
    }

    const mustKnowProcesses = allProcesses.filter(p => p.priority === 'MUST_KNOW');
    const mustKnowCompleted = mustKnowProcesses.filter(p => this.hasCompleted(p.process_name));
    
    const newProcesses = allProcesses.filter(p => p.status === 'NEW');
    const newViewed = newProcesses.filter(p => this.hasSeenVersion(p.process_name, p.version));
    
    const updatedProcesses = allProcesses.filter(p => p.status === 'UPDATED');
    const updatedViewed = updatedProcesses.filter(p => this.hasSeenVersion(p.process_name, p.version));

    return {
      totalProcesses: allProcesses.length,
      viewedCount: Object.keys(this.progress.viewedProcesses).length,
      completedCount: Object.keys(this.progress.completedProcesses).length,
      mustKnowTotal: mustKnowProcesses.length,
      mustKnowCompleted: mustKnowCompleted.length,
      mustKnowPending: mustKnowProcesses.length - mustKnowCompleted.length,
      newTotal: newProcesses.length,
      newViewed: newViewed.length,
      newPending: newProcesses.length - newViewed.length,
      updatedTotal: updatedProcesses.length,
      updatedViewed: updatedViewed.length,
      updatedPending: updatedProcesses.length - updatedViewed.length,
      completionPercentage: allProcesses.length > 0 
        ? Math.round((Object.keys(this.progress.completedProcesses).length / allProcesses.length) * 100)
        : 0
    };
  }

  /**
   * Get processes categorized by time period
   */
  getProcessesByTimePeriod(allProcesses) {
    if (!allProcesses) return { thisWeek: [], thisMonth: [], older: [] };

    const now = Date.now();
    const oneWeek = 7 * 24 * 60 * 60 * 1000;
    const oneMonth = 30 * 24 * 60 * 60 * 1000;

    const thisWeek = [];
    const thisMonth = [];
    const older = [];

    allProcesses.forEach(proc => {
      const addedDate = new Date(proc.date_added).getTime();
      const updatedDate = new Date(proc.date_updated).getTime();
      const latestDate = Math.max(addedDate, updatedDate);
      
      const age = now - latestDate;

      if (age < oneWeek) {
        thisWeek.push(proc);
      } else if (age < oneMonth) {
        thisMonth.push(proc);
      } else {
        older.push(proc);
      }
    });

    return { thisWeek, thisMonth, older };
  }
}

// Global instance
const processProgress = new ProcessProgress();
/**
 * SNOOZE FEATURE - Add to captain-process-overlay.js
 * 
 * Features:
 * 1. Snooze button on MUST_KNOW blockers (max 2 times)
 * 2. Snooze duration options (15min, 30min, 1hr)
 * 3. Pulsing animation reminder for snoozed processes
 * 4. Countdown timer showing time remaining
 */

// Add this to the CaptainProcessOverlay class

class ProcessSnoozeManager {
  constructor() {
    this.snoozes = {}; // {processName: {count: 0, snoozedUntil: timestamp}}
    this.MAX_SNOOZES = 2;
    this.loadSnoozes();
  }

  async loadSnoozes() {
    const result = await chrome.storage.local.get(['processSnoozes']);
    this.snoozes = result.processSnoozes || {};
  }

  async saveSnoozes() {
    await chrome.storage.local.set({ processSnoozes: this.snoozes });
  }

  canSnooze(processName) {
    const snooze = this.snoozes[processName];
    if (!snooze) return true; // Never snoozed
    return snooze.count < this.MAX_SNOOZES;
  }

  getSnoozeCount(processName) {
    return this.snoozes[processName]?.count || 0;
  }

  getRemainingSnoozes(processName) {
    return this.MAX_SNOOZES - this.getSnoozeCount(processName);
  }

  isSnoozed(processName) {
    const snooze = this.snoozes[processName];
    if (!snooze || !snooze.snoozedUntil) return false;
    return Date.now() < snooze.snoozedUntil;
  }

  getTimeRemaining(processName) {
    const snooze = this.snoozes[processName];
    if (!snooze || !snooze.snoozedUntil) return 0;
    return Math.max(0, snooze.snoozedUntil - Date.now());
  }

  async snoozeProcess(processName, durationMs) {
    if (!this.canSnooze(processName)) {
      return false;
    }

    const currentSnooze = this.snoozes[processName] || { count: 0 };
    
    this.snoozes[processName] = {
      count: currentSnooze.count + 1,
      snoozedUntil: Date.now() + durationMs,
      lastSnooze: Date.now()
    };

    await this.saveSnoozes();
    return true;
  }

  formatTimeRemaining(ms) {
    const minutes = Math.floor(ms / 60000);
    const hours = Math.floor(minutes / 60);
    
    if (hours > 0) {
      const mins = minutes % 60;
      return `${hours}h ${mins}m`;
    }
    return `${minutes}m`;
  }
}

// Global instance
window.snoozeManager = new ProcessSnoozeManager();


/**
 * ENHANCED BLOCKING OVERLAY WITH SNOOZE
 * 
 * Replace the showBlockingOverlay function in captain-process-overlay.js
 */

async function showBlockingOverlay(process) {
  const { process_name, video_link, priority } = process;
  
  // Check if snoozed
  if (window.snoozeManager.isSnoozed(process_name)) {
    console.log('[Process Overlay] Process is snoozed, not blocking');
    return;
  }

  // Create blocking overlay
  const overlay = document.createElement('div');
  overlay.className = 'captain-blocking-overlay';
  overlay.id = 'captain-blocking-overlay';

  const canSnooze = window.snoozeManager.canSnooze(process_name);
  const snoozeCount = window.snoozeManager.getSnoozeCount(process_name);
  const remainingSnoozes = window.snoozeManager.getRemainingSnoozes(process_name);

  overlay.innerHTML = `
    <div class="blocking-backdrop"></div>
    <div class="blocking-modal">
      <div class="blocking-header">
        <div class="blocking-icon">🚨</div>
        <h2>Required Training - Action Needed</h2>
        <p class="blocking-subtitle">Complete this MUST KNOW training to continue</p>
      </div>

      <div class="blocking-body">
        <div class="blocking-process-card">
          <div class="blocking-priority">🔴 MUST KNOW</div>
          <h3>${process_name}</h3>
          <p>This training is mandatory before accessing this module.</p>
        </div>

        <div class="blocking-actions">
          <button class="blocking-btn blocking-btn-primary" id="watch-now-btn">
            🎥 Watch Training Now
          </button>
          
          ${canSnooze ? `
            <button class="blocking-btn blocking-btn-secondary" id="snooze-btn">
              ⏰ Snooze (${remainingSnoozes} remaining)
            </button>
          ` : `
            <div class="blocking-snooze-exhausted">
              ⚠️ Maximum snoozes used (${snoozeCount}/${window.snoozeManager.MAX_SNOOZES})
            </div>
          `}
        </div>

        ${canSnooze ? `
          <div class="snooze-options" id="snooze-options" style="display: none;">
            <p class="snooze-warning">⚠️ You have ${remainingSnoozes} snooze${remainingSnoozes > 1 ? 's' : ''} left</p>
            <div class="snooze-duration-btns">
              <button class="snooze-duration-btn" data-duration="900000">15 minutes</button>
              <button class="snooze-duration-btn" data-duration="1800000">30 minutes</button>
              <button class="snooze-duration-btn" data-duration="3600000">1 hour</button>
            </div>
          </div>
        ` : ''}
      </div>

      <div class="blocking-footer">
        <small>This overlay will remain until you complete the training or snooze</small>
      </div>
    </div>
  `;

  document.body.appendChild(overlay);

  // Add event listeners
  document.getElementById('watch-now-btn')?.addEventListener('click', () => {
    window.open(video_link, '_blank');
    // Don't remove overlay - they need to mark it complete
  });

  document.getElementById('snooze-btn')?.addEventListener('click', () => {
    const options = document.getElementById('snooze-options');
    if (options) {
      options.style.display = options.style.display === 'none' ? 'block' : 'none';
    }
  });

  document.querySelectorAll('.snooze-duration-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const duration = parseInt(btn.dataset.duration);
      const success = await window.snoozeManager.snoozeProcess(process_name, duration);
      
      if (success) {
        // Show success message
        const modal = document.querySelector('.blocking-modal');
        modal.innerHTML = `
          <div class="snooze-success">
            <div class="snooze-success-icon">✅</div>
            <h2>Process Snoozed</h2>
            <p>${process_name} has been snoozed for ${btn.textContent}</p>
            <p class="snooze-reminder">⏰ You'll be reminded when the time is up</p>
            <button class="blocking-btn blocking-btn-primary" onclick="document.getElementById('captain-blocking-overlay').remove()">
              Continue Working
            </button>
          </div>
        `;

        // Start showing reminder animations
        startSnoozeReminder(process_name);
      }
    });
  });

  console.log('[Process Overlay] Blocking overlay shown');
}


/**
 * SNOOZE REMINDER ANIMATION
 * 
 * Shows pulsing indicator for snoozed processes
 */

function startSnoozeReminder(processName) {
  // Add reminder badge to the overlay button
  const overlayBtn = document.querySelector('.valmo-overlay-btn');
  if (!overlayBtn) return;

  // Create pulsing badge
  const badge = document.createElement('div');
  badge.className = 'snooze-reminder-badge';
  badge.id = `snooze-badge-${processName.replace(/\s/g, '-')}`;
  
  const updateBadge = () => {
    const timeRemaining = window.snoozeManager.getTimeRemaining(processName);
    
    if (timeRemaining <= 0) {
      badge.remove();
      // Re-show blocking overlay
      chrome.storage.local.get(['allProcesses'], (result) => {
        const process = result.allProcesses?.find(p => p.process_name === processName);
        if (process) {
          showBlockingOverlay(process);
        }
      });
      return;
    }

    const formatted = window.snoozeManager.formatTimeRemaining(timeRemaining);
    badge.innerHTML = `
      <div class="snooze-badge-content">
        <span class="snooze-badge-icon">⏰</span>
        <span class="snooze-badge-text">${formatted}</span>
      </div>
    `;

    setTimeout(updateBadge, 10000); // Update every 10 seconds
  };

  overlayBtn.appendChild(badge);
  updateBadge();

  console.log('[Snooze] Reminder started for:', processName);
}


/**
 * CSS FOR SNOOZE FEATURE
 * 
 * Add this to captain-process-overlay.css
 */

const SNOOZE_CSS = `
/* Snooze Options */
.snooze-options {
  margin-top: 16px;
  padding: 16px;
  background: #fff3cd;
  border-radius: 8px;
  border: 2px solid #ffc107;
}

.snooze-warning {
  margin: 0 0 12px 0;
  font-size: 14px;
  font-weight: 600;
  color: #856404;
  text-align: center;
}

.snooze-duration-btns {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 8px;
}

.snooze-duration-btn {
  padding: 12px;
  background: white;
  border: 2px solid #ffc107;
  border-radius: 6px;
  font-size: 14px;
  font-weight: 600;
  color: #856404;
  cursor: pointer;
  transition: all 0.2s ease;
}

.snooze-duration-btn:hover {
  background: #ffc107;
  color: white;
  transform: translateY(-2px);
}

.blocking-snooze-exhausted {
  padding: 12px;
  background: #f8d7da;
  border: 2px solid #dc3545;
  border-radius: 8px;
  color: #721c24;
  font-size: 13px;
  font-weight: 600;
  text-align: center;
}

/* Snooze Success */
.snooze-success {
  text-align: center;
  padding: 40px;
}

.snooze-success-icon {
  font-size: 64px;
  margin-bottom: 20px;
  animation: bounceIn 0.6s ease;
}

.snooze-reminder {
  margin-top: 12px;
  padding: 12px;
  background: #fff3cd;
  border-radius: 8px;
  color: #856404;
  font-size: 14px;
}

/* Snooze Reminder Badge */
.snooze-reminder-badge {
  position: absolute;
  top: -8px;
  right: -8px;
  background: linear-gradient(135deg, #ff9800, #f57c00);
  border-radius: 20px;
  padding: 6px 12px;
  box-shadow: 0 4px 12px rgba(255, 152, 0, 0.4);
  animation: pulse 2s ease infinite;
  z-index: 10;
}

.snooze-badge-content {
  display: flex;
  align-items: center;
  gap: 6px;
  color: white;
  font-size: 12px;
  font-weight: 700;
}

.snooze-badge-icon {
  font-size: 14px;
  animation: swing 1s ease infinite;
}

@keyframes pulse {
  0%, 100% {
    transform: scale(1);
    box-shadow: 0 4px 12px rgba(255, 152, 0, 0.4);
  }
  50% {
    transform: scale(1.05);
    box-shadow: 0 6px 20px rgba(255, 152, 0, 0.6);
  }
}

@keyframes swing {
  0%, 100% { transform: rotate(0deg); }
  25% { transform: rotate(-15deg); }
  75% { transform: rotate(15deg); }
}

@keyframes bounceIn {
  0% {
    transform: scale(0);
    opacity: 0;
  }
  50% {
    transform: scale(1.1);
  }
  100% {
    transform: scale(1);
    opacity: 1;
  }
}
`;

console.log('[Snooze Feature] Loaded');
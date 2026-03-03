/**
 * my-stats-tab.js - Compact Stats View in Extension
 * 
 * Adds a "My Stats" tab to the extension sidebar showing:
 * - Current level & XP
 * - Quick stats (videos, assessments, streak)
 * - Recent achievements
 * - Big button to open Training Games Page
 */

class MyStatsTab {
  constructor() {
    this.userEmail = null;
    this.userProgress = null;
    this.initialized = false;
  }

  /**
   * Initialize stats tab for user
   */
  async init(userEmail) {
    this.userEmail = userEmail;
    console.log('[My Stats] Initializing for:', userEmail);

    // Load user progress from gamification system
    if (window.gamificationSystem && window.gamificationSystem.initialized) {
      this.userProgress = window.gamificationSystem.getStats();
    } else {
      // Load from storage directly
      const storageKey = `gamification_${userEmail}`;
      const result = await chrome.storage.local.get([storageKey]);
      
      if (result[storageKey]) {
        this.userProgress = this.calculateStats(result[storageKey]);
      } else {
        // Default empty stats
        this.userProgress = {
          totalXP: 0,
          level: 1,
          videosWatched: 0,
          assessmentsPassed: 0,
          currentStreak: 0,
          achievements: []
        };
      }
    }

    this.initialized = true;
    console.log('[My Stats] Stats loaded:', this.userProgress);
  }

  /**
   * Calculate stats from raw user data
   */
  calculateStats(userData) {
    const levels = [0, 100, 250, 450, 700, 1000, 1400, 1900, 2500, 3200, 4000, 5000, 6200, 7600, 9200, 11000, 13000, 15500, 18500, 22000];
    let level = 1;
    
    for (let i = levels.length - 1; i >= 0; i--) {
      if (userData.totalXP >= levels[i]) {
        level = i + 1;
        break;
      }
    }

    return {
      totalXP: userData.totalXP || 0,
      level: level,
      videosWatched: userData.stats?.totalVideos || 0,
      assessmentsPassed: userData.stats?.totalAssessments || 0,
      currentStreak: userData.streaks?.current || 0,
      achievements: userData.achievements || []
    };
  }

  /**
   * Inject stats tab into extension sidebar
   */
  injectTab() {
    console.log('[My Stats] Injecting tab...');

    // Add to navigation if it doesn't exist
    const navContainer = document.querySelector('.valmo-nav');
    if (!navContainer) {
      console.warn('[My Stats] Navigation container not found');
      return;
    }

    // Check if tab already exists
    if (document.querySelector('[data-tab="mystats"]')) {
      console.log('[My Stats] Tab already exists');
      return;
    }

    // Create stats tab button
    const statsTabBtn = document.createElement('button');
    statsTabBtn.className = 'valmo-nav-btn';
    statsTabBtn.dataset.tab = 'mystats';
    statsTabBtn.innerHTML = `📊 My Stats`;
    
    // Add after Videos tab
    const videosBtn = document.querySelector('[data-tab="videos"]');
    if (videosBtn) {
      videosBtn.parentNode.insertBefore(statsTabBtn, videosBtn.nextSibling);
    } else {
      navContainer.appendChild(statsTabBtn);
    }

    // Create stats view content
    const contentContainer = document.querySelector('.valmo-content');
    if (!contentContainer) {
      console.warn('[My Stats] Content container not found');
      return;
    }

    const statsView = document.createElement('div');
    statsView.id = 'mystats-view';
    statsView.className = 'valmo-view';
    statsView.innerHTML = this.renderStatsHTML();
    
    contentContainer.appendChild(statsView);

    // Attach event listeners
    this.attachListeners();

    console.log('[My Stats] ✅ Tab injected');
  }

  /**
   * Render stats HTML
   */
  renderStatsHTML() {
    if (!this.userProgress) {
      return `
        <div class="mystats-loading">
          <div class="loading-spinner-small"></div>
          <p>Loading your stats...</p>
        </div>
      `;
    }

    const { totalXP, level, videosWatched, assessmentsPassed, currentStreak, achievements } = this.userProgress;
    const rankName = this.getRankName(level);
    const nextLevelXP = this.getNextLevelXP(level);
    const currentLevelXP = this.getCurrentLevelXP(level);
    const progress = Math.floor(((totalXP - currentLevelXP) / (nextLevelXP - currentLevelXP)) * 100);

    return `
      <div class="mystats-container">
        
        <!-- Profile Summary -->
        <div class="mystats-profile">
          <div class="mystats-level-badge">
            <div class="mystats-level-number">${level}</div>
            <div class="mystats-level-label">Level</div>
          </div>
          <div class="mystats-profile-info">
            <div class="mystats-rank">${rankName}</div>
            <div class="mystats-xp">${totalXP} XP</div>
          </div>
        </div>

        <!-- XP Progress Bar -->
        <div class="mystats-progress">
          <div class="mystats-progress-header">
            <span>Progress to Level ${level + 1}</span>
            <span>${progress}%</span>
          </div>
          <div class="mystats-progress-bar">
            <div class="mystats-progress-fill" style="width: ${progress}%"></div>
          </div>
          <div class="mystats-progress-text">${totalXP - currentLevelXP} / ${nextLevelXP - currentLevelXP} XP</div>
        </div>

        <!-- Quick Stats Grid -->
        <div class="mystats-grid">
          <div class="mystats-stat">
            <div class="mystats-stat-icon">📹</div>
            <div class="mystats-stat-value">${videosWatched}</div>
            <div class="mystats-stat-label">Videos</div>
          </div>
          <div class="mystats-stat">
            <div class="mystats-stat-icon">📝</div>
            <div class="mystats-stat-value">${assessmentsPassed}</div>
            <div class="mystats-stat-label">Assessments</div>
          </div>
          <div class="mystats-stat">
            <div class="mystats-stat-icon">🔥</div>
            <div class="mystats-stat-value">${currentStreak}</div>
            <div class="mystats-stat-label">Day Streak</div>
          </div>
          <div class="mystats-stat">
            <div class="mystats-stat-icon">🏅</div>
            <div class="mystats-stat-value">${achievements.length}</div>
            <div class="mystats-stat-label">Achievements</div>
          </div>
        </div>

        <!-- Recent Achievements -->
        ${achievements.length > 0 ? `
          <div class="mystats-achievements">
            <h4>🏆 Recent Achievements</h4>
            <div class="mystats-achievement-list">
              ${achievements.slice(-3).reverse().map(ach => `
                <div class="mystats-achievement-item">
                  <span class="mystats-achievement-icon">${ach.icon}</span>
                  <div class="mystats-achievement-details">
                    <div class="mystats-achievement-name">${ach.name}</div>
                    <div class="mystats-achievement-time">${this.timeAgo(ach.unlockedAt)}</div>
                  </div>
                </div>
              `).join('')}
            </div>
          </div>
        ` : ''}

        <!-- Open Training Hub Button -->
        <button class="mystats-open-hub-btn" id="open-training-hub-btn">
          <span class="mystats-hub-icon">🎮</span>
          <div class="mystats-hub-text">
            <div class="mystats-hub-title">Open Training Hub</div>
            <div class="mystats-hub-subtitle">View full dashboard, leaderboard & games</div>
          </div>
          <span class="mystats-hub-arrow">→</span>
        </button>

        <!-- Quick Links -->
        <div class="mystats-quick-links">
          <button class="mystats-quick-link" onclick="window.overlayInstance.openPanel(); window.overlayInstance.switchToTab('videos')">
            📚 Browse Training
          </button>
          <button class="mystats-quick-link" id="refresh-stats-btn">
            🔄 Refresh Stats
          </button>
        </div>

      </div>
    `;
  }

  /**
   * Attach event listeners
   */
  attachListeners() {
    // Tab switching
    const statsBtn = document.querySelector('[data-tab="mystats"]');
    if (statsBtn) {
      statsBtn.addEventListener('click', () => {
        document.querySelectorAll('.valmo-nav-btn').forEach(b => b.classList.remove('active'));
        document.querySelectorAll('.valmo-view').forEach(v => v.classList.remove('active'));
        
        statsBtn.classList.add('active');
        document.getElementById('mystats-view').classList.add('active');
      });
    }

    // Open Training Hub button
    const openHubBtn = document.getElementById('open-training-hub-btn');
    if (openHubBtn) {
      openHubBtn.addEventListener('click', () => {
        this.openTrainingHub();
      });
    }

    // Refresh stats button
    const refreshBtn = document.getElementById('refresh-stats-btn');
    if (refreshBtn) {
      refreshBtn.addEventListener('click', async () => {
        refreshBtn.textContent = '⏳ Refreshing...';
        await this.init(this.userEmail);
        this.updateStatsDisplay();
        refreshBtn.textContent = '✓ Refreshed!';
        setTimeout(() => {
          refreshBtn.textContent = '🔄 Refresh Stats';
        }, 2000);
      });
    }
  }

  /**
   * Open Training Hub in new tab with user authentication
   */
  openTrainingHub() {
    console.log('[My Stats] Opening Training Hub...');

    // Get Training Hub URL from config or use default
    // TODO: Update this URL to your actual GitHub Pages URL
    const TRAINING_HUB_URL = 'https://pranavak3704.github.io/valmo-ops/';
    
    // Generate a simple token (in production, use proper JWT or session token)
    const token = btoa(`${this.userEmail}:${Date.now()}`);
    
    // Construct URL with user authentication
    const url = `${TRAINING_HUB_URL}?email=${encodeURIComponent(this.userEmail)}&token=${encodeURIComponent(token)}`;
    
    // Open in new tab
    window.open(url, '_blank');
    
    console.log('[My Stats] Training Hub opened');
  }

  /**
   * Update stats display (without full re-render)
   */
  updateStatsDisplay() {
    const view = document.getElementById('mystats-view');
    if (view) {
      view.innerHTML = this.renderStatsHTML();
      this.attachListeners();
    }
  }

  /**
   * Get rank name for level
   */
  getRankName(level) {
    if (level >= 20) return '🏆 Master Captain';
    if (level >= 15) return '⭐ Expert Captain';
    if (level >= 10) return '💎 Senior Captain';
    if (level >= 7) return '🎯 Captain';
    if (level >= 5) return '📚 Specialist';
    if (level >= 3) return '🌟 Learner';
    return '🆕 Rookie';
  }

  /**
   * Get current level's starting XP
   */
  getCurrentLevelXP(level) {
    const levels = [0, 100, 250, 450, 700, 1000, 1400, 1900, 2500, 3200, 4000, 5000, 6200, 7600, 9200, 11000, 13000, 15500, 18500, 22000];
    return levels[level - 1] || 0;
  }

  /**
   * Get next level's XP requirement
   */
  getNextLevelXP(level) {
    const levels = [0, 100, 250, 450, 700, 1000, 1400, 1900, 2500, 3200, 4000, 5000, 6200, 7600, 9200, 11000, 13000, 15500, 18500, 22000];
    return levels[level] || (levels[levels.length - 1] + (level - levels.length + 1) * 3000);
  }

  /**
   * Format time ago
   */
  timeAgo(timestamp) {
    const now = Date.now();
    const diff = now - timestamp;
    const days = Math.floor(diff / 86400000);
    const hours = Math.floor(diff / 3600000);
    
    if (days > 0) return `${days}d ago`;
    if (hours > 0) return `${hours}h ago`;
    return 'Recently';
  }
}

// Global instance
window.myStatsTab = new MyStatsTab();

console.log('[My Stats] System loaded');
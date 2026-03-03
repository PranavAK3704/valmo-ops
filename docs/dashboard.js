/**
 * dashboard.js - Main Training Hub Logic
 * 
 * Handles:
 * - Page initialization
 * - User authentication
 * - Tab switching
 * - Data loading and display
 * - User progress tracking
 */

// Global state
const AppState = {
  currentUser: null,
  userProgress: null,
  allProcesses: [],
  leaderboard: [],
  currentTab: 'dashboard',
  initialized: false
};

// ═══════════════════════════════════════════════════════════════
// INITIALIZATION
// ═══════════════════════════════════════════════════════════════

document.addEventListener('DOMContentLoaded', async () => {
  console.log('[Dashboard] Initializing...');
  
  // Get user from URL parameters
  const user = getUserFromURL();
  
  if (!user) {
    console.warn('[Dashboard] No user provided, using demo');
    AppState.currentUser = { email: 'demo@valmo.com', name: 'Demo User' };
  } else {
    AppState.currentUser = user;
  }
  
  console.log('[Dashboard] Current user:', AppState.currentUser);
  
  // Initialize
  await init();
});

/**
 * Extract user info from URL parameters
 */
function getUserFromURL() {
  const params = new URLSearchParams(window.location.search);
  
  const email = params.get('email') || params.get('user');
  const name = params.get('name');
  const token = params.get('token');
  
  if (!email) return null;
  
  return {
    email: email,
    name: name || email.split('@')[0],
    token: token
  };
}

/**
 * Main initialization
 */
async function init() {
  try {
    // Show loading screen
    showLoading(true);
    
    // Load user progress
    AppState.userProgress = await API.getUserProgress(AppState.currentUser.email);
    console.log('[Dashboard] User progress:', AppState.userProgress);
    
    // Load all data
    await Promise.all([
      loadProcesses(),
      loadLeaderboard()
    ]);
    
    // Setup UI
    setupTabSwitching();
    setupUserProfile();
    renderDashboard();
    renderTrainingTab();
    renderLeaderboard();
    renderAchievements();
    
    // Hide loading screen
    setTimeout(() => {
      showLoading(false);
      AppState.initialized = true;
      console.log('[Dashboard] ✅ Initialized');
    }, 800);
    
  } catch (error) {
    console.error('[Dashboard] Init error:', error);
    showLoading(false);
  }
}

function showLoading(show) {
  const loadingScreen = document.getElementById('loading-screen');
  const mainContainer = document.getElementById('main-container');
  
  if (show) {
    loadingScreen.classList.remove('hidden');
    mainContainer.classList.add('hidden');
  } else {
    loadingScreen.classList.add('hidden');
    mainContainer.classList.remove('hidden');
  }
}

// ═══════════════════════════════════════════════════════════════
// DATA LOADING
// ═══════════════════════════════════════════════════════════════

async function loadProcesses() {
  console.log('[Dashboard] Loading processes...');
  AppState.allProcesses = await API.getProcesses();
  console.log('[Dashboard] Loaded', AppState.allProcesses.length, 'processes');
}

async function loadLeaderboard() {
  console.log('[Dashboard] Loading leaderboard...');
  AppState.leaderboard = await API.getLeaderboard();
  console.log('[Dashboard] Loaded', AppState.leaderboard.length, 'leaderboard entries');
}

// ═══════════════════════════════════════════════════════════════
// TAB SWITCHING
// ═══════════════════════════════════════════════════════════════

function setupTabSwitching() {
  const tabs = document.querySelectorAll('.nav-tab');
  
  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      const tabName = tab.dataset.tab;
      switchTab(tabName);
    });
  });
}

function switchTab(tabName) {
  console.log('[Dashboard] Switching to tab:', tabName);
  
  // Update nav tabs
  document.querySelectorAll('.nav-tab').forEach(tab => {
    tab.classList.remove('active');
  });
  document.querySelector(`[data-tab="${tabName}"]`).classList.add('active');
  
  // Update content
  document.querySelectorAll('.tab-content').forEach(content => {
    content.classList.remove('active');
  });
  document.getElementById(`${tabName}-tab`).classList.add('active');
  
  AppState.currentTab = tabName;
}

// Make globally accessible for quick actions
window.switchTab = switchTab;

// ═══════════════════════════════════════════════════════════════
// USER PROFILE
// ═══════════════════════════════════════════════════════════════

function setupUserProfile() {
  const { email, name } = AppState.currentUser;
  const { totalXP, level } = AppState.userProgress;
  
  // Get initials
  const initials = name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2);
  
  // Update header profile
  document.getElementById('user-initials').textContent = initials;
  document.getElementById('user-name').textContent = name;
  document.getElementById('user-rank').textContent = getRankName(level);
  
  // Update profile card
  document.getElementById('profile-initials').textContent = initials;
  document.getElementById('profile-name').textContent = name;
  document.getElementById('profile-email').textContent = email;
  document.getElementById('profile-avatar-large').style.background = getAvatarGradient(email);
  document.getElementById('user-avatar').style.background = getAvatarGradient(email);
}

function getAvatarGradient(email) {
  // Generate consistent gradient from email
  const hash = email.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
  const hue1 = hash % 360;
  const hue2 = (hash + 60) % 360;
  return `linear-gradient(135deg, hsl(${hue1}, 70%, 60%), hsl(${hue2}, 70%, 50%))`;
}

function getRankName(level) {
  if (level >= 20) return '🏆 Master Captain';
  if (level >= 15) return '⭐ Expert Captain';
  if (level >= 10) return '💎 Senior Captain';
  if (level >= 7) return '🎯 Captain';
  if (level >= 5) return '📚 Specialist';
  if (level >= 3) return '🌟 Learner';
  return '🆕 Rookie';
}

// ═══════════════════════════════════════════════════════════════
// DASHBOARD TAB
// ═══════════════════════════════════════════════════════════════

function renderDashboard() {
  renderLevelCard();
  renderStatsCard();
  renderActivityFeed();
}

function renderLevelCard() {
  const { totalXP, level } = AppState.userProgress;
  
  // Calculate XP for levels
  const levels = [0, 100, 250, 450, 700, 1000, 1400, 1900, 2500, 3200, 4000, 5000, 6200, 7600, 9200, 11000, 13000, 15500, 18500, 22000];
  const currentLevelXP = levels[level - 1] || 0;
  const nextLevelXP = levels[level] || (levels[levels.length - 1] + (level - levels.length + 1) * 3000);
  
  const xpIntoLevel = totalXP - currentLevelXP;
  const xpNeeded = nextLevelXP - currentLevelXP;
  const progress = Math.floor((xpIntoLevel / xpNeeded) * 100);
  
  document.getElementById('level-number').textContent = level;
  document.getElementById('level-rank').textContent = getRankName(level);
  document.getElementById('xp-value').textContent = `${xpIntoLevel} / ${xpNeeded} XP`;
  document.getElementById('xp-bar-fill').style.width = `${progress}%`;
  document.getElementById('xp-next-level').textContent = `${nextLevelXP - totalXP} XP to Level ${level + 1}`;
}

function renderStatsCard() {
  const { stats, streak, assessmentScores } = AppState.userProgress;
  const totalProcesses = AppState.allProcesses.length;
  
  document.getElementById('stat-videos').textContent = `${stats.totalVideos} / ${totalProcesses}`;
  document.getElementById('stat-assessments').textContent = `${stats.totalAssessments} / ${totalProcesses}`;
  document.getElementById('stat-avg-score').textContent = `${stats.averageScore || 0}%`;
  document.getElementById('stat-streak').textContent = `${streak.current} days`;
}

function renderActivityFeed() {
  const { history } = AppState.userProgress;
  const activityList = document.getElementById('activity-list');
  
  if (!history || history.length === 0) {
    activityList.innerHTML = `
      <div class="activity-empty">
        <div class="activity-empty-icon">📭</div>
        <p>No recent activity</p>
        <small>Complete training to see your progress here</small>
      </div>
    `;
    return;
  }
  
  const recent = history.slice(0, 10);
  activityList.innerHTML = recent.map(item => `
    <div class="activity-item">
      <div class="activity-icon">${getActivityIcon(item.type)}</div>
      <div class="activity-details">
        <div class="activity-text">${item.reason}</div>
        <div class="activity-time">${formatTimeAgo(item.timestamp)}</div>
      </div>
      <div class="activity-xp">+${item.amount} XP</div>
    </div>
  `).join('');
}

function getActivityIcon(type) {
  const icons = {
    xp: '⚡',
    video: '📹',
    assessment: '📝',
    achievement: '🏅',
    streak: '🔥'
  };
  return icons[type] || '⭐';
}

function formatTimeAgo(timestamp) {
  const now = Date.now();
  const diff = now - timestamp;
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);
  
  if (days > 0) return `${days}d ago`;
  if (hours > 0) return `${hours}h ago`;
  if (minutes > 0) return `${minutes}m ago`;
  return 'Just now';
}

// ═══════════════════════════════════════════════════════════════
// TRAINING TAB
// ═══════════════════════════════════════════════════════════════

function renderTrainingTab() {
  const processList = document.getElementById('process-list');
  
  if (AppState.allProcesses.length === 0) {
    processList.innerHTML = `
      <div class="loading-processes">
        <p>No training processes available</p>
      </div>
    `;
    return;
  }
  
  processList.innerHTML = AppState.allProcesses.map(proc => {
    const isCompleted = AppState.userProgress.assessmentsPassed.includes(proc.Process_Name);
    const videoWatched = AppState.userProgress.videosWatched.includes(proc.Process_Name);
    
    return `
      <div class="process-card" data-process="${proc.Process_Name}">
        <div class="process-header">
          <div class="process-priority ${proc.Priority === 'MUST_KNOW' ? 'must-know' : 'good-to-know'}">
            ${proc.Priority === 'MUST_KNOW' ? '🔴' : '🟡'}
          </div>
          <div class="process-title-section">
            <div class="process-name">${proc.Process_Name}</div>
            <div class="process-badges">
              ${proc.Status === 'NEW' ? '<span class="process-badge new">NEW</span>' : ''}
              ${proc.Status === 'UPDATED' ? '<span class="process-badge updated">UPDATED</span>' : ''}
            </div>
          </div>
        </div>
        
        <div class="process-status ${isCompleted ? 'complete' : videoWatched ? 'video-done' : 'pending'}">
          ${isCompleted ? '✅ 100% Complete' : videoWatched ? '⏳ Video Done - Assessment Pending' : '❌ Not Started'}
        </div>
        
        <div class="process-actions">
          <button class="process-action-btn primary" onclick="watchVideo('${proc.Process_Name}', '${proc.Video_Link}')">
            ${videoWatched ? '🎥 Watch Again' : '🎥 Watch Video'}
          </button>
          ${!isCompleted ? `
            <button class="process-action-btn secondary" onclick="takeAssessment('${proc.Process_Name}')">
              📝 Take Assessment
            </button>
          ` : ''}
        </div>
      </div>
    `;
  }).join('');
  
  // Setup filters
  setupTrainingFilters();
}

function setupTrainingFilters() {
  const filterBtns = document.querySelectorAll('.filter-btn');
  
  filterBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      // Update active state
      filterBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      
      // Filter processes
      const filter = btn.dataset.filter;
      filterProcesses(filter);
    });
  });
}

function filterProcesses(filter) {
  const cards = document.querySelectorAll('.process-card');
  
  cards.forEach(card => {
    const processName = card.dataset.process;
    const process = AppState.allProcesses.find(p => p.Process_Name === processName);
    const isCompleted = AppState.userProgress.assessmentsPassed.includes(processName);
    const videoWatched = AppState.userProgress.videosWatched.includes(processName);
    
    let show = true;
    
    if (filter === 'must-know') {
      show = process.Priority === 'MUST_KNOW';
    } else if (filter === 'good-to-know') {
      show = process.Priority === 'GOOD_TO_KNOW';
    } else if (filter === 'completed') {
      show = isCompleted;
    } else if (filter === 'pending') {
      show = !isCompleted;
    }
    
    card.style.display = show ? 'block' : 'none';
  });
}

// ═══════════════════════════════════════════════════════════════
// LEADERBOARD TAB
// ═══════════════════════════════════════════════════════════════

function renderLeaderboard() {
  const tbody = document.getElementById('leaderboard-tbody');
  const { totalXP, level } = AppState.userProgress;
  const currentUserEmail = AppState.currentUser.email;
  
  if (AppState.leaderboard.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="7" class="leaderboard-loading">
          <p>No leaderboard data available</p>
        </td>
      </tr>
    `;
    return;
  }
  
  // Sort by XP
  const sorted = AppState.leaderboard.sort((a, b) => parseInt(b.totalXP) - parseInt(a.totalXP));
  
  // Find user rank
  const userRank = sorted.findIndex(u => u.email === currentUserEmail) + 1;
  
  // Update your rank card
  if (userRank > 0) {
    document.getElementById('your-rank-number').textContent = `#${userRank}`;
    document.getElementById('your-rank-xp').textContent = `${totalXP} XP`;
    
    if (userRank > 1) {
      const xpBehind = parseInt(sorted[userRank - 2].totalXP) - totalXP;
      document.getElementById('your-rank-behind').textContent = `${xpBehind} XP behind #${userRank - 1}`;
    } else {
      document.getElementById('your-rank-behind').textContent = '🏆 You\'re #1!';
    }
  }
  
  // Render table
  tbody.innerHTML = sorted.map((user, idx) => {
    const rank = idx + 1;
    const isCurrentUser = user.email === currentUserEmail;
    
    return `
      <tr class="${isCurrentUser ? 'highlight' : ''}">
        <td>
          <span class="rank-badge ${rank === 1 ? 'gold' : rank === 2 ? 'silver' : rank === 3 ? 'bronze' : 'default'}">
            ${rank === 1 ? '🥇' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : rank}
          </span>
        </td>
        <td><strong>${user.name}</strong></td>
        <td>${user.level}</td>
        <td><strong>${user.totalXP} XP</strong></td>
        <td>${user.videosCompleted || 0}</td>
        <td>${user.assessmentsPassed || 0}</td>
        <td>${user.streak || 0} 🔥</td>
      </tr>
    `;
  }).join('');
}

// ═══════════════════════════════════════════════════════════════
// ACHIEVEMENTS TAB
// ═══════════════════════════════════════════════════════════════

function renderAchievements() {
  const grid = document.getElementById('achievements-grid');
  
  const allAchievements = [
    { id: 'first_video', name: 'First Steps', description: 'Watch your first training video', icon: '🎬', xp: 20 },
    { id: 'first_assessment', name: 'Knowledge Tested', description: 'Pass your first assessment', icon: '📝', xp: 30 },
    { id: 'knowledge_seeker', name: 'Knowledge Seeker', description: 'Complete 10 training processes', icon: '🎓', xp: 50 },
    { id: 'streak_master', name: 'Streak Master', description: 'Maintain a 7-day learning streak', icon: '🔥', xp: 50 },
    { id: 'perfectionist', name: 'Perfectionist', description: 'Score 100% on an assessment', icon: '💯', xp: 40 },
    { id: 'speed_learner', name: 'Speed Learner', description: 'Complete 5 processes in one day', icon: '⚡', xp: 40 },
    { id: 'dedicated_learner', name: 'Dedicated Learner', description: 'Maintain a 30-day streak', icon: '🏆', xp: 100 }
  ];
  
  const unlocked = AppState.userProgress.achievements.map(a => a.id);
  
  document.getElementById('achievements-unlocked').textContent = unlocked.length;
  document.getElementById('achievements-total').textContent = allAchievements.length;
  
  grid.innerHTML = allAchievements.map(achievement => {
    const isUnlocked = unlocked.includes(achievement.id);
    
    return `
      <div class="achievement-card ${isUnlocked ? 'unlocked' : 'locked'}">
        ${isUnlocked ? '<div class="achievement-unlocked-badge">✓</div>' : ''}
        <div class="achievement-icon">${achievement.icon}</div>
        <div class="achievement-name">${achievement.name}</div>
        <div class="achievement-description">${achievement.description}</div>
        <div class="achievement-xp">+${achievement.xp} XP</div>
      </div>
    `;
  }).join('');
}

// ═══════════════════════════════════════════════════════════════
// ACTIONS
// ═══════════════════════════════════════════════════════════════

function watchVideo(processName, videoLink) {
  console.log('[Dashboard] Opening video:', processName);
  
  // Open video in new tab
  window.open(videoLink, '_blank');
  
  // Mark as watched if not already
  if (!AppState.userProgress.videosWatched.includes(processName)) {
    AppState.userProgress.videosWatched.push(processName);
    AppState.userProgress.stats.totalVideos++;
    
    // Award XP (basic - can enhance later)
    AppState.userProgress.totalXP += 10;
    
    // Save progress
    API.saveUserProgress(AppState.currentUser.email, AppState.userProgress);
    
    // Re-render
    renderDashboard();
    renderTrainingTab();
  }
}

function takeAssessment(processName) {
  console.log('[Dashboard] Taking assessment:', processName);
  
  // This will be handled by assessment.js
  // For now, just log
  alert(`Assessment for "${processName}" will open here.\n\nThis will be implemented in assessment.js with:\n- Questions from Google Sheets\n- AI grading with Groq\n- XP rewards`);
}

function openJarvis() {
  window.open('https://ai-assistant-trainer-651608447704.asia-southeast1.run.app/', '_blank');
}

// Make functions globally accessible
window.watchVideo = watchVideo;
window.takeAssessment = takeAssessment;
window.openJarvis = openJarvis;

console.log('[Dashboard] Loaded');
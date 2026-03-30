/**
 * gamification-system.js - Core Gamification Engine
 * 
 * Handles:
 * - XP calculation and tracking
 * - Level progression (1-20)
 * - Achievement system
 * - Streak tracking
 * - Score syncing to Google Sheets
 */

class GamificationSystem {
  constructor() {
    this.userEmail = null;
    this.userData = null;
    this.initialized = false;
  }

  /**
   * Initialize gamification for user
   */
  async init(userEmail) {
    this.userEmail = userEmail;
    console.log('[Gamification] Initializing for:', userEmail);

    // Load user data from storage
    const storageKey = `gamification_${userEmail}`;
    const result = await chrome.storage.local.get([storageKey]);

    if (result[storageKey]) {
      this.userData = result[storageKey];
      console.log('[Gamification] Loaded existing data:', this.userData);
    } else {
      // Initialize new user
      this.userData = {
        email: userEmail,
        totalXP: 0,
        level: 1,
        videosWatched: [],
        assessmentsPassed: [],
        assessmentScores: {},
        achievements: [],
        streaks: {
          current: 0,
          longest: 0,
          lastActive: null
        },
        stats: {
          totalVideos: 0,
          totalAssessments: 0,
          averageScore: 0,
          firstAttemptPasses: 0
        },
        history: [],
        createdAt: Date.now(),
        lastUpdated: Date.now()
      };
      await this.save();
      console.log('[Gamification] Created new user profile');
    }

    // Update streak
    this.updateStreak();

    this.initialized = true;
    return this.userData;
  }

  /**
   * Save user data to storage and sync to Google Sheets
   */
  async save() {
    if (!this.userEmail || !this.userData) return;

    this.userData.lastUpdated = Date.now();
    const storageKey = `gamification_${this.userEmail}`;
    
    await chrome.storage.local.set({
      [storageKey]: this.userData
    });

    // Sync to leaderboard (debounced)
    this.syncToLeaderboard();

    console.log('[Gamification] Data saved:', this.userData);
  }

  /**
   * Award XP and check for level up
   */
  async awardXP(amount, reason) {
    if (!this.initialized) {
      console.error('[Gamification] Not initialized!');
      return;
    }

    const oldLevel = this.userData.level;
    const oldXP = this.userData.totalXP;

    this.userData.totalXP += amount;

    // Calculate new level
    const newLevel = this.calculateLevel(this.userData.totalXP);
    const leveledUp = newLevel > oldLevel;

    if (leveledUp) {
      this.userData.level = newLevel;
      console.log(`[Gamification] 🎉 LEVEL UP! ${oldLevel} → ${newLevel}`);
    }

    // Add to history
    this.userData.history.unshift({
      type: 'xp',
      amount: amount,
      reason: reason,
      timestamp: Date.now(),
      levelUp: leveledUp ? newLevel : null
    });

    // Keep only last 50 history items
    if (this.userData.history.length > 50) {
      this.userData.history = this.userData.history.slice(0, 50);
    }

    await this.save();

    console.log(`[Gamification] +${amount} XP for: ${reason}`);
    console.log(`[Gamification] Total XP: ${oldXP} → ${this.userData.totalXP}`);

    // Sync to Supabase
    if (typeof supabaseSync !== 'undefined') {
      supabaseSync.syncXP(this.userEmail, amount, reason, null, leveledUp ? newLevel : null);
      if (leveledUp) supabaseSync.syncLevelUp(this.userEmail, newLevel);
      // Keep profile row current with latest XP + level
      supabaseSync.upsert('agent_profiles', {
        email:      this.userEmail,
        level:      this.userData.level,
        total_xp:   this.userData.totalXP,
        streak_current: this.userData.streaks.current,
        streak_longest: this.userData.streaks.longest,
        last_active: new Date().toISOString(),
        updated_at:  new Date().toISOString()
      }, 'email');
    }

    return {
      xpGained: amount,
      totalXP: this.userData.totalXP,
      leveledUp: leveledUp,
      newLevel: newLevel,
      oldLevel: oldLevel
    };
  }

  /**
   * Calculate level from XP
   * Level 1: 0 XP
   * Level 2: 100 XP
   * Level 3: 250 XP
   * Level 4: 450 XP
   * Level 5: 700 XP
   * +250 XP per level after that with scaling
   */
  calculateLevel(xp) {
    const levels = [
      0,     // Level 1
      100,   // Level 2
      250,   // Level 3
      450,   // Level 4
      700,   // Level 5
      1000,  // Level 6
      1400,  // Level 7
      1900,  // Level 8
      2500,  // Level 9
      3200,  // Level 10
      4000,  // Level 11
      5000,  // Level 12
      6200,  // Level 13
      7600,  // Level 14
      9200,  // Level 15
      11000, // Level 16
      13000, // Level 17
      15500, // Level 18
      18500, // Level 19
      22000  // Level 20
    ];

    for (let i = levels.length - 1; i >= 0; i--) {
      if (xp >= levels[i]) {
        return i + 1;
      }
    }

    return 1;
  }

  /**
   * Get XP required for next level
   */
  getXPForNextLevel(currentLevel) {
    const levels = [0, 100, 250, 450, 700, 1000, 1400, 1900, 2500, 3200, 4000, 5000, 6200, 7600, 9200, 11000, 13000, 15500, 18500, 22000];
    
    if (currentLevel >= levels.length) {
      return levels[levels.length - 1] + (currentLevel - levels.length + 1) * 3000;
    }
    
    return levels[currentLevel];
  }

  /**
   * Get progress to next level (0-100)
   */
  getLevelProgress() {
    const currentLevel = this.userData.level;
    const currentXP = this.userData.totalXP;
    const currentLevelXP = this.getXPForNextLevel(currentLevel - 1);
    const nextLevelXP = this.getXPForNextLevel(currentLevel);

    const xpIntoLevel = currentXP - currentLevelXP;
    const xpNeeded = nextLevelXP - currentLevelXP;

    return Math.floor((xpIntoLevel / xpNeeded) * 100);
  }

  /**
   * Award XP for watching video
   */
  async watchVideo(processName, isNew = false, isUpdated = false) {
    let xp = 10; // Base XP for watching
    let reason = `Watched ${processName}`;

    if (isNew) {
      xp += 10;
      reason += ' [NEW]';
    } else if (isUpdated) {
      xp += 5;
      reason += ' [UPDATED]';
    }

    // Track video
    if (!this.userData.videosWatched.includes(processName)) {
      this.userData.videosWatched.push(processName);
      this.userData.stats.totalVideos++;
    }

    await this.awardXP(xp, reason);

    // Check achievements
    await this.checkAchievements();

    return xp;
  }

  /**
   * Award XP for passing assessment
   */
  async passAssessment(processName, score, isMustKnow = false, isFirstAttempt = false) {
    let xp = isMustKnow ? 40 : 20; // Base XP
    let reason = `Passed ${processName} assessment (${score}%)`;

    if (isFirstAttempt) {
      xp += 10;
      reason += ' [First Attempt]';
      this.userData.stats.firstAttemptPasses++;
    }

    // Bonus XP for high scores
    if (score >= 90) {
      xp += 10;
      reason += ' [Excellence Bonus]';
    }

    // Track assessment
    if (!this.userData.assessmentsPassed.includes(processName)) {
      this.userData.assessmentsPassed.push(processName);
      this.userData.stats.totalAssessments++;
    }

    // Store score
    this.userData.assessmentScores[processName] = {
      score: score,
      date: Date.now(),
      firstAttempt: isFirstAttempt
    };

    // Update average score
    const allScores = Object.values(this.userData.assessmentScores).map(s => s.score);
    this.userData.stats.averageScore = Math.floor(
      allScores.reduce((a, b) => a + b, 0) / allScores.length
    );

    await this.awardXP(xp, reason);

    // Check achievements
    await this.checkAchievements();

    return xp;
  }

  /**
   * Update streak tracking
   */
  updateStreak() {
    const now = Date.now();
    const lastActive = this.userData.streaks.lastActive;
    const oneDayMs = 24 * 60 * 60 * 1000;

    if (!lastActive) {
      // First time
      this.userData.streaks.current = 1;
      this.userData.streaks.lastActive = now;
      return;
    }

    const daysSinceActive = Math.floor((now - lastActive) / oneDayMs);

    if (daysSinceActive === 0) {
      // Same day, no change
      return;
    } else if (daysSinceActive === 1) {
      // Next day, increment streak
      this.userData.streaks.current++;
      this.userData.streaks.lastActive = now;

      // Update longest
      if (this.userData.streaks.current > this.userData.streaks.longest) {
        this.userData.streaks.longest = this.userData.streaks.current;
      }

      // Award streak bonuses
      this.awardStreakBonus();
    } else {
      // Streak broken
      console.log('[Gamification] Streak broken!');
      this.userData.streaks.current = 1;
      this.userData.streaks.lastActive = now;
    }

    this.save();
  }

  /**
   * Award bonus XP for streaks
   */
  async awardStreakBonus() {
    const streak = this.userData.streaks.current;

    if (streak === 3) {
      await this.awardXP(25, '🔥 3-day streak bonus');
    } else if (streak === 7) {
      await this.awardXP(50, '🔥 7-day streak bonus');
      await this.unlockAchievement('streak_master');
    } else if (streak === 14) {
      await this.awardXP(100, '🔥 14-day streak bonus');
    } else if (streak === 30) {
      await this.awardXP(200, '🔥 30-day streak bonus');
      await this.unlockAchievement('dedicated_learner');
    }
  }

  /**
   * Check and unlock achievements
   */
  async checkAchievements() {
    const achievements = [
      {
        id: 'first_video',
        name: 'First Steps',
        description: 'Watch your first training video',
        icon: '🎬',
        xp: 20,
        condition: () => this.userData.stats.totalVideos >= 1
      },
      {
        id: 'first_assessment',
        name: 'Knowledge Tested',
        description: 'Pass your first assessment',
        icon: '📝',
        xp: 30,
        condition: () => this.userData.stats.totalAssessments >= 1
      },
      {
        id: 'knowledge_seeker',
        name: 'Knowledge Seeker',
        description: 'Complete 10 training processes',
        icon: '🎓',
        xp: 50,
        condition: () => this.userData.assessmentsPassed.length >= 10
      },
      {
        id: 'streak_master',
        name: 'Streak Master',
        description: 'Maintain a 7-day learning streak',
        icon: '🔥',
        xp: 50,
        condition: () => this.userData.streaks.current >= 7
      },
      {
        id: 'perfectionist',
        name: 'Perfectionist',
        description: 'Score 100% on an assessment',
        icon: '💯',
        xp: 40,
        condition: () => Object.values(this.userData.assessmentScores).some(s => s.score === 100)
      },
      {
        id: 'speed_learner',
        name: 'Speed Learner',
        description: 'Complete 5 processes in one day',
        icon: '⚡',
        xp: 40,
        condition: () => {
          const today = new Date().toDateString();
          const todayHistory = this.userData.history.filter(h => 
            new Date(h.timestamp).toDateString() === today &&
            h.reason.includes('Passed')
          );
          return todayHistory.length >= 5;
        }
      },
      {
        id: 'dedicated_learner',
        name: 'Dedicated Learner',
        description: 'Maintain a 30-day streak',
        icon: '🏆',
        xp: 100,
        condition: () => this.userData.streaks.current >= 30
      }
    ];

    for (const achievement of achievements) {
      // Skip if already unlocked
      if (this.userData.achievements.some(a => a.id === achievement.id)) {
        continue;
      }

      // Check condition
      if (achievement.condition()) {
        await this.unlockAchievement(achievement.id);
      }
    }
  }

  /**
   * Unlock achievement
   */
  async unlockAchievement(achievementId) {
    const achievementDefs = {
      first_video: { name: 'First Steps', icon: '🎬', xp: 20 },
      first_assessment: { name: 'Knowledge Tested', icon: '📝', xp: 30 },
      knowledge_seeker: { name: 'Knowledge Seeker', icon: '🎓', xp: 50 },
      streak_master: { name: 'Streak Master', icon: '🔥', xp: 50 },
      perfectionist: { name: 'Perfectionist', icon: '💯', xp: 40 },
      speed_learner: { name: 'Speed Learner', icon: '⚡', xp: 40 },
      dedicated_learner: { name: 'Dedicated Learner', icon: '🏆', xp: 100 }
    };

    const achievement = achievementDefs[achievementId];
    if (!achievement) return;

    // Add to achievements
    this.userData.achievements.push({
      id: achievementId,
      name: achievement.name,
      icon: achievement.icon,
      unlockedAt: Date.now()
    });

    // Award bonus XP
    await this.awardXP(achievement.xp, `🏅 Achievement: ${achievement.name}`);

    // Sync to Supabase
    if (typeof supabaseSync !== 'undefined') {
      supabaseSync.syncAchievement(this.userEmail, achievementId, achievement.xp);
    }

    console.log(`[Gamification] 🏅 Achievement unlocked: ${achievement.name}`);
  }

  /**
   * Get user stats for display
   */
  getStats() {
    if (!this.initialized) return null;

    const nextLevelXP = this.getXPForNextLevel(this.userData.level);
    const currentLevelXP = this.getXPForNextLevel(this.userData.level - 1);
    const progress = this.getLevelProgress();

    return {
      email: this.userData.email,
      totalXP: this.userData.totalXP,
      level: this.userData.level,
      levelProgress: progress,
      xpToNextLevel: nextLevelXP - this.userData.totalXP,
      nextLevelXP: nextLevelXP,
      currentLevelXP: currentLevelXP,
      videosWatched: this.userData.stats.totalVideos,
      assessmentsPassed: this.userData.stats.totalAssessments,
      averageScore: this.userData.stats.averageScore,
      currentStreak: this.userData.streaks.current,
      longestStreak: this.userData.streaks.longest,
      achievements: this.userData.achievements,
      recentActivity: this.userData.history.slice(0, 10)
    };
  }

  /**
   * Sync user data to Google Sheets leaderboard
   */
  async syncToLeaderboard() {
    // TODO: Implement Google Sheets sync
    // This will be called after every save (debounced)
    console.log('[Gamification] Syncing to leaderboard...');
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
}

// Global instance
window.gamificationSystem = new GamificationSystem();

console.log('[Gamification] System loaded');
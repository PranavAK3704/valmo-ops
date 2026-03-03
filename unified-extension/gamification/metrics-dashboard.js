/**
 * METRICS DASHBOARD - Captain Training Analytics
 * 
 * Shows:
 * 1. Personal completion rates
 * 2. Time spent on training
 * 3. Assessment scores & progress
 * 4. Team leaderboard (if multiple Captains)
 * 5. Weekly/Monthly trends
 */

class TrainingMetricsDashboard {
  constructor() {
    this.userEmail = null;
    this.metrics = null;
  }

  async init(userEmail) {
    this.userEmail = userEmail;
    await this.loadMetrics();
  }

  async loadMetrics() {
    // Get gamification data
    const gamData = await chrome.storage.local.get([`gamification_${this.userEmail}`]);
    const userData = gamData[`gamification_${this.userEmail}`] || {};

    // Get all processes
    const response = await new Promise(resolve => {
      chrome.runtime.sendMessage({ type: 'GET_ALL_PROCESSES' }, resolve);
    });
    const allProcesses = response?.processes || [];

    // Calculate metrics
    this.metrics = {
      personal: this.calculatePersonalMetrics(userData, allProcesses),
      time: this.calculateTimeMetrics(userData),
      assessments: this.calculateAssessmentMetrics(userData),
      trends: this.calculateTrends(userData)
    };

    console.log('[Metrics] Loaded:', this.metrics);
  }

  calculatePersonalMetrics(userData, allProcesses) {
    const totalProcesses = allProcesses.length;
    const mustKnowProcesses = allProcesses.filter(p => p.priority === 'MUST_KNOW').length;
    const goodToKnowProcesses = allProcesses.filter(p => p.priority === 'GOOD_TO_KNOW').length;

    const videosWatched = userData.stats?.totalVideos || 0;
    const assessmentsPassed = userData.stats?.totalAssessments || 0;

    return {
      totalProcesses,
      mustKnowProcesses,
      goodToKnowProcesses,
      videosWatched,
      assessmentsPassed,
      overallCompletion: totalProcesses > 0 ? Math.round((assessmentsPassed / totalProcesses) * 100) : 0,
      mustKnowCompletion: mustKnowProcesses > 0 ? 
        Math.round((assessmentsPassed / mustKnowProcesses) * 100) : 0,
      videosVsAssessments: videosWatched - assessmentsPassed // Pending assessments
    };
  }

  calculateTimeMetrics(userData) {
    const history = userData.history || [];
    
    // Estimate time based on activity
    const videosWatched = history.filter(h => h.reason?.includes('Watched')).length;
    const assessmentsTaken = history.filter(h => h.reason?.includes('Passed')).length;

    // Rough estimates: 5min per video, 3min per assessment
    const estimatedVideoTime = videosWatched * 5;
    const estimatedAssessmentTime = assessmentsTaken * 3;
    const totalMinutes = estimatedVideoTime + estimatedAssessmentTime;

    return {
      totalMinutes,
      hours: Math.floor(totalMinutes / 60),
      minutes: totalMinutes % 60,
      videosWatched,
      assessmentsTaken,
      avgTimePerProcess: assessmentsTaken > 0 ? Math.round(totalMinutes / assessmentsTaken) : 0
    };
  }

  calculateAssessmentMetrics(userData) {
    const scores = Object.values(userData.assessmentScores || {});
    const avgScore = userData.stats?.averageScore || 0;
    const firstAttemptPasses = userData.stats?.firstAttemptPasses || 0;
    const totalAttempts = scores.length;

    return {
      averageScore: avgScore,
      totalAssessments: totalAttempts,
      firstAttemptPasses,
      firstAttemptRate: totalAttempts > 0 ? Math.round((firstAttemptPasses / totalAttempts) * 100) : 0,
      perfectScores: scores.filter(s => s.score === 100).length,
      scoreDistribution: this.getScoreDistribution(scores)
    };
  }

  getScoreDistribution(scores) {
    const distribution = { excellent: 0, good: 0, average: 0, needsWork: 0 };
    
    scores.forEach(s => {
      if (s.score >= 90) distribution.excellent++;
      else if (s.score >= 80) distribution.good++;
      else if (s.score >= 70) distribution.average++;
      else distribution.needsWork++;
    });

    return distribution;
  }

  calculateTrends(userData) {
    const history = userData.history || [];
    const now = Date.now();
    const oneWeekAgo = now - (7 * 24 * 60 * 60 * 1000);
    const oneMonthAgo = now - (30 * 24 * 60 * 60 * 1000);

    const thisWeek = history.filter(h => h.timestamp > oneWeekAgo);
    const thisMonth = history.filter(h => h.timestamp > oneMonthAgo);

    return {
      thisWeek: {
        xpEarned: thisWeek.reduce((sum, h) => sum + (h.amount || 0), 0),
        activities: thisWeek.length,
        assessmentsPassed: thisWeek.filter(h => h.reason?.includes('Passed')).length
      },
      thisMonth: {
        xpEarned: thisMonth.reduce((sum, h) => sum + (h.amount || 0), 0),
        activities: thisMonth.length,
        assessmentsPassed: thisMonth.filter(h => h.reason?.includes('Passed')).length
      },
      streak: userData.streaks?.current || 0,
      longestStreak: userData.streaks?.longest || 0
    };
  }

  renderDashboard() {
    if (!this.metrics) {
      return '<div class="metrics-loading">Loading metrics...</div>';
    }

    const { personal, time, assessments, trends } = this.metrics;

    return `
      <div class="metrics-dashboard">
        
        <!-- Header -->
        <div class="metrics-header">
          <h2>📊 Training Metrics</h2>
          <p>Your performance overview</p>
        </div>

        <!-- Completion Overview -->
        <div class="metrics-section">
          <h3>🎯 Completion Status</h3>
          <div class="metrics-grid">
            <div class="metric-card">
              <div class="metric-icon">📚</div>
              <div class="metric-value">${personal.overallCompletion}%</div>
              <div class="metric-label">Overall Completion</div>
              <div class="metric-detail">${personal.assessmentsPassed}/${personal.totalProcesses} processes</div>
            </div>

            <div class="metric-card">
              <div class="metric-icon">🔴</div>
              <div class="metric-value">${personal.mustKnowCompletion}%</div>
              <div class="metric-label">MUST KNOW</div>
              <div class="metric-detail">${personal.mustKnowProcesses} total</div>
            </div>

            <div class="metric-card">
              <div class="metric-icon">📹</div>
              <div class="metric-value">${personal.videosWatched}</div>
              <div class="metric-label">Videos Watched</div>
              <div class="metric-detail">${personal.videosVsAssessments} pending tests</div>
            </div>

            <div class="metric-card">
              <div class="metric-icon">📝</div>
              <div class="metric-value">${personal.assessmentsPassed}</div>
              <div class="metric-label">Assessments Passed</div>
              <div class="metric-detail">${assessments.firstAttemptRate}% first try</div>
            </div>
          </div>

          <!-- Progress Bar -->
          <div class="completion-progress">
            <div class="progress-header">
              <span>Training Progress</span>
              <span>${personal.overallCompletion}%</span>
            </div>
            <div class="progress-bar">
              <div class="progress-fill" style="width: ${personal.overallCompletion}%"></div>
            </div>
          </div>
        </div>

        <!-- Time Investment -->
        <div class="metrics-section">
          <h3>⏱️ Time Investment</h3>
          <div class="time-stats">
            <div class="time-stat-large">
              <div class="time-value">${time.hours}h ${time.minutes}m</div>
              <div class="time-label">Total Time Invested</div>
            </div>
            <div class="time-stat-grid">
              <div class="time-stat">
                <span class="time-stat-icon">🎥</span>
                <span class="time-stat-text">${time.videosWatched} videos watched</span>
              </div>
              <div class="time-stat">
                <span class="time-stat-icon">📝</span>
                <span class="time-stat-text">${time.assessmentsTaken} assessments taken</span>
              </div>
              <div class="time-stat">
                <span class="time-stat-icon">⚡</span>
                <span class="time-stat-text">~${time.avgTimePerProcess} min per process</span>
              </div>
            </div>
          </div>
        </div>

        <!-- Assessment Performance -->
        <div class="metrics-section">
          <h3>💯 Assessment Performance</h3>
          <div class="assessment-metrics">
            <div class="score-card">
              <div class="score-main">
                <div class="score-value">${assessments.averageScore}%</div>
                <div class="score-label">Average Score</div>
              </div>
              <div class="score-details">
                <div class="score-detail">
                  <span>✅ ${assessments.firstAttemptPasses} first attempt passes</span>
                </div>
                <div class="score-detail">
                  <span>💯 ${assessments.perfectScores} perfect scores</span>
                </div>
              </div>
            </div>

            <!-- Score Distribution -->
            <div class="score-distribution">
              <h4>Score Distribution</h4>
              <div class="dist-bar-container">
                ${this.renderDistributionBar('Excellent (90-100%)', assessments.scoreDistribution.excellent, '#48bb78')}
                ${this.renderDistributionBar('Good (80-89%)', assessments.scoreDistribution.good, '#4299e1')}
                ${this.renderDistributionBar('Average (70-79%)', assessments.scoreDistribution.average, '#ed8936')}
                ${this.renderDistributionBar('Needs Work (<70%)', assessments.scoreDistribution.needsWork, '#f56565')}
              </div>
            </div>
          </div>
        </div>

        <!-- Trends -->
        <div class="metrics-section">
          <h3>📈 Recent Activity</h3>
          <div class="trends-grid">
            <div class="trend-card">
              <div class="trend-period">This Week</div>
              <div class="trend-stats">
                <div class="trend-stat">
                  <span class="trend-icon">⭐</span>
                  <span class="trend-value">${trends.thisWeek.xpEarned} XP</span>
                </div>
                <div class="trend-stat">
                  <span class="trend-icon">📝</span>
                  <span class="trend-value">${trends.thisWeek.assessmentsPassed} passed</span>
                </div>
                <div class="trend-stat">
                  <span class="trend-icon">🔥</span>
                  <span class="trend-value">${trends.streak} day streak</span>
                </div>
              </div>
            </div>

            <div class="trend-card">
              <div class="trend-period">This Month</div>
              <div class="trend-stats">
                <div class="trend-stat">
                  <span class="trend-icon">⭐</span>
                  <span class="trend-value">${trends.thisMonth.xpEarned} XP</span>
                </div>
                <div class="trend-stat">
                  <span class="trend-icon">📝</span>
                  <span class="trend-value">${trends.thisMonth.assessmentsPassed} passed</span>
                </div>
                <div class="trend-stat">
                  <span class="trend-icon">🏆</span>
                  <span class="trend-value">${trends.longestStreak} longest</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- Action Items -->
        <div class="metrics-section">
          <h3>🎯 Next Steps</h3>
          <div class="action-items">
            ${this.renderActionItems(personal, assessments, trends)}
          </div>
        </div>

      </div>
    `;
  }

  renderDistributionBar(label, count, color) {
    const percentage = this.metrics.assessments.totalAssessments > 0 
      ? Math.round((count / this.metrics.assessments.totalAssessments) * 100) 
      : 0;

    return `
      <div class="dist-bar">
        <div class="dist-label">${label}</div>
        <div class="dist-bar-track">
          <div class="dist-bar-fill" style="width: ${percentage}%; background: ${color}"></div>
        </div>
        <div class="dist-count">${count}</div>
      </div>
    `;
  }

  renderActionItems(personal, assessments, trends) {
    const items = [];

    // Pending assessments
    if (personal.videosVsAssessments > 0) {
      items.push(`
        <div class="action-item action-warning">
          <span class="action-icon">⚠️</span>
          <span class="action-text">You have ${personal.videosVsAssessments} video(s) watched but not assessed</span>
        </div>
      `);
    }

    // Low score warning
    if (assessments.averageScore < 80 && assessments.totalAssessments > 0) {
      items.push(`
        <div class="action-item action-warning">
          <span class="action-icon">📚</span>
          <span class="action-text">Average score below 80% - consider reviewing materials</span>
        </div>
      `);
    }

    // Streak encouragement
    if (trends.streak >= 3) {
      items.push(`
        <div class="action-item action-success">
          <span class="action-icon">🔥</span>
          <span class="action-text">Great! ${trends.streak}-day streak - keep it going!</span>
        </div>
      `);
    }

    // Completion progress
    if (personal.overallCompletion < 100) {
      const remaining = personal.totalProcesses - personal.assessmentsPassed;
      items.push(`
        <div class="action-item action-info">
          <span class="action-icon">🎯</span>
          <span class="action-text">${remaining} process${remaining > 1 ? 'es' : ''} remaining to complete training</span>
        </div>
      `);
    } else {
      items.push(`
        <div class="action-item action-success">
          <span class="action-icon">🏆</span>
          <span class="action-text">Congratulations! You've completed all training!</span>
        </div>
      `);
    }

    return items.join('');
  }

  async injectDashboard() {
    // Add metrics view to sidebar
    const contentContainer = document.querySelector('.valmo-content');
    if (!contentContainer) return;

    const metricsView = document.createElement('div');
    metricsView.id = 'metrics-view';
    metricsView.className = 'valmo-view';
    metricsView.innerHTML = this.renderDashboard();

    contentContainer.appendChild(metricsView);

    // Add tab button
    const navContainer = document.querySelector('.valmo-nav');
    if (navContainer) {
      const metricsBtn = document.createElement('button');
      metricsBtn.className = 'valmo-nav-btn';
      metricsBtn.dataset.tab = 'metrics';
      metricsBtn.innerHTML = '📊 Metrics';

      metricsBtn.addEventListener('click', () => {
        document.querySelectorAll('.valmo-nav-btn').forEach(b => b.classList.remove('active'));
        document.querySelectorAll('.valmo-view').forEach(v => v.classList.remove('active'));
        
        metricsBtn.classList.add('active');
        metricsView.classList.add('active');
      });

      navContainer.appendChild(metricsBtn);
    }

    console.log('[Metrics] Dashboard injected');
  }
}

// Global instance
window.metricsDashboard = new TrainingMetricsDashboard();

console.log('[Metrics Dashboard] Loaded');
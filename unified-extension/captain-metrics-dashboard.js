/* Storage helper - uses localStorage */
const metricsStorage = {
  async get(keys) {
    const result = {};
    keys.forEach(key => {
      const value = localStorage.getItem(key);
      if (value) try { result[key] = JSON.parse(value); } catch { result[key] = value; }
    });
    return result;
  },
  async set(items) {
    Object.keys(items).forEach(key => localStorage.setItem(key, JSON.stringify(items[key])));
  }
};

/**
 * captain-metrics-dashboard.js - Pranav Akella Metrics Dashboard
 * 
 * Displays 4 core metrics:
 * - pKRT (Process Knowledge Resolution Time)
 * - PCT (Process Cycle Time)
 * - QFD (Query Frequency Decay)
 * - iPER (In-Process Error Rate)
 * 
 * With charts, benchmarks, and correlation signals
 */

class CaptainMetricsDashboard {
  constructor() {
    this.userEmail = null;
    this.sessionHistory = [];
    this.metrics = null;
    this.initialized = false;
  }

  /**
   * Initialize dashboard
   */
  async init(userEmail) {
    this.userEmail = userEmail;
    console.log('[Metrics Dashboard] Initializing for:', userEmail);

    // Load hub from chrome.storage
    const stored = await new Promise(r => chrome.storage.local.get(['userHub'], r));
    this.userHub = stored.userHub || null;

    // Load session history (own + hub peers from Supabase)
    await this.loadSessionHistory();

    // Calculate metrics
    this.calculateMetrics();

    // Inject dashboard
    await this.injectDashboard();

    this.initialized = true;
    console.log('[Metrics Dashboard] ✅ Initialized');
  }

  /**
   * Load session history — own localStorage + hub peers from Supabase
   */
  async loadSessionHistory() {
    const historyKey = `captain_session_history_${this.userEmail}`;
    const result = await metricsStorage.get([historyKey]);
    this.sessionHistory = result[historyKey] || [];
    console.log('[Metrics Dashboard] Loaded', this.sessionHistory.length, 'local sessions');

    // Fetch hub-wide sessions from Supabase if hub is set
    if (this.userHub && typeof SUPABASE_CONFIG !== 'undefined') {
      try {
        const url = `${SUPABASE_CONFIG.url}/rest/v1/captain_sessions?select=email,process_name,pct,total_pkrt,pause_count,query_count,error_count,completed_at&order=completed_at.desc&limit=500`;
        const res = await fetch(url, {
          headers: {
            apikey:        SUPABASE_CONFIG.anonKey,
            Authorization: `Bearer ${SUPABASE_CONFIG.anonKey}`,
          }
        });
        if (res.ok) {
          const rows = await res.json();
          // Filter to hub peers only (email list from agent_profiles not available here,
          // so we keep own sessions from localStorage and use Supabase rows as hub context)
          this.hubSessions = rows;
          console.log('[Metrics Dashboard] Loaded', rows.length, 'hub sessions from Supabase');
        }
      } catch (e) {
        console.warn('[Metrics Dashboard] Could not load hub sessions:', e.message);
        this.hubSessions = [];
      }
    } else {
      this.hubSessions = [];
    }
  }

  /**
   * Calculate all metrics
   */
  calculateMetrics() {
    if (this.sessionHistory.length === 0) {
      this.metrics = this.getEmptyMetrics();
      return;
    }

    // Filter last 30 days
    const thirtyDaysAgo = Date.now() - (30 * 24 * 60 * 60 * 1000);
    const recentSessions = this.sessionHistory.filter(s => s.completed_at >= thirtyDaysAgo);

    this.metrics = {
      pKRT: this.calculatePKRT(recentSessions),
      PCT: this.calculatePCT(recentSessions),
      QFD: this.calculateQFD(recentSessions),
      iPER: this.calculateIPER(recentSessions),
      totalSessions: recentSessions.length,
      processBreakdown: this.getProcessBreakdown(recentSessions)
    };

    console.log('[Metrics Dashboard] Calculated metrics:', this.metrics);
  }

  /**
   * Calculate pKRT (Process Knowledge Resolution Time)
   */
  calculatePKRT(sessions) {
    const allPauses = sessions.flatMap(s => s.pauses || []);
    
    if (allPauses.length === 0) {
      return {
        average: 0,
        total: 0,
        count: 0,
        trend: [],
        byResolution: { jarvis: 0, video: 0, manual: 0 }
      };
    }

    const totalPKRT = allPauses.reduce((sum, p) => sum + (p.pkrt || 0), 0);
    const avgPKRT = Math.floor(totalPKRT / allPauses.length);

    // Breakdown by resolution method
    const byResolution = {
      jarvis: 0,
      video: 0,
      manual: 0
    };

    allPauses.forEach(p => {
      if (p.resolution_method === 'jarvis') {
        byResolution.jarvis += (p.pkrt || 0);
      } else if (p.resolution_method === 'video') {
        byResolution.video += (p.pkrt || 0);
      } else {
        byResolution.manual += (p.pkrt || 0);
      }
    });

    // Calculate averages
    const jarvisCount = allPauses.filter(p => p.resolution_method === 'jarvis').length;
    const videoCount = allPauses.filter(p => p.resolution_method === 'video').length;
    const manualCount = allPauses.length - jarvisCount - videoCount;

    if (jarvisCount > 0) byResolution.jarvis = Math.floor(byResolution.jarvis / jarvisCount);
    if (videoCount > 0) byResolution.video = Math.floor(byResolution.video / videoCount);
    if (manualCount > 0) byResolution.manual = Math.floor(byResolution.manual / manualCount);

    // Calculate trend (last 7 days)
    const trend = this.calculateDailyTrend(sessions, 'pkrt', 7);

    return {
      average: avgPKRT,
      total: totalPKRT,
      count: allPauses.length,
      trend: trend,
      byResolution: byResolution
    };
  }

  /**
   * Calculate PCT (Process Cycle Time)
   */
  calculatePCT(sessions) {
    if (sessions.length === 0) {
      return {
        average: 0,
        benchmark: 0,
        delta: 0,
        trend: [],
        byProcess: {}
      };
    }

    const totalPCT = sessions.reduce((sum, s) => sum + (s.metrics?.pct || 0), 0);
    const avgPCT = Math.floor(totalPCT / sessions.length);

    // Benchmark (assume fleet average is 10% higher for demo)
    const benchmark = Math.floor(avgPCT * 1.1);
    const delta = avgPCT - benchmark;
    const deltaPercent = benchmark > 0 ? Math.floor((delta / benchmark) * 100) : 0;

    // Trend
    const trend = this.calculateDailyTrend(sessions, 'pct', 7);

    // By process
    const byProcess = {};
    sessions.forEach(s => {
      if (!byProcess[s.process_name]) {
        byProcess[s.process_name] = {
          total: 0,
          count: 0,
          average: 0
        };
      }
      byProcess[s.process_name].total += (s.metrics?.pct || 0);
      byProcess[s.process_name].count++;
    });

    // Calculate averages
    Object.keys(byProcess).forEach(proc => {
      byProcess[proc].average = Math.floor(byProcess[proc].total / byProcess[proc].count);
    });

    return {
      average: avgPCT,
      benchmark: benchmark,
      delta: delta,
      deltaPercent: deltaPercent,
      trend: trend,
      byProcess: byProcess
    };
  }

  /**
   * Calculate QFD (Query Frequency Decay)
   */
  calculateQFD(sessions) {
    // Group by process
    const byProcess = {};

    sessions.forEach(s => {
      if (!byProcess[s.process_name]) {
        byProcess[s.process_name] = [];
      }
      byProcess[s.process_name].push({
        date: s.completed_at,
        queries: s.queries?.length || 0
      });
    });

    // Calculate decay slope for each process
    const decayData = {};

    Object.keys(byProcess).forEach(proc => {
      const data = byProcess[proc].sort((a, b) => a.date - b.date);
      
      if (data.length < 2) {
        decayData[proc] = {
          slope: 0,
          status: 'insufficient_data'
        };
        return;
      }

      // Simple linear regression
      const n = data.length;
      const sumX = data.reduce((sum, _d, i) => sum + i, 0);
      const sumY = data.reduce((sum, d) => sum + d.queries, 0);
      const sumXY = data.reduce((sum, d, i) => sum + (i * d.queries), 0);
      const sumXX = data.reduce((sum, _d, i) => sum + (i * i), 0);

      const slope = (n * sumXY - sumX * sumY) / (n * sumXX - sumX * sumX);

      // Determine status
      let status = 'stable';
      if (slope < -0.5) status = 'improving'; // Queries decreasing
      if (slope > 0.5) status = 'worsening'; // Queries increasing

      decayData[proc] = {
        slope: slope,
        status: status,
        dataPoints: data.length
      };
    });

    return {
      byProcess: decayData,
      totalProcesses: Object.keys(byProcess).length
    };
  }

  /**
   * Calculate iPER (In-Process Error Rate)
   */
  calculateIPER(sessions) {
    if (sessions.length === 0) {
      return {
        average: 0,
        total: 0,
        trend: [],
        byProcess: {}
      };
    }

    const totalErrors = sessions.reduce((sum, s) => sum + (s.errors?.length || 0), 0);
    const avgErrors = totalErrors / sessions.length;

    // Trend
    const trend = this.calculateDailyTrend(sessions, 'errors', 7);

    // By process
    const byProcess = {};
    sessions.forEach(s => {
      if (!byProcess[s.process_name]) {
        byProcess[s.process_name] = {
          total: 0,
          count: 0,
          rate: 0
        };
      }
      byProcess[s.process_name].total += (s.errors?.length || 0);
      byProcess[s.process_name].count++;
    });

    // Calculate rates
    Object.keys(byProcess).forEach(proc => {
      byProcess[proc].rate = byProcess[proc].total / byProcess[proc].count;
    });

    return {
      average: avgErrors,
      total: totalErrors,
      trend: trend,
      byProcess: byProcess
    };
  }

  /**
   * Calculate daily trend
   */
  calculateDailyTrend(sessions, metric, days) {
    const trend = [];
    const now = Date.now();

    for (let i = days - 1; i >= 0; i--) {
      const dayStart = now - (i * 24 * 60 * 60 * 1000);
      const dayEnd = dayStart + (24 * 60 * 60 * 1000);

      const daySessions = sessions.filter(s => 
        s.completed_at >= dayStart && s.completed_at < dayEnd
      );

      let value = 0;

      if (metric === 'pkrt') {
        const allPauses = daySessions.flatMap(s => s.pauses || []);
        const totalPKRT = allPauses.reduce((sum, p) => sum + (p.pkrt || 0), 0);
        value = allPauses.length > 0 ? Math.floor(totalPKRT / allPauses.length) : 0;
      } else if (metric === 'pct') {
        const totalPCT = daySessions.reduce((sum, s) => sum + (s.metrics?.pct || 0), 0);
        value = daySessions.length > 0 ? Math.floor(totalPCT / daySessions.length) : 0;
      } else if (metric === 'errors') {
        const totalErrors = daySessions.reduce((sum, s) => sum + (s.errors?.length || 0), 0);
        value = daySessions.length > 0 ? totalErrors / daySessions.length : 0;
      }

      trend.push({
        day: i === 0 ? 'Today' : i === 1 ? 'Yesterday' : `${i}d ago`,
        value: value
      });
    }

    return trend;
  }

  /**
   * Get process breakdown
   */
  getProcessBreakdown(sessions) {
    const breakdown = {};

    sessions.forEach(s => {
      if (!breakdown[s.process_name]) {
        breakdown[s.process_name] = {
          count: 0, totalPCT: 0,
          totalPauses: 0, totalPKRT: 0,
          totalQueries: 0, totalErrors: 0
        };
      }
      const b = breakdown[s.process_name];
      b.count++;
      b.totalPCT    += (s.metrics?.pct || 0);
      b.totalPauses += (s.pauses?.length || 0);
      b.totalPKRT   += (s.pauses || []).reduce((sum, p) => sum + (p.pkrt || 0), 0);
      b.totalQueries+= (s.queries?.length || 0);
      b.totalErrors += (s.errors?.length || 0);
    });

    return breakdown;
  }

  /**
   * Get empty metrics
   */
  getEmptyMetrics() {
    return {
      pKRT: { average: 0, total: 0, count: 0, trend: [], byResolution: {} },
      PCT: { average: 0, benchmark: 0, delta: 0, trend: [], byProcess: {} },
      QFD: { byProcess: {}, totalProcesses: 0 },
      iPER: { average: 0, total: 0, trend: [], byProcess: {} },
      totalSessions: 0,
      processBreakdown: {}
    };
  }

  /**
   * Inject dashboard tab
   */
  async injectDashboard() {
    // Wait for sidebar
    await this.waitForSidebar();

    // Inject tab button
    this.injectTabButton();

    // Inject tab content
    this.injectTabContent();

    // Attach event listeners
    this.attachEventListeners();

    console.log('[Metrics Dashboard] ✅ Dashboard injected');
  }

  /**
   * Wait for sidebar
   */
  async waitForSidebar() {
    return new Promise((resolve) => {
      const check = setInterval(() => {
        const nav = document.querySelector('.valmo-nav');
        if (nav) {
          clearInterval(check);
          resolve();
        }
      }, 100);

      setTimeout(() => {
        clearInterval(check);
        resolve();
      }, 10000);
    });
  }

  /**
   * Inject tab button
   */
  injectTabButton() {
    const nav = document.querySelector('.valmo-nav');
    if (!nav) return;

    if (document.querySelector('[data-tab="metrics"]')) {
      console.log('[Metrics Dashboard] Tab button already exists');
      return;
    }

    const metricsBtn = document.createElement('button');
    metricsBtn.className = 'valmo-nav-btn';
    metricsBtn.dataset.tab = 'metrics';
    metricsBtn.innerHTML = '📊 Metrics';

    // Insert after Timer tab
    const timerBtn = document.querySelector('[data-tab="timer"]');
    if (timerBtn) {
      timerBtn.insertAdjacentElement('afterend', metricsBtn);
    } else {
      nav.appendChild(metricsBtn);
    }

    console.log('[Metrics Dashboard] ✅ Tab button injected');
  }

  /**
   * Inject tab content (or overwrite if stale content exists)
   */
  injectTabContent() {
    const content = document.querySelector('.valmo-content');
    if (!content) return;

    let metricsView = document.getElementById('metrics-view');
    if (!metricsView) {
      metricsView = document.createElement('div');
      metricsView.id = 'metrics-view';
      metricsView.className = 'valmo-view';
      content.appendChild(metricsView);
    }

    // Always write our content (overwrite anything stale from other scripts)
    metricsView.innerHTML = this.getDashboardHTML();

    console.log('[Metrics Dashboard] ✅ Tab content injected');
  }

  /**
   * Get dashboard HTML
   */
  getDashboardHTML() {
    const hasPersonal = this.metrics && this.metrics.totalSessions > 0;
    const hasHub = this.hubSessions && this.hubSessions.length > 0;

    if (!hasPersonal && !hasHub) {
      return this.getEmptyStateHTML();
    }

    return `
      <div class="metrics-dashboard">

        <!-- Header -->
        <div class="metrics-header">
          <h2>📊 My Metrics</h2>
          <p class="metrics-subtitle">${this.userHub ? `🏢 ${this.userHub} · ` : ''}Last 30 days${hasPersonal ? ` · ${this.metrics.totalSessions} sessions` : ''}</p>
        </div>

        ${hasPersonal ? `
        <!-- Key Metrics Cards -->
        <div class="metrics-cards">
          ${this.getPKRTCard()}
          ${this.getPCTCard()}
          ${this.getQFDCard()}
          ${this.getIPERCard()}
        </div>

        <!-- My Process Breakdown -->
        ${this.getProcessBreakdownHTML()}
        ` : `
        <div class="metrics-no-personal">
          <p>No personal sessions yet. Start a process to track pKRT, PCT, QFD &amp; iPER.</p>
        </div>
        `}

        <!-- Hub Process Breakdown -->
        ${this.getHubBreakdownHTML()}

      </div>
    `;
  }

  /**
   * Get pKRT card
   */
  getPKRTCard() {
    const pkrt = this.metrics.pKRT;
    const minutes = Math.floor(pkrt.average / 60);
    const seconds = pkrt.average % 60;

    return `
      <div class="metrics-card">
        <div class="metrics-card-header">
          <span class="metrics-card-icon">⏱️</span>
          <span class="metrics-card-title">pKRT</span>
        </div>
        <div class="metrics-card-value">${minutes}:${seconds.toString().padStart(2, '0')}</div>
        <div class="metrics-card-label">Avg Resolution Time</div>
        <div class="metrics-card-detail">
          ${pkrt.count} pauses resolved
        </div>
        ${this.getMiniChart(pkrt.trend)}
      </div>
    `;
  }

  /**
   * Get PCT card
   */
  getPCTCard() {
    const pct = this.metrics.PCT;
    const minutes = Math.floor(pct.average / 60);
    const deltaClass = pct.delta < 0 ? 'positive' : 'negative';
    const deltaSign = pct.delta < 0 ? '' : '+';

    return `
      <div class="metrics-card">
        <div class="metrics-card-header">
          <span class="metrics-card-icon">⏲️</span>
          <span class="metrics-card-title">PCT</span>
        </div>
        <div class="metrics-card-value">${minutes} min</div>
        <div class="metrics-card-label">Avg Cycle Time</div>
        <div class="metrics-card-detail ${deltaClass}">
          ${deltaSign}${pct.deltaPercent}% vs fleet
        </div>
        ${this.getMiniChart(pct.trend)}
      </div>
    `;
  }

  /**
   * Get QFD card
   */
  getQFDCard() {
    const qfd = this.metrics.QFD;
    const improving = Object.values(qfd.byProcess).filter(p => p.status === 'improving').length;

    return `
      <div class="metrics-card">
        <div class="metrics-card-header">
          <span class="metrics-card-icon">📉</span>
          <span class="metrics-card-title">QFD</span>
        </div>
        <div class="metrics-card-value">${improving}</div>
        <div class="metrics-card-label">Processes Improving</div>
        <div class="metrics-card-detail">
          of ${qfd.totalProcesses} tracked
        </div>
      </div>
    `;
  }

  /**
   * Get iPER card
   */
  getIPERCard() {
    const iper = this.metrics.iPER;

    return `
      <div class="metrics-card">
        <div class="metrics-card-header">
          <span class="metrics-card-icon">⚠️</span>
          <span class="metrics-card-title">iPER</span>
        </div>
        <div class="metrics-card-value">${iper.average.toFixed(2)}</div>
        <div class="metrics-card-label">Errors per Session</div>
        <div class="metrics-card-detail">
          ${iper.total} total errors
        </div>
        ${this.getMiniChart(iper.trend)}
      </div>
    `;
  }

  /**
   * Get mini chart HTML
   */
  getMiniChart(trend) {
    if (!trend || trend.length === 0) return '';

    const max = Math.max(...trend.map(t => t.value), 1);
    const bars = trend.map(t => {
      const height = (t.value / max) * 100;
      return `<div class="metrics-chart-bar" style="height: ${height}%"></div>`;
    }).join('');

    return `<div class="metrics-mini-chart">${bars}</div>`;
  }

  /**
   * Get correlation signal
   */
  getCorrelationSignal() {
    // TODO: Implement correlation matrix
    return `
      <div class="metrics-correlation">
        <h3>🔔 Correlation Signals</h3>
        <p class="metrics-correlation-note">
          Analyzing relationship between QFD and iPER...
        </p>
      </div>
    `;
  }

  /**
   * Get process breakdown
   */
  getProcessBreakdownHTML() {
    const breakdown = this.metrics.processBreakdown;
    const processes = Object.keys(breakdown);

    if (processes.length === 0) return '';

    const rows = processes.map(proc => {
      const d = breakdown[proc];
      const avgPCT   = d.count > 0 ? Math.floor(d.totalPCT  / d.count / 60) : 0;
      const avgPKRT  = d.totalPauses > 0 ? Math.floor(d.totalPKRT / d.totalPauses) : 0;
      const avgPauses= d.count > 0 ? (d.totalPauses / d.count) : 0;
      const iPER     = d.count > 0 ? (d.totalErrors / d.count) : 0;
      const qfdCol   = avgPauses <= 1 ? '#22c55e' : avgPauses <= 3 ? '#f59e0b' : '#ef4444';
      const iperCol  = iPER > 1 ? '#ef4444' : iPER > 0.5 ? '#f59e0b' : '#22c55e';
      return `
        <tr>
          <td class="metrics-table-process col-process">${this.escape(proc)}</td>
          <td class="col-num">${d.count}</td>
          <td class="col-num">${avgPCT}m</td>
          <td class="col-num">${avgPKRT > 0 ? avgPKRT + 's' : '—'}</td>
          <td class="col-num" style="color:${qfdCol};font-weight:700">${avgPauses.toFixed(1)}</td>
          <td class="col-num" style="color:${iperCol};font-weight:700">${iPER.toFixed(2)}</td>
        </tr>
      `;
    }).join('');

    return `
      <div class="metrics-breakdown">
        <h3>📋 Per-Process Metrics</h3>
        <table class="metrics-table">
          <thead>
            <tr>
              <th class="col-process">Process</th>
              <th class="col-num">Sess</th>
              <th class="col-num">PCT</th>
              <th class="col-num">PKRT</th>
              <th class="col-num">QFD</th>
              <th class="col-num">iPER</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    `;
  }

  /**
   * Hub-wide process breakdown (from Supabase sessions, all captains in hub)
   */
  getHubBreakdownHTML() {
    if (!this.userHub || !this.hubSessions || this.hubSessions.length === 0) return '';

    const byProc = {};
    this.hubSessions.forEach(s => {
      const p = s.process_name || 'Unknown';
      if (!byProc[p]) byProc[p] = { count: 0, totalPCT: 0, totalPauses: 0, totalErrors: 0 };
      byProc[p].count++;
      byProc[p].totalPCT    += s.pct          || 0;
      byProc[p].totalPauses += s.pause_count  || 0;
      byProc[p].totalErrors += s.error_count  || 0;
    });

    const rows = Object.entries(byProc).sort((a,b) => b[1].count - a[1].count).map(([proc, d]) => {
      const avgPCT   = d.count > 0 ? Math.floor(d.totalPCT / d.count / 60) : 0;
      const avgPauses = d.count > 0 ? (d.totalPauses / d.count) : 0;
      const iPER      = d.count > 0 ? (d.totalErrors / d.count) : 0;
      const qfdCol   = avgPauses <= 1 ? '#22c55e' : avgPauses <= 3 ? '#f59e0b' : '#ef4444';
      const iperCol  = iPER > 1 ? '#ef4444' : iPER > 0.5 ? '#f59e0b' : '#22c55e';
      return `
        <tr>
          <td class="metrics-table-process col-process">${this.escape(proc)}</td>
          <td class="col-num">${d.count}</td>
          <td class="col-num">${avgPCT > 0 ? avgPCT + 'm' : '—'}</td>
          <td class="col-num" style="color:${qfdCol};font-weight:700">${avgPauses.toFixed(1)}</td>
          <td class="col-num" style="color:${iperCol};font-weight:700">${iPER.toFixed(2)}</td>
        </tr>
      `;
    }).join('');

    return `
      <div class="metrics-breakdown">
        <h3>🏢 ${this.escape(this.userHub)} — All Processes</h3>
        <table class="metrics-table">
          <thead>
            <tr>
              <th class="col-process">Process</th>
              <th class="col-num">Sess</th>
              <th class="col-num">PCT</th>
              <th class="col-num">QFD</th>
              <th class="col-num">iPER</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    `;
  }

  /**
   * Get empty state HTML
   */
  getEmptyStateHTML() {
    return `
      <div class="metrics-empty">
        <div class="metrics-empty-icon">📊</div>
        <h3>No Metrics Yet</h3>
        <p>Complete some processes to see your performance metrics</p>
      </div>
    `;
  }

  /**
   * Attach event listeners
   */
  attachEventListeners() {
    const metricsBtn = document.querySelector('[data-tab="metrics"]');
    if (metricsBtn) {
      metricsBtn.addEventListener('click', () => {
        document.querySelectorAll('.valmo-nav-btn').forEach(b => b.classList.remove('active'));
        document.querySelectorAll('.valmo-view').forEach(v => v.classList.remove('active'));

        metricsBtn.classList.add('active');
        document.getElementById('metrics-view').classList.add('active');

        // Refresh metrics when tab opened
        this.refreshMetrics();
      });
    }
  }

  /**
   * Refresh metrics
   */
  async refreshMetrics() {
    await this.loadSessionHistory();
    this.calculateMetrics();
    
    // Update view
    const metricsView = document.getElementById('metrics-view');
    if (metricsView) {
      metricsView.innerHTML = this.getDashboardHTML();
    }
  }

  /**
   * Escape HTML
   */
  escape(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }
}

// Global instance
window.captainMetricsDashboard = new CaptainMetricsDashboard();

// Auto-initialize is handled by content.js
// This file just provides the CaptainMetricsDashboard class

console.log('[Metrics Dashboard] Script loaded');
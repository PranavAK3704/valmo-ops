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
   * @param {string} userEmail
   * @param {string|null} userHub   — passed from content script (no chrome API needed)
   * @param {string} supabaseUrl    — passed from content script
   * @param {string} supabaseKey    — passed from content script
   */
  async init(userEmail, userHub, supabaseUrl, supabaseKey, hubCode) {
    this.userEmail  = userEmail;
    this.userHub    = userHub     || null;
    this.hubCode    = hubCode     || null;
    this.sbUrl      = supabaseUrl || '';
    this.sbKey      = supabaseKey || '';
    console.log('[Metrics Dashboard] Initializing for:', userEmail, '| hub:', this.userHub);

    // Load session history (own + hub peers from Supabase)
    await this.loadSessionHistory();

    // Calculate metrics — wrapped so a calculation error never blocks tab injection
    try {
      this.calculateMetrics();
    } catch (e) {
      console.error('[Metrics Dashboard] calculateMetrics error (showing empty state):', e);
      this.metrics = this.getEmptyMetrics();
    }

    // Inject dashboard
    await this.injectDashboard();

    this.initialized = true;
    console.log('[Metrics Dashboard] ✅ Initialized');
  }

  /**
   * Load session history — own sessions from Supabase (source of truth),
   * with localStorage as fallback. Hub peers also fetched for benchmarks.
   */
  async loadSessionHistory() {
    const historyKey = `captain_session_history_${this.userEmail}`;
    const result = await metricsStorage.get([historyKey]);
    this.sessionHistory = result[historyKey] || [];
    console.log('[Metrics Dashboard] Loaded', this.sessionHistory.length, 'local sessions');

    this.ownSessions  = null;   // own Supabase sessions (source of truth when available)
    this.hubSessions  = [];     // all captains in hub (for benchmarks)

    if (this.sbUrl && this.sbKey) {
      const headers = { apikey: this.sbKey, Authorization: `Bearer ${this.sbKey}` };
      try {
        // Own captain sessions — same data the admin panel uses
        const ownUrl = `${this.sbUrl}/rest/v1/captain_sessions`
          + `?email=eq.${encodeURIComponent(this.userEmail)}`
          + `&select=session_id,process_name,pct,total_pkrt,pause_count,query_count,error_count,completed_at`
          + `&order=completed_at.desc&limit=200`;
        const ownRes = await fetch(ownUrl, { headers });
        if (ownRes.ok) {
          this.ownSessions = await ownRes.json();
          console.log('[Metrics Dashboard] Loaded', this.ownSessions.length, 'own sessions from Supabase');
        }
      } catch (e) {
        console.warn('[Metrics Dashboard] Could not load own Supabase sessions:', e.message);
      }

      // Hub-wide sessions for PCT benchmark and hub breakdown table
      if (this.hubCode) {
        try {
          const hubUrl = `${this.sbUrl}/rest/v1/captain_sessions`
            + `?hub_code=eq.${encodeURIComponent(this.hubCode)}`
            + `&select=email,process_name,pct,pause_count,error_count,completed_at`
            + `&order=completed_at.desc&limit=500`;
          const hubRes = await fetch(hubUrl, { headers });
          if (hubRes.ok) {
            this.hubSessions = await hubRes.json();
            console.log('[Metrics Dashboard] Loaded', this.hubSessions.length, 'hub sessions from Supabase');
          }
        } catch (e) {
          console.warn('[Metrics Dashboard] Could not load hub sessions:', e.message);
        }
      }
    }
  }

  /**
   * Normalize Supabase session rows into the shape calculatePKRT/PCT/QFD/iPER expect.
   * Supabase stores aggregated values (total_pkrt, pause_count) rather than pause arrays.
   */
  normalizeSupabaseSessions(rows) {
    const thirtyDaysAgo = Date.now() - (30 * 24 * 60 * 60 * 1000);
    return rows
      .filter(s => new Date(s.completed_at).getTime() >= thirtyDaysAgo)
      .map(s => {
        const pauseCount = s.pause_count || 0;
        const avgPkrt    = pauseCount > 0 ? Math.floor((s.total_pkrt || 0) / pauseCount) : 0;
        return {
          session_id:   s.session_id,
          process_name: s.process_name,
          completed_at: new Date(s.completed_at).getTime(),
          metrics: { pct: s.pct || 0, error_count: s.error_count || 0 },
          // Recreate pause array so calculatePKRT and calculateQFD work unchanged
          pauses: Array(pauseCount).fill(null).map(() => ({ pkrt: avgPkrt, resolution_method: null })),
          errors: [],
        };
      });
  }

  /**
   * Calculate all metrics
   */
  calculateMetrics() {
    // Prefer Supabase sessions (same source as admin panel) — fall back to localStorage
    let sessions;
    if (this.ownSessions && this.ownSessions.length > 0) {
      sessions = this.normalizeSupabaseSessions(this.ownSessions);
      console.log('[Metrics Dashboard] Using', sessions.length, 'Supabase sessions for metrics');
    } else {
      const thirtyDaysAgo = Date.now() - (30 * 24 * 60 * 60 * 1000);
      sessions = this.sessionHistory.filter(s => s.completed_at >= thirtyDaysAgo);
      console.log('[Metrics Dashboard] Falling back to', sessions.length, 'localStorage sessions');
    }

    if (sessions.length === 0) {
      this.metrics = this.getEmptyMetrics();
      return;
    }

    this.metrics = {
      pKRT: this.calculatePKRT(sessions),
      PCT: this.calculatePCT(sessions),
      QFD: this.calculateQFD(sessions),
      iPER: this.calculateIPER(sessions),
      totalSessions: sessions.length,
      processBreakdown: this.getProcessBreakdown(sessions)
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

    // Benchmark: hub-wide avg PCT from Supabase (0 if no hub data yet)
    let benchmark = 0;
    if (this.hubSessions && this.hubSessions.length > 0) {
      const hubTotal = this.hubSessions.reduce((sum, s) => sum + (s.pct || 0), 0);
      benchmark = Math.floor(hubTotal / this.hubSessions.length);
    }
    const delta = benchmark > 0 ? avgPCT - benchmark : 0;
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
   * Formula: avg pauses per session. Lower = better.
   * Trend: compare first-half sessions vs second-half sessions.
   */
  calculateQFD(sessions) {
    if (sessions.length === 0) {
      return { average: 0, trend: 'stable', trendDelta: 0, totalSessions: 0 };
    }

    const totalPauses = sessions.reduce((sum, s) => sum + (s.pauses?.length || 0), 0);
    const average = +(totalPauses / sessions.length).toFixed(1);

    // Trend: sort by time, compare oldest half vs newest half
    const sorted = [...sessions].sort((a, b) => a.completed_at - b.completed_at);
    const mid = Math.max(1, Math.floor(sorted.length / 2));
    const oldHalf = sorted.slice(0, mid);
    const newHalf = sorted.slice(mid);

    const oldAvg = oldHalf.reduce((s, x) => s + (x.pauses?.length || 0), 0) / oldHalf.length;
    const newAvg = newHalf.length > 0
      ? newHalf.reduce((s, x) => s + (x.pauses?.length || 0), 0) / newHalf.length
      : oldAvg;

    const delta = +(newAvg - oldAvg).toFixed(1);
    let trend = 'stable';
    if (delta < -0.3) trend = 'improving'; // fewer pauses recently
    if (delta > 0.3)  trend = 'worsening'; // more pauses recently

    return { average, trend, trendDelta: delta, totalSessions: sessions.length };
  }

  /**
   * Calculate iPER (In-Process Error Rate) — bucket-weighted, inferred signal.
   *
   * Formula per session:
   *   score = avg(BUCKET_WEIGHTS[bucket]) across all pauses in that session
   *   iPER  = avg(score) across all sessions in last 30 days
   *
   * Bucket weights (from supabaseSync.BUCKET_WEIGHTS):
   *   REPETITIVE=1.0, PROCESS_GAP=0.8, POLICY_UNCLEAR=0.4,
   *   CUSTOMER_COMPLEXITY=0.1, SYSTEM_ISSUE=0.0, UNCLASSIFIED=0.2
   *
   * Falls back to error_count-based calc if no bucket data available yet.
   */
  calculateIPER(sessions) {
    if (sessions.length === 0) {
      return { average: 0, total: 0, trend: [], byProcess: {} };
    }

    // Load bucket logs from localStorage
    const bucketKey  = `captain_pause_buckets_${this.userEmail}`;
    let   bucketLog  = [];
    try {
      const raw = localStorage.getItem(bucketKey);
      if (raw) bucketLog = JSON.parse(raw);
    } catch (e) { /* ignore */ }

    const weights = (typeof supabaseSync !== 'undefined' && supabaseSync.BUCKET_WEIGHTS)
      ? supabaseSync.BUCKET_WEIGHTS
      : { PROCESS_GAP: 0.8, REPETITIVE: 1.0, POLICY_UNCLEAR: 0.4,
          CUSTOMER_COMPLEXITY: 0.1, SYSTEM_ISSUE: 0.0, UNCLASSIFIED: 0.2 };

    // Build a map of session_id → bucket score
    const bucketScoreBySession = {};
    for (const entry of bucketLog) {
      if (!entry.buckets?.length) continue;
      const score = entry.buckets.reduce((sum, b) => sum + (weights[b] ?? 0.2), 0) / entry.buckets.length;
      bucketScoreBySession[entry.session_id] = +score.toFixed(3);
    }

    const hasBucketData = Object.keys(bucketScoreBySession).length > 0;

    let sessionScores;
    if (hasBucketData) {
      sessionScores = sessions.map(s =>
        bucketScoreBySession[s.session_id] ?? ((s.metrics?.error_count ?? 0) > 0 ? 0.5 : 0)
      );
    } else {
      // Fallback: raw error_count until classifier has run at least once
      sessionScores = sessions.map(s => s.metrics?.error_count ?? s.errors?.length ?? 0);
    }

    const totalErrors = sessionScores.reduce((a, b) => a + b, 0);
    const avgErrors   = sessionScores.length > 0 ? totalErrors / sessionScores.length : 0;

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
      total:   totalErrors,
      trend:   trend,
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
      b.totalErrors += (s.metrics?.error_count ?? s.errors?.length ?? 0);
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
      QFD: { average: 0, trend: 'stable', trendDelta: 0, totalSessions: 0 },
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
        <div class="metrics-card-detail ${pct.benchmark > 0 ? deltaClass : ''}">
          ${pct.benchmark > 0 ? `${deltaSign}${pct.deltaPercent}% vs fleet` : 'No fleet data yet'}
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
    const trendIcon  = qfd.trend === 'improving' ? '↓' : qfd.trend === 'worsening' ? '↑' : '→';
    const trendColor = qfd.trend === 'improving' ? '#22c55e' : qfd.trend === 'worsening' ? '#ef4444' : '#6b7280';
    const trendLabel = qfd.trend === 'improving' ? 'Improving' : qfd.trend === 'worsening' ? 'Worsening' : 'Stable';

    return `
      <div class="metrics-card">
        <div class="metrics-card-header">
          <span class="metrics-card-icon">📉</span>
          <span class="metrics-card-title">QFD</span>
        </div>
        <div class="metrics-card-value">${qfd.average}</div>
        <div class="metrics-card-label">Avg Queries/Session</div>
        <div class="metrics-card-detail" style="color:${trendColor};font-weight:600;">
          ${trendIcon} ${trendLabel}
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
        <div class="metrics-card-label">Error Signal Score</div>
        <div class="metrics-card-detail" style="color:${iper.average < 0.2 ? '#22c55e' : iper.average < 0.5 ? '#f59e0b' : '#ef4444'}">
          ${iper.average < 0.2 ? 'Clean execution' : iper.average < 0.5 ? 'Some anomalies' : 'Needs attention'}
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
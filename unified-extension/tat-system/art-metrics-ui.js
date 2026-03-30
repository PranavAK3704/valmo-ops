/**
 * art-metrics-ui.js
 *
 * Renders the "My Metrics" view inside the My Tickets tab.
 * Shows: ART overall, ART by queue, top queue, reopen rate, 7-day trend.
 * Data is produced by TATTrackerBackground.startARTTracking().
 */

async function loadARTMetrics() {
  const container = document.getElementById('art-metrics-container');
  if (!container) return;

  container.innerHTML = `
    <div class="art-loading">
      <div class="loading-spinner"></div>
      <p>Loading your metrics...</p>
    </div>
  `;

  try {
    const { artSummary, artTickets } = await chrome.storage.local.get(['artSummary', 'artTickets']);

    if (!artSummary || artSummary.totalResolved === 0) {
      container.innerHTML = renderARTEmpty();
      return;
    }

    container.innerHTML = renderARTDashboard(artSummary, artTickets || {});
  } catch (err) {
    console.error('[ART UI] Load error:', err);
    container.innerHTML = `<div class="tat-error"><p>❌ Could not load metrics</p></div>`;
  }
}

function renderARTEmpty() {
  return `
    <div class="tat-empty">
      <div class="empty-icon">📊</div>
      <h3>No metrics yet</h3>
      <p>Metrics appear after your first completed tickets are processed.</p>
      <p style="font-size:12px;color:#aaa;margin-top:8px">Check back in ~30 seconds after resolving tickets on Kapture.</p>
    </div>
  `;
}

function renderARTDashboard(summary, artTickets) {
  const lastCalc = summary.lastCalculated
    ? `Updated ${Math.round((Date.now() - summary.lastCalculated) / 60000)}m ago`
    : '';

  return `
    <div class="art-dashboard">

      <div class="art-header">
        <h3>📈 My Performance</h3>
        <span class="last-update">${lastCalc}</span>
      </div>

      <!-- Top KPI strip -->
      <div class="art-kpi-strip">
        <div class="art-kpi">
          <div class="art-kpi-value">${summary.overallART}h</div>
          <div class="art-kpi-label">Avg Resolution Time</div>
        </div>
        <div class="art-kpi">
          <div class="art-kpi-value">${summary.totalResolved}</div>
          <div class="art-kpi-label">Tickets Resolved</div>
        </div>
        <div class="art-kpi ${summary.reopenRate > 10 ? 'art-kpi-warn' : ''}">
          <div class="art-kpi-value">${summary.reopenRate}%</div>
          <div class="art-kpi-label">Reopen Rate</div>
        </div>
      </div>

      <!-- ART by queue -->
      <div class="art-section">
        <div class="art-section-title">⏱ ART by Queue</div>
        ${renderARTByQueue(summary.artByQueue, summary.countByQueue, summary.overallART)}
      </div>

      <!-- 7-day trend -->
      <div class="art-section">
        <div class="art-section-title">📅 Last 7 Days</div>
        ${renderTrend(summary.byDate)}
      </div>

      <!-- Reopen details -->
      ${summary.reopenRate > 0 ? `
        <div class="art-section">
          <div class="art-section-title">🔄 Reopened Tickets</div>
          ${renderReopenedTickets(artTickets)}
        </div>
      ` : ''}

    </div>
  `;
}

function renderARTByQueue(artByQueue, countByQueue, overallART) {
  const entries = Object.entries(artByQueue).sort((a, b) => b[1] - a[1]);
  if (entries.length === 0) return '<p class="art-empty-text">No data yet</p>';

  const maxART = Math.max(...entries.map(([, v]) => v), overallART);

  return `
    <div class="art-queue-list">
      ${entries.map(([queue, art]) => {
        const pct = Math.round((art / maxART) * 100);
        const count = countByQueue[queue] || 0;
        const isHigh = art > overallART * 1.3;
        return `
          <div class="art-queue-row">
            <div class="art-queue-info">
              <span class="art-queue-name">${escapeHtml(queue)}</span>
              <span class="art-queue-count">${count} ticket${count !== 1 ? 's' : ''}</span>
            </div>
            <div class="art-queue-bar-wrap">
              <div class="art-queue-bar ${isHigh ? 'art-bar-warn' : ''}" style="width:${pct}%"></div>
            </div>
            <span class="art-queue-art ${isHigh ? 'art-text-warn' : ''}">${art}h</span>
          </div>
        `;
      }).join('')}
    </div>
  `;
}

function renderTrend(byDate) {
  const sortedDays = Object.entries(byDate).sort((a, b) => a[0].localeCompare(b[0]));
  if (sortedDays.length === 0) return '<p class="art-empty-text">No tickets resolved in the last 7 days</p>';

  const maxCount = Math.max(...sortedDays.map(([, v]) => v.count));

  return `
    <div class="art-trend-grid">
      ${sortedDays.map(([date, { count, totalART }]) => {
        const dayART = Math.round((totalART / count) * 10) / 10;
        const barPct = Math.round((count / maxCount) * 100);
        const label = new Date(date).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric' });
        return `
          <div class="art-trend-col">
            <div class="art-trend-bar-wrap">
              <div class="art-trend-bar" style="height:${barPct}%" title="${count} tickets, avg ${dayART}h"></div>
            </div>
            <div class="art-trend-count">${count}</div>
            <div class="art-trend-label">${label}</div>
          </div>
        `;
      }).join('')}
    </div>
  `;
}

function renderReopenedTickets(artTickets) {
  const reopened = Object.values(artTickets).filter(t => t.wasReopened).slice(0, 5);
  if (reopened.length === 0) return '';

  return `
    <div class="art-reopen-list">
      ${reopened.map(t => `
        <div class="art-reopen-row">
          <span class="art-reopen-id">#${t.ticketId}</span>
          <span class="art-reopen-subject">${escapeHtml((t.subject || '').substring(0, 40))}</span>
          <span class="art-reopen-queue">${t.sopCategory}</span>
        </div>
      `).join('')}
    </div>
  `;
}

function escapeHtml(str) {
  if (!str) return '';
  return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

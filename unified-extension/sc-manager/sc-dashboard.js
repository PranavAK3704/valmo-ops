/**
 * sc-dashboard.js - SC Manager Dashboard Logic
 * 
 * Handles fetching, caching, and rendering Metabase data
 */

class SCDashboard {
  constructor(container) {
    this.container = container;
    this.activeMetric = 'IB_PENDENCY'; // Default
    this.cache = new Map();
    this.refreshTimers = new Map();
  }

  /**
   * Initialize dashboard with metric selector
   */
  init() {
    this.renderMetricSelector();
    this.renderDashboardContainer();
    this.loadMetric('IB_PENDENCY'); // Load default
  }

  /**
   * Render metric selector tabs
   */
  renderMetricSelector() {
    const metrics = [
      { key: 'IB_PENDENCY', label: 'IB Pendency', icon: '📥' },
      { key: 'OB_PENDENCY', label: 'OB Pendency', icon: '📤' },
      { key: 'SHORTAGE', label: 'Shortages', icon: '⚠️' },
      { key: 'IN_TRANSIT', label: 'In-Transit', icon: '🚚' },
      { key: 'LANE_VOLUME', label: 'Lane Volume', icon: '📊' },
      { key: 'SHIPMENT_TRACKING', label: 'Track Shipment', icon: '🔍' },
      { key: 'BAG_VISIBILITY', label: 'Bag Details', icon: '👜' }
    ];

    const selectorHTML = `
      <div class="sc-metric-selector">
        ${metrics.map(m => `
          <button 
            class="sc-metric-btn ${m.key === this.activeMetric ? 'active' : ''}"
            data-metric="${m.key}"
          >
            <span class="metric-icon">${m.icon}</span>
            <span class="metric-label">${m.label}</span>
          </button>
        `).join('')}
      </div>
    `;

    this.container.insertAdjacentHTML('beforeend', selectorHTML);

    // Add event listeners
    this.container.querySelectorAll('.sc-metric-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const metric = e.currentTarget.dataset.metric;
        this.switchMetric(metric);
      });
    });
  }

  /**
   * Render dashboard data container
   */
  renderDashboardContainer() {
    const containerHTML = `
      <div class="sc-dashboard-content">
        <div class="sc-dashboard-header">
          <h3 id="sc-metric-title">Loading...</h3>
          <div class="sc-dashboard-controls">
            <span id="sc-last-updated" class="last-updated">—</span>
            <button id="sc-refresh-btn" class="refresh-btn">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                <path d="M21.5 2v6h-6M2.5 22v-6h6M2 11.5a10 10 0 0 1 18.8-4.3M22 12.5a10 10 0 0 1-18.8 4.2"/>
              </svg>
              Refresh
            </button>
            <button id="sc-export-btn" class="export-btn">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"/>
              </svg>
              Export
            </button>
          </div>
        </div>
        <div id="sc-dashboard-body" class="sc-dashboard-body">
          <!-- Data renders here -->
        </div>
      </div>
    `;

    this.container.insertAdjacentHTML('beforeend', containerHTML);

    // Add event listeners
    document.getElementById('sc-refresh-btn')?.addEventListener('click', () => {
      this.refreshCurrentMetric();
    });

    document.getElementById('sc-export-btn')?.addEventListener('click', () => {
      this.exportToCSV();
    });
  }

  /**
   * Switch to different metric
   */
  switchMetric(metricKey) {
    // Update active button
    this.container.querySelectorAll('.sc-metric-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.metric === metricKey);
    });

    this.activeMetric = metricKey;
    this.loadMetric(metricKey);
  }

  /**
   * Load and display metric data
   */
  async loadMetric(metricKey) {
    const queryConfig = METABASE_QUERIES[metricKey];
    
    if (!queryConfig) {
      this.showError('Metric not configured yet');
      return;
    }

    // Update title
    document.getElementById('sc-metric-title').textContent = queryConfig.name;

    // Check cache
    const cached = this.cache.get(metricKey);
    if (cached && (Date.now() - cached.timestamp < 30000)) {
      console.log(`[SC Dashboard] Using cached data for ${metricKey}`);
      this.renderMetricData(metricKey, cached);
      return;
    }

    // Show loading
    this.showLoading();

    // Fetch fresh data
    try {
  // Ask background script to find Metabase tab and fetch
  const result = await chrome.runtime.sendMessage({
    type: 'FETCH_METABASE_VIA_BRIDGE',
    endpoint: queryConfig.endpoint
  });

  if (result.error === 'NO_METABASE_TAB') {
    this.showError(`
      <p>📊 Metabase tab not found</p>
      <p><a href="https://metabase-main.bi.meeshogcp.in/question/167151" target="_blank" style="color: #667eea; text-decoration: underline;">Open Metabase →</a></p>
    `);
    return;
  }

  if (result.success) {
    this.cache.set(metricKey, result);
    this.renderMetricData(metricKey, result);
    this.startAutoRefresh(metricKey);
  } else {
    this.showError(`
      <p>🔒 ${result.error}</p>
      <p><a href="https://metabase-main.bi.meeshogcp.in/question/167151" target="_blank" style="color: #667eea; text-decoration: underline;">Login to Metabase →</a></p>
    `);
  }
  
} catch (err) {
  this.showError('Failed to fetch data: ' + err.message);
}
  }

  /**
   * Render metric data based on type
   */
  renderMetricData(metricKey, data) {
    const queryConfig = METABASE_QUERIES[metricKey];
    const body = document.getElementById('sc-dashboard-body');
    
    if (!body) return;

    // Update last updated timestamp
    document.getElementById('sc-last-updated').textContent = 
      `Updated ${formatLastUpdated(data.timestamp)}`;

    // Render based on metric type
    switch (metricKey) {
      case 'IB_PENDENCY':
      case 'OB_PENDENCY':
      case 'IN_TRANSIT':
      case 'LANE_VOLUME':
      case 'BAG_VISIBILITY':
        this.renderTable(body, queryConfig, data);
        break;
      
      case 'SHORTAGE':
        this.renderShortageView(body, data);
        break;
      
      case 'SHIPMENT_TRACKING':
        this.renderShipmentTracker(body);
        break;
      
      default:
        this.showError('Rendering not implemented for this metric');
    }
  }

  /**
   * Render data as table
   */
  renderTable(container, queryConfig, data) {
    const displayCols = queryConfig.displayColumns || [];
    
    if (!displayCols.length || !data.rows.length) {
      container.innerHTML = '<div class="no-data">No data available</div>';
      return;
    }

    // Build column index map
    const colMap = {};
    data.columns.forEach((col, idx) => {
      colMap[col.name] = idx;
    });

    const tableHTML = `
      <div class="sc-table-wrapper">
        <table class="sc-data-table">
          <thead>
            <tr>
              ${displayCols.map(col => `<th>${col.label}</th>`).join('')}
            </tr>
          </thead>
          <tbody>
            ${data.rows.slice(0, 100).map(row => `
              <tr>
                ${displayCols.map(col => {
                  const cellValue = row[colMap[col.key]] ?? '—';
                  return `<td>${this.formatCellValue(cellValue, col.key)}</td>`;
                }).join('')}
              </tr>
            `).join('')}
          </tbody>
        </table>
        ${data.rows.length > 100 ? `
          <div class="table-footer">
            Showing 100 of ${data.rows.length} rows
          </div>
        ` : ''}
      </div>
    `;

    container.innerHTML = tableHTML;
  }

  /**
   * Format cell values based on column type
   */
  formatCellValue(value, columnKey) {
    if (value === null || value === undefined) return '—';
    
    // Highlight breach volumes in red
    if (columnKey.includes('breach') && value > 0) {
      return `<span class="breach-value">${value.toLocaleString()}</span>`;
    }
    
    // Format numbers with commas
    if (typeof value === 'number') {
      return value.toLocaleString();
    }
    
    return value;
  }

  /**
   * Render shortage visibility (custom layout)
   */
  renderShortageView(container) {
    container.innerHTML = `
      <div class="shortage-placeholder">
        <p>⚠️ Shortage visibility requires Superset integration</p>
        <p>This metric will be implemented in the next phase</p>
      </div>
    `;
  }

  /**
   * Render shipment tracker (search interface)
   */
  renderShipmentTracker(container) {
    container.innerHTML = `
      <div class="shipment-tracker">
        <div class="tracker-search">
          <input 
            type="text" 
            id="shipment-search" 
            placeholder="Enter Shipment ID or AWB..."
          />
          <button id="track-btn">Track</button>
        </div>
        <div id="shipment-path" class="shipment-path">
          <!-- Path visualization will render here -->
        </div>
      </div>
    `;

    document.getElementById('track-btn')?.addEventListener('click', () => {
      const shipmentId = document.getElementById('shipment-search').value.trim();
      if (shipmentId) {
        this.trackShipment(shipmentId);
      }
    });
  }

  /**
   * Track shipment journey (placeholder)
   */
  async trackShipment(shipmentId) {
    const pathContainer = document.getElementById('shipment-path');
    pathContainer.innerHTML = '<div class="loading">Tracking shipment...</div>';

    // TODO: Implement actual tracking API call
    setTimeout(() => {
      pathContainer.innerHTML = `
        <div class="placeholder">
          Shipment tracking for <strong>${shipmentId}</strong> will be implemented with OpsTech API
        </div>
      `;
    }, 1000);
  }

  /**
   * Show loading state
   */
  showLoading() {
    const body = document.getElementById('sc-dashboard-body');
    if (body) {
      body.innerHTML = `
        <div class="loading-state">
          <div class="spinner"></div>
          <p>Loading data...</p>
        </div>
      `;
    }
  }

  /**
   * Show error state
   */
  showError(message) {
    const body = document.getElementById('sc-dashboard-body');
    if (body) {
      body.innerHTML = `
        <div class="error-state">
          <p>❌ ${message}</p>
          <button onclick="this.closest('.sc-manager-overlay').querySelector('#sc-refresh-btn').click()">Retry</button>S
      `;
    }
  }

  /**
   * Start auto-refresh for current metric
   */
  startAutoRefresh(metricKey) {
    // Clear existing timer
    if (this.refreshTimers.has(metricKey)) {
      clearInterval(this.refreshTimers.get(metricKey));
    }

    const queryConfig = METABASE_QUERIES[metricKey];
    const interval = queryConfig.refreshInterval || 60000;

    const timer = setInterval(() => {
      if (this.activeMetric === metricKey) {
        console.log(`[SC Dashboard] Auto-refreshing ${metricKey}`);
        this.loadMetric(metricKey);
      }
    }, interval);

    this.refreshTimers.set(metricKey, timer);
  }

  /**
   * Manually refresh current metric
   */
  refreshCurrentMetric() {
    this.cache.delete(this.activeMetric);
    this.loadMetric(this.activeMetric);
  }

  /**
   * Export current data to CSV
   */
  exportToCSV() {
    const cached = this.cache.get(this.activeMetric);
    if (!cached || !cached.rows.length) {
      alert('No data to export');
      return;
    }

    const queryConfig = METABASE_QUERIES[this.activeMetric];
    const displayCols = queryConfig.displayColumns || [];

    // Build CSV
    const headers = displayCols.map(col => col.label).join(',');
    const colMap = {};
    cached.columns.forEach((col, idx) => {
      colMap[col.name] = idx;
    });

    const rows = cached.rows.map(row => {
      return displayCols.map(col => {
        const value = row[colMap[col.key]] ?? '';
        return `"${value}"`;
      }).join(',');
    }).join('\n');

    const csv = `${headers}\n${rows}`;
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${queryConfig.name.replace(/\s/g, '_')}_${Date.now()}.csv`;
    a.click();
    URL.revokeObjectURL(url);

    console.log('[SC Dashboard] Exported CSV');
  }

  /**
   * Cleanup timers
   */
  destroy() {
    this.refreshTimers.forEach(timer => clearInterval(timer));
    this.refreshTimers.clear();
  }
}

window.SCDashboard = SCDashboard;
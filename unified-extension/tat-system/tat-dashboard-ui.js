/**
 * TAT Monitoring Dashboard UI
 * 
 * Shows real-time ticket tracking with urgency indicators
 * Integrated into L1 Chatbot Enhanced overlay
 */

// Add to L1ChatbotOverlayEnhanced class

/**
 * Inject TAT Dashboard Tab
 */
function injectTATDashboard() {
  // Add "My Tickets" tab to the header
  const tabsContainer = document.querySelector('.valmo-tabs');
  if (!tabsContainer) return;
  
  // Check if already exists
  if (document.querySelector('[data-tab="tickets"]')) return;
  
  const tatTabHTML = `
    <button class="valmo-tab-btn" data-tab="tickets" id="tab-tickets">
      <span class="tab-icon">📊</span>
      <span class="tab-label">My Tickets</span>
      <span class="ticket-badge" id="overdue-badge" style="display:none;"></span>
    </button>
  `;
  
  tabsContainer.insertAdjacentHTML('beforeend', tatTabHTML);
  
  // Add content container
  const content = document.querySelector('.valmo-content');
  if (!content) return;
  
  const tatContentHTML = `
    <div class="valmo-tab-content" data-tab="tickets">
      <div id="tat-dashboard-container"></div>
    </div>
  `;
  
  content.insertAdjacentHTML('beforeend', tatContentHTML);
  
  // Attach click listener
  document.getElementById('tab-tickets')?.addEventListener('click', () => {
    loadTATDashboard();
  });
}

/**
 * Inject the Tickets / My Metrics toggle into the My Tickets tab
 * Called once when the tab is first activated.
 */
function injectTicketsToggle() {
  const container = document.getElementById('tat-dashboard-container');
  if (!container || container.dataset.toggled) return;
  container.dataset.toggled = 'true';

  container.innerHTML = `
    <div class="tickets-tab-toggle">
      <button class="tickets-toggle-btn active" id="toggle-tickets">🎫 Tickets</button>
      <button class="tickets-toggle-btn" id="toggle-metrics">📈 My Metrics</button>
    </div>
    <div id="tickets-panel"></div>
    <div id="art-metrics-container" style="display:none"></div>
  `;

  document.getElementById('toggle-tickets').addEventListener('click', () => {
    document.getElementById('toggle-tickets').classList.add('active');
    document.getElementById('toggle-metrics').classList.remove('active');
    document.getElementById('tickets-panel').style.display = '';
    document.getElementById('art-metrics-container').style.display = 'none';
  });

  document.getElementById('toggle-metrics').addEventListener('click', () => {
    document.getElementById('toggle-metrics').classList.add('active');
    document.getElementById('toggle-tickets').classList.remove('active');
    document.getElementById('tickets-panel').style.display = 'none';
    document.getElementById('art-metrics-container').style.display = '';
    loadARTMetrics();
  });
}

/**
 * Load and render TAT dashboard
 */
async function loadTATDashboard() {
  injectTicketsToggle();

  const container = document.getElementById('tickets-panel') ||
                    document.getElementById('tat-dashboard-container');
  if (!container) return;
  
  // Check if extension context is still valid
  if (!chrome.runtime?.id) {
    console.log('[TAT Dashboard] Extension context invalidated');
    container.innerHTML = `
      <div class="tat-error">
        <p>⚠️ Extension reloaded. Please refresh the page.</p>
      </div>
    `;
    return;
  }
  
  // Show loading
  container.innerHTML = `
    <div class="tat-loading">
      <div class="loading-spinner"></div>
      <p>Loading tickets...</p>
    </div>
  `;
  
  try {
    console.log('[TAT Dashboard] Chrome object:', typeof chrome);
    console.log('[TAT Dashboard] Chrome.storage:', typeof chrome?.storage);
    console.log('[TAT Dashboard] Chrome.storage.local:', typeof chrome?.storage?.local);
    
    // Get tracked tickets from storage
    const result = await chrome.storage.local.get(['trackedTickets', 'lastTicketFetch']);
    
    console.log('[TAT Dashboard] Storage result:', result);
    console.log('[TAT Dashboard] Tickets count:', result.trackedTickets?.length || 0);
    
    const tickets = result.trackedTickets || [];
    const lastFetch = result.lastTicketFetch || 0;
    const timeSinceUpdate = Math.floor((Date.now() - lastFetch) / 1000);
    
    if (tickets.length === 0) {
      console.log('[TAT Dashboard] No tickets found in storage');
      container.innerHTML = renderEmptyState();
      return;
    }
    
    console.log('[TAT Dashboard] Rendering', tickets.length, 'tickets');
    
    // Group tickets by urgency
    const grouped = groupTicketsByUrgency(tickets);
    const stats = calculateStats(tickets);
    
    // Render dashboard
    container.innerHTML = renderTATDashboard(grouped, stats, timeSinceUpdate);
    
    // Attach event listeners
    attachTATDashboardListeners();
    
    // Update badge
    updateOverdueBadge(stats.overdue);
    
  } catch (error) {
    if (error.message?.includes('Extension context invalidated')) {
      console.log('[TAT Dashboard] Context invalidated, needs page refresh');
      container.innerHTML = `
        <div class="tat-error">
          <p>⚠️ Extension reloaded. Please refresh the page.</p>
          <button onclick="window.location.reload()">Refresh Page</button>
        </div>
      `;
    } else {
      console.error('[TAT Dashboard] Error loading:', error);
      container.innerHTML = `
        <div class="tat-error">
          <p>❌ Failed to load tickets</p>
          <button onclick="loadTATDashboard()">Retry</button>
        </div>
      `;
    }
  }
}

/**
 * Refresh button handler - reload the dashboard
 */
function refreshTickets() {
  loadTATDashboard();
}

/**
 * Export button handler - trigger Excel export
 */
async function exportTATAnalytics() {
  if (typeof tatAnalytics !== 'undefined') {
    await tatAnalytics.exportToExcel();
  } else {
    alert('Analytics module not loaded. Please refresh the page.');
  }
}

/**
 * Group tickets by urgency
 */
function groupTicketsByUrgency(tickets) {
  return {
    overdue: tickets.filter(t => t.urgencyLevel === 'OVERDUE'),
    dueSoon: tickets.filter(t => t.urgencyLevel === 'DUE_SOON'),
    onTrack: tickets.filter(t => t.urgencyLevel === 'ON_TRACK')
  };
}

/**
 * Calculate statistics
 */
function calculateStats(tickets) {
  return {
    total: tickets.length,
    overdue: tickets.filter(t => t.urgencyLevel === 'OVERDUE').length,
    dueSoon: tickets.filter(t => t.urgencyLevel === 'DUE_SOON').length,
    onTrack: tickets.filter(t => t.urgencyLevel === 'ON_TRACK').length
  };
}

/**
 * Render complete TAT dashboard (SLA from Kapture removed — team SLAs coming soon)
 */
function renderTATDashboard(grouped, stats, timeSinceUpdate) {
  const allTickets = [...grouped.overdue, ...grouped.dueSoon, ...grouped.onTrack];
  return `
    <div class="tat-dashboard">
      <!-- Header -->
      <div class="tat-header">
        <div class="tat-title">
          <h3>📊 My Tickets</h3>
          <span class="last-update">Updated ${timeSinceUpdate}s ago</span>
        </div>
        <button class="refresh-btn" onclick="refreshTickets()">
          🔄 Refresh
        </button>
      </div>

      <!-- SLA Coming Soon Banner -->
      <div class="sla-coming-soon-banner">
        <span class="sla-icon">📋</span>
        <div>
          <strong>SLA tracking coming soon</strong>
          <p>Team-defined SLAs based on SOPs will appear here. Hang tight!</p>
        </div>
      </div>

      <!-- Simple ticket count -->
      <div class="tat-stats">
        <div class="stat-card total" style="grid-column: 1 / -1;">
          <div class="stat-number">${stats.total}</div>
          <div class="stat-label">Open Tickets</div>
        </div>
      </div>

      <!-- All Tickets (no urgency grouping) -->
      <div class="tat-section">
        <div class="section-header">
          <h4>ALL TICKETS (${allTickets.length})</h4>
        </div>
        <div class="ticket-list">
          ${allTickets.map(ticket => renderTicketCard(ticket)).join('')}
        </div>
      </div>
    </div>
  `;
}

/**
 * Render individual ticket card (no Kapture SLA — team SLAs coming soon)
 */
function renderTicketCard(ticket) {
  return `
    <div class="ticket-card">
      <div class="ticket-header">
        <span class="ticket-id">#${ticket.ticketId}</span>
        ${ticket.sopCategory ? `<span class="ticket-category">${ticket.sopCategory}</span>` : ''}
        ${ticket.isEscalated ? '<span class="escalated-badge">⚠️ Escalated</span>' : ''}
      </div>

      <div class="ticket-subject">${escapeHtml(ticket.subject)}</div>

      <div class="ticket-meta">
        <span class="ticket-customer">👤 ${escapeHtml(ticket.customerEmail)}</span>
        <span class="ticket-status">${ticket.substatusName}</span>
      </div>

      <div class="ticket-actions">
        <button class="open-ticket-btn" onclick="openTicket('${ticket.ticketURL}')">
          Open Ticket →
        </button>
      </div>
    </div>
  `;
}

/**
 * Render empty state
 */
function renderEmptyState() {
  return `
    <div class="tat-empty">
      <div class="empty-icon">📭</div>
      <h3>No Pending Tickets</h3>
      <p>You're all caught up! Great work! 🎉</p>
      <button onclick="refreshTickets()">Check Again</button>
    </div>
  `;
}

/**
 * Attach event listeners
 */
function attachTATDashboardListeners() {
  // Ticket card click
  document.querySelectorAll('.ticket-card').forEach(card => {
    card.addEventListener('click', (e) => {
      if (e.target.closest('.open-ticket-btn')) return;
      
      const ticketURL = card.querySelector('.open-ticket-btn')?.getAttribute('onclick')?.match(/'([^']+)'/)?.[1];
      if (ticketURL) {
        window.open(ticketURL, '_blank');
      }
    });
  });
}

/**
 * Refresh tickets from API
 */
async function refreshTickets() {
  console.log('[TAT Dashboard] Refreshing tickets...');
  
  // Show loading in refresh button
  const refreshBtn = document.querySelector('.refresh-btn');
  if (refreshBtn) {
    refreshBtn.innerHTML = '⏳ Loading...';
    refreshBtn.disabled = true;
  }
  
  try {
    // Trigger background fetch (this will be handled by ticket-tracker.js)
    chrome.runtime.sendMessage({ type: 'REFRESH_TICKETS' });
    
    // Wait a bit for fetch to complete
    setTimeout(() => {
      loadTATDashboard();
    }, 2000);
    
  } catch (error) {
    console.error('[TAT Dashboard] Refresh failed:', error);
    if (refreshBtn) {
      refreshBtn.innerHTML = '🔄 Refresh';
      refreshBtn.disabled = false;
    }
  }
}

/**
 * Toggle section collapse
 */
function toggleSection(btn) {
  const section = btn.closest('.tat-section');
  const list = section.querySelector('.ticket-list');
  
  list.classList.toggle('collapsed');
  btn.textContent = list.classList.contains('collapsed') ? '▼' : '▲';
}

/**
 * Open ticket in new tab
 */
function openTicket(url) {
  window.open(url, '_blank');
  
  // Log analytics
  chrome.runtime.sendMessage({
    type: 'TICKET_OPENED',
    url: url,
    timestamp: Date.now()
  });
}

/**
 * Update overdue badge
 */
function updateOverdueBadge(count) {
  const badge = document.getElementById('overdue-badge');
  if (!badge) return;
  
  if (count > 0) {
    badge.textContent = count;
    badge.style.display = 'inline-block';
  } else {
    badge.style.display = 'none';
  }
}

/**
 * Escape HTML
 */
function escapeHtml(str) {
  const div = document.createElement('div');
  div.appendChild(document.createTextNode(str || ''));
  return div.innerHTML;
}

/**
 * Export TAT Analytics to Excel
 */
async function exportTATAnalytics() {
  console.log('[TAT Dashboard] Exporting analytics...');
  
  if (typeof tatAnalytics !== 'undefined') {
    await tatAnalytics.exportToExcel();
  } else {
    alert('Analytics module not loaded. Please refresh the page.');
  }
}

// Initialize when overlay loads
document.addEventListener('DOMContentLoaded', () => {
  injectTATDashboard();
});
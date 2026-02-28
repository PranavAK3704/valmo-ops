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
 * Load and render TAT dashboard
 */
async function loadTATDashboard() {
  const container = document.getElementById('tat-dashboard-container');
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
 * Render complete TAT dashboard
 */
function renderTATDashboard(grouped, stats, timeSinceUpdate) {
  return `
    <div class="tat-dashboard">
      <!-- Header -->
      <div class="tat-header">
        <div class="tat-title">
          <h3>📊 My Tickets</h3>
          <span class="last-update">Updated ${timeSinceUpdate}s ago</span>
        </div>
        <div style="display: flex; gap: 8px;">
          <button class="refresh-btn" onclick="refreshTickets()">
            🔄 Refresh
          </button>
          <button class="refresh-btn" onclick="exportTATAnalytics()" style="background: linear-gradient(135deg, #4ecdc4 0%, #44a08d 100%);">
            📊 Export Excel
          </button>
        </div>
      </div>
      
      <!-- Stats Summary -->
      <div class="tat-stats">
        <div class="stat-card total">
          <div class="stat-number">${stats.total}</div>
          <div class="stat-label">Total Tickets</div>
        </div>
        <div class="stat-card overdue">
          <div class="stat-number">${stats.overdue}</div>
          <div class="stat-label">🔴 Overdue</div>
        </div>
        <div class="stat-card due-soon">
          <div class="stat-number">${stats.dueSoon}</div>
          <div class="stat-label">🟡 Due Soon</div>
        </div>
        <div class="stat-card on-track">
          <div class="stat-number">${stats.onTrack}</div>
          <div class="stat-label">🟢 On Track</div>
        </div>
      </div>
      
      <!-- Overdue Tickets -->
      ${grouped.overdue.length > 0 ? `
        <div class="tat-section overdue-section">
          <div class="section-header">
            <span class="section-icon">🔴</span>
            <h4>OVERDUE (${grouped.overdue.length})</h4>
          </div>
          <div class="ticket-list">
            ${grouped.overdue.map(ticket => renderTicketCard(ticket)).join('')}
          </div>
        </div>
      ` : ''}
      
      <!-- Due Soon Tickets -->
      ${grouped.dueSoon.length > 0 ? `
        <div class="tat-section due-soon-section">
          <div class="section-header">
            <span class="section-icon">🟡</span>
            <h4>DUE SOON (${grouped.dueSoon.length})</h4>
          </div>
          <div class="ticket-list">
            ${grouped.dueSoon.map(ticket => renderTicketCard(ticket)).join('')}
          </div>
        </div>
      ` : ''}
      
      <!-- On Track Tickets -->
      ${grouped.onTrack.length > 0 ? `
        <div class="tat-section on-track-section">
          <div class="section-header">
            <span class="section-icon">🟢</span>
            <h4>ON TRACK (${grouped.onTrack.length})</h4>
            <button class="collapse-btn" onclick="toggleSection(this)">▼</button>
          </div>
          <div class="ticket-list collapsed">
            ${grouped.onTrack.map(ticket => renderTicketCard(ticket)).join('')}
          </div>
        </div>
      ` : ''}
    </div>
  `;
}

/**
 * Render individual ticket card
 */
function renderTicketCard(ticket) {
  const overdueHours = ticket.remainingHours < 0 ? Math.abs(ticket.remainingHours) : 0;
  const timeDisplay = ticket.remainingHours < 0 
    ? `${Math.floor(overdueHours)}h ${Math.round((overdueHours % 1) * 60)}m OVER`
    : `${Math.floor(ticket.remainingHours)}h ${Math.round((ticket.remainingHours % 1) * 60)}m left`;
  
  return `
    <div class="ticket-card ${ticket.urgencyColor}" data-ticket-id="${ticket.ticketId}">
      <div class="ticket-header">
        <span class="ticket-id">#${ticket.ticketId}</span>
        <span class="ticket-category">${ticket.sopCategory}</span>
        ${ticket.isEscalated ? '<span class="escalated-badge">⚠️ Escalated</span>' : ''}
      </div>
      
      <div class="ticket-subject">${escapeHtml(ticket.subject)}</div>
      
      <div class="ticket-meta">
        <span class="ticket-customer">👤 ${escapeHtml(ticket.customerEmail)}</span>
        <span class="ticket-status">${ticket.substatusName}</span>
      </div>
      
      <div class="ticket-tat">
        <div class="tat-info">
          <span class="tat-icon">${ticket.urgencyIcon}</span>
          <span class="tat-time ${ticket.urgencyColor}">${timeDisplay}</span>
        </div>
        <div class="tat-detail">
          <span class="elapsed">Elapsed: ${ticket.elapsedHours}h</span>
          <span class="tat-total">TAT: ${ticket.tatHours}h</span>
        </div>
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
      
      const ticketId = card.dataset.ticketId;
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
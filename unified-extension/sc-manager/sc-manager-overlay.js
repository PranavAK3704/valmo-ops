/**
 * sc-manager-overlay.js - SC Manager Main Overlay
 * 
 * 3 Tabs:
 * 1. Processes - Training videos
 * 2. SOPs + Chatbot - Reconciliation procedures
 * 3. Dashboard - Live Metabase data
 */

class SCManagerOverlay {
  constructor() {
    this.container = null;
    this.activeTab = 'processes';
    this.dashboard = null;
    this.chatbot = null;
    this.init();
  }

  init() {
    console.log('[SC Manager] Initializing overlay');
    this.injectOverlay();
    this.loadProcesses();
  }

  /**
   * Inject overlay UI
   */
  injectOverlay() {
    // Remove existing if present
    const existing = document.getElementById('sc-manager-overlay');
    if (existing) existing.remove();

    const overlayHTML = `
      <div id="sc-manager-overlay" class="valmo-overlay sc-manager-overlay">
        <!-- Header -->
        <div class="overlay-header">
          <div class="header-title">
            <span class="header-icon">📊</span>
            <span>SC Manager Console</span>
          </div>
          <button class="close-btn" id="sc-close-btn">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor">
              <path d="M18 6L6 18M6 6l12 12"/>
            </svg>
          </button>
        </div>

        <!-- Tab Navigation -->
        <div class="overlay-tabs">
          <button class="tab-btn active" data-tab="processes">
            <span class="tab-icon">🎥</span>
            <span>Processes</span>
          </button>
          <button class="tab-btn" data-tab="sops">
            <span class="tab-icon">📋</span>
            <span>SOPs + AI</span>
          </button>
          <button class="tab-btn" data-tab="dashboard">
            <span class="tab-icon">📈</span>
            <span>Dashboard</span>
          </button>
        </div>

        <!-- Tab Content -->
        <div class="overlay-content">
          <!-- Processes Tab -->
          <div id="sc-tab-processes" class="tab-content active">
            <div class="processes-section">
              <div class="section-header">
                <h3>Training Videos</h3>
                <div class="process-filters">
                  <button class="filter-btn active" data-filter="all">All</button>
                  <button class="filter-btn" data-filter="new">New This Week</button>
                  <button class="filter-btn" data-filter="updated">Recently Updated</button>
                </div>
              </div>
              <div id="sc-processes-list" class="processes-list">
                <div class="loading">Loading training videos...</div>
              </div>
            </div>
          </div>

          <!-- SOPs + Chatbot Tab -->
          <div id="sc-tab-sops" class="tab-content">
            <div class="sops-section">
              <div class="sop-categories">
                <h4>Reconciliation SOPs</h4>
                <div id="sc-sop-list" class="sop-list">
                  <div class="sop-item" data-sop="facility">
                    <div class="sop-icon">🏢</div>
                    <div class="sop-info">
                      <div class="sop-title">Facility Pendency</div>
                      <div class="sop-desc">7-day cycle, Monday reports</div>
                    </div>
                  </div>
                  <div class="sop-item" data-sop="transit">
                    <div class="sop-icon">🚚</div>
                    <div class="sop-info">
                      <div class="sop-title">In-Transit Pendency</div>
                      <div class="sop-desc">5-day trips, 120hr evidence</div>
                    </div>
                  </div>
                  <div class="sop-item" data-sop="bag-nlh">
                    <div class="sop-icon">👜</div>
                    <div class="sop-info">
                      <div class="sop-title">Bag Shortage (NLH)</div>
                      <div class="sop-desc">24hr marking, CCTV required</div>
                    </div>
                  </div>
                  <div class="sop-item" data-sop="bag-rlh">
                    <div class="sop-icon">📝</div>
                    <div class="sop-info">
                      <div class="sop-title">Bag Shortage (RLH)</div>
                      <div class="sop-desc">Trip Sheet process</div>
                    </div>
                  </div>
                  <div class="sop-item" data-sop="shipment">
                    <div class="sop-icon">📦</div>
                    <div class="sop-info">
                      <div class="sop-title">Shipment Shortage</div>
                      <div class="sop-desc">Marked vs Assigned location</div>
                    </div>
                  </div>
                  <div class="sop-item" data-sop="cctv">
                    <div class="sop-icon">📹</div>
                    <div class="sop-info">
                      <div class="sop-title">CCTV Requirements</div>
                      <div class="sop-desc">Footage specifications</div>
                    </div>
                  </div>
                  <div class="sop-item" data-sop="damage">
                    <div class="sop-icon">⚠️</div>
                    <div class="sop-info">
                      <div class="sop-title">Damage/Tamper</div>
                      <div class="sop-desc">24hr marking, Pre-Alert email</div>
                    </div>
                  </div>
                </div>
              </div>

              <div class="chatbot-section">
                <h4>Ask AI Assistant</h4>
                <div id="sc-chatbot" class="chatbot-container">
                  <div class="chat-messages" id="sc-chat-messages">
                    <div class="chat-message assistant">
                      <div class="message-content">
                        👋 Hi! I can help you with SC reconciliation SOPs. Ask me about:
                        <ul>
                          <li>Facility pendency timelines</li>
                          <li>In-transit liability rules</li>
                          <li>Bag shortage procedures</li>
                          <li>CCTV evidence requirements</li>
                        </ul>
                      </div>
                    </div>
                  </div>
                  <div class="chat-input-container">
                    <input 
                      type="text" 
                      id="sc-chat-input" 
                      placeholder="Ask about reconciliation procedures..."
                    />
                    <button id="sc-chat-send">Send</button>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <!-- Dashboard Tab -->
          <div id="sc-tab-dashboard" class="tab-content">
            <div id="sc-dashboard-container">
              <!-- Dashboard renders here via SCDashboard class -->
            </div>
          </div>
        </div>
      </div>
    `;

    document.body.insertAdjacentHTML('beforeend', overlayHTML);
    this.container = document.getElementById('sc-manager-overlay');

    // Attach event listeners
    this.attachEventListeners();
  }

  /**
   * Attach all event listeners
   */
  attachEventListeners() {
    // Close button
    document.getElementById('sc-close-btn')?.addEventListener('click', () => {
      this.destroy();
    });

    // Tab switching
    this.container.querySelectorAll('.tab-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const tab = e.currentTarget.dataset.tab;
        this.switchTab(tab);
      });
    });

    // Process filters
    this.container.querySelectorAll('.filter-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        this.container.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
        e.currentTarget.classList.add('active');
        const filter = e.currentTarget.dataset.filter;
        this.filterProcesses(filter);
      });
    });

    // SOP item clicks
    this.container.querySelectorAll('.sop-item').forEach(item => {
      item.addEventListener('click', (e) => {
        const sopKey = e.currentTarget.dataset.sop;
        this.showSOPDetails(sopKey);
      });
    });

    // Chatbot
    document.getElementById('sc-chat-send')?.addEventListener('click', () => {
      this.sendChatMessage();
    });

    document.getElementById('sc-chat-input')?.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') {
        this.sendChatMessage();
      }
    });
  }

  /**
   * Switch between tabs
   */
  switchTab(tabName) {
    this.activeTab = tabName;

    // Update tab buttons
    this.container.querySelectorAll('.tab-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.tab === tabName);
    });

    // Update tab content
    this.container.querySelectorAll('.tab-content').forEach(content => {
      content.classList.toggle('active', content.id === `sc-tab-${tabName}`);
    });

    // Initialize tab-specific content
    if (tabName === 'dashboard' && !this.dashboard) {
      this.initDashboard();
    }
  }

  /**
   * Load training processes from sheet
   */
  async loadProcesses() {
    try {
        const response = await chrome.runtime.sendMessage({ type: 'PULSE_REQUEST_MATCHES'});
      const processes = response.matches || []; // Uses existing function from background.js
      this.renderProcesses(processes);
    } catch (err) {
      console.error('[SC Manager] Failed to load processes:', err);
      document.getElementById('sc-processes-list').innerHTML = 
        '<div class="error">Failed to load training videos</div>';
    }
  }

  /**
   * Render processes list
   */
  renderProcesses(processes) {
    const container = document.getElementById('sc-processes-list');
    
    if (!processes || processes.length === 0) {
      container.innerHTML = '<div class="no-data">No training videos available</div>';
      return;
    }

    const processesHTML = processes.map(proc => `
      <div class="process-card" data-process="${proc.process_name}">
        <div class="process-header">
          <h4>${proc.process_name}</h4>
          ${this.isNew(proc) ? '<span class="badge new">New</span>' : ''}
        </div>
        <div class="process-meta">
          <span>📍 Tab: ${proc.start_tab || 'N/A'}</span>
          <span>🔗 Module: ${proc.url_module || 'N/A'}</span>
        </div>
        <button class="watch-btn" data-video="${proc.video_link}">
          ▶ Watch Training
        </button>
      </div>
    `).join('');

    container.innerHTML = processesHTML;

    // Add click listeners for watch buttons
    container.querySelectorAll('.watch-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const videoUrl = e.currentTarget.dataset.video;
        window.open(videoUrl, '_blank');
      });
    });
  }

  /**
   * Check if process is new (placeholder logic)
   */
  isNew(process) {
    // TODO: Add actual logic based on process creation date
    return false;
  }

  /**
   * Filter processes
   */
  filterProcesses(filter) {
    const cards = this.container.querySelectorAll('.process-card');
    
    cards.forEach(card => {
      // TODO: Implement actual filtering logic
      card.style.display = 'block';
    });
  }

  /**
   * Show SOP details (placeholder)
   */
  showSOPDetails(sopKey) {
    alert(`SOP Details for ${sopKey} will be shown in a modal or expanded view`);
  }

  /**
   * Send chat message to AI
   */
  async sendChatMessage() {
    const input = document.getElementById('sc-chat-input');
    const message = input.value.trim();
    
    if (!message) return;

    // Add user message
    this.addChatMessage(message, 'user');
    input.value = '';

    // TODO: Integrate with Groq chatbot (reuse L1 chatbot logic)
    // For now, show placeholder response
    setTimeout(() => {
      this.addChatMessage(
        'AI chatbot integration will be implemented using the reconciliation SOP knowledge base.',
        'assistant'
      );
    }, 500);
  }

  /**
   * Add message to chat
   */
  addChatMessage(content, role) {
    const messagesContainer = document.getElementById('sc-chat-messages');
    
    const messageHTML = `
      <div class="chat-message ${role}">
        <div class="message-content">${content}</div>
      </div>
    `;

    messagesContainer.insertAdjacentHTML('beforeend', messageHTML);
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
  }

  /**
   * Initialize dashboard
   */
  initDashboard() {
    const container = document.getElementById('sc-dashboard-container');
    this.dashboard = new SCDashboard(container);
    this.dashboard.init();
    console.log('[SC Manager] Dashboard initialized');
  }

  /**
   * Cleanup
   */
  destroy() {
    if (this.dashboard) {
      this.dashboard.destroy();
    }
    if (this.container) {
      this.container.remove();
    }
    console.log('[SC Manager] Overlay destroyed');
  }
}

window.SCManagerOverlay = SCManagerOverlay;
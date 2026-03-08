/**
 * content.js - Unified Ops Assistant (ENHANCED UI for L1 Agents)
 * 
 * NEW FEATURES:
 * - Quick action dashboard with category buttons
 * - Visual answer cards with icons and step numbers
 * - Color-coded urgency (red/yellow/green based on TAT)
 * - Template search with "Most Used" section
 * - Conversation history breadcrumb
 * - Better loading states
 * - Analytics tracking
 * - TAT Monitoring Dashboard
 */

const OVERLAY_ID = "valmo-ops-overlay";
let currentUser = null;
let currentPlatform = null;
let overlayInstance = null;

console.log("[Valmo Ops] Content script loaded (Enhanced UI)");

// ─── Analytics Helper ───
const analytics = {
  log: (event, data) => {
    try {
      chrome.storage.local.get(['analytics'], (result) => {
        const logs = result.analytics || [];
        logs.push({
          timestamp: Date.now(),
          event: event,
          data: data,
          user: currentUser?.email || 'unknown'
        });
        
        // Keep only last 1000 events to avoid storage bloat
        if (logs.length > 1000) {
          logs.shift();
        }
        
        chrome.storage.local.set({ analytics: logs });
      });
    } catch (e) {
      console.log('[Analytics] Failed to log:', e);
    }
  }
};

// ─── Detect platform from URL ───
function detectPlatform() {
  const url = window.location.href;
  if (url.includes('console.valmo.in')) return 'log10';
  if (url.includes('kapturecrm.com')) return 'kapture';
  return 'unknown';
}

// ─── Initialize ───
async function init() {
  currentPlatform = detectPlatform();
  
  const result = await chrome.storage.local.get(['userEmail', 'userRole']);
  
  if (!result.userEmail) {
    console.log("[Valmo Ops] No user logged in");
    return;
  }
  
  currentUser = { email: result.userEmail, role: result.userRole };
  console.log(`[Valmo Ops] ${currentUser.role} on ${currentPlatform}`);
  
  analytics.log('session_start', { role: currentUser.role, platform: currentPlatform });
  
  if (shouldShowOverlay()) {
    injectOverlay();
  }

  if (currentUser.role === 'Captain' && currentPlatform === 'log10') {
    console.log('[Gamification] Initializing for Captain...');

    // Initialize gamification system
    if (typeof window.gamificationSystem !== 'undefined' && 
        typeof window.gamificationSystem.init === 'function') {
      try {
        await window.gamificationSystem.init(currentUser.email);
        console.log('[Gamification] ✅ System initialized');
      } catch (error) {
        console.error('[Gamification] Init error:', error);
      }
    } else {
      console.warn('[Gamification] gamificationSystem not ready yet');
    }

    // Initialize My Stats tab
    if (window.myStatsTab) {
      try {
        await window.myStatsTab.init(currentUser.email);

        //wait a moment for the sidebar to be injected, then add the stats tab
        setTimeout(() => {
          window.myStatsTab.injectTab();
          console.log('[Gamification] ✅ My Stats tab injected');
        }, 500);
      } catch (error) {
        console.error('[Gamification] My Stats init error:', error);
      }
    } else {
      console.warn('[Gamification] myStatsTab not loaded');
    }

    // Initialize Metrics Dashboard
    if (window.metricsDashboard) {
      try {
        await window.metricsDashboard.init(currentUser.email);

        // Wait for sidebar to be ready, then inject metrics tab
        setTimeout(() => {
          window.metricsDashboard.injectDashboard();
          console.log('[Gamification] ✅ Metrics dashboard injected');
        }, 600);
      } catch (error) {
        console.error('[Gamification] Metrics init error:', error);
      }
    } else {
      console.warn('[Gamification] metricsDashboard not loaded');
    }

    // Initialize Captain Timer System
    if (window.captainTimerSystem) {
      try {
        await window.captainTimerSystem.init(currentUser.email);
        console.log('[Captain Timer] ✅ System initialized');
      } catch (error) {
        console.error('[Captain Timer] Init error:', error);
      }
    } else {
      console.warn('[Captain Timer] captainTimerSystem not loaded');
    }
  }
}

// ─── Inject appropriate overlay ───
function injectOverlay() {
  if (overlayInstance) return;
  
  const { role } = currentUser;
  
  if (role === 'Captain' && currentPlatform === 'log10') {
    overlayInstance = new ProcessPulseOverlay();
    overlayInstance.inject();
  } else if (role === 'L1 Agent' && currentPlatform === 'kapture') {
    overlayInstance = new L1ChatbotOverlayEnhanced();
    overlayInstance.inject();
  } else if (role === 'SC Manager' && currentPlatform === 'log10') {
    overlayInstance = new SCManagerOverlay();
  }
}

// ─── Should we show overlay? ───
function shouldShowOverlay() {
  const { role } = currentUser;
  
  if (role === 'Captain' && currentPlatform === 'log10') return true;
  if (role === 'L1 Agent' && currentPlatform === 'kapture') return true;
  if (role === 'SC Manager' && currentPlatform === 'log10') return true;
  
  return false;
}

// ─── Inject appropriate overlay ───

// ═══════════════════════════════════════════════════════════════
// OVERLAY 1: Process Pulse (Captain on Log10) - UNCHANGED
// ═══════════════════════════════════════════════════════════════

class ProcessPulseOverlay {
  constructor() {
    this.matches = [];
    this.isPanelOpen = false;
  }
  
  inject() {
    const html = `
      <div id="${OVERLAY_ID}" class="valmo-overlay valmo-pulse">
        <div class="valmo-tab" id="valmo-tab">
          <div class="valmo-icon">🎯</div>
          <div class="valmo-label">Videos</div>
        </div>
        <div class="valmo-panel" id="valmo-panel">
          <div class="valmo-header">
            <span class="valmo-title">Captain Support</span>
            <button class="valmo-close" id="valmo-close">✕</button>
          </div>

          <div class="valmo-welcome">
            👋 Hi Captain! <br>
            I’m your support assistant. <br>
            You can:
            <ul>
              <li>🎥 Watch training videos for this tab</li>
              <li>🤖 Ask Jarvis anything</li>
            </ul>
          </div>

          <div class="valmo-nav">
            <button class="valmo-nav-btn active" data-tab="videos">🎥 Videos</button>
            <button class="valmo-nav-btn" data-tab="jarvis">🤖 Jarvis AI</button>
          </div>
          
          <div class="valmo-content">
            <div id="videos-view" class="valmo-view active">
              <div id="valmo-process-list"></div>
            </div>

            <div id="jarvis-view" class="valmo-view">
              <div class="valmo-jarvis-box">
                <p>Need help? Ask Jarvis anything.</p>
                <button id="open-jarvis-btn" class="valmo-jarvis-btn">
                  Open Jarvis AI →
                </button>
              </div>
            </div>
          </div>

            
          <div class="valmo-footer">Powered by Adhyayan</div>
        </div>
      </div>
    `;
    
    const wrapper = document.createElement('div');
    wrapper.innerHTML = html;
    document.body.appendChild(wrapper.firstElementChild);
    
    this.attachListeners();

    document.getElementById("open-jarvis-btn")?.addEventListener("click", () => {
      window.open(
        "https://ai-assistant-trainer-651608447704.asia-southeast1.run.app/",
        "_blank"
      );
    });

    document.querySelectorAll(".valmo-nav-btn").forEach(btn => {
      btn.addEventListener("click", (e) => {
        document.querySelectorAll(".valmo-nav-btn").forEach(b => b.classList.remove("active"));
        document.querySelectorAll(".valmo-view").forEach(v => v.classList.remove("active"));

        e.target.classList.add("active");
        document.getElementById(e.target.dataset.tab + "-view").classList.add("active");
      });
    });

    // Wait for DOM to be fully ready before requesting matches
    setTimeout(() => {
      this.requestMatches();
    }, 500);
  }
  
  attachListeners() {
    document.getElementById('valmo-tab')?.addEventListener('click', () => this.togglePanel());
    document.getElementById('valmo-close')?.addEventListener('click', () => this.closePanel());
    
    document.getElementById('valmo-process-list')?.addEventListener('click', (e) => {
      const btn = e.target.closest('.valmo-video-btn');
      if (!btn) return;
      
      const link = btn.dataset.videoLink;
      
      if (!link || link === 'demo://placeholder_video') {
        btn.textContent = 'Coming soon...';
        setTimeout(() => { btn.textContent = 'Watch Video'; }, 2000);
        return;
      }
      
      if (!link.startsWith('http') && !link.startsWith('demo://')) {
        const videoUrl = chrome.runtime.getURL('data/' + link);
        window.open(videoUrl, '_blank');
        return;
      }
      
      window.open(link, '_blank', 'noopener,noreferrer');
    });
  }
  
  requestMatches() {
    // Check if extension context is valid
    if(!chrome.runtime?.id) {
      console.log('[Valmo Ops] Extension Context invalid, retrying...');
      setTimeout(() => this.requestMatches(), 1000);
      return;
    }

    console.log('[Valmo Ops] Requesting matches from background...');

    chrome.runtime.sendMessage({ type: 'PULSE_REQUEST_MATCHES' }, (response) => {
      if (chrome.runtime.lastError) {
        console.log('[Valmo Ops] Service worker not ready, retrying...', chrome.runtime.lastError);
        setTimeout(() => this.requestMatches(), 1000);
        return;
      }

      console.log('[Valmo Ops] Got Response:', response);

      if (response?.matches) {
        console.log('[Valmo Ops] Found matches:', response.matches.length);
        this.updateSidebar(response.matches);
      } else {
        console.log('[Valmo Ops] No Matches in response');
        this.updateSidebar([]);
      }
    });
  }
  
  updateSidebar(matches) {
    this.matches = matches;
    const root = document.getElementById(OVERLAY_ID);
    const tab = document.getElementById('valmo-tab');
    
    if (matches.length > 0) {
      root?.classList.add('active');
      tab?.classList.add('pulse');
      this.renderProcesses(matches);
    } else {
      root?.classList.remove('active');
      tab?.classList.remove('pulse');
      this.renderProcesses([]);
    }
  }
  
  renderProcesses(matches) {
    const list = document.getElementById('valmo-process-list');
    if (!list) return;

    if(!matches || matches.length === 0) {
      list.innerHTML = `
        <div class="valmo-empty">
          <div class="valmo-empty-icon">📂</div> 
          <h3>No processes yet</h3>
          <p>This tab does not have documented training videos yet.</p>
        </div>
      `;
      return;
    }
    
    list.innerHTML = matches.map(proc => `
      <div class="valmo-process-card">
        <div class="valmo-process-name">${this.escape(proc.process_name)}</div>
        <div class="valmo-process-meta">
          📂 ${this.escape(proc.start_tab)}
        </div>
        <button class="valmo-video-btn" data-video-link="${this.escape(proc.video_link || '')}">
          🎥 Watch Video
        </button>
      </div>
    `).join('');
  }
  
  togglePanel() {
    this.isPanelOpen ? this.closePanel() : this.openPanel();
  }
  
  openPanel() {
    document.getElementById('valmo-panel')?.classList.add('open');
    this.isPanelOpen = true;
  }
  
  closePanel() {
    document.getElementById('valmo-panel')?.classList.remove('open');
    this.isPanelOpen = false;
  }
  
  escape(str) {
    const div = document.createElement('div');
    div.appendChild(document.createTextNode(str));
    return div.innerHTML;
  }
}

// ═══════════════════════════════════════════════════════════════
// OVERLAY 2: L1 Chatbot - ENHANCED UI WITH TAT TAB
// ═══════════════════════════════════════════════════════════════

class L1ChatbotOverlayEnhanced {
  constructor() {
    this.sopData = null;
    this.templateData = null;
    this.smartChatbot = null;
    this.conversationHistory = [];
    this.currentView = 'dashboard';
    this.templateUsage = {};
  }
  
  async inject() {
    await this.loadData();
    this.loadTemplateUsage();
    
    const html = `
      <div id="${OVERLAY_ID}" class="valmo-overlay valmo-l1-enhanced">
        <div class="valmo-tab" id="valmo-tab">
          <div class="valmo-icon">💬</div>
          <div class="valmo-label">Help</div>
        </div>
        <div class="valmo-panel open" id="valmo-panel">
          <div class="valmo-header">
            <div class="valmo-tabs">
              <button class="valmo-tab-btn active" data-tab="sop" id="tab-sop">
                <span class="tab-icon">🤖</span>
                <span class="tab-label">SOPs</span>
              </button>
              <button class="valmo-tab-btn" data-tab="templates" id="tab-templates">
                <span class="tab-icon">📋</span>
                <span class="tab-label">Templates</span>
              </button>
              <button class="valmo-tab-btn" data-tab="tickets" id="tab-tickets">
                <span class="tab-icon">📊</span>
                <span class="tab-label">My Tickets</span>
              </button>
            </div>
            <button class="valmo-close" id="valmo-close">✕</button>
          </div>
          <div class="valmo-content">
            <div class="valmo-tab-content active" data-tab="sop">
              <div id="sop-view-container"></div>
            </div>
            
            <div class="valmo-tab-content" data-tab="templates">
              <div id="template-view-container"></div>
            </div>
            
            <div class="valmo-tab-content" data-tab="tickets">
              <div id="tat-dashboard-container"></div>
            </div>
          </div>
        </div>
      </div>
    `;
    
    const wrapper = document.createElement('div');
    wrapper.innerHTML = html;
    document.body.appendChild(wrapper.firstElementChild);
    
    this.attachListeners();
    this.renderDashboard();
    this.renderTemplateView();
  }
  
  renderDashboard() {
    const container = document.getElementById('sop-view-container');
    if (!container) return;
    
    const categoryCounts = {};
    Object.entries(this.sopData).forEach(([category, sops]) => {
      categoryCounts[category] = sops.length;
    });
    
    const commonIssues = [
      { emoji: '📦', text: 'Shortage loss marked', query: 'shortage loss attribution pending' },
      { emoji: '💰', text: 'Payment not received', query: 'payment not received status' },
      { emoji: '📊', text: 'Low load volume', query: 'low load from previous weeks' },
      { emoji: '💵', text: 'COD not reflecting', query: 'deposited money not reflecting' }
    ];
    
    container.innerHTML = `
      <div class="valmo-dashboard">
        <div class="valmo-greeting">
          <div class="greeting-icon">👋</div>
          <h2>Hi! How can I help?</h2>
          <p>Get instant answers from SOPs</p>
        </div>
        
        <div class="valmo-quick-actions">
          <div class="section-title">🔥 QUICK ACTIONS</div>
          <div class="category-grid">
            ${this.renderCategoryButtons(categoryCounts)}
          </div>
        </div>
        
        <div class="valmo-common-issues">
          <div class="section-title">📋 COMMON ISSUES</div>
          <div class="issue-list">
            ${commonIssues.map(issue => `
              <button class="issue-btn" data-query="${this.escape(issue.query)}">
                <span class="issue-emoji">${issue.emoji}</span>
                <span class="issue-text">${issue.text}</span>
                <span class="issue-arrow">→</span>
              </button>
            `).join('')}
          </div>
        </div>
        
        <div class="valmo-search-box">
          <div class="search-icon">🔍</div>
          <input 
            type="text" 
            id="sop-search" 
            placeholder="Or search for anything..." 
            autocomplete="off"
          />
          <button id="sop-search-btn" class="search-btn">Ask</button>
        </div>
      </div>
    `;
    
    container.querySelectorAll('.category-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const category = e.currentTarget.dataset.category;
        this.showCategorySOPs(category);
      });
    });
    
    container.querySelectorAll('.issue-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const query = e.currentTarget.dataset.query;
        analytics.log('quick_action_clicked', { query });
        this.handleSearch(query, true);
      });
    });
    
    const searchInput = container.querySelector('#sop-search');
    const searchBtn = container.querySelector('#sop-search-btn');
    
    searchBtn?.addEventListener('click', () => {
      const query = searchInput.value.trim();
      if (query) {
        analytics.log('search_submitted', { query, method: 'button' });
        this.handleSearch(query, true);
      }
    });
    
    searchInput?.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') {
        const query = searchInput.value.trim();
        if (query) {
          analytics.log('search_submitted', { query, method: 'enter' });
          this.handleSearch(query, true);
        }
      }
    });
  }
  
  renderCategoryButtons(counts) {
    const categories = [
      { name: 'Losses & Debits', icon: '📦', color: '#ff6b6b' },
      { name: 'Payments', icon: '💰', color: '#4ecdc4' },
      { name: 'Orders & Planning', icon: '📊', color: '#95e1d3' },
      { name: 'Cash Handover', icon: '💵', color: '#ffd93d' }
    ];
    
    return categories.map(cat => {
      const count = counts[cat.name] || 0;
      if (count === 0) return '';
      
      return `
        <button class="category-btn" data-category="${this.escape(cat.name)}" style="border-color: ${cat.color}">
          <div class="category-icon">${cat.icon}</div>
          <div class="category-name">${cat.name}</div>
          <div class="category-count">${count} SOPs</div>
        </button>
      `;
    }).join('');
  }
  
  showCategorySOPs(category) {
    const sops = this.sopData[category] || [];
    analytics.log('category_clicked', { category, sopCount: sops.length });
    
    const container = document.getElementById('sop-view-container');
    if (!container) return;
    
    container.innerHTML = `
      <div class="valmo-category-view">
        <div class="category-header">
          <button class="back-btn" id="back-to-dashboard">← Back</button>
          <h3>${category}</h3>
          <span class="sop-count">${sops.length} SOPs</span>
        </div>
        
        <div class="sop-list">
          ${sops.map((sop, idx) => this.renderSOPCard(sop, category, idx)).join('')}
        </div>
      </div>
    `;
    
    container.querySelector('#back-to-dashboard')?.addEventListener('click', () => {
      this.renderDashboard();
    });
    
    container.querySelectorAll('.copy-process-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const sopIdx = e.target.dataset.sopIdx;
        const process = sops[sopIdx]?.process || '';
        this.copyToClipboard(process, e.target);
        analytics.log('process_copied', { category, sopIdx });
      });
    });
  }
  
  renderSOPCard(sop, category, idx) {
    const urgency = this.getUrgencyLevel(sop.tat);
    
    return `
      <div class="sop-card compact ${urgency.class}">
        <div class="sop-card-header">
          <span class="category-badge">${category}</span>
          ${urgency.tat ? `<span class="tat-badge ${urgency.class}">${urgency.icon} ${urgency.tat}</span>` : ''}
        </div>
        <h4 class="sop-scenario">${this.escape(sop.scenario)}</h4>
        <div class="sop-quick-info">
          ${sop.escalateTo ? `<div class="info-item"><strong>📤 Escalate:</strong> ${this.escape(sop.escalateTo)}</div>` : ''}
          ${sop.inputs ? `<div class="info-item"><strong>📥 Inputs:</strong> ${this.escape(sop.inputs)}</div>` : ''}
        </div>
        <div class="sop-actions">
          <button class="action-btn primary" onclick="this.closest('.sop-card').classList.toggle('expanded')">
            <span class="expand-icon">▼</span> View Details
          </button>
          <button class="action-btn copy-process-btn" data-sop-idx="${idx}">
            📋 Copy Steps
          </button>
        </div>
        <div class="sop-details">
          <div class="detail-section">
            <strong>📋 Process:</strong>
            <pre class="process-text">${this.escape(sop.process)}</pre>
          </div>
        </div>
      </div>
    `;
  }
  
  async handleSearch(query, switchToChatView = false) {
    if (!query.trim()) return;
    
    const container = document.getElementById('sop-view-container');
    if (!container) return;
    
    if (switchToChatView) {
      this.currentView = 'chat';
    }
    
    container.innerHTML = `
      <div class="valmo-chat-view">
        <div class="chat-header">
          <button class="back-btn" id="back-to-dashboard">← Back</button>
          <h3>Assistant</h3>
        </div>
        
        <div class="conversation-area" id="conversation-area">
          ${this.renderConversationHistory()}
          <div class="message user-message">
            <div class="message-avatar">👤</div>
            <div class="message-content">${this.escape(query)}</div>
          </div>
          <div class="message bot-message loading">
            <div class="message-avatar">🤖</div>
            <div class="message-content">
              <div class="loading-indicator">
                <div class="loading-dots">
                  <span></span><span></span><span></span>
                </div>
                <div class="loading-text">Searching SOPs...</div>
              </div>
            </div>
          </div>
        </div>
        
        <div class="chat-input-area">
          <input type="text" id="followup-input" placeholder="Ask a follow-up question..." />
          <button id="followup-btn">Send</button>
          <button id="new-topic-btn" class="secondary">🔄 New Topic</button>
        </div>
      </div>
    `;
    
    container.querySelector('#back-to-dashboard')?.addEventListener('click', () => {
      this.conversationHistory = [];
      this.renderDashboard();
    });
    
    const startTime = Date.now();
    let result;
    
    if (CHATBOT_CONFIG.use_claude_api && this.smartChatbot) {
      result = await this.smartChatbot.ask(query);
    } else {
      result = { success: false };
    }
    
    const responseTime = Date.now() - startTime;
    
    analytics.log('question_asked', {
      query,
      responseType: result.success ? 'smart' : 'keyword',
      responseTime
    });
    
    this.conversationHistory.push({
      role: 'user',
      content: query,
      timestamp: Date.now()
    });
    
    if (result.success) {
      this.conversationHistory.push({
        role: 'assistant',
        content: result.answer,
        timestamp: Date.now(),
        type: 'smart'
      });
      this.renderSmartAnswer(result.answer, query);
    } else {
      this.conversationHistory.push({
        role: 'assistant',
        content: 'keyword_search',
        timestamp: Date.now(),
        type: 'keyword'
      });
      this.searchSOPsKeyword(query);
    }
    
    this.setupFollowUpInput(container);
  }
  
  renderConversationHistory() {
    if (this.conversationHistory.length === 0) return '';
    
    const recent = this.conversationHistory.slice(-4);
    
    return recent.map(msg => {
      if (msg.role === 'user') {
        return `
          <div class="message user-message">
            <div class="message-avatar">👤</div>
            <div class="message-content">${this.escape(msg.content)}</div>
          </div>
        `;
      } else if (msg.type === 'smart') {
        return `
          <div class="message bot-message">
            <div class="message-avatar">🤖</div>
            <div class="message-content">
              <div class="smart-response">${this.formatSmartAnswer(msg.content)}</div>
            </div>
          </div>
        `;
      } else {
        return '';
      }
    }).join('');
  }
  
  renderSmartAnswer(answer, originalQuery) {
    const container = document.getElementById('sop-view-container');
    if (!container) return;
    
    const conversationArea = container.querySelector('#conversation-area');
    if (!conversationArea) return;
    
    const loadingMsg = conversationArea.querySelector('.loading');
    if (loadingMsg) loadingMsg.remove();
    
    const messageDiv = document.createElement('div');
    messageDiv.className = 'message bot-message';
    messageDiv.innerHTML = `
      <div class="message-avatar">✨</div>
      <div class="message-content">
        ${this.formatSmartAnswer(answer)}
      </div>
    `;
    
    conversationArea.appendChild(messageDiv);
    conversationArea.scrollTop = conversationArea.scrollHeight;
  }
  
  formatSmartAnswer(text) {
    let formatted = text;
    formatted = formatted.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
    formatted = formatted.replace(/(\d+)\.\s+([^\n]+)/g, (match, num, content) => {
      return `
        <div class="step-item">
          <div class="step-number">${num}</div>
          <div class="step-content">${content}</div>
        </div>
      `;
    });
    
    formatted = formatted.replace(/Process:/gi, '<div class="section-marker">📋 Process:</div>');
    formatted = formatted.replace(/Escalate:/gi, '<div class="section-marker">📤 Escalate:</div>');
    formatted = formatted.replace(/Required inputs:/gi, '<div class="section-marker">📥 Required Inputs:</div>');
    formatted = formatted.replace(/TAT:/gi, '<div class="section-marker">⏰ TAT:</div>');
    
    return `
      <div class="smart-answer-card">
        <div class="answer-badge">✨ AI Answer</div>
        <div class="answer-content">${formatted}</div>
        <div class="answer-actions">
          <button class="answer-action-btn copy-answer" onclick="navigator.clipboard.writeText(this.closest('.smart-answer-card').querySelector('.answer-content').innerText); this.textContent = '✓ Copied'; setTimeout(() => this.textContent = '📋 Copy Answer', 2000);">
            📋 Copy Answer
          </button>
        </div>
      </div>
    `;
  }
  
  searchSOPsKeyword(query) {
    const container = document.getElementById('sop-view-container');
    if (!container) return;
    
    const conversationArea = container.querySelector('#conversation-area');
    if (!conversationArea) return;
    
    const loadingMsg = conversationArea.querySelector('.loading');
    if (loadingMsg) loadingMsg.remove();
    
    const matches = [];
    const lower = query.toLowerCase();
    
    Object.entries(this.sopData).forEach(([category, sops]) => {
      sops.forEach((sop, idx) => {
        const score = sop.keywords?.filter(kw => lower.includes(kw) || kw.includes(lower)).length || 0;
        if (score > 0 || sop.scenario.toLowerCase().includes(lower)) {
          matches.push({ ...sop, category, score, idx });
        }
      });
    });
    
    matches.sort((a, b) => b.score - a.score);
    
    const messageDiv = document.createElement('div');
    messageDiv.className = 'message bot-message';
    
    if (matches.length === 0) {
      messageDiv.innerHTML = `
        <div class="message-avatar">🤖</div>
        <div class="message-content">
          <div class="no-results">
            <div class="no-results-icon">🔍</div>
            <p>No SOPs found matching "<strong>${this.escape(query)}</strong>"</p>
            <p class="suggestion">Try different keywords or check the category buttons above</p>
          </div>
        </div>
      `;
    } else {
      messageDiv.innerHTML = `
        <div class="message-avatar">🤖</div>
        <div class="message-content">
          <div class="keyword-results">
            <div class="results-header">Found ${matches.length} matching SOP${matches.length > 1 ? 's' : ''}</div>
            ${matches.slice(0, 3).map((sop) => this.renderSOPCard(sop, sop.category, sop.idx)).join('')}
          </div>
        </div>
      `;
    }
    
    conversationArea.appendChild(messageDiv);
    conversationArea.scrollTop = conversationArea.scrollHeight;
  }
  
  setupFollowUpInput(container) {
    const followupInput = container.querySelector('#followup-input');
    const followupBtn = container.querySelector('#followup-btn');
    const newTopicBtn = container.querySelector('#new-topic-btn');
    
    const handleFollowup = () => {
      const query = followupInput.value.trim();
      if (query) {
        followupInput.value = '';
        this.handleSearch(query, false);
      }
    };
    
    followupBtn?.addEventListener('click', handleFollowup);
    followupInput?.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') handleFollowup();
    });
    
    newTopicBtn?.addEventListener('click', () => {
      this.conversationHistory = [];
      if (this.smartChatbot) {
        this.smartChatbot.clearHistory();
      }
      analytics.log('new_topic_clicked', {});
      this.renderDashboard();
    });
  }
  
  renderTemplateView() {
    const container = document.getElementById('template-view-container');
    if (!container) return;
    
    const mostUsed = this.getMostUsedTemplates(5);
    
    container.innerHTML = `
      <div class="template-view">
        <div class="template-search-box">
          <div class="search-icon">🔍</div>
          <input 
            type="text" 
            id="template-search" 
            placeholder="Search templates..." 
            autocomplete="off"
          />
        </div>
        
        ${mostUsed.length > 0 ? `
          <div class="most-used-section">
            <div class="section-title">🔥 MOST USED</div>
            <div class="template-quick-list">
              ${mostUsed.map(t => `
                <button class="template-quick-btn" data-category="${this.escape(t.category)}" data-idx="${t.idx}">
                  <span class="template-name">${this.escape(t.name)}</span>
                  <span class="usage-count">${t.usage}×</span>
                </button>
              `).join('')}
            </div>
          </div>
        ` : ''}
        
        <div class="template-categories">
          <div class="section-title">📂 BY CATEGORY</div>
          <div class="category-accordion" id="template-accordion">
            ${this.renderTemplateCategories()}
          </div>
        </div>
        
        <div id="template-results"></div>
      </div>
    `;
    
    const searchInput = container.querySelector('#template-search');
    searchInput?.addEventListener('input', (e) => {
      this.searchTemplates(e.target.value);
    });
    
    container.querySelectorAll('.template-quick-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const category = e.currentTarget.dataset.category;
        const idx = parseInt(e.currentTarget.dataset.idx);
        const template = this.templateData[category]?.[idx];
        if (template) {
          this.copyTemplate(template, category, idx, e.currentTarget);
        }
      });
    });
    
    container.querySelectorAll('.category-header').forEach(header => {
      header.addEventListener('click', () => {
        header.parentElement.classList.toggle('expanded');
      });
    });
    
    this.attachTemplateCopyListeners(container);
  }
  
  renderTemplateCategories() {
    return Object.entries(this.templateData).map(([category, templates]) => `
      <div class="category-item">
        <div class="category-header">
          <span class="category-icon">📁</span>
          <span class="category-name">${category}</span>
          <span class="category-count">${templates.length}</span>
          <span class="expand-icon">▼</span>
        </div>
        <div class="category-content">
          ${templates.map((tpl, idx) => `
            <div class="template-card">
              <div class="template-header">
                <h4>${this.escape(tpl.name)}</h4>
                <button class="copy-template-btn" data-category="${this.escape(category)}" data-idx="${idx}">
                  📋 Copy
                </button>
              </div>
              <pre class="template-preview">${this.escape(tpl.template.substring(0, 150))}${tpl.template.length > 150 ? '...' : ''}</pre>
            </div>
          `).join('')}
        </div>
      </div>
    `).join('');
  }
  
  searchTemplates(query) {
    const resultsDiv = document.getElementById('template-results');
    if (!resultsDiv) return;
    
    if (!query.trim()) {
      resultsDiv.innerHTML = '';
      return;
    }
    
    const matches = [];
    const lower = query.toLowerCase();
    
    Object.entries(this.templateData).forEach(([category, templates]) => {
      templates.forEach((tpl, idx) => {
        if (tpl.name.toLowerCase().includes(lower) || 
            tpl.template.toLowerCase().includes(lower)) {
          matches.push({ ...tpl, category, idx });
        }
      });
    });
    
    if (matches.length === 0) {
      resultsDiv.innerHTML = '<div class="no-results"><p>No templates found</p></div>';
    } else {
      resultsDiv.innerHTML = `
        <div class="search-results">
          <div class="results-header">Found ${matches.length} template${matches.length > 1 ? 's' : ''}</div>
          ${matches.map((tpl) => `
            <div class="template-card">
              <div class="template-header">
                <span class="template-category-badge">${tpl.category}</span>
                <h4>${this.escape(tpl.name)}</h4>
                <button class="copy-template-btn" data-category="${this.escape(tpl.category)}" data-idx="${tpl.idx}">
                  📋 Copy
                </button>
              </div>
              <pre class="template-preview">${this.escape(tpl.template.substring(0, 200))}...</pre>
            </div>
          `).join('')}
        </div>
      `;
      
      this.attachTemplateCopyListeners(resultsDiv);
    }
  }
  
  attachTemplateCopyListeners(container) {
    container.querySelectorAll('.copy-template-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const category = e.target.dataset.category;
        const idx = parseInt(e.target.dataset.idx);
        const template = this.templateData[category]?.[idx];
        if (template) {
          this.copyTemplate(template, category, idx, e.target);
        }
      });
    });
  }
  
  copyTemplate(template, category, idx, button) {
    navigator.clipboard.writeText(template.template).then(() => {
      const key = `${category}-${idx}`;
      this.templateUsage[key] = (this.templateUsage[key] || 0) + 1;
      this.saveTemplateUsage();
      
      const originalText = button.textContent;
      button.textContent = '✓ Copied!';
      button.style.background = '#4caf50';
      
      setTimeout(() => {
        button.textContent = originalText;
        button.style.background = '';
      }, 2000);
      
      analytics.log('template_copied', { 
        category, 
        templateName: template.name,
        usage: this.templateUsage[key]
      });
    });
  }
  
  getMostUsedTemplates(limit = 5) {
    const templates = [];
    
    Object.entries(this.templateData).forEach(([category, categoryTemplates]) => {
      categoryTemplates.forEach((tpl, idx) => {
        const key = `${category}-${idx}`;
        const usage = this.templateUsage[key] || 0;
        if (usage > 0) {
          templates.push({
            ...tpl,
            category,
            idx,
            usage
          });
        }
      });
    });
    
    return templates
      .sort((a, b) => b.usage - a.usage)
      .slice(0, limit);
  }
  
  loadTemplateUsage() {
    try {
      chrome.storage.local.get(['templateUsage'], (result) => {
        this.templateUsage = result.templateUsage || {};
      });
    } catch (e) {
      console.log('[Template Usage] Failed to load:', e);
    }
  }
  
  saveTemplateUsage() {
    try {
      chrome.storage.local.set({ templateUsage: this.templateUsage });
    } catch (e) {
      console.log('[Template Usage] Failed to save:', e);
    }
  }
  
  getUrgencyLevel(tat) {
    if (!tat) return { class: '', icon: '', tat: '' };
    
    const tatLower = tat.toLowerCase();
    
    if (tatLower.includes('12') || tatLower.includes('hour')) {
      return { class: 'urgent', icon: '🔴', tat: tat };
    } else if (tatLower.includes('24') || tatLower.includes('48')) {
      return { class: 'normal', icon: '🟡', tat: tat };
    } else {
      return { class: 'low', icon: '🟢', tat: tat };
    }
  }
  
  copyToClipboard(text, button) {
    navigator.clipboard.writeText(text).then(() => {
      const originalText = button.textContent;
      button.textContent = '✓ Copied!';
      button.classList.add('copied');
      
      setTimeout(() => {
        button.textContent = originalText;
        button.classList.remove('copied');
      }, 2000);
    });
  }
  
  escape(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.appendChild(document.createTextNode(str));
    return div.innerHTML;
  }
  
  async loadData() {
    try {
      const data = await sheetsSync.loadData();
      this.sopData = data.sops;
      this.templateData = data.templates;
      
      if (CHATBOT_CONFIG.use_claude_api) {
        this.smartChatbot = new SmartChatbot(this.sopData);
      }
      
    } catch (e) {
      console.error('[Valmo Ops] Failed to load data:', e);
      this.sopData = {};
      this.templateData = {};
    }
  }
  
  attachListeners() {
    document.getElementById('valmo-tab')?.addEventListener('click', () => this.togglePanel());
    document.getElementById('valmo-close')?.addEventListener('click', () => this.closePanel());
    
    document.querySelectorAll('.valmo-tab-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const tab = e.target.closest('.valmo-tab-btn').dataset.tab;
        
        document.querySelectorAll('.valmo-tab-btn').forEach(b => b.classList.remove('active'));
        e.target.closest('.valmo-tab-btn').classList.add('active');
        
        document.querySelectorAll('.valmo-tab-content').forEach(c => {
          c.classList.toggle('active', c.dataset.tab === tab);
        });
        
        // Load TAT dashboard when tickets tab is clicked
        if (tab === 'tickets') {
          if (typeof loadTATDashboard === 'function') {
            loadTATDashboard();
          }
        }
        
        analytics.log('tab_switched', { tab });
      });
    });
  }
  
  togglePanel() {
    const panel = document.getElementById('valmo-panel');
    panel?.classList.toggle('open');
  }
  
  closePanel() {
    document.getElementById('valmo-panel')?.classList.remove('open');
  }
}

// ═══════════════════════════════════════════════════════════════
// OVERLAY 3: SC Manager (UNCHANGED)
// ═══════════════════════════════════════════════════════════════

/*class SCManagerOverlay {
  inject() {
    const html = `
      <div id="${OVERLAY_ID}" class="valmo-overlay valmo-sc">
        <div class="valmo-tab" id="valmo-tab">
          <div class="valmo-icon">📚</div>
          <div class="valmo-label">SOPs</div>
        </div>
        <div class="valmo-panel" id="valmo-panel">
          <div class="valmo-header">
            <span class="valmo-title">SC Manager SOPs</span>
            <button class="valmo-close" id="valmo-close">✕</button>
          </div>
          <div class="valmo-content">
            <div class="valmo-placeholder">
              <div class="valmo-placeholder-icon">🚧</div>
              <h3>Coming Soon</h3>
              <p>SC Manager SOPs will be available once requirements are finalized.</p>
            </div>
          </div>
        </div>
      </div>
    `;
    
    const wrapper = document.createElement('div');
    wrapper.innerHTML = html;
    document.body.appendChild(wrapper.firstElementChild);
    
    document.getElementById('valmo-tab')?.addEventListener('click', () => {
      document.getElementById('valmo-panel')?.classList.toggle('open');
    });
    document.getElementById('valmo-close')?.addEventListener('click', () => {
      document.getElementById('valmo-panel')?.classList.remove('open');
    });
  }
}*/

// ─── Listen for login/logout ───
chrome.runtime.onMessage.addListener((message) => {
  console.log('[Valmo Ops] Received message:', message.type);

  if (message.type === 'PULSE_UPDATE') {
    console.log('[Valmo Ops] PROCESS_UPDATE received, overlayInstance:', overlayInstance);
    if (overlayInstance instanceof ProcessPulseOverlay) {
      overlayInstance.updateSidebar(message.matches);
    }
  }

  if (message.type === 'USER_LOGGED_IN') {
    currentUser = { email: message.email, role: message.role };
    const existing = document.getElementById(OVERLAY_ID);
    if (existing) existing.remove();
    if (shouldShowOverlay()) injectOverlay();
  } else if (message.type === 'USER_LOGGED_OUT') {
    const existing = document.getElementById(OVERLAY_ID);
    if (existing) existing.remove();
    currentUser = null;
  }
});

// ─── Print Screen Stealth ───
document.addEventListener('keydown', (e) => {
  if (e.key === 'PrintScreen' || (e.ctrlKey && e.key === 'p')) {
    const overlay = document.getElementById(OVERLAY_ID);
    if (overlay) {
      overlay.style.opacity = '0';
      setTimeout(() => { overlay.style.opacity = '1'; }, 500);
    }
  }
});

// ─── Init ───
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}

// ═══════════════════════════════════════════════════════════════
// TAT DASHBOARD INITIALIZATION
// ═══════════════════════════════════════════════════════════════
// TAT tracking now handled by tat-tracker-background.js
// Dashboard UI injected by tat-dashboard-ui.js

setTimeout(() => {
  if (typeof injectTATDashboard === 'function') {
    console.log('[Valmo Ops] Injecting TAT Dashboard...');
    try {
      injectTATDashboard();
      console.log('[Valmo Ops] ✓ TAT Dashboard injected successfully');
    } catch (error) {
      console.error('[Valmo Ops] Failed to inject TAT Dashboard:', error);
    }
  } else {
    console.warn('[Valmo Ops] injectTATDashboard function not found');
  }
}, 1500);
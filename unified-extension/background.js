/**
 * background.js - Unified Service Worker
 * 
 * Handles:
 * 1. Process Pulse (Log10 video matching for Captains)
 * 2. TAT Tracking (Kapture ticket monitoring for L1 Agents)
 */

console.log('[Valmo Ops] Service worker loaded');

// ═══════════════════════════════════════════════════════════════
// PROCESS PULSE (Log10 - Captains)
// ═══════════════════════════════════════════════════════════════

let log10ProcessesCache = null;

async function loadLog10Processes() {
  try {
    if (!SHEETS_CONFIG.training_videos_url) throw new Error('No URL');
    
    const url = SHEETS_CONFIG.training_videos_url + '&t=' + Date.now();
    const response = await fetch(url);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    
    const csv = await response.text();
    const rows = csv.trim().split('\n').slice(1); // skip header
    
    const processes = rows
      .map(row => row.split(','))
      .filter(cols => cols[0] && cols[1])
      .map(cols => ({
        process_name: cols[0]?.trim().replace(/"/g, ''),
        url_module:   cols[1]?.trim().replace(/"/g, ''),
        start_tab:    cols[2]?.trim().replace(/"/g, ''),
        video_link:   cols[3]?.trim().replace(/"/g, ''),
        platform:     cols[4]?.trim().replace(/"/g, ''),
        // PHASE 1: New columns for progress tracking & gamification
        priority:     cols[5]?.trim().replace(/"/g, '') || 'GOOD_TO_KNOW',
        status:       cols[6]?.trim().replace(/"/g, '') || 'STABLE',
        date_added:   cols[7]?.trim().replace(/"/g, '') || new Date().toISOString().split('T')[0],
        date_updated: cols[8]?.trim().replace(/"/g, '') || new Date().toISOString().split('T')[0],
        version:      cols[9]?.trim().replace(/"/g, '') || '1.0',
        completion_required: (cols[10]?.trim().replace(/"/g, '') || 'FALSE').toUpperCase() === 'TRUE'
      }));

    console.log('[Process Pulse] Loaded', processes.length, 'from Training_Videos sheet');
    
    // PHASE 1: Log breakdown by priority
    const mustKnow = processes.filter(p => p.priority === 'MUST_KNOW').length;
    const goodToKnow = processes.filter(p => p.priority === 'GOOD_TO_KNOW').length;
    console.log(`[Process Pulse]   - ${mustKnow} MUST_KNOW, ${goodToKnow} GOOD_TO_KNOW`);
    
    // PHASE 1: Log breakdown by status
    const newProcs = processes.filter(p => p.status === 'NEW').length;
    const updated = processes.filter(p => p.status === 'UPDATED').length;
    console.log(`[Process Pulse]   - ${newProcs} NEW, ${updated} UPDATED`);
    
    return processes;

  } catch (err) {
    console.warn('[Process Pulse] Sheet failed, using local fallback:', err.message);
    const localUrl = chrome.runtime.getURL('data/log10_processes.json');
    const response = await fetch(localUrl);
    return await response.json();
  }
}

function extractModule(url) {
  try {
    const pathname = new URL(url).pathname;
    const parts = pathname.split('/').filter(s => s.length > 0);
    if (parts[0] === 'operations' && parts.length >= 2) {
      return parts[1].toLowerCase();
    }
    return null;
  } catch {
    return null;
  }
}

function findMatchingProcesses(url, processes) {
  const module = extractModule(url);
  if (!module) return [];
  
  return processes.filter(proc => {
    return (proc.url_module || '').toLowerCase() === module;
  });
}

// Listen for tab updates (Log10)
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (!changeInfo.url && !changeInfo.title) return;
  
  const url = changeInfo.url || tab.url || '';
  if (!url.includes('console.valmo.in')) return;
  
  const processes = await loadLog10Processes();
  const matches = findMatchingProcesses(url, processes);
  
  try {
    chrome.tabs.sendMessage(tabId, {
      type: 'PULSE_UPDATE',
      matches: matches
    });
    console.log(`[Process Pulse] Sent ${matches.length} matches for ${url}`)
  } catch (err) {
    // Ignore - tab not ready
  }
});

// ═══════════════════════════════════════════════════════════════
// TAT TRACKING - Now handled by tat-tracker-background.js
// ═══════════════════════════════════════════════════════════════
// This section is intentionally empty - tracking moved to dedicated module

// ═══════════════════════════════════════════════════════════════
// UNIFIED MESSAGE HANDLER
// ═══════════════════════════════════════════════════════════════

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // Process Pulse messages
  if (message.type === 'PULSE_REQUEST_MATCHES') {
    const url = sender.tab?.url || '';
    
    loadLog10Processes().then(processes => {
      const matches = findMatchingProcesses(url, processes);
      sendResponse({ matches });
    });
    
    return true;
  }
  
  // PHASE 1: Get all processes for progress tracking
  if (message.type === 'GET_ALL_PROCESSES') {
    loadLog10Processes().then(processes => {
      sendResponse({ processes });
    }).catch(err => {
      console.error('[Background] GET_ALL_PROCESSES failed:', err);
      sendResponse({ processes: [] });
    });
    return true;
  }
  
  // TAT Tracking messages - Handled by tat-tracker-background.js
  // Keep these for backwards compatibility with UI
  if (message.type === 'TICKET_OPENED') {
    (async () => {
      // Log ticket open event for analytics
      const { ticketOpenLogs = [] } = await chrome.storage.local.get(['ticketOpenLogs']);
      ticketOpenLogs.push({
        url: message.url,
        timestamp: message.timestamp,
        date: new Date(message.timestamp).toISOString()
      });
      if (ticketOpenLogs.length > 1000) ticketOpenLogs.shift();
      await chrome.storage.local.set({ ticketOpenLogs });
      sendResponse({ success: true });
    })();
    return true;
  }

  if (message.type === 'EXPORT_TAT_ANALYTICS') {
    // Trigger Excel export from analytics module
    sendResponse({ success: true });
    return true;
  }

  if (message.type === 'UPDATE_BADGE') {
    // Update extension badge (can only be done in service worker)
    const count = message.count || 0;
    if (count > 0) {
      chrome.action.setBadgeText({ text: count.toString() });
      chrome.action.setBadgeBackgroundColor({ color: '#ff4444' });
    } else {
      chrome.action.setBadgeText({ text: '' });
    }
    sendResponse({ success: true });
    return true;
  }

  if (message.type === 'FETCH_METABASE') {
    (async () => {
      try {
        const response = await fetch(message.queryConfig.endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include'
        });
        
        if (!response.ok) {
          sendResponse({ success: false, error: `HTTP ${response.status}` });
          return;
        }
        
        const data = await response.json();
        sendResponse({
          success: true,
          rows: data.data?.rows || [],
          columns: data.data?.cols || [],
          timestamp: Date.now()
        });
      } catch (err) {
        sendResponse({ success: false, error: err.message });
      }
    })();
    return true;
  }

  // SC Manager - Metabase fetch via bridge
if (message.type === 'FETCH_METABASE_VIA_BRIDGE') {
  (async () => {
    try {
      // Find Metabase tab
      const tabs = await chrome.tabs.query({ url: 'https://metabase-main.bi.meeshogcp.in/*' });
      
      if (tabs.length === 0) {
        sendResponse({ success: false, error: 'NO_METABASE_TAB' });
        return;
      }
      
      // Send message to Metabase tab's bridge
      const result = await chrome.tabs.sendMessage(tabs[0].id, {
        type: 'FETCH_METABASE_FROM_PAGE',
        endpoint: message.endpoint
      });
      
      sendResponse(result);
      
    } catch (err) {
      sendResponse({ success: false, error: err.message });
    }
  })();
  return true;
}
  
  sendResponse({ error: 'Unknown message type' });
});

console.log('[Valmo Ops] ✓ Service worker ready (Process Pulse + TAT Tracking)');
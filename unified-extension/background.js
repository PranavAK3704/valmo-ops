/**
 * background.js - Unified Service Worker
 * 
 * Handles:
 * 1. Process Pulse (Log10 video matching for Captains)
 * 2. TAT Tracking (Kapture ticket monitoring for L1 Agents)
 */

console.log('[Valmo Ops] Service worker loaded');

// ═══════════════════════════════════════════════════════════════
// CONFIG (inlined because service workers can't import scripts)
// ═══════════════════════════════════════════════════════════════

const SHEETS_CONFIG = {
  // SOPs + templates still read from Sheets (unchanged)
  sops_url: 'https://docs.google.com/spreadsheets/d/e/2PACX-1vTtfp2EauVkBu1RILwErMMDs7mfwdzC1V9CdP0bf4ZjEsoe_QEr7o1slJm5tsMxNIqMK6vudtYjHCql/pub?gid=1281163884&single=true&output=csv',
  templates_url: 'https://docs.google.com/spreadsheets/d/e/2PACX-1vRNGnSVBmO7sU79z_zNfAa9N2S0yUSDR6yyOBTtnEi_m-XGBV6eBK0H9DJMuaDp_l0YA4enSjTKzNsk/pub?gid=0&single=true&output=csv',
  refresh_interval: 300000
};

// ── Supabase (process_videos) ─────────────────────────────────────────────────
const SB_URL = 'https://wfnmltorfvaokqbzggkn.supabase.co';
const SB_KEY = 'sb_publishable_kVRokdcfNT-egywk-KbQ3g_mEs5QVGW';

async function sbGet(path) {
  const res = await fetch(`${SB_URL}/rest/v1/${path}`, {
    headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, Accept: 'application/json' }
  });
  if (!res.ok) return [];
  return res.json();
}

// ═══════════════════════════════════════════════════════════════
// PROCESS PULSE (Log10 - Captains)
// Primary source: Supabase process_videos (admin-managed)
// Fallback: Google Sheet (legacy — used until process_videos is populated)
// ═══════════════════════════════════════════════════════════════

const LEGACY_VIDEOS_URL = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vTKDX4o1H_sZSJS_tUDo68N1SyjV3m3kbnkucjLe-4y1cUR3PBb2O49fbfNe2AQt-Oiuiu0Egj-wi_P/pub?output=csv';

async function loadLog10Processes() {
  // 1. Try Supabase process_videos first
  try {
    const rows = await sbGet('process_videos?select=process_name,video_url,starting_tab,hub,title');
    const processes = rows
      .filter(r => r.process_name && r.video_url)
      .map(r => ({
        process_name: r.process_name,
        url_module:   (r.starting_tab || '').toLowerCase(),
        start_tab:    r.starting_tab || '',
        video_link:   r.video_url,
        hub:          r.hub || null,
        title:        r.title || r.process_name,
      }));
    if (processes.length > 0) {
      console.log('[Process Pulse] Loaded', processes.length, 'video(s) from process_videos');
      return processes;
    }
    console.log('[Process Pulse] process_videos empty — falling back to legacy sheet');
  } catch (err) {
    console.warn('[Process Pulse] Supabase fetch failed:', err.message);
  }

  // 2. Fallback: legacy Google Sheet (until process_videos is populated via admin)
  try {
    const resp = await fetch(LEGACY_VIDEOS_URL + '&t=' + Date.now());
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const csv  = await resp.text();
    const rows = csv.trim().split('\n').slice(1);
    const processes = rows
      .map(r => r.split(','))
      .filter(c => c[0] && c[1])
      .map(c => ({
        process_name: c[0]?.trim().replace(/"/g, ''),
        url_module:   c[1]?.trim().replace(/"/g, ''),
        start_tab:    c[2]?.trim().replace(/"/g, ''),
        video_link:   c[3]?.trim().replace(/"/g, ''),
      }));
    if (processes.length > 0) {
      console.log('[Process Pulse] Loaded', processes.length, 'from legacy sheet');
      return processes;
    }
  } catch (err) {
    console.warn('[Process Pulse] Legacy sheet failed:', err.message);
  }

  // 3. Final fallback: bundled local JSON
  try {
    const localUrl = chrome.runtime.getURL('data/log10_processes.json');
    const resp = await fetch(localUrl);
    const data = await resp.json();
    console.log('[Process Pulse] Loaded', data.length, 'from local JSON fallback');
    return data;
  } catch (err) {
    console.warn('[Process Pulse] Local JSON fallback failed:', err.message);
    return [];
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
  
  chrome.tabs.sendMessage(tabId, { type: 'PULSE_UPDATE', matches })
    .then(() => console.log(`[Process Pulse] Sent ${matches.length} matches for ${url}`))
    .catch(() => { /* content script not ready yet — next requestMatches will catch up */ });
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

  sendResponse({ error: 'Unknown message type' });
});

console.log('[Valmo Ops] ✓ Service worker ready (Process Pulse + TAT Tracking)');
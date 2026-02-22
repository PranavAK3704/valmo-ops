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
        platform:     cols[4]?.trim().replace(/"/g, '')
      }));

    console.log('[Process Pulse] Loaded', processes.length, 'from Training_Videos sheet');
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
// TAT TRACKING (Kapture - L1 Agents)
// ═══════════════════════════════════════════════════════════════

let lastFetchTime = 0;
const FETCH_INTERVAL = 30000; // 30 seconds

/**
 * Initialize TAT tracking when extension loads
 */
chrome.runtime.onInstalled.addListener(() => {
  console.log('[TAT Tracking] Extension installed/updated');
  
  // Set up alarm for periodic ticket fetching
  chrome.alarms.create('fetch-tickets', {
    periodInMinutes: 0.5 // Every 30 seconds
  });
  
  // Initial fetch
  fetchTicketsBackground();
});

/**
 * Listen for alarms
 */
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'fetch-tickets') {
    fetchTicketsBackground();
  }
});

/**
 * Fetch tickets in background
 */
async function fetchTicketsBackground() {
  const now = Date.now();
  
  if (now - lastFetchTime < FETCH_INTERVAL) {
    console.log('[TAT Tracking] Skipping fetch (too soon)');
    return;
  }
  
  try {
    console.log('[TAT Tracking] Fetching tickets...');
    
    const response = await fetch('https://valmostagging.kapturecrm.com/api/version3/ticket/get-ticket-list', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      credentials: 'include',
      body: JSON.stringify({
        sort_by_column: 'last_conversation_time',
        type: 5,
        status: 'P',
        folder_id: -1,
        query: '',
        page_no: 0,
        sort_type: 'desc',
        page_size: 100,
        response_type: 'json',
        key_beautify: 'yes'
      })
    });
    
    if (!response.ok) {
      throw new Error(`API returned ${response.status}`);
    }
    
    const data = await response.json();
    
    if (data.status === 'Success' && data.response && data.response.tickets) {
      const tickets = data.response.tickets;
      console.log(`[TAT Tracking] ✓ Fetched ${tickets.length} tickets`);
      
      const processed = tickets.map(ticket => processTicketBackground(ticket));
      
      await chrome.storage.local.set({
        trackedTickets: processed,
        lastTicketFetch: now
      });
      
      lastFetchTime = now;
      updateBadge(processed);
      checkUrgentTickets(processed);
      
      return processed;
    } else {
      console.warn('[TAT Tracking] No tickets in response');
      return [];
    }
    
  } catch (error) {
    console.error('[TAT Tracking] Fetch failed:', error);
    return [];
  }
}

/**
 * Process individual ticket
 */
function processTicketBackground(ticket) {
  const now = Date.now();
  
  const dateValue = ticket.date || ticket.createdDate || ticket.created_date || ticket.created_at;
  const createdDate = parseKaptureDate(dateValue);
  
  const elapsedMs = now - createdDate;
  const elapsedHours = elapsedMs / (1000 * 60 * 60);
  
  const sopMatch = matchSOPCategory(ticket.taskTitle);
  const remainingHours = sopMatch.tat - elapsedHours;
  const urgency = calculateUrgency(sopMatch.tat, elapsedHours);
  
  return {
    id: ticket.id,
    ticketId: ticket.ticketId,
    subject: ticket.taskTitle,
    customerEmail: ticket.email,
    status: ticket.status,
    substatus: ticket.substatus,
    substatusName: ticket.substatusName,
    isEscalated: ticket.isEscalated,
    createdDate: createdDate,
    createdDateStr: formatDateForDisplay(dateValue),
    lastConversationTime: ticket.lastConversationTime,
    sopCategory: sopMatch.category,
    tatHours: sopMatch.tat,
    elapsedHours: Math.round(elapsedHours * 10) / 10,
    remainingHours: Math.round(remainingHours * 10) / 10,
    urgencyLevel: urgency.status,
    urgencyColor: urgency.color,
    urgencyIcon: urgency.icon,
    ticketURL: `https://valmostagging.kapturecrm.com${ticket.ticketURL}`,
    folderColor: ticket.folderColor,
    conversationCount: ticket.totalConversationCount
  };
}

/**
 * Parse Kapture date - handles multiple formats
 */
function parseKaptureDate(dateValue) {
  if (dateValue && typeof dateValue === 'object' && !Array.isArray(dateValue)) {
    if ('year' in dateValue && 'month' in dateValue && 'date' in dateValue) {
      const year = dateValue.year + 1900;
      const month = dateValue.month;
      const date = dateValue.date;
      const hours = dateValue.hours || 0;
      const minutes = dateValue.minutes || 0;
      const seconds = dateValue.seconds || 0;
      
      return new Date(year, month, date, hours, minutes, seconds).getTime();
    }
    
    if (dateValue.timestamp) {
      return dateValue.timestamp < 10000000000 ? dateValue.timestamp * 1000 : dateValue.timestamp;
    }
    
    console.warn('[TAT Tracking] Unknown date object format:', dateValue);
    return Date.now();
  }
  
  if (typeof dateValue === 'string') {
    const parts = dateValue.match(/(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})/);
    if (parts) {
      const [_, year, month, day, hour, min, sec] = parts;
      return new Date(year, month - 1, day, hour, min, sec).getTime();
    }
    console.warn('[TAT Tracking] Could not parse date string:', dateValue);
    return Date.now();
  }
  
  if (typeof dateValue === 'number') {
    return dateValue < 10000000000 ? dateValue * 1000 : dateValue;
  }
  
  console.warn('[TAT Tracking] Invalid date value:', dateValue, typeof dateValue);
  return Date.now();
}

/**
 * Format date for display
 */
function formatDateForDisplay(dateValue) {
  if (!dateValue) return '';
  
  if (typeof dateValue === 'object' && 'year' in dateValue) {
    const year = dateValue.year + 1900;
    const month = String(dateValue.month + 1).padStart(2, '0');
    const date = String(dateValue.date).padStart(2, '0');
    const hours = String(dateValue.hours || 0).padStart(2, '0');
    const minutes = String(dateValue.minutes || 0).padStart(2, '0');
    const seconds = String(dateValue.seconds || 0).padStart(2, '0');
    return `${year}-${month}-${date} ${hours}:${minutes}:${seconds}`;
  }
  
  if (typeof dateValue === 'string') {
    return dateValue;
  }
  
  if (typeof dateValue === 'number') {
    const timestamp = dateValue < 10000000000 ? dateValue * 1000 : dateValue;
    const d = new Date(timestamp);
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const date = String(d.getDate()).padStart(2, '0');
    const hours = String(d.getHours()).padStart(2, '0');
    const minutes = String(d.getMinutes()).padStart(2, '0');
    const seconds = String(d.getSeconds()).padStart(2, '0');
    return `${year}-${month}-${date} ${hours}:${minutes}:${seconds}`;
  }
  
  return '';
}

/**
 * Match ticket subject to SOP category
 */
function matchSOPCategory(subject) {
  if (!subject) return { category: 'General', tat: 48 };
  const lower = subject.toLowerCase();
  
  if (lower.includes('shortage') || lower.includes('loss') || lower.includes('debit') || lower.includes('hardstop')) {
    return { category: 'Losses & Debits', tat: 72 };
  }
  if (lower.includes('payment') || lower.includes('invoice') || lower.includes('payout') || lower.includes('gst')) {
    return lower.includes('not received') || lower.includes('pending') 
      ? { category: 'Payments', tat: 12 }
      : { category: 'Payments', tat: 72 };
  }
  if (lower.includes('cod') || lower.includes('deposit') || lower.includes('cash')) {
    return { category: 'COD', tat: 24 };
  }
  if (lower.includes('load') || lower.includes('volume') || lower.includes('manifest')) {
    return { category: 'Orders & Planning', tat: 12 };
  }
  if (lower.includes('cms') || lower.includes('log10') || lower.includes('system') || lower.includes('tool')) {
    return { category: 'Tech Issues', tat: 24 };
  }
  return { category: 'General', tat: 48 };
}

/**
 * Calculate urgency level
 */
function calculateUrgency(tatHours, elapsedHours) {
  const remaining = tatHours - elapsedHours;
  const threshold = tatHours * 0.25;
  
  if (remaining < 0) return { status: 'OVERDUE', color: 'red', icon: '🔴', sortOrder: 1 };
  if (remaining < threshold) return { status: 'DUE_SOON', color: 'yellow', icon: '🟡', sortOrder: 2 };
  return { status: 'ON_TRACK', color: 'green', icon: '🟢', sortOrder: 3 };
}

/**
 * Update extension badge
 */
function updateBadge(tickets) {
  const overdue = tickets.filter(t => t.urgencyLevel === 'OVERDUE').length;
  if (overdue > 0) {
    chrome.action.setBadgeText({ text: overdue.toString() });
    chrome.action.setBadgeBackgroundColor({ color: '#ff4444' });
  } else {
    chrome.action.setBadgeText({ text: '' });
  }
}

/**
 * Check for urgent tickets
 */
async function checkUrgentTickets(tickets) {
  const urgent = tickets.filter(t => t.urgencyLevel === 'OVERDUE' && t.remainingHours < -1);
  if (urgent.length === 0) return;
  
  const { notifiedTickets = [] } = await chrome.storage.local.get(['notifiedTickets']);
  
  for (const ticket of urgent) {
    if (!notifiedTickets.includes(ticket.ticketId)) {
      console.log(`[TAT Tracking] 🔴 URGENT: Ticket ${ticket.ticketId} is overdue by ${Math.abs(ticket.remainingHours).toFixed(1)}h`);
      notifiedTickets.push(ticket.ticketId);
    }
  }
  
  await chrome.storage.local.set({ notifiedTickets });
}

async function logTicketOpened(data) {
  const { ticketOpenLogs = [] } = await chrome.storage.local.get(['ticketOpenLogs']);
  ticketOpenLogs.push({
    url: data.url,
    timestamp: data.timestamp,
    date: new Date(data.timestamp).toISOString()
  });
  if (ticketOpenLogs.length > 1000) ticketOpenLogs.shift();
  await chrome.storage.local.set({ ticketOpenLogs });
}

async function getTicketStats() {
  const { trackedTickets = [] } = await chrome.storage.local.get(['trackedTickets']);
  return {
    total: trackedTickets.length,
    overdue: trackedTickets.filter(t => t.urgencyLevel === 'OVERDUE').length,
    dueSoon: trackedTickets.filter(t => t.urgencyLevel === 'DUE_SOON').length,
    onTrack: trackedTickets.filter(t => t.urgencyLevel === 'ON_TRACK').length
  };
}

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
  
  // TAT Tracking messages
  if (message.type === 'REFRESH_TICKETS') {
    fetchTicketsBackground().then(() => {
      sendResponse({ success: true });
    });
    return true;
  }
  
  if (message.type === 'TICKET_OPENED') {
    logTicketOpened(message);
    sendResponse({ success: true });
    return true;
  }
  
  if (message.type === 'GET_TICKET_STATS') {
    getTicketStats().then(stats => {
      sendResponse(stats);
    });
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
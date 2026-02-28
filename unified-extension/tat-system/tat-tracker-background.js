/**
 * tat-tracker-background.js - Background TAT Monitoring System
 * 
 * Monitors ticket lifecycle events from Kapture history API
 * Tracks: Manual Assignment → Disposition
 * Calculates real TAT based on actual ticket events
 * Records escalations per agent
 */

class TATTrackerBackground {
  constructor() {
    this.isTracking = false;
    this.refreshInterval = 60000; // 60 seconds
    this.intervalId = null;
    this.trackedTicketIds = new Set();
  }

  /**
   * Start background monitoring
   */
  async start() {
    if (this.isTracking) return;
    
    this.isTracking = true;
    console.log('[TAT Tracker BG] Started background monitoring');
    
    // Initial fetch
    await this.fetchAndProcessTickets();
    
    // Set up auto-refresh every 60 seconds
    this.intervalId = setInterval(() => {
      this.fetchAndProcessTickets();
    }, this.refreshInterval);
  }

  /**
   * Stop monitoring
   */
  stop() {
    if (!this.isTracking) return;
    
    this.isTracking = false;
    if (this.intervalId) {
      clearInterval(this.intervalId);
    }
    console.log('[TAT Tracker BG] Stopped monitoring');
  }

  /**
   * Fetch tickets and process their history
   */
  async fetchAndProcessTickets() {
    try {
      // Check if extension context is still valid
      if (!chrome.runtime?.id) {
        console.log('[TAT Tracker BG] Extension context invalidated, stopping...');
        this.stop();
        return;
      }

      console.log('[TAT Tracker BG] Fetching pending tickets...');

      // Fetch pending tickets assigned to current user
      const response = await fetch(
        'https://valmostagging.kapturecrm.com/api/version3/ticket/get-ticket-list',
        {
          method: 'POST',
          credentials: 'include',
          headers: { 
            'Content-Type': 'application/x-www-form-urlencoded'
          },
          body: 'sort_by_column=last_conversation_time&type=5&status=P&folder_id=-1&query=&page_no=0&sort_type=desc&page_size=50&response_type=json&key_beautify=yes&isElasticSearch=true'
        }
      );

      if (!response.ok) {
        throw new Error(`API returned ${response.status}`);
      }

      const data = await response.json();

      if (data.status === 'Success' && data.response?.tickets) {
        const tickets = data.response.tickets;
        console.log(`[TAT Tracker BG] Got ${tickets.length} pending tickets`);

        // For each ticket, fetch its history to calculate real TAT
        for (const ticket of tickets) {
          await this.processTicketHistory(ticket);
        }

        // Update dashboard display
        await this.updateDashboard();
      }

    } catch (error) {
      // Check if it's a context invalidation error
      if (error.message?.includes('Extension context invalidated')) {
        console.log('[TAT Tracker BG] Extension context invalidated, stopping tracker');
        this.stop();
      } else {
        console.error('[TAT Tracker BG] Fetch failed:', error);
      }
    }
  }

  /**
   * Fetch and process individual ticket history
   */
  async processTicketHistory(ticket) {
    try {
      console.log('[TAT Tracker BG] Processing ticket:', ticket.ticketId || ticket.id);
      
      // Use the CORRECT history API endpoint with proper parameters
      const historyResponse = await fetch(
        `https://valmostagging.kapturecrm.com/api/version3/ticket/get-ticket-detail?id=${ticket.id}&data_type=history&cdate=${encodeURIComponent(ticket.date)}&fetch_action_name=yes`,
        {
          method: 'GET',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' }
        }
      );

      if (!historyResponse.ok) {
        console.log('[TAT Tracker BG] History fetch failed for ticket', ticket.id, '- status:', historyResponse.status);
        return;
      }

      const historyData = await historyResponse.json();
      
      console.log('[TAT Tracker BG] Got history for ticket', ticket.id);

      if (historyData.status === 'Success' && historyData.response?.history) {
        const history = historyData.response.history;

        // Find latest MANUAL ASSIGNED event
        const latestAssignment = this.findLatestAssignment(history);
        
        if (!latestAssignment) {
          console.log(`[TAT Tracker BG] No assignment found for ticket ${ticket.ticketId || ticket.id}`);
          return;
        }
        
        console.log('[TAT Tracker BG] Found assignment for ticket', ticket.ticketId || ticket.id);

        // Calculate TAT from assignment time to now
        const assignedTime = this.parseDate(latestAssignment.createDate);
        const now = Date.now();
        const elapsedMs = now - assignedTime;
        const elapsedHours = elapsedMs / (1000 * 60 * 60);

        // Match SOP category
        const sopMatch = this.matchSOPCategory(ticket.taskTitle);
        const remainingHours = sopMatch.tat - elapsedHours;
        const urgency = this.calculateUrgency(sopMatch.tat, elapsedHours);

        // Extract agent info from assignment
        const agentEmail = this.extractAgentEmail(latestAssignment.remark);

        // Check if ticket was escalated
        const escalations = history.filter(h => 
          h.action === 'DISPOSED' && h.substatus === 'ETL'
        );

        // Build ticket record
        const ticketRecord = {
          // Core info
          id: ticket.id,
          ticketId: ticket.ticketId,
          subject: ticket.taskTitle,
          customerEmail: ticket.email,
          
          // Status
          status: ticket.status,
          substatus: ticket.substatus,
          substatusName: ticket.substatusName,
          
          // Assignment
          assignedTo: agentEmail,
          assignedTime: assignedTime,
          assignedTimeStr: latestAssignment.createDate,
          
          // TAT calculation
          sopCategory: sopMatch.category,
          tatHours: sopMatch.tat,
          elapsedHours: Math.round(elapsedHours * 10) / 10,
          remainingHours: Math.round(remainingHours * 10) / 10,
          
          // Urgency
          urgencyLevel: urgency.status,
          urgencyColor: urgency.color,
          urgencyIcon: urgency.icon,
          
          // Escalation tracking
          isEscalated: escalations.length > 0,
          escalationCount: escalations.length,
          lastEscalatedTime: escalations.length > 0 
            ? this.parseDate(escalations[escalations.length - 1].createDate)
            : null,
          
          // URL
          ticketURL: `https://valmostagging.kapturecrm.com${ticket.ticketURL}`,
          
          // Metadata
          lastUpdate: now
        };

        console.log('[TAT Tracker BG] Built ticket record, calling storeTicketRecord...');

        // Store in chrome.storage
        await this.storeTicketRecord(ticketRecord);
      } else {
        console.log('[TAT Tracker BG] Invalid history response for ticket', ticket.id);
      }

    } catch (error) {
      console.error(`[TAT Tracker BG] Error processing ticket ${ticket.ticketId || ticket.id}:`, error);
    }
  }

  /**
   * Find the latest MANUAL ASSIGNED event in history
   */
  findLatestAssignment(history) {
    // Filter for MANUAL ASSIGNED actions
    const assignments = history.filter(h => h.action === 'MANUAL ASSIGNED');
    
    if (assignments.length === 0) return null;
    
    // Return the most recent one
    return assignments[assignments.length - 1];
  }

  /**
   * Extract agent email from remark like:
   * "-Manual Task Assigning - assigned to Deepika Jaiswal at 02/02/2026 02:13 and creator Gaurav Nirmalkar"
   */
  extractAgentEmail(remark) {
    // Try to extract agent name from remark
    const match = remark.match(/assigned to ([^<]+)/i);
    if (match) {
      return match[1].trim();
    }
    return 'Unknown';
  }

  /**
   * Parse Kapture date: "2026-02-02 14:13:27"
   */
  parseDate(dateStr) {
    const parts = dateStr.match(/(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})/);
    if (!parts) return Date.now();
    
    const [_, year, month, day, hour, min, sec] = parts;
    return new Date(year, month - 1, day, hour, min, sec).getTime();
  }

  /**
   * Match ticket subject to SOP category and TAT
   */
  matchSOPCategory(subject) {
    if (!subject) return { category: 'General', tat: 48 };
    
    const lower = subject.toLowerCase();
    
    // Losses & Debits - 72h
    if (lower.includes('shortage') || lower.includes('loss') || 
        lower.includes('debit') || lower.includes('hardstop')) {
      return { category: 'Losses & Debits', tat: 72 };
    }
    
    // Payments - 12h urgent, 72h normal
    if (lower.includes('payment') || lower.includes('invoice') || 
        lower.includes('payout') || lower.includes('gst')) {
      if (lower.includes('not received') || lower.includes('pending')) {
        return { category: 'Payments', tat: 12 };
      }
      return { category: 'Payments', tat: 72 };
    }
    
    // COD - 24h
    if (lower.includes('cod') || lower.includes('deposit') || lower.includes('cash')) {
      return { category: 'COD', tat: 24 };
    }
    
    // Orders & Planning - 12h
    if (lower.includes('load') || lower.includes('volume') || lower.includes('manifest')) {
      return { category: 'Orders & Planning', tat: 12 };
    }
    
    // Tech Issues - 24h
    if (lower.includes('cms') || lower.includes('log10') || lower.includes('system')) {
      return { category: 'Tech Issues', tat: 24 };
    }
    
    return { category: 'General', tat: 48 };
  }

  /**
   * Calculate urgency based on remaining time
   */
  calculateUrgency(tatHours, elapsedHours) {
    const remaining = tatHours - elapsedHours;
    const threshold = tatHours * 0.25; // 25% threshold
    
    if (remaining < 0) {
      return { status: 'OVERDUE', color: 'red', icon: '🔴', sortOrder: 1 };
    } else if (remaining < threshold) {
      return { status: 'DUE_SOON', color: 'yellow', icon: '🟡', sortOrder: 2 };
    } else {
      return { status: 'ON_TRACK', color: 'green', icon: '🟢', sortOrder: 3 };
    }
  }

  /**
   * Store ticket record in chrome.storage
   */
  async storeTicketRecord(ticketRecord) {
    try {
      console.log('[TAT Tracker BG] Storing ticket:', ticketRecord.ticketId);
      
      if (!chrome.runtime?.id) {
        console.log('[TAT Tracker BG] Context invalid, cannot store');
        return;
      }
      
      const { tatTickets = {} } = await chrome.storage.local.get(['tatTickets']);
      
      console.log('[TAT Tracker BG] Current tatTickets count:', Object.keys(tatTickets).length);
      
      // Store indexed by ticket ID
      tatTickets[ticketRecord.ticketId] = ticketRecord;
      
      await chrome.storage.local.set({ tatTickets });
      
      console.log('[TAT Tracker BG] ✓ Stored ticket', ticketRecord.ticketId);
    } catch (error) {
      console.error('[TAT Tracker BG] Failed to store ticket:', error);
      if (error.message?.includes('Extension context invalidated')) {
        console.log('[TAT Tracker BG] Context invalidated during store');
        this.stop();
      }
    }
  }

  /**
   * Update dashboard display data
   */
  async updateDashboard() {
    try {
      if (!chrome.runtime?.id) {
        console.log('[TAT Tracker BG] Context invalid in updateDashboard');
        return;
      }
      
      const { tatTickets = {} } = await chrome.storage.local.get(['tatTickets']);
      
      // Convert to array
      const tickets = Object.values(tatTickets);
      
      console.log('[TAT Tracker BG] updateDashboard - tickets from storage:', tickets.length);
      
      // Calculate stats
      const stats = {
        total: tickets.length,
        overdue: tickets.filter(t => t.urgencyLevel === 'OVERDUE').length,
        dueSoon: tickets.filter(t => t.urgencyLevel === 'DUE_SOON').length,
        onTrack: tickets.filter(t => t.urgencyLevel === 'ON_TRACK').length,
        escalated: tickets.filter(t => t.isEscalated).length,
        avgTAT: tickets.length > 0 
          ? Math.round(tickets.reduce((sum, t) => sum + t.elapsedHours, 0) / tickets.length * 10) / 10
          : 0
      };

      console.log('[TAT Tracker BG] Calculated stats:', stats);
      console.log('[TAT Tracker BG] Writing trackedTickets array with', tickets.length, 'items');

      // Store for dashboard
      await chrome.storage.local.set({
        trackedTickets: tickets,
        tatStats: stats,
        lastTicketFetch: Date.now()
      });

      console.log('[TAT Tracker BG] ✓ Dashboard updated successfully');

      // Update badge
      this.updateBadge(stats.overdue);
      
    } catch (error) {
      console.error('[TAT Tracker BG] updateDashboard failed:', error);
      if (error.message?.includes('Extension context invalidated')) {
        console.log('[TAT Tracker BG] Context invalidated during dashboard update');
        this.stop();
      }
    }
  }

  /**
   * Update extension badge with overdue count
   * Note: This runs in content script context, so we send message to background
   */
  updateBadge(overdueCount) {
    // Send message to background to update badge
    chrome.runtime.sendMessage({
      type: 'UPDATE_BADGE',
      count: overdueCount
    });
  }
}

// Global instance
const tatTrackerBG = new TATTrackerBackground();

// Auto-start when extension loads
tatTrackerBG.start();
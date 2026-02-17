/**
 * ticket-tracker.js - TAT Monitoring System
 * 
 * Fetches tickets from Kapture API
 * Calculates TAT (Turnaround Time)
 * Provides real-time monitoring
 */

class TicketTracker {
  constructor() {
    this.tickets = [];
    this.lastFetch = 0;
    this.refreshInterval = 30000; // 30 seconds
    this.isTracking = false;
  }
  
  /**
   * Start monitoring tickets
   */
  async startTracking() {
    if (this.isTracking) return;
    
    this.isTracking = true;
    console.log('[Ticket Tracker] Started monitoring');
    
    // Initial fetch
    await this.fetchTickets();
    
    // Set up auto-refresh
    this.intervalId = setInterval(() => {
      this.fetchTickets();
    }, this.refreshInterval);
  }
  
  /**
   * Stop monitoring
   */
  stopTracking() {
    if (!this.isTracking) return;
    
    this.isTracking = false;
    if (this.intervalId) {
      clearInterval(this.intervalId);
    }
    console.log('[Ticket Tracker] Stopped monitoring');
  }
  
  /**
   * Fetch tickets from Kapture API
   */
  async fetchTickets() {
    try {
      console.log('[Ticket Tracker] Fetching tickets from Kapture API...');
      
      const response = await fetch('https://valmostagging.kapturecrm.com/api/version3/ticket/get-ticket-list', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        credentials: 'include', // Important for auth cookies
        body: JSON.stringify({
          sort_by_column: 'last_conversation_time',
          type: 5, // Assigned to me
          status: 'P', // Pending
          folder_id: -1,
          query: '',
          page_no: 0,
          sort_type: 'desc',
          page_size: 100, // Get up to 100 tickets
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
        console.log(`[Ticket Tracker] ✓ Fetched ${tickets.length} tickets`);
        
        // Process tickets
        this.tickets = tickets.map(ticket => this.processTicket(ticket));
        
        // Store in chrome.storage for dashboard access
        chrome.storage.local.set({
          trackedTickets: this.tickets,
          lastTicketFetch: Date.now()
        });
        
        this.lastFetch = Date.now();
        return this.tickets;
      } else {
        console.warn('[Ticket Tracker] No tickets in response');
        this.tickets = [];
        return [];
      }
      
    } catch (error) {
      console.error('[Ticket Tracker] Failed to fetch tickets:', error);
      return [];
    }
  }
  
  /**
   * Process individual ticket - calculate TAT, match SOP, etc.
   */
  processTicket(ticket) {
    // Parse created date
    const createdDate = this.parseKaptureDate(ticket.date);
    const now = Date.now();
    
    // Calculate elapsed time
    const elapsedMs = now - createdDate;
    const elapsedHours = elapsedMs / (1000 * 60 * 60);
    
    // Match subject to SOP category and get TAT
    const sopMatch = this.matchSOPCategory(ticket.taskTitle);
    
    // Calculate remaining time
    const remainingHours = sopMatch.tat - elapsedHours;
    
    // Determine urgency
    const urgency = this.calculateUrgency(sopMatch.tat, elapsedHours);
    
    return {
      // Original ticket data
      id: ticket.id,
      ticketId: ticket.ticketId,
      subject: ticket.taskTitle,
      customerEmail: ticket.email,
      status: ticket.status,
      substatus: ticket.substatus,
      substatusName: ticket.substatusName,
      isEscalated: ticket.isEscalated,
      
      // Timestamps
      createdDate: createdDate,
      createdDateStr: ticket.date,
      lastConversationTime: ticket.lastConversationTime,
      
      // TAT calculation
      sopCategory: sopMatch.category,
      tatHours: sopMatch.tat,
      elapsedHours: Math.round(elapsedHours * 10) / 10,
      remainingHours: Math.round(remainingHours * 10) / 10,
      
      // Urgency
      urgencyLevel: urgency.status,
      urgencyColor: urgency.color,
      urgencyIcon: urgency.icon,
      
      // URL to open ticket
      ticketURL: `https://valmostagging.kapturecrm.com${ticket.ticketURL}`,
      
      // Metadata
      folderColor: ticket.folderColor,
      conversationCount: ticket.totalConversationCount
    };
  }
  
  /**
   * Parse Kapture date format: "2026-02-12 05:39:32"
   */
  parseKaptureDate(dateStr) {
    // Format: "YYYY-MM-DD HH:MM:SS"
    const parts = dateStr.match(/(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})/);
    if (!parts) return Date.now();
    
    const [_, year, month, day, hour, min, sec] = parts;
    return new Date(year, month - 1, day, hour, min, sec).getTime();
  }
  
  /**
   * Match ticket subject to SOP category
   */
  matchSOPCategory(subject) {
    if (!subject) return { category: 'General', tat: 48 };
    
    const lower = subject.toLowerCase();
    
    // Losses & Debits (72 hours)
    if (lower.includes('shortage') || lower.includes('loss') || 
        lower.includes('debit') || lower.includes('hardstop') ||
        lower.includes('shipment') && (lower.includes('short') || lower.includes('missing'))) {
      return { category: 'Losses & Debits', tat: 72 };
    }
    
    // Payments (12-72 hours depending on type, defaulting to 72)
    if (lower.includes('payment') || lower.includes('invoice') || 
        lower.includes('payout') || lower.includes('gst') ||
        lower.includes('pending sign')) {
      // Payment not received: 12h, others: 72h
      if (lower.includes('not received') || lower.includes('pending')) {
        return { category: 'Payments', tat: 12 };
      }
      return { category: 'Payments', tat: 72 };
    }
    
    // COD / Cash (24 hours estimated)
    if (lower.includes('cod') || lower.includes('deposit') || 
        lower.includes('cash') || lower.includes('pendency')) {
      return { category: 'COD', tat: 24 };
    }
    
    // Orders & Planning (12-24 hours)
    if (lower.includes('load') || lower.includes('volume') || 
        lower.includes('manifest') || lower.includes('planning')) {
      return { category: 'Orders & Planning', tat: 12 };
    }
    
    // Tech issues (24 hours estimated)
    if (lower.includes('cms') || lower.includes('log10') || 
        lower.includes('system') || lower.includes('tool') ||
        lower.includes('bagging') || lower.includes('inactive')) {
      return { category: 'Tech Issues', tat: 24 };
    }
    
    // Default fallback
    return { category: 'General', tat: 48 };
  }
  
  /**
   * Calculate urgency level based on TAT
   */
  calculateUrgency(tatHours, elapsedHours) {
    const remaining = tatHours - elapsedHours;
    const threshold = tatHours * 0.25; // 25% threshold for "due soon"
    
    if (remaining < 0) {
      // Overdue
      return { 
        status: 'OVERDUE', 
        color: 'red', 
        icon: '🔴',
        sortOrder: 1
      };
    } else if (remaining < threshold) {
      // Due soon (less than 25% time left)
      return { 
        status: 'DUE_SOON', 
        color: 'yellow', 
        icon: '🟡',
        sortOrder: 2
      };
    } else {
      // On track
      return { 
        status: 'ON_TRACK', 
        color: 'green', 
        icon: '🟢',
        sortOrder: 3
      };
    }
  }
  
  /**
   * Get tickets grouped by urgency
   */
  getGroupedTickets() {
    const groups = {
      overdue: [],
      dueSoon: [],
      onTrack: []
    };
    
    this.tickets.forEach(ticket => {
      switch (ticket.urgencyLevel) {
        case 'OVERDUE':
          groups.overdue.push(ticket);
          break;
        case 'DUE_SOON':
          groups.dueSoon.push(ticket);
          break;
        case 'ON_TRACK':
          groups.onTrack.push(ticket);
          break;
      }
    });
    
    // Sort each group by time remaining
    groups.overdue.sort((a, b) => a.remainingHours - b.remainingHours);
    groups.dueSoon.sort((a, b) => a.remainingHours - b.remainingHours);
    groups.onTrack.sort((a, b) => a.remainingHours - b.remainingHours);
    
    return groups;
  }
  
  /**
   * Get statistics
   */
  getStats() {
    const total = this.tickets.length;
    const overdue = this.tickets.filter(t => t.urgencyLevel === 'OVERDUE').length;
    const dueSoon = this.tickets.filter(t => t.urgencyLevel === 'DUE_SOON').length;
    const onTrack = this.tickets.filter(t => t.urgencyLevel === 'ON_TRACK').length;
    
    return {
      total,
      overdue,
      dueSoon,
      onTrack,
      avgElapsedHours: total > 0 
        ? Math.round(this.tickets.reduce((sum, t) => sum + t.elapsedHours, 0) / total * 10) / 10
        : 0
    };
  }
}

// Global instance
const ticketTracker = new TicketTracker();
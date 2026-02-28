/**
 * tat-analytics.js - TAT Analytics & Excel Export
 * 
 * Tracks agent performance:
 * - Average TAT per agent
 * - Escalation rate
 * - Tickets resolved vs escalated
 * - Export to Excel
 */

class TATAnalytics {
  constructor() {
    this.historicalData = {};
  }

  /**
   * Record ticket disposition event
   * Called when agent disposes a ticket
   */
  async recordDisposition(ticketId, disposition) {
    const { tatTickets = {} } = await chrome.storage.local.get(['tatTickets']);
    const ticket = tatTickets[ticketId];
    
    if (!ticket) {
      console.warn('[TAT Analytics] Ticket not found:', ticketId);
      return;
    }

    const disposedTime = Date.now();
    const tatMs = disposedTime - ticket.assignedTime;
    const tatHours = tatMs / (1000 * 60 * 60);

    const dispositionRecord = {
      ticketId: ticket.ticketId,
      subject: ticket.subject,
      category: ticket.sopCategory,
      agent: ticket.assignedTo,
      assignedTime: ticket.assignedTime,
      disposedTime: disposedTime,
      tatHours: Math.round(tatHours * 10) / 10,
      dispositionType: disposition, // 'RESOLVED', 'ETL', 'CLOSED', etc.
      isEscalated: disposition === 'ETL',
      wasOverdue: tatHours > ticket.tatHours
    };

    // Store in historical data
    await this.storeHistoricalRecord(dispositionRecord);

    console.log('[TAT Analytics] Recorded disposition:', dispositionRecord);
  }

  /**
   * Store disposition record in chrome.storage
   */
  async storeHistoricalRecord(record) {
    const { tatHistory = [] } = await chrome.storage.local.get(['tatHistory']);
    
    // Add new record
    tatHistory.push(record);
    
    // Keep last 1000 records to avoid storage bloat
    if (tatHistory.length > 1000) {
      tatHistory.shift();
    }

    await chrome.storage.local.set({ tatHistory });
  }

  /**
   * Get agent performance statistics
   */
  async getAgentStats(agentEmail) {
    const { tatHistory = [] } = await chrome.storage.local.get(['tatHistory']);
    
    // Filter for this agent
    const agentRecords = tatHistory.filter(r => r.agent === agentEmail);
    
    if (agentRecords.length === 0) {
      return {
        agent: agentEmail,
        totalTickets: 0,
        resolved: 0,
        escalated: 0,
        escalationRate: 0,
        avgTAT: 0,
        overdueCount: 0
      };
    }

    const resolved = agentRecords.filter(r => r.dispositionType === 'RESOLVED').length;
    const escalated = agentRecords.filter(r => r.isEscalated).length;
    const overdueCount = agentRecords.filter(r => r.wasOverdue).length;
    const avgTAT = agentRecords.reduce((sum, r) => sum + r.tatHours, 0) / agentRecords.length;

    return {
      agent: agentEmail,
      totalTickets: agentRecords.length,
      resolved: resolved,
      escalated: escalated,
      escalationRate: Math.round((escalated / agentRecords.length) * 100),
      avgTAT: Math.round(avgTAT * 10) / 10,
      overdueCount: overdueCount,
      overdueRate: Math.round((overdueCount / agentRecords.length) * 100)
    };
  }

  /**
   * Get all agents' performance
   */
  async getAllAgentsStats() {
    const { tatHistory = [] } = await chrome.storage.local.get(['tatHistory']);
    
    // Get unique agents
    const agents = [...new Set(tatHistory.map(r => r.agent))];
    
    // Calculate stats for each
    const allStats = [];
    for (const agent of agents) {
      const stats = await this.getAgentStats(agent);
      allStats.push(stats);
    }

    // Sort by escalation rate (worst first)
    allStats.sort((a, b) => b.escalationRate - a.escalationRate);

    return allStats;
  }

  /**
   * Export to Excel (CSV format)
   */
  async exportToExcel() {
    const { tatHistory = [] } = await chrome.storage.local.get(['tatHistory']);
    
    if (tatHistory.length === 0) {
      alert('No data to export yet!');
      return;
    }

    // CSV Header
    let csv = 'Ticket ID,Subject,Category,Agent,Assigned Time,Disposed Time,TAT (Hours),Disposition,Escalated,Overdue\n';

    // Add rows
    tatHistory.forEach(record => {
      const row = [
        record.ticketId,
        `"${record.subject.replace(/"/g, '""')}"`, // Escape quotes
        record.category,
        record.agent,
        new Date(record.assignedTime).toLocaleString(),
        new Date(record.disposedTime).toLocaleString(),
        record.tatHours,
        record.dispositionType,
        record.isEscalated ? 'Yes' : 'No',
        record.wasOverdue ? 'Yes' : 'No'
      ].join(',');
      
      csv += row + '\n';
    });

    // Add summary stats
    csv += '\n--- AGENT PERFORMANCE SUMMARY ---\n';
    csv += 'Agent,Total Tickets,Resolved,Escalated,Escalation Rate %,Avg TAT (Hours),Overdue Count,Overdue Rate %\n';

    const agentStats = await this.getAllAgentsStats();
    agentStats.forEach(stats => {
      const row = [
        stats.agent,
        stats.totalTickets,
        stats.resolved,
        stats.escalated,
        stats.escalationRate,
        stats.avgTAT,
        stats.overdueCount,
        stats.overdueRate
      ].join(',');
      
      csv += row + '\n';
    });

    // Download
    this.downloadCSV(csv, `TAT_Analytics_${new Date().toISOString().split('T')[0]}.csv`);
  }

  /**
   * Download CSV file
   */
  downloadCSV(csvContent, filename) {
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    
    link.setAttribute('href', url);
    link.setAttribute('download', filename);
    link.style.visibility = 'hidden';
    
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    console.log('[TAT Analytics] Exported:', filename);
  }

  /**
   * Get real-time summary for dashboard
   */
  async getSummary() {
    const { tatHistory = [], trackedTickets = [] } = await chrome.storage.local.get([
      'tatHistory',
      'trackedTickets'
    ]);

    const agentStats = await this.getAllAgentsStats();

    return {
      // Current pending tickets
      pending: {
        total: trackedTickets.length,
        overdue: trackedTickets.filter(t => t.urgencyLevel === 'OVERDUE').length,
        escalated: trackedTickets.filter(t => t.isEscalated).length
      },
      
      // Historical data
      historical: {
        totalProcessed: tatHistory.length,
        totalEscalated: tatHistory.filter(r => r.isEscalated).length,
        avgEscalationRate: tatHistory.length > 0
          ? Math.round((tatHistory.filter(r => r.isEscalated).length / tatHistory.length) * 100)
          : 0
      },
      
      // Agent performance
      agents: agentStats,
      
      // Last updated
      lastUpdate: Date.now()
    };
  }
}

// Global instance
const tatAnalytics = new TATAnalytics();
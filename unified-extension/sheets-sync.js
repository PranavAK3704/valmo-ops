/**
 * sheets-sync.js - ROBUST CSV PARSER
 * 
 * Handles:
 * - Multi-line templates with \n
 * - Commas inside quoted fields
 * - Nested quotes
 * - Line breaks within cells
 */

class SheetsSync {
  constructor() {
    this.sopData = null;
    this.templateData = null;
    this.lastFetch = 0;
  }
  
  async loadData() {
    const now = Date.now();
    
    if (this.sopData && this.templateData && 
        (now - this.lastFetch < SHEETS_CONFIG.refresh_interval)) {
      console.log('[Sheets Sync] Using cached data');
      return { sops: this.sopData, templates: this.templateData };
    }
    
    if (SHEETS_CONFIG.enabled) {
      try {
        console.log('[Sheets Sync] Fetching from Google Sheets...');
        
        let sops = {};
        if (SHEETS_CONFIG.sops_url) {
          sops = await this.fetchSheetAsJSON(SHEETS_CONFIG.sops_url, 'sops');
        }
        
        let templates = {};
        if (SHEETS_CONFIG.templates_url) {
          templates = await this.fetchSheetAsJSON(SHEETS_CONFIG.templates_url, 'templates');
        }
        
        this.sopData = sops;
        this.templateData = templates;
        this.lastFetch = now;
        
        console.log('[Sheets Sync] ✓ Loaded from Google Sheets');
        console.log(`[Sheets Sync]   - ${Object.keys(sops).length} SOP categories`);
        console.log(`[Sheets Sync]   - ${Object.keys(templates).length} Template categories`);
        
        Object.entries(templates).forEach(([cat, temps]) => {
          console.log(`[Sheets Sync]     • ${cat}: ${temps.length} templates`);
        });
        
        return { sops, templates };
        
      } catch (error) {
        console.warn('[Sheets Sync] ⚠️  Failed:', error.message);
        console.warn('[Sheets Sync] Falling back to local JSON...');
      }
    }
    
    return await this.loadLocalJSON();
  }
  
  async fetchSheetAsJSON(url, type) {
    const fetchUrl = url.includes('?') ? `${url}&t=${Date.now()}` : `${url}?t=${Date.now()}`;
    
    const response = await fetch(fetchUrl);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    
    const csv = await response.text();
    if (!csv.trim() || csv.includes('<!DOCTYPE html>')) {
      throw new Error('Invalid CSV response (got HTML)');
    }
    
    return this.parseCSV(csv, type);
  }
  
  parseCSV(csv, type) {
    // ROBUST CSV PARSING - handles multi-line, quotes, commas
    const rows = [];
    let currentRow = [];
    let currentCell = '';
    let inQuotes = false;
    let i = 0;
    
    while (i < csv.length) {
      const char = csv[i];
      const nextChar = csv[i + 1];
      
      if (char === '"') {
        if (inQuotes && nextChar === '"') {
          // Escaped quote ("")
          currentCell += '"';
          i += 2;
          continue;
        } else {
          // Toggle quote mode
          inQuotes = !inQuotes;
          i++;
          continue;
        }
      }
      
      if (!inQuotes) {
        if (char === ',') {
          // End of cell
          currentRow.push(currentCell.trim());
          currentCell = '';
          i++;
          continue;
        }
        
        if (char === '\n' || (char === '\r' && nextChar === '\n')) {
          // End of row
          currentRow.push(currentCell.trim());
          if (currentRow.some(cell => cell.length > 0)) {
            rows.push(currentRow);
          }
          currentRow = [];
          currentCell = '';
          i += (char === '\r' ? 2 : 1);
          continue;
        }
      }
      
      // Add character to current cell
      currentCell += char;
      i++;
    }
    
    // Handle last row
    if (currentCell || currentRow.length > 0) {
      currentRow.push(currentCell.trim());
      if (currentRow.some(cell => cell.length > 0)) {
        rows.push(currentRow);
      }
    }
    
    if (rows.length < 2) {
      throw new Error('CSV has no data rows');
    }
    
    // Parse into objects
    const headers = rows[0].map(h => h.trim());
    console.log(`[Sheets Sync] ${type} headers:`, headers);
    console.log(`[Sheets Sync] ${type} total rows:`, rows.length - 1);
    
    const data = {};
    
    for (let rowIdx = 1; rowIdx < rows.length; rowIdx++) {
      const values = rows[rowIdx];
      const row = {};
      
      headers.forEach((header, index) => {
        row[header] = values[index] || '';
      });
      
      if (type === 'sops') {
        // SOP parsing
        const category = row.Category || row.category || 'General';
        
        if (!data[category]) {
          data[category] = [];
        }
        
        data[category].push({
          type: row.Type || '',
          scenario: row.Scenario || '',
          process: row.L1_Process || row.Process || '',
          escalateTo: row.Escalate_To || row.Escalate || '',
          guardrails: row.Guardrails || '',
          tat: row.TAT || '',
          keywords: (row.Keywords || '').split('|').map(k => k.trim()).filter(Boolean)
        });
        
      } else if (type === 'templates') {
        // TEMPLATE PARSING
        let category = row['Final Status'] || row['final status'] || '';
        const scenario = row.Scenario || row.scenario || '';
        const template = row['Templates for L1 agents'] || 
                        row['templates for l1 agents'] || '';
        
        category = category.trim();
        
        // Skip junk
        const skipCategories = ['Final Status', 'Status', 'L2', 'Template', 
                               'Output', 'scenario', 'nan', ''];
        if (skipCategories.includes(category) || !category) {
          continue;
        }
        
        // Skip invalid templates
        if (!template || template === '-' || template.trim().length < 10) {
          continue;
        }
        
        // Normalize categories
        let normalizedCategory = category;
        
        const paymentCategories = [
          'Payment processed', 'Pending Sign', 'Hold Negative', 'No Payment',
          'GST Defaulter Hold', 'Risk is above threshold (COD pendency)',
          'Risk is above threshold (COD + Shipment pendency )', 
          'Payment Hold due to GST>20 lakh', 'Hold by ops', 'Onboarding Issue',
          'F&F Vendor', 'Grocery defaulter:', 'Negative balance', 'Payment Failed'
        ];
        
        if (paymentCategories.includes(category)) {
          normalizedCategory = 'Payments';
        }
        
        if (category === 'Shortage Loss' || category === 'I received hardstop alert email') {
          normalizedCategory = 'Losses';
        }
        
        if (category.includes('COD pendency')) {
          normalizedCategory = 'COD';
        }
        
        if (!data[normalizedCategory]) {
          data[normalizedCategory] = [];
        }
        
        data[normalizedCategory].push({
          name: scenario || category,
          template: template.trim()
        });
        
        console.log(`[Sheets Sync] Added template: ${normalizedCategory} - ${(scenario || category).substring(0, 40)}...`);
      }
    }
    
    return data;
  }
  
  async loadLocalJSON() {
    try {
      const [sopResponse, templateResponse] = await Promise.all([
        fetch(chrome.runtime.getURL('data/sop_database.json')),
        fetch(chrome.runtime.getURL('data/template_database.json'))
      ]);
      
      if (!sopResponse.ok || !templateResponse.ok) {
        throw new Error('Failed to load local JSON');
      }
      
      const sops = await sopResponse.json();
      const templates = await templateResponse.json();
      
      this.sopData = sops;
      this.templateData = templates;
      this.lastFetch = Date.now();
      
      console.log('[Sheets Sync] ✓ Loaded from local JSON');
      console.log(`[Sheets Sync]   - ${Object.keys(sops).length} SOP categories`);
      console.log(`[Sheets Sync]   - ${Object.keys(templates).length} Template categories`);
      
      return { sops, templates };
      
    } catch (error) {
      console.error('[Sheets Sync] ❌ Failed to load local JSON:', error);
      return { sops: {}, templates: {} };
    }
  }
}

const sheetsSync = new SheetsSync();
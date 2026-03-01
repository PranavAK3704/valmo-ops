/**
 * config.js - Configuration for Google Sheets URLs and API Keys
 * 
 * STEP 1: Get your Groq API key from https://console.groq.com/keys
 * STEP 2: Paste it in the api_key field below (line 27)
 * STEP 3: Save this file
 * STEP 4: Reload extension in Chrome
 */

const SHEETS_CONFIG = {
  // Set to true to use Google Sheets, false to use local JSON files
  enabled: true,
  
  // Published CSV URLs from Google Sheets
  // Format: https://docs.google.com/spreadsheets/d/[SHEET_ID]/export?format=csv&gid=[GID]
  training_videos_url: 'https://docs.google.com/spreadsheets/d/e/2PACX-1vTKDX4o1H_sZSJS_tUDo68N1SyjV3m3kbnkucjLe-4y1cUR3PBb2O49fbfNe2AQt-Oiuiu0Egj-wi_P/pub?gid=956797213&single=true&output=csv',
  sops_url: 'https://docs.google.com/spreadsheets/d/e/2PACX-1vTtfp2EauVkBu1RILwErMMDs7mfwdzC1V9CdP0bf4ZjEsoe_QEr7o1slJm5tsMxNIqMK6vudtYjHCql/pub?gid=1281163884&single=true&output=csv',
  templates_url: 'https://docs.google.com/spreadsheets/d/e/2PACX-1vRNGnSVBmO7sU79z_zNfAa9N2S0yUSDR6yyOBTtnEi_m-XGBV6eBK0H9DJMuaDp_l0YA4enSjTKzNsk/pub?gid=0&single=true&output=csv',
  
  sc_sops_url: 'YOUR_SC_SOP_SHEET_PUBLISHED_CSV_URL',
  // Refresh interval (in milliseconds)
  // 300000 = 5 minutes
  refresh_interval: 300000
};

// Groq API settings for smart chatbot
const CHATBOT_CONFIG = {
  // Set to true to use Groq API (smart chatbot)
  // Set to false to use keyword search (simple chatbot)
  use_claude_api: true,
  
  // ⭐ PASTE YOUR GROQ API KEY HERE ⭐
  // Get it from: https://console.groq.com/keys
  api_key: '',
  
  // System prompt for Groq
  system_prompt: `You are a helpful L1 support agent assistant for Valmo logistics operations.
Your job is to help L1 agents answer support tickets by searching through SOPs and providing clear guidance.

When answering:
- Be concise and actionable
- Reference the specific SOP section
- Mention escalation path if relevant
- List required inputs from captains
- If asked about losses, payments, or orders, always check the relevant SOP category

If you don't find relevant information in the SOPs, say so clearly.`
};
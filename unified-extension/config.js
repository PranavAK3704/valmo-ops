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

// ─────────────────────────────────────────────────────────────────
// JARVIS CONFIG  ← Plug your AI in here
// ─────────────────────────────────────────────────────────────────
// Jarvis is tried FIRST. If it fails or is disabled, Groq is used.
// Jarvis must expose an OpenAI-compatible endpoint:
//   POST <endpoint>/v1/chat/completions
//   Body: { model, messages, max_tokens, temperature }
//   Response: { choices: [{ message: { content } }] }
//
// If Jarvis uses a completely different format, set request_format to
// 'custom' and Claude Code will write a custom adapter for you.
// ─────────────────────────────────────────────────────────────────
const JARVIS_CONFIG = {
  enabled: false,                        // ← flip to true when ready

  // Base URL for Jarvis (without /v1/chat/completions)
  endpoint: 'YOUR_JARVIS_BASE_URL_HERE', // e.g. 'https://jarvis.yourcompany.com'

  api_key: 'YOUR_JARVIS_API_KEY_HERE',   // Bearer token / API key

  model: 'jarvis',                       // Model name Jarvis expects

  // 'openai'  → standard OpenAI-compatible format (most AIs)
  // 'custom'  → tell Claude Code the format and it'll write the adapter
  request_format: 'openai'
};

// ─────────────────────────────────────────────────────────────────
// SUPABASE CONFIG  ← LMS backend (admin portal + cross-agent data)
// ─────────────────────────────────────────────────────────────────
const SUPABASE_CONFIG = {
  url:      'https://wfnmltorfvaokqbzggkn.supabase.co',
  anon_key: 'sb_publishable_kVRokdcfNT-egywk-KbQ3g_mEs5QVGW'
};

// Groq API — fallback when Jarvis is disabled or unavailable
const CHATBOT_CONFIG = {
  use_claude_api: true,

  // ⭐ PASTE YOUR GROQ API KEY HERE ⭐
  api_key: '',  // set your Groq key here locally — never commit

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
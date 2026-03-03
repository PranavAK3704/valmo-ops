/**
 * api.js - Google Sheets API Integration
 * 
 * Handles all data fetching from Google Sheets:
 * - Training processes (Training_Videos)
 * - Assessment questions (Assessment_Questions)
 * - User progress (User_Progress)
 * - Leaderboard data (Leaderboard)
 */

const API = {
  // Google Sheets published CSV URLs
  // Replace these with your actual published URLs
  SHEETS: {
    TRAINING_VIDEOS: 'YOUR_TRAINING_VIDEOS_CSV_URL',  // TODO: Replace
    ASSESSMENT_QUESTIONS: 'YOUR_ASSESSMENT_QUESTIONS_CSV_URL',  // TODO: Replace
    LEADERBOARD: 'YOUR_LEADERBOARD_CSV_URL',  // TODO: Replace
    USER_PROGRESS: 'YOUR_USER_PROGRESS_CSV_URL'  // TODO: Replace (optional)
  },

  // Cache to avoid repeated fetches
  cache: {
    processes: null,
    questions: null,
    leaderboard: null,
    lastFetch: {}
  },

  /**
   * Fetch and parse CSV from Google Sheets
   */
  async fetchCSV(url) {
    try {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      
      const text = await response.text();
      return this.parseCSV(text);
    } catch (error) {
      console.error('[API] Fetch error:', error);
      return null;
    }
  },

  /**
   * Parse CSV text to array of objects
   */
  parseCSV(text) {
    const lines = text.trim().split('\n');
    if (lines.length < 2) return [];

    const headers = lines[0].split(',').map(h => h.trim());
    const rows = [];

    for (let i = 1; i < lines.length; i++) {
      const values = lines[i].split(',').map(v => v.trim());
      const row = {};
      
      headers.forEach((header, idx) => {
        row[header] = values[idx] || '';
      });
      
      rows.push(row);
    }

    return rows;
  },

  /**
   * Get all training processes
   */
  async getProcesses(forceRefresh = false) {
    // Use cache if available and not forcing refresh
    if (!forceRefresh && this.cache.processes) {
      return this.cache.processes;
    }

    console.log('[API] Fetching training processes...');
    
    // For demo/testing: return mock data if URL not configured
    if (this.SHEETS.TRAINING_VIDEOS === 'YOUR_TRAINING_VIDEOS_CSV_URL') {
      console.warn('[API] Using mock data - configure TRAINING_VIDEOS URL');
      return this.getMockProcesses();
    }

    const data = await this.fetchCSV(this.SHEETS.TRAINING_VIDEOS);
    
    if (!data) {
      console.warn('[API] Failed to fetch, using mock data');
      return this.getMockProcesses();
    }

    this.cache.processes = data;
    return data;
  },

  /**
   * Get assessment questions for a process
   */
  async getAssessmentQuestions(processName) {
    console.log('[API] Fetching assessment questions for:', processName);

    // For demo: return mock questions if URL not configured
    if (this.SHEETS.ASSESSMENT_QUESTIONS === 'YOUR_ASSESSMENT_QUESTIONS_CSV_URL') {
      console.warn('[API] Using mock questions - configure ASSESSMENT_QUESTIONS URL');
      return this.getMockQuestions(processName);
    }

    const allQuestions = await this.fetchCSV(this.SHEETS.ASSESSMENT_QUESTIONS);
    
    if (!allQuestions) {
      return this.getMockQuestions(processName);
    }

    // Filter questions for this process
    return allQuestions.filter(q => q.process_name === processName);
  },

  /**
   * Get leaderboard data
   */
  async getLeaderboard(forceRefresh = false) {
    if (!forceRefresh && this.cache.leaderboard) {
      return this.cache.leaderboard;
    }

    console.log('[API] Fetching leaderboard...');

    // For demo: return mock leaderboard if URL not configured
    if (this.SHEETS.LEADERBOARD === 'YOUR_LEADERBOARD_CSV_URL') {
      console.warn('[API] Using mock leaderboard - configure LEADERBOARD URL');
      return this.getMockLeaderboard();
    }

    const data = await this.fetchCSV(this.SHEETS.LEADERBOARD);
    
    if (!data) {
      return this.getMockLeaderboard();
    }

    this.cache.leaderboard = data;
    return data;
  },

  /**
   * Save user progress to Google Sheets
   * Note: This requires a backend API or Google Sheets API
   * For now, we'll use localStorage
   */
  async saveUserProgress(userEmail, progressData) {
    console.log('[API] Saving progress for:', userEmail);
    
    // Store in localStorage for now
    const key = `user_progress_${userEmail}`;
    localStorage.setItem(key, JSON.stringify(progressData));
    
    // TODO: Implement actual Google Sheets write via API
    // This would require a backend endpoint or Apps Script
    
    return true;
  },

  /**
   * Load user progress from storage
   */
  async getUserProgress(userEmail) {
    console.log('[API] Loading progress for:', userEmail);
    
    const key = `user_progress_${userEmail}`;
    const data = localStorage.getItem(key);
    
    if (data) {
      return JSON.parse(data);
    }
    
    // Return default progress structure
    return {
      email: userEmail,
      totalXP: 0,
      level: 1,
      videosWatched: [],
      assessmentsPassed: [],
      assessmentScores: {},
      achievements: [],
      streak: { current: 0, longest: 0, lastActive: null },
      stats: {
        totalVideos: 0,
        totalAssessments: 0,
        averageScore: 0
      },
      history: []
    };
  },

  // ═══════════════════════════════════════════════════════════════
  // MOCK DATA (for testing without Google Sheets configured)
  // ═══════════════════════════════════════════════════════════════

  getMockProcesses() {
    return [
      {
        Process_Name: 'RTO Bagging',
        URL_Module: 'rto',
        Start_Tab: 'RTO',
        Video_Link: 'https://www.youtube.com/watch?v=demo1',
        Platform: 'Log10',
        Priority: 'MUST_KNOW',
        Status: 'NEW',
        Date_Added: '2026-03-01',
        Date_Updated: '2026-03-01',
        Version: '1.0',
        Completion_Required: 'TRUE'
      },
      {
        Process_Name: 'Misroute Bagging',
        URL_Module: 'inventory',
        Start_Tab: 'Inventory',
        Video_Link: 'https://www.youtube.com/watch?v=demo2',
        Platform: 'Log10',
        Priority: 'GOOD_TO_KNOW',
        Status: 'UPDATED',
        Date_Added: '2026-02-15',
        Date_Updated: '2026-03-02',
        Version: '1.2',
        Completion_Required: 'FALSE'
      }
    ];
  },

  getMockQuestions(processName) {
    const questionBank = {
      'RTO Bagging': [
        {
          process_name: 'RTO Bagging',
          version: '1.0',
          question_id: 'rto_q1',
          type: 'mcq',
          question: 'What is the first step in RTO Bagging?',
          option_a: 'Create Manifest',
          option_b: 'Scan Shipments',
          option_c: 'Navigate to RTO Tab',
          option_d: 'Lock Manifest',
          correct_index: '2',
          model_answer: '',
          points: '20'
        },
        {
          process_name: 'RTO Bagging',
          version: '1.0',
          question_id: 'rto_q2',
          type: 'mcq',
          question: 'When should you lock the manifest?',
          option_a: 'Before scanning',
          option_b: 'After all shipments scanned',
          option_c: 'Any time',
          option_d: 'Never',
          correct_index: '1',
          model_answer: '',
          points: '20'
        },
        {
          process_name: 'RTO Bagging',
          version: '1.0',
          question_id: 'rto_q3',
          type: 'subjective',
          question: 'Explain why RTO shipments must be bagged separately.',
          option_a: '',
          option_b: '',
          option_c: '',
          option_d: '',
          correct_index: '',
          model_answer: 'RTO shipments are bagged separately to prevent mixing with forward shipments, which could cause delivery to wrong addresses and customer complaints.',
          points: '30'
        }
      ],
      'Misroute Bagging': [
        {
          process_name: 'Misroute Bagging',
          version: '1.2',
          question_id: 'mis_q1',
          type: 'mcq',
          question: 'What is a misroute shipment?',
          option_a: 'Delivered to wrong address',
          option_b: 'Sent to wrong hub',
          option_c: 'Damaged shipment',
          option_d: 'RTO shipment',
          correct_index: '1',
          model_answer: '',
          points: '20'
        }
      ]
    };

    return questionBank[processName] || [];
  },

  getMockLeaderboard() {
    return [
      { email: 'alice@valmo.com', name: 'Alice Kumar', totalXP: '1250', level: '8', videosCompleted: '10', assessmentsPassed: '10', streak: '7' },
      { email: 'bob@valmo.com', name: 'Bob Singh', totalXP: '980', level: '7', videosCompleted: '9', assessmentsPassed: '8', streak: '5' },
      { email: 'charlie@valmo.com', name: 'Charlie Patel', totalXP: '750', level: '6', videosCompleted: '8', assessmentsPassed: '7', streak: '3' },
      { email: 'diana@valmo.com', name: 'Diana Sharma', totalXP: '620', level: '5', videosCompleted: '7', assessmentsPassed: '6', streak: '2' },
      { email: 'eve@valmo.com', name: 'Eve Reddy', totalXP: '450', level: '4', videosCompleted: '5', assessmentsPassed: '4', streak: '1' }
    ];
  }
};

// Make API globally accessible
window.API = API;

console.log('[API] Loaded');
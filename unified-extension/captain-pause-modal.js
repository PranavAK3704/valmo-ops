/**
 * captain-pause-modal.js - Pause Resolution Modal with Jarvis Integration
 * 
 * Shows when captain pauses a process with:
 * - Error/issue description
 * - Resolution options: Jarvis AI or Watch Video
 * - Embedded Jarvis chat
 * - Resolution tracking
 * - Satisfied/Resume flow
 */

class CaptainPauseModal {
  constructor() {
    this.currentPause = null;
    this.chatHistory = [];
    this.modalElement = null;
  }

  /**
   * Show pause modal
   */
  show(pauseData) {
    this.currentPause = pauseData;
    this.chatHistory = [];

    // Create modal if doesn't exist
    if (!this.modalElement) {
      this.createModal();
    }

    // Reset modal state
    this.resetModal();

    // Show issue description
    this.showIssueStep(pauseData.reason);

    // Display modal
    this.modalElement.classList.add('visible');
    document.body.style.overflow = 'hidden'; // Prevent background scroll
  }

  /**
   * Create modal DOM
   */
  createModal() {
    const modal = document.createElement('div');
    modal.id = 'captain-pause-modal';
    modal.className = 'captain-pause-modal';
    modal.innerHTML = `
      <div class="captain-pause-backdrop"></div>
      <div class="captain-pause-container">
        
        <!-- Header -->
        <div class="captain-pause-header">
          <div class="captain-pause-icon">⏸️</div>
          <h2 class="captain-pause-title">Process Paused</h2>
          <button class="captain-pause-close" id="pause-modal-close">✕</button>
        </div>

        <!-- Step 1: Issue Description -->
        <div class="captain-pause-step" id="pause-step-issue">
          <div class="captain-pause-issue">
            <h3>What issue are you facing?</h3>
            <textarea 
              id="pause-issue-input" 
              class="captain-pause-textarea"
              placeholder="Describe the problem or question..."
              rows="4"
            ></textarea>
            <button class="captain-pause-btn captain-pause-btn-primary" id="pause-issue-submit">
              Continue →
            </button>
          </div>
        </div>

        <!-- Step 2: Resolution Options -->
        <div class="captain-pause-step" id="pause-step-options" style="display: none;">
          <div class="captain-pause-issue-display">
            <strong>Issue:</strong> <span id="pause-issue-text"></span>
          </div>

          <h3 class="captain-pause-options-title">How would you like to resolve this?</h3>

          <div class="captain-pause-options">
            <button class="captain-pause-option" id="pause-option-jarvis">
              <div class="captain-pause-option-icon">🤖</div>
              <div class="captain-pause-option-content">
                <strong>Ask Jarvis AI</strong>
                <span>Get instant answers from AI</span>
              </div>
            </button>

            <button class="captain-pause-option" id="pause-option-video">
              <div class="captain-pause-option-icon">🎥</div>
              <div class="captain-pause-option-content">
                <strong>Watch Training Video</strong>
                <span>Review the process guide</span>
              </div>
            </button>
          </div>

          <button class="captain-pause-btn captain-pause-btn-secondary" id="pause-back-to-issue">
            ← Back
          </button>
        </div>

        <!-- Step 3: Jarvis Chat -->
        <div class="captain-pause-step" id="pause-step-jarvis" style="display: none;">
          <div class="captain-pause-issue-display">
            <strong>Issue:</strong> <span id="pause-issue-text-jarvis"></span>
          </div>

          <div class="captain-pause-chat">
            <div class="captain-pause-chat-header">
              <div class="captain-pause-chat-icon">🤖</div>
              <strong>Jarvis AI</strong>
            </div>

            <div class="captain-pause-chat-messages" id="pause-chat-messages">
              <div class="captain-pause-chat-message captain-pause-chat-assistant">
                <div class="captain-pause-chat-bubble">
                  Hi! I can help you with that. Let me look into it...
                </div>
              </div>
            </div>

            <div class="captain-pause-chat-input-container">
              <input 
                type="text" 
                id="pause-chat-input" 
                class="captain-pause-chat-input"
                placeholder="Ask a follow-up question..."
              />
              <button class="captain-pause-chat-send" id="pause-chat-send">Send</button>
            </div>
          </div>

          <div class="captain-pause-resolution">
            <p>Did this help resolve your issue?</p>
            <div class="captain-pause-resolution-btns">
              <button class="captain-pause-btn captain-pause-btn-success" id="pause-resolved-yes">
                ✓ Yes, Resume Process
              </button>
              <button class="captain-pause-btn captain-pause-btn-secondary" id="pause-resolved-no">
                ✕ No, Try Video
              </button>
            </div>
          </div>

          <button class="captain-pause-btn captain-pause-btn-text" id="pause-back-to-options">
            ← Back to Options
          </button>
        </div>

        <!-- Step 4: Video Option -->
        <div class="captain-pause-step" id="pause-step-video" style="display: none;">
          <div class="captain-pause-issue-display">
            <strong>Issue:</strong> <span id="pause-issue-text-video"></span>
          </div>

          <div class="captain-pause-video-info">
            <div class="captain-pause-video-icon">🎥</div>
            <h3>Training Video</h3>
            <p id="pause-video-process-name"></p>
            <button class="captain-pause-btn captain-pause-btn-primary" id="pause-open-video">
              Open Training Video →
            </button>
          </div>

          <div class="captain-pause-resolution">
            <p>After watching the video:</p>
            <div class="captain-pause-resolution-btns">
              <button class="captain-pause-btn captain-pause-btn-success" id="pause-video-resolved">
                ✓ Issue Resolved, Resume
              </button>
              <button class="captain-pause-btn captain-pause-btn-secondary" id="pause-video-not-resolved">
                ✕ Still Need Help
              </button>
            </div>
          </div>

          <button class="captain-pause-btn captain-pause-btn-text" id="pause-back-from-video">
            ← Back to Options
          </button>
        </div>

      </div>
    `;

    document.body.appendChild(modal);
    this.modalElement = modal;

    // Attach event listeners
    this.attachEventListeners();

    console.log('[Pause Modal] ✅ Modal created');
  }

  /**
   * Attach event listeners
   */
  attachEventListeners() {
    // Close button
    document.getElementById('pause-modal-close')?.addEventListener('click', () => {
      this.hide();
    });

    // Step 1: Issue submit
    document.getElementById('pause-issue-submit')?.addEventListener('click', () => {
      this.submitIssue();
    });

    // Step 2: Resolution options
    document.getElementById('pause-option-jarvis')?.addEventListener('click', () => {
      this.showJarvisStep();
    });

    document.getElementById('pause-option-video')?.addEventListener('click', () => {
      this.showVideoStep();
    });

    document.getElementById('pause-back-to-issue')?.addEventListener('click', () => {
      this.showIssueStep();
    });

    // Step 3: Jarvis chat
    document.getElementById('pause-chat-send')?.addEventListener('click', () => {
      this.sendChatMessage();
    });

    document.getElementById('pause-chat-input')?.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') {
        this.sendChatMessage();
      }
    });

    document.getElementById('pause-resolved-yes')?.addEventListener('click', () => {
      this.resumeProcess('jarvis', true);
    });

    document.getElementById('pause-resolved-no')?.addEventListener('click', () => {
      this.showVideoStep();
    });

    document.getElementById('pause-back-to-options')?.addEventListener('click', () => {
      this.showOptionsStep();
    });

    // Step 4: Video
    document.getElementById('pause-open-video')?.addEventListener('click', () => {
      this.openVideo();
    });

    document.getElementById('pause-video-resolved')?.addEventListener('click', () => {
      this.resumeProcess('video', true);
    });

    document.getElementById('pause-video-not-resolved')?.addEventListener('click', () => {
      this.showJarvisStep();
    });

    document.getElementById('pause-back-from-video')?.addEventListener('click', () => {
      this.showOptionsStep();
    });

    // Backdrop click
    this.modalElement.querySelector('.captain-pause-backdrop')?.addEventListener('click', () => {
      // Don't close on backdrop click - force captain to resolve
    });
  }

  /**
   * Reset modal to initial state
   */
  resetModal() {
    // Clear issue input
    document.getElementById('pause-issue-input').value = '';

    // Clear chat
    this.chatHistory = [];
    const messagesEl = document.getElementById('pause-chat-messages');
    if (messagesEl) {
      messagesEl.innerHTML = `
        <div class="captain-pause-chat-message captain-pause-chat-assistant">
          <div class="captain-pause-chat-bubble">
            Hi! I can help you with that. Let me look into it...
          </div>
        </div>
      `;
    }

    // Clear chat input
    document.getElementById('pause-chat-input').value = '';
  }

  /**
   * Show issue description step
   */
  showIssueStep(existingReason = '') {
    this.hideAllSteps();
    document.getElementById('pause-step-issue').style.display = 'block';

    if (existingReason) {
      document.getElementById('pause-issue-input').value = existingReason;
    }
  }

  /**
   * Submit issue and show options
   */
  submitIssue() {
    const issueInput = document.getElementById('pause-issue-input');
    const issue = issueInput.value.trim();

    if (!issue) {
      alert('Please describe the issue');
      return;
    }

    // Update current pause reason
    if (this.currentPause) {
      this.currentPause.reason = issue;
    }

    // Show options step
    this.showOptionsStep();
  }

  /**
   * Show resolution options step
   */
  showOptionsStep() {
    this.hideAllSteps();
    document.getElementById('pause-step-options').style.display = 'block';

    // Display issue
    const issue = this.currentPause?.reason || 'Unknown issue';
    document.getElementById('pause-issue-text').textContent = issue;
  }

  /**
   * Show Jarvis chat step
   */
  async showJarvisStep() {
    this.hideAllSteps();
    document.getElementById('pause-step-jarvis').style.display = 'block';

    // Display issue
    const issue = this.currentPause?.reason || 'Unknown issue';
    document.getElementById('pause-issue-text-jarvis').textContent = issue;

    // Auto-send first query
    if (this.chatHistory.length === 0) {
      await this.sendInitialQuery(issue);
    }
  }

  /**
   * Send initial query to Jarvis
   */
  async sendInitialQuery(query) {
    // Add user message to chat
    this.addChatMessage('user', query);

    // Get current process context
    const session = window.captainTimerSystem?.getCurrentSession();
    const processName = session?.process_name || 'Unknown Process';

    // Call Jarvis (placeholder - integrate with your actual Jarvis API)
    const response = await this.callJarvis(query, processName);

    // Add assistant response
    this.addChatMessage('assistant', response);

    // Save to history
    this.chatHistory.push({ query, response, satisfied: null });
  }

  /**
   * Send chat message
   */
  async sendChatMessage() {
    const input = document.getElementById('pause-chat-input');
    const message = input.value.trim();

    if (!message) return;

    // Clear input
    input.value = '';

    // Add user message
    this.addChatMessage('user', message);

    // Get response
    const session = window.captainTimerSystem?.getCurrentSession();
    const processName = session?.process_name || 'Unknown Process';
    const response = await this.callJarvis(message, processName);

    // Add assistant response
    this.addChatMessage('assistant', response);

    // Save to history
    this.chatHistory.push({ query: message, response, satisfied: null });
  }

  /**
   * Add message to chat
   */
  addChatMessage(role, text) {
    const messagesEl = document.getElementById('pause-chat-messages');
    if (!messagesEl) return;

    const messageDiv = document.createElement('div');
    messageDiv.className = `captain-pause-chat-message captain-pause-chat-${role}`;
    messageDiv.innerHTML = `
      <div class="captain-pause-chat-bubble">
        ${this.escape(text)}
      </div>
    `;

    messagesEl.appendChild(messageDiv);

    // Scroll to bottom
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  /**
   * Call Jarvis API (placeholder - integrate with your actual implementation)
   */
  async callJarvis(query, processContext) {
    // TODO: Replace with actual Jarvis API call
    // For now, return a mock response

    console.log('[Pause Modal] Jarvis Query:', query, 'Context:', processContext);

    // Simulate API delay
    await new Promise(resolve => setTimeout(resolve, 1000));

    // Mock response
    return `I understand you need help with "${query}" for the ${processContext} process. Here's what you should do:\n\n1. Check the process guidelines\n2. Verify all inputs are correct\n3. If the issue persists, escalate to supervisor\n\nDoes this help?`;
  }

  /**
   * Show video step
   */
  showVideoStep() {
    this.hideAllSteps();
    document.getElementById('pause-step-video').style.display = 'block';

    // Display issue
    const issue = this.currentPause?.reason || 'Unknown issue';
    document.getElementById('pause-issue-text-video').textContent = issue;

    // Get process name
    const session = window.captainTimerSystem?.getCurrentSession();
    const processName = session?.process_name || 'Unknown Process';
    document.getElementById('pause-video-process-name').textContent = processName;
  }

  /**
   * Open training video
   */
  openVideo() {
    // Get current process
    const session = window.captainTimerSystem?.getCurrentSession();
    if (!session) return;

    // Find video link from all processes
    const allProcesses = window.captainTimerSystem?.allProcesses || [];
    const process = allProcesses.find(p => p.process_name === session.process_name);

    if (process && process.video_link) {
      window.open(process.video_link, '_blank');
      console.log('[Pause Modal] Opened video:', process.video_link);
    } else {
      alert('Video not available for this process');
    }
  }

  /**
   * Resume process after resolution
   */
  async resumeProcess(method, successful) {
    // Prepare additional data
    const additionalData = {};

    if (method === 'jarvis') {
      additionalData.chatTranscript = this.chatHistory;
    } else if (method === 'video') {
      const session = window.captainTimerSystem?.getCurrentSession();
      const allProcesses = window.captainTimerSystem?.allProcesses || [];
      const process = allProcesses.find(p => p.process_name === session?.process_name);
      additionalData.videoWatched = process?.video_link || 'Unknown';
    }

    // Resume in timer system
    await window.captainTimerSystem.resumeProcess(method, successful, additionalData);

    // Hide modal
    this.hide();

    // Refresh timer tab UI so status/buttons reflect running state
    window.processTimerTab?.updateUI();

    // Notify user
    if (successful) {
      this.showSuccessToast('Process resumed successfully!');
    }

    console.log('[Pause Modal] Resumed via', method, 'successful:', successful);
  }

  /**
   * Hide all steps
   */
  hideAllSteps() {
    document.getElementById('pause-step-issue').style.display = 'none';
    document.getElementById('pause-step-options').style.display = 'none';
    document.getElementById('pause-step-jarvis').style.display = 'none';
    document.getElementById('pause-step-video').style.display = 'none';
  }

  /**
   * Hide modal
   */
  hide() {
    if (this.modalElement) {
      this.modalElement.classList.remove('visible');
      document.body.style.overflow = ''; // Restore scroll
    }
  }

  /**
   * Show success toast
   */
  showSuccessToast(message) {
    const toast = document.createElement('div');
    toast.className = 'captain-pause-toast';
    toast.textContent = message;
    document.body.appendChild(toast);

    setTimeout(() => toast.classList.add('visible'), 10);

    setTimeout(() => {
      toast.classList.remove('visible');
      setTimeout(() => toast.remove(), 300);
    }, 3000);
  }

  /**
   * Escape HTML
   */
  escape(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }
}

// Global instance
window.captainPauseModal = new CaptainPauseModal();

console.log('[Pause Modal] Script loaded');
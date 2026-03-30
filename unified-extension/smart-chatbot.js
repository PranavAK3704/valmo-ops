/**
 * smart-chatbot.js
 *
 * Priority:  1. Jarvis (JARVIS_CONFIG.enabled = true)
 *            2. Groq   (always available as fallback)
 *            3. Keyword search (when both APIs fail)
 *
 * To plug in Jarvis: set JARVIS_CONFIG.enabled = true and fill in
 * endpoint + api_key in config.js. No other changes needed.
 */

class SmartChatbot {
  constructor(sopData, agentName = '', commonQueries = []) {
    this.sopData = sopData;
    this.agentName = agentName;
    this.commonQueries = commonQueries;
    this.conversationHistory = [];
  }

  // ── Public entry point ───────────────────────────────────────────

  async ask(question) {
    const sopContext = this.buildSOPContext();
    const userPrompt = `Question: ${question}\n\nAvailable SOPs:\n${sopContext}\n\nAnswer based on the SOPs. If not found, say so clearly.`;

    // 1. Try Jarvis if configured
    if (typeof JARVIS_CONFIG !== 'undefined' && JARVIS_CONFIG.enabled) {
      const result = await this._askJarvis(userPrompt);
      if (result.success) {
        this._updateHistory(userPrompt, result.answer);
        return result;
      }
      console.warn('[SmartChatbot] Jarvis unavailable — falling back to Groq');
    }

    // 2. Fall back to Groq
    return await this._askGroq(userPrompt);
  }

  // ── Jarvis adapter (OpenAI-compatible) ──────────────────────────

  async _askJarvis(userPrompt) {
    try {
      const systemPrompt = this._buildSystemPrompt();
      const response = await fetch(`${JARVIS_CONFIG.endpoint}/v1/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${JARVIS_CONFIG.api_key}`
        },
        body: JSON.stringify({
          model: JARVIS_CONFIG.model || 'jarvis',
          messages: [
            { role: 'system', content: systemPrompt },
            ...this.conversationHistory,
            { role: 'user', content: userPrompt }
          ],
          max_tokens: 1000,
          temperature: 0.3
        })
      });

      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(`Jarvis ${response.status}: ${err.error?.message || 'error'}`);
      }

      const data = await response.json();
      const answer = data.choices[0].message.content;
      return { success: true, answer, type: 'jarvis' };

    } catch (error) {
      console.error('[SmartChatbot] Jarvis error:', error.message);
      return { success: false, error: error.message, type: 'jarvis_failed' };
    }
  }

  // ── Groq adapter ────────────────────────────────────────────────

  async _askGroq(userPrompt) {
    try {
      const systemPrompt = this._buildSystemPrompt();
      const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${CHATBOT_CONFIG.api_key}`
        },
        body: JSON.stringify({
          model: 'llama-3.3-70b-versatile',
          messages: [
            { role: 'system', content: systemPrompt },
            ...this.conversationHistory,
            { role: 'user', content: userPrompt }
          ],
          max_tokens: 1000,
          temperature: 0.3
        })
      });

      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(`Groq ${response.status}: ${err.error?.message || 'error'}`);
      }

      const data = await response.json();
      const answer = data.choices[0].message.content;
      this._updateHistory(userPrompt, answer);
      return { success: true, answer, type: 'groq' };

    } catch (error) {
      console.error('[SmartChatbot] Groq error:', error.message);
      return { success: false, error: error.message, type: 'fallback' };
    }
  }

  // ── Helpers ─────────────────────────────────────────────────────

  _buildSystemPrompt() {
    const agentContext = this.commonQueries.length > 0
      ? `\n\nThis agent (${this.agentName}) frequently asks about: ${this.commonQueries.join(', ')}. Be especially warm and proactive about these topics.`
      : (this.agentName ? `\n\nYou are assisting agent: ${this.agentName}.` : '');
    return CHATBOT_CONFIG.system_prompt + agentContext;
  }

  _updateHistory(userPrompt, answer) {
    this.conversationHistory.push(
      { role: 'user', content: userPrompt },
      { role: 'assistant', content: answer }
    );
    if (this.conversationHistory.length > 4) {
      this.conversationHistory = this.conversationHistory.slice(-4);
    }
  }

  buildSOPContext() {
    const lines = [];
    Object.entries(this.sopData).forEach(([category, sops]) => {
      lines.push(`\n=== ${category} ===\n`);
      sops.forEach((sop, index) => {
        lines.push(`${index + 1}. ${sop.scenario}`);
        lines.push(`   Process: ${sop.process.substring(0, 400)}...`);
        lines.push(`   Escalate to: ${sop.escalateTo}`);
        lines.push(`   Required inputs: ${sop.inputs}`);
        lines.push('');
      });
    });
    return lines.join('\n');
  }

  clearHistory() {
    this.conversationHistory = [];
  }
}

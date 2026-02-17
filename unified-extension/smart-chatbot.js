/**
 * smart-chatbot.js - Groq-powered intelligent chatbot
 * 
 * Uses Groq API (Llama 3.1) to understand natural language questions
 * and provide contextual answers from SOPs
 */

class SmartChatbot {
  constructor(sopData) {
    this.sopData = sopData;
    this.conversationHistory = [];
  }
  
  /**
   * Ask a question and get an intelligent answer
   */
  async ask(question) {
    // Build context from all SOPs
    const sopContext = this.buildSOPContext();
    
    // Create the prompt
    const userPrompt = `Question: ${question}

Available SOPs:
${sopContext}

Please answer the question based on the SOPs above. If the information isn't in the SOPs, say so clearly.`;
    
    try {
      // Call Groq API
      const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${CHATBOT_CONFIG.api_key}`
        },
        body: JSON.stringify({
          model: "llama-3.3-70b-versatile",
          messages: [
            {
              role: "system",
              content: CHATBOT_CONFIG.system_prompt
            },
            ...this.conversationHistory,
            {
              role: "user",
              content: userPrompt
            }
          ],
          max_tokens: 1000,
          temperature: 0.3
        })
      });
      
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(`API error: ${response.status} - ${errorData.error?.message || 'Unknown error'}`);
      }
      
      const data = await response.json();
      
      // Extract text from response
      const answer = data.choices[0].message.content;
      
      // Update conversation history
      this.conversationHistory.push(
        { role: "user", content: userPrompt },
        { role: "assistant", content: answer }
      );
      
      // Keep only last 4 messages (2 exchanges) to avoid context overflow
      if (this.conversationHistory.length > 4) {
        this.conversationHistory = this.conversationHistory.slice(-4);
      }
      
      return {
        success: true,
        answer: answer,
        type: 'smart'
      };
      
    } catch (error) {
      console.error('[Smart Chatbot] Error calling Groq API:', error);
      
      // Fallback to keyword search
      return {
        success: false,
        error: error.message,
        type: 'fallback'
      };
    }
  }
  
  /**
   * Build a text context from all SOPs
   */
  buildSOPContext() {
    const lines = [];
    
    Object.entries(this.sopData).forEach(([category, sops]) => {
      lines.push(`\n=== ${category} ===\n`);
      
      sops.forEach((sop, index) => {
        lines.push(`${index + 1}. ${sop.scenario}`);
        lines.push(`   Process: ${sop.process.substring(0, 400)}...`); // Truncate long processes
        lines.push(`   Escalate to: ${sop.escalateTo}`);
        lines.push(`   Required inputs: ${sop.inputs}`);
        lines.push('');
      });
    });
    
    return lines.join('\n');
  }
  
  /**
   * Clear conversation history
   */
  clearHistory() {
    this.conversationHistory = [];
  }
}
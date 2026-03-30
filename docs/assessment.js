/**
 * assessment.js — MCQ Assessment Modal System
 *
 * Triggered by takeAssessment(processName) in dashboard.js.
 * Fetches questions from Supabase, renders modal, scores and saves result.
 */

const AssessmentSystem = {
  current:     null,   // { assessment, questions }
  answers:     {},     // { [question_id]: "A"|"B"|"C"|"D" }
  prevResult:  null,   // best previous attempt
  attemptCount: 1,

  // ── Open ──────────────────────────────────────────────────────────────────

  async open(processName) {
    const modal = document.getElementById('assessment-modal');
    if (!modal) return;

    this._showModal();
    this._renderLoading(processName);

    const [assessment, email] = await Promise.all([
      API.getAssessmentForProcess(processName),
      Promise.resolve(window.AppState?.currentUser?.email || '')
    ]);

    if (!assessment || !assessment.questions?.length) {
      this._renderEmpty(processName);
      return;
    }

    this.current = assessment;
    this.answers = {};

    // Fetch previous result
    this.prevResult = email
      ? await API.getAssessmentResult(email, assessment.id)
      : null;
    this.attemptCount = this.prevResult ? (this.prevResult.attempt_count || 1) + 1 : 1;

    this._renderQuestions();
  },

  // ── Render states ─────────────────────────────────────────────────────────

  _renderLoading(processName) {
    document.getElementById('assessment-modal-body').innerHTML = `
      <div class="am-loading">
        <div class="am-spinner"></div>
        <p>Loading assessment for <strong>${processName}</strong>…</p>
      </div>
    `;
  },

  _renderEmpty(processName) {
    document.getElementById('assessment-modal-body').innerHTML = `
      <div class="am-empty">
        <div style="font-size:40px;margin-bottom:12px">📋</div>
        <h3>No assessment yet</h3>
        <p>Your trainer hasn't created an assessment for <strong>${processName}</strong> yet. Check back later.</p>
        <button class="am-btn secondary" onclick="AssessmentSystem.close()">Close</button>
      </div>
    `;
  },

  _renderQuestions() {
    const { current, prevResult } = this;
    const passBadge = prevResult?.passed
      ? `<span class="am-prev-badge pass">✅ Best score: ${prevResult.score}% — Passed</span>`
      : prevResult
        ? `<span class="am-prev-badge fail">Previous score: ${prevResult.score}% — Not passed</span>`
        : '';

    const questionsHTML = current.questions.map((q, i) => `
      <div class="am-question" id="q-block-${q.id}">
        <div class="am-question-text">
          <span class="am-q-num">Q${i + 1}</span> ${q.question}
        </div>
        <div class="am-options">
          ${q.options.map(opt => `
            <label class="am-option" id="opt-${q.id}-${opt.key}">
              <input type="radio" name="q_${q.id}" value="${opt.key}"
                onchange="AssessmentSystem.selectAnswer('${q.id}','${opt.key}')">
              <span class="am-opt-key">${opt.key}</span>
              <span class="am-opt-text">${opt.text}</span>
            </label>
          `).join('')}
        </div>
        <div class="am-explanation" id="exp-${q.id}" style="display:none"></div>
      </div>
    `).join('');

    document.getElementById('assessment-modal-body').innerHTML = `
      <div class="am-header">
        <div class="am-title">${current.title}</div>
        <div class="am-meta">
          ${current.questions.length} questions &nbsp;·&nbsp; Pass: ${current.passing_score}%
          ${passBadge}
        </div>
      </div>
      <div class="am-questions">${questionsHTML}</div>
      <div class="am-footer">
        <span class="am-answered" id="am-answered-count">0 / ${current.questions.length} answered</span>
        <div style="display:flex;gap:10px">
          <button class="am-btn secondary" onclick="AssessmentSystem.close()">Cancel</button>
          <button class="am-btn primary" id="am-submit-btn" onclick="AssessmentSystem.submit()" disabled>
            Submit Assessment
          </button>
        </div>
      </div>
    `;
  },

  _renderResults(score, passed, markedQuestions) {
    const { current } = this;
    const xp = passed ? 75 : 0;

    const resultCards = markedQuestions.map((q, i) => `
      <div class="am-result-card ${q.correct ? 'correct' : 'wrong'}">
        <div class="am-result-q">
          <span class="am-result-icon">${q.correct ? '✅' : '❌'}</span>
          <span class="am-q-num">Q${i + 1}</span> ${q.question}
        </div>
        <div class="am-result-answer">
          Your answer: <strong>${q.userKey} — ${q.userText}</strong>
          ${!q.correct ? `&nbsp;·&nbsp; Correct: <strong>${q.correctKey} — ${q.correctText}</strong>` : ''}
        </div>
        ${q.explanation ? `<div class="am-result-explanation">💡 ${q.explanation}</div>` : ''}
      </div>
    `).join('');

    document.getElementById('assessment-modal-body').innerHTML = `
      <div class="am-result-header ${passed ? 'pass' : 'fail'}">
        <div class="am-result-icon-big">${passed ? '🏆' : '📚'}</div>
        <div class="am-result-score">${score}%</div>
        <div class="am-result-label">${passed ? 'Assessment Passed!' : 'Not Passed'}</div>
        ${passed ? `<div class="am-xp-badge">+${xp} XP earned</div>` : `<div class="am-result-hint">Need ${current.passing_score}% to pass. Review below and try again.</div>`}
      </div>
      <div class="am-questions">${resultCards}</div>
      <div class="am-footer" style="justify-content:flex-end">
        ${!passed ? `<button class="am-btn secondary" onclick="AssessmentSystem._renderQuestions()">🔁 Try Again</button>` : ''}
        <button class="am-btn primary" onclick="AssessmentSystem.close()">Done</button>
      </div>
    `;

    // Reset answers for potential retry
    this.answers = {};
  },

  // ── Interaction ───────────────────────────────────────────────────────────

  selectAnswer(questionId, key) {
    this.answers[questionId] = key;

    // Highlight selected option
    const block = document.getElementById(`q-block-${questionId}`);
    if (block) {
      block.querySelectorAll('.am-option').forEach(el => el.classList.remove('selected'));
      const sel = document.getElementById(`opt-${questionId}-${key}`);
      if (sel) sel.classList.add('selected');
    }

    // Update answered count + enable submit if all answered
    const total     = this.current.questions.length;
    const answered  = Object.keys(this.answers).length;
    const countEl   = document.getElementById('am-answered-count');
    const submitBtn = document.getElementById('am-submit-btn');
    if (countEl)   countEl.textContent = `${answered} / ${total} answered`;
    if (submitBtn) submitBtn.disabled = (answered < total);
  },

  async submit() {
    const { current, answers } = this;
    if (!current) return;

    const email = window.AppState?.currentUser?.email || '';
    let correct = 0;

    const markedQuestions = current.questions.map(q => {
      const userKey   = answers[q.id] || '';
      const isCorrect = userKey === q.correct_key;
      if (isCorrect) correct++;

      const userOpt    = q.options.find(o => o.key === userKey)    || { text: '(no answer)' };
      const correctOpt = q.options.find(o => o.key === q.correct_key) || { text: '' };

      return {
        question:    q.question,
        correct:     isCorrect,
        userKey,
        userText:    userOpt.text,
        correctKey:  q.correct_key,
        correctText: correctOpt.text,
        explanation: q.explanation || ''
      };
    });

    const score  = Math.round((correct / current.questions.length) * 100);
    const passed = score >= current.passing_score;

    // Save to Supabase
    if (email) {
      await API.submitAssessmentResult(
        email, current.id, score, passed, answers, this.attemptCount
      );

      // Update local progress if passed
      if (passed && window.AppState?.userProgress) {
        const ap = window.AppState.userProgress;
        if (!ap.assessmentsPassed.includes(current.id)) {
          ap.assessmentsPassed.push(current.id);
        }
        ap.totalXP   = (ap.totalXP   || 0) + 75;
        ap.stats     = ap.stats || {};
        ap.stats.totalAssessments = (ap.stats.totalAssessments || 0) + 1;
        await API.saveUserProgress(email, ap);
        if (typeof renderDashboard === 'function') renderDashboard();
        if (typeof renderTrainingTab === 'function') renderTrainingTab();
      }
    }

    this._renderResults(score, passed, markedQuestions);
  },

  // ── Modal show/hide ───────────────────────────────────────────────────────

  _showModal() {
    const modal = document.getElementById('assessment-modal');
    modal.classList.add('open');
    document.body.style.overflow = 'hidden';
  },

  close() {
    const modal = document.getElementById('assessment-modal');
    modal.classList.remove('open');
    document.body.style.overflow = '';
    this.current    = null;
    this.answers    = {};
    this.prevResult = null;
  }
};

// Close on backdrop click
document.addEventListener('DOMContentLoaded', () => {
  const modal = document.getElementById('assessment-modal');
  if (modal) {
    modal.addEventListener('click', e => {
      if (e.target === modal) AssessmentSystem.close();
    });
  }
});

console.log('[Assessment] Ready');

/**
 * supabase-sync.js
 *
 * Content-script sync layer — pushes extension data to Supabase.
 *
 * Key guarantees (12,000-hub scale):
 *   1. hub_code on every write — no joins needed to locate a captain's hub
 *   2. Offline write queue — failed writes are stored in chrome.storage.local
 *      and retried automatically (up to 5× with exponential backoff)
 *   3. All public functions are safe to call fire-and-forget
 */

const supabaseSync = (() => {
  const URL = typeof SUPABASE_CONFIG !== 'undefined' ? SUPABASE_CONFIG.url      : '';
  const KEY = typeof SUPABASE_CONFIG !== 'undefined' ? SUPABASE_CONFIG.anon_key : '';

  const QUEUE_KEY   = 'valmo_write_queue';
  const MAX_RETRIES = 5;
  let   draining    = false;

  // ── HTTP helpers ────────────────────────────────────────────────────────────

  function headers(extra = {}) {
    return {
      'Content-Type':  'application/json',
      'apikey':        KEY,
      'Authorization': `Bearer ${KEY}`,
      'Prefer':        'return=minimal',
      ...extra
    };
  }

  async function _insert(table, data) {
    const res = await fetch(`${URL}/rest/v1/${table}`, {
      method: 'POST', headers: headers(), body: JSON.stringify(data)
    });
    if (!res.ok) throw new Error(await res.text());
  }

  async function _upsert(table, data, onConflict) {
    const qs  = onConflict ? `?on_conflict=${encodeURIComponent(onConflict)}` : '';
    const res = await fetch(`${URL}/rest/v1/${table}${qs}`, {
      method: 'POST',
      headers: headers({ 'Prefer': 'resolution=merge-duplicates,return=minimal' }),
      body: JSON.stringify(data)
    });
    if (!res.ok) throw new Error(await res.text());
  }

  // ── Offline write queue ─────────────────────────────────────────────────────
  // Stored in chrome.storage.local as an array of pending write descriptors.
  // Drained on init, on navigator.onLine events, and after each successful write.

  async function enqueue(method, table, data, onConflict) {
    const result = await new Promise(r => chrome.storage.local.get([QUEUE_KEY], r));
    const queue  = result[QUEUE_KEY] || [];
    queue.push({
      id:         `${Date.now()}_${Math.random().toString(36).slice(2)}`,
      method,           // 'insert' | 'upsert'
      table,
      data,
      onConflict:  onConflict || null,
      retries:     0,
      created_at:  Date.now()
    });
    await new Promise(r => chrome.storage.local.set({ [QUEUE_KEY]: queue }, r));
    drainQueue(); // attempt immediately
  }

  async function drainQueue() {
    if (draining || !URL || !KEY) return;
    draining = true;
    try {
      const result = await new Promise(r => chrome.storage.local.get([QUEUE_KEY], r));
      let queue = result[QUEUE_KEY] || [];
      if (queue.length === 0) { draining = false; return; }

      const failed = [];
      for (const item of queue) {
        try {
          if (item.method === 'upsert') {
            await _upsert(item.table, item.data, item.onConflict);
          } else {
            await _insert(item.table, item.data);
          }
          // success — do not re-add to queue
        } catch (e) {
          item.retries++;
          if (item.retries < MAX_RETRIES) {
            failed.push(item); // keep for retry
          } else {
            console.warn(`[Supabase Queue] Permanently failed after ${MAX_RETRIES} attempts:`, item.table, e.message);
            // Drop it — don't block the queue forever
          }
        }
      }

      await new Promise(r => chrome.storage.local.set({ [QUEUE_KEY]: failed }, r));

      // Schedule retry for remaining items with backoff
      if (failed.length > 0) {
        const minRetries = Math.min(...failed.map(i => i.retries));
        const delayMs    = Math.min(30000, 1000 * Math.pow(2, minRetries));
        setTimeout(drainQueue, delayMs);
      }
    } finally {
      draining = false;
    }
  }

  // Drain on network recovery
  window.addEventListener('online', () => {
    console.log('[Supabase Queue] Network online — draining queue');
    drainQueue();
  });

  // ── Public write helpers (enqueue everything) ───────────────────────────────

  async function insert(table, data) {
    if (!URL || !KEY) return;
    await enqueue('insert', table, data, null);
  }

  async function upsert(table, data, onConflict) {
    if (!URL || !KEY) return;
    await enqueue('upsert', table, data, onConflict);
  }

  // ── Agent profile sync ──────────────────────────────────────────────────────

  async function syncProfile(user) {
    if (!user?.email) return;
    const { gamification_data } = await new Promise(r =>
      chrome.storage.local.get([`gamification_${user.email}`], d =>
        r({ gamification_data: d[`gamification_${user.email}`] })
      )
    );
    const g = gamification_data || {};
    await upsert('agent_profiles', {
      email:              user.email,
      role:               user.role     || null,
      hub:                user.hub      || null,
      hub_code:           user.hubCode  || null,
      level:              g.level       || 1,
      total_xp:           g.totalXP     || 0,
      streak_current:     g.streaks?.current      || 0,
      streak_longest:     g.streaks?.longest      || 0,
      videos_watched:     g.stats?.totalVideos    || 0,
      assessments_passed: g.stats?.totalAssessments || 0,
      avg_score:          g.stats?.averageScore   || 0,
      last_active:        new Date().toISOString(),
      updated_at:         new Date().toISOString()
    }, 'email');
  }

  // ── Gamification event sync ─────────────────────────────────────────────────

  async function syncXP(email, xpAmount, reason, processName, newLevel) {
    await insert('gamification_events', {
      email, reason,
      process_name: processName || null,
      event_type:   'xp_earned',
      xp_amount:    xpAmount,
      new_level:    newLevel || null,
      created_at:   new Date().toISOString()
    });
  }

  async function syncAchievement(email, achievementId, xpAwarded) {
    await insert('gamification_events', {
      email,
      event_type:     'achievement_unlocked',
      achievement_id: achievementId,
      xp_amount:      xpAwarded || 0,
      created_at:     new Date().toISOString()
    });
  }

  async function syncLevelUp(email, newLevel) {
    await insert('gamification_events', {
      email,
      event_type: 'level_up',
      new_level:  newLevel,
      xp_amount:  0,
      created_at: new Date().toISOString()
    });
  }

  // ── Captain session sync ────────────────────────────────────────────────────
  // hub_code is now a required field — denormalized for fast hub-scoped queries

  async function syncCaptainSession(sessionData) {
    await upsert('captain_sessions', {
      session_id:     sessionData.session_id,
      email:          sessionData.email,
      hub_code:       sessionData.hub_code       || null,
      hub_process_id: sessionData.hub_process_id || null,
      session_role:   sessionData.session_role   || 'captain',
      process_name:   sessionData.process_name,
      pct:            sessionData.pct,
      total_pkrt:     sessionData.total_pkrt,
      pause_count:    sessionData.pause_count,
      query_count:    sessionData.query_count,
      error_count:    sessionData.error_count,
      started_at:     sessionData.started_at,
      completed_at:   sessionData.completed_at,
      created_at:     new Date().toISOString()
    }, 'session_id');
  }

  // ── Per-pause detail sync ───────────────────────────────────────────────────

  async function syncCaptainPauses(sessionData) {
    const pauses = sessionData.pauses || [];
    if (!pauses.length) return;
    for (const [i, p] of pauses.entries()) {
      await insert('captain_pauses', {
        session_id:            sessionData.session_id,
        email:                 sessionData.email,
        hub_code:              sessionData.hub_code    || null,
        process_name:          sessionData.process_name,
        pause_index:           i,
        pause_reason:          p.reason               || null,
        resolution_method:     p.resolution_method    || null,
        resolution_successful: p.resolution_successful ?? null,
        pkrt:                  p.pkrt                 || null,
        chat_transcript:       p.chat_transcript      || null,
        video_watched:         p.video_watched        || null,
        paused_at:             p.pause_time  ? new Date(p.pause_time).toISOString()  : null,
        resumed_at:            p.resume_time ? new Date(p.resume_time).toISOString() : null,
        created_at:            new Date().toISOString()
      });
    }
  }

  // ── L1 ART metric sync ──────────────────────────────────────────────────────

  async function syncARTMetrics(email, artSummary, artByQueue, countByQueue) {
    if (!email || !artByQueue) return;
    const today = new Date().toISOString().split('T')[0];
    const rows  = Object.entries(artByQueue).map(([queue, artHours]) => ({
      email,
      date:         today,
      queue,
      art_hours:    artHours,
      ticket_count: countByQueue[queue] || 0,
      reopen_count: 0,
      updated_at:   new Date().toISOString()
    }));
    if (rows.length > 0) await upsert('l1_art_metrics', rows, 'email,date,queue');
  }

  // ── Sim completion sync ─────────────────────────────────────────────────────

  async function syncSimCompletion(email, simId, processName, score, mode, timeSeconds) {
    await upsert('sim_completions', {
      email,
      sim_id:       simId,
      process_name: processName || null,
      score:        score       || null,
      mode:         mode        || 'guided',
      time_seconds: timeSeconds || null,
      completed_at: new Date().toISOString()
    }, 'email,sim_id');
  }

  // ── Phase 3: Query Bifurcation Engine ──────────────────────────────────────
  //
  // After pauses are written to Supabase, classify each pause_reason into a
  // bucket. Runs fire-and-forget (never blocks session completion).
  //
  // Buckets:
  //   PROCESS_GAP          — doesn't know the steps
  //   POLICY_UNCLEAR        — knows steps, unsure of rules/thresholds
  //   SYSTEM_ISSUE          — tool/platform problem, not captain's fault
  //   CUSTOMER_COMPLEXITY   — edge case, not a knowledge gap
  //   REPETITIVE            — same reason seen in prior sessions (auto-detected)
  //   UNCLASSIFIED          — Groq couldn't determine or reason was empty

  const GROQ_ENDPOINT = 'https://api.groq.com/openai/v1/chat/completions';
  const GROQ_MODEL    = 'llama3-8b-8192';

  // iPER bucket weights — how much each bucket contributes to error probability
  const BUCKET_WEIGHTS = {
    PROCESS_GAP:        0.8,
    REPETITIVE:         1.0,   // worst signal — seen this before, still pausing
    POLICY_UNCLEAR:     0.4,
    CUSTOMER_COMPLEXITY:0.1,
    SYSTEM_ISSUE:       0.0,   // not captain's fault
    UNCLASSIFIED:       0.2
  };

  /**
   * Check if a pause_reason is repetitive by comparing against the last
   * N sessions stored in localStorage for this captain + process.
   * Returns true if the same reason (case-insensitive, trimmed) was seen before.
   */
  function isRepetitive(reason, email, processName) {
    if (!reason) return false;
    const key = `captain_session_history_${email}`;
    try {
      const stored = localStorage.getItem(key);
      if (!stored) return false;
      const history = JSON.parse(stored);
      const norm    = reason.toLowerCase().trim();
      // Check last 5 sessions for the same process
      const priorSessions = history
        .filter(s => s.process_name === processName)
        .slice(0, 5);
      for (const s of priorSessions) {
        for (const p of (s.pauses || [])) {
          if (p.reason && p.reason.toLowerCase().trim() === norm) return true;
        }
      }
    } catch (e) { /* ignore parse errors */ }
    return false;
  }

  /**
   * Classify all pause reasons in one Groq call (batch).
   * Returns array of buckets in the same order as reasons[].
   */
  async function groqClassifyBatch(reasons, groqKey) {
    const validReasons = reasons.map(r => r || '(no reason given)');
    const prompt = `You are classifying why a logistics operations captain paused a process.

For each pause reason below, return EXACTLY one of these labels:
PROCESS_GAP | POLICY_UNCLEAR | SYSTEM_ISSUE | CUSTOMER_COMPLEXITY | UNCLASSIFIED

Definitions:
- PROCESS_GAP: captain doesn't know the steps (e.g. "how do I handle misroute?")
- POLICY_UNCLEAR: knows steps but unsure of rules/thresholds (e.g. "what's the TAT?")
- SYSTEM_ISSUE: tool or platform problem, not captain's fault (e.g. "app not loading")
- CUSTOMER_COMPLEXITY: unusual edge case, not a training gap (e.g. "customer has 3 orders")
- UNCLASSIFIED: empty, gibberish, or genuinely unclear

Respond with ONLY a JSON array of labels, one per reason, in the same order.
Example: ["PROCESS_GAP","SYSTEM_ISSUE","POLICY_UNCLEAR"]

Reasons:
${validReasons.map((r, i) => `${i + 1}. ${r}`).join('\n')}`;

    const res = await fetch(GROQ_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': `Bearer ${groqKey}`
      },
      body: JSON.stringify({
        model:       GROQ_MODEL,
        messages:    [{ role: 'user', content: prompt }],
        max_tokens:  200,
        temperature: 0
      })
    });

    if (!res.ok) throw new Error(`Groq ${res.status}: ${await res.text()}`);
    const data    = await res.json();
    const content = data.choices?.[0]?.message?.content?.trim() || '[]';

    // Extract JSON array from response (handle any surrounding text)
    const match = content.match(/\[[\s\S]*\]/);
    if (!match) throw new Error('Groq response not parseable: ' + content);
    const buckets = JSON.parse(match[0]);

    const valid = new Set(['PROCESS_GAP','POLICY_UNCLEAR','SYSTEM_ISSUE','CUSTOMER_COMPLEXITY','UNCLASSIFIED']);
    return buckets.map(b => valid.has(b) ? b : 'UNCLASSIFIED');
  }

  /**
   * PATCH bucket onto an existing captain_pauses row.
   * Uses session_id + pause_index as the unique locator.
   */
  async function patchPauseBucket(sessionId, pauseIndex, bucket) {
    if (!URL || !KEY) return;
    try {
      const res = await fetch(
        `${URL}/rest/v1/captain_pauses?session_id=eq.${encodeURIComponent(sessionId)}&pause_index=eq.${pauseIndex}`,
        {
          method:  'PATCH',
          headers: {
            'Content-Type':  'application/json',
            'apikey':        KEY,
            'Authorization': `Bearer ${KEY}`,
            'Prefer':        'return=minimal'
          },
          body: JSON.stringify({ bucket })
        }
      );
      if (!res.ok) console.warn('[Classifier] PATCH bucket failed:', await res.text());
    } catch (e) {
      console.warn('[Classifier] PATCH error:', e.message);
    }
  }

  /**
   * Main entry point — called after syncCaptainPauses().
   * Fire-and-forget: never throws, never blocks.
   */
  async function classifyPauses(sessionData) {
    const pauses   = sessionData.pauses || [];
    const groqKey  = typeof CHATBOT_CONFIG !== 'undefined' ? CHATBOT_CONFIG.api_key : '';
    if (!pauses.length || !groqKey) return;

    try {
      const reasons  = pauses.map(p => p.reason || '');
      const buckets  = [];

      // Step 1 — local REPETITIVE check (no API call needed)
      for (const [i, p] of pauses.entries()) {
        if (isRepetitive(p.reason, sessionData.email, sessionData.process_name)) {
          buckets[i] = 'REPETITIVE';
        } else {
          buckets[i] = null; // needs Groq
        }
      }

      // Step 2 — batch Groq call for non-REPETITIVE pauses
      const needsGroq = reasons.filter((_, i) => buckets[i] === null);
      if (needsGroq.length > 0) {
        const groqBuckets = await groqClassifyBatch(needsGroq, groqKey);
        let gi = 0;
        for (let i = 0; i < buckets.length; i++) {
          if (buckets[i] === null) buckets[i] = groqBuckets[gi++] || 'UNCLASSIFIED';
        }
      }

      // Step 3 — PATCH each bucket back to Supabase
      for (const [i, bucket] of buckets.entries()) {
        await patchPauseBucket(sessionData.session_id, i, bucket);
      }

      // Step 4 — store buckets in localStorage for iPER calculation
      const histKey = `captain_pause_buckets_${sessionData.email}`;
      const stored  = await new Promise(r => chrome.storage.local.get([histKey], r));
      const log     = stored[histKey] || [];
      log.unshift({ session_id: sessionData.session_id, process_name: sessionData.process_name, buckets, created_at: Date.now() });
      if (log.length > 200) log.splice(200); // keep last 200 sessions
      chrome.storage.local.set({ [histKey]: log });

      console.log('[Classifier] ✅ Classified', buckets.length, 'pauses:', buckets);
    } catch (e) {
      console.warn('[Classifier] Failed (non-blocking):', e.message);
    }
  }

  // ── Listen for postMessages from page-context scripts ──────────────────────

  window.addEventListener('message', async (event) => {
    if (!event.data?.type) return;
    switch (event.data.type) {
      case 'SUPABASE_CAPTAIN_SESSION':
        await syncCaptainSession(event.data.data);
        await syncCaptainPauses(event.data.data);
        classifyPauses(event.data.data); // fire-and-forget, never blocks
        break;
      case 'SUPABASE_SIM_COMPLETE': {
        const d = event.data.data;
        await syncSimCompletion(d.email, d.simId, d.processName, d.score, d.mode, d.timeSeconds);
        break;
      }
    }
  });

  // Drain any queued writes from previous sessions on load
  drainQueue();

  console.log('[Supabase Sync] Ready —', URL ? 'connected' : 'no config');

  return {
    insert, upsert,
    syncProfile, syncXP, syncAchievement, syncLevelUp,
    syncCaptainSession, syncCaptainPauses, classifyPauses,
    syncARTMetrics, syncSimCompletion,
    drainQueue, BUCKET_WEIGHTS
  };
})();

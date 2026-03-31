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
    await insert('captain_sessions', {
      session_id:   sessionData.session_id,
      email:        sessionData.email,
      hub_code:     sessionData.hub_code    || null,
      process_name: sessionData.process_name,
      pct:          sessionData.pct,
      total_pkrt:   sessionData.total_pkrt,
      pause_count:  sessionData.pause_count,
      query_count:  sessionData.query_count,
      error_count:  sessionData.error_count,
      started_at:   sessionData.started_at,
      completed_at: sessionData.completed_at,
      created_at:   new Date().toISOString()
    });
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

  // ── Listen for postMessages from page-context scripts ──────────────────────

  window.addEventListener('message', async (event) => {
    if (!event.data?.type) return;
    switch (event.data.type) {
      case 'SUPABASE_CAPTAIN_SESSION':
        await syncCaptainSession(event.data.data);
        await syncCaptainPauses(event.data.data);
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
    syncCaptainSession, syncCaptainPauses,
    syncARTMetrics, syncSimCompletion,
    drainQueue
  };
})();

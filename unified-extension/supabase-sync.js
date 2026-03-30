/**
 * supabase-sync.js
 *
 * Content-script sync layer — pushes extension data to Supabase so the
 * admin LMS portal has visibility across all agents and hubs.
 *
 * Exposes: window.supabaseSync  (used by other content scripts directly)
 * Listens: window messages from page-context scripts (captain-timer-system.js)
 */

const supabaseSync = (() => {
  const URL  = typeof SUPABASE_CONFIG !== 'undefined' ? SUPABASE_CONFIG.url      : '';
  const KEY  = typeof SUPABASE_CONFIG !== 'undefined' ? SUPABASE_CONFIG.anon_key : '';

  function headers(extra = {}) {
    return {
      'Content-Type':  'application/json',
      'apikey':        KEY,
      'Authorization': `Bearer ${KEY}`,
      'Prefer':        'return=minimal',
      ...extra
    };
  }

  /** INSERT one or more rows into a table. */
  async function insert(table, data) {
    if (!URL || !KEY) return;
    try {
      const res = await fetch(`${URL}/rest/v1/${table}`, {
        method:  'POST',
        headers: headers(),
        body:    JSON.stringify(data)
      });
      if (!res.ok) console.warn(`[Supabase] insert ${table} failed:`, await res.text());
    } catch (e) {
      console.warn('[Supabase] insert error:', e.message);
    }
  }

  /**
   * UPSERT — insert or update on conflict.
   * @param {string} table
   * @param {object|object[]} data
   * @param {string} onConflict  comma-separated column(s) to match on, e.g. 'email' or 'email,date,queue'
   */
  async function upsert(table, data, onConflict) {
    if (!URL || !KEY) return;
    try {
      const url = `${URL}/rest/v1/${table}${onConflict ? `?on_conflict=${encodeURIComponent(onConflict)}` : ''}`;
      const res = await fetch(url, {
        method:  'POST',
        headers: headers({ 'Prefer': 'resolution=merge-duplicates,return=minimal' }),
        body:    JSON.stringify(data)
      });
      if (!res.ok) console.warn(`[Supabase] upsert ${table} failed:`, await res.text());
    } catch (e) {
      console.warn('[Supabase] upsert error:', e.message);
    }
  }

  // ── Agent profile sync ───────────────────────────────────────────────────

  /** Call once on login / init to keep the profile row current. */
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
      role:               user.role  || null,
      hub:                user.hub   || null,
      level:              g.level    || 1,
      total_xp:           g.totalXP  || 0,
      streak_current:     g.streaks?.current  || 0,
      streak_longest:     g.streaks?.longest  || 0,
      videos_watched:     g.stats?.totalVideos      || 0,
      assessments_passed: g.stats?.totalAssessments || 0,
      avg_score:          g.stats?.averageScore     || 0,
      last_active:        new Date().toISOString(),
      updated_at:         new Date().toISOString()
    }, 'email');
  }

  // ── Gamification event sync ──────────────────────────────────────────────

  async function syncXP(email, xpAmount, reason, processName, newLevel) {
    await insert('gamification_events', {
      email, reason, process_name: processName || null,
      event_type: 'xp_earned',
      xp_amount:  xpAmount,
      new_level:  newLevel || null,
      created_at: new Date().toISOString()
    });
    // Keep profile level + XP current
    if (email) {
      await upsert('agent_profiles', {
        email,
        total_xp:   undefined, // will be recalculated on next syncProfile
        last_active: new Date().toISOString(),
        updated_at:  new Date().toISOString()
      }, 'email');
    }
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

  // ── Captain session sync ─────────────────────────────────────────────────

  async function syncCaptainSession(sessionData) {
    await insert('captain_sessions', {
      session_id:   sessionData.session_id,
      email:        sessionData.email,
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

  // ── L1 ART metric sync ───────────────────────────────────────────────────

  async function syncARTMetrics(email, artSummary, artByQueue, countByQueue, reopenCount) {
    if (!email || !artByQueue) return;
    const today = new Date().toISOString().split('T')[0];
    const rows  = Object.entries(artByQueue).map(([queue, artHours]) => ({
      email,
      date:         today,
      queue,
      art_hours:    artHours,
      ticket_count: countByQueue[queue] || 0,
      reopen_count: 0, // per-queue reopen breakdown not available; total tracked in profile
      updated_at:   new Date().toISOString()
    }));
    if (rows.length > 0) {
      await upsert('l1_art_metrics', rows, 'email,date,queue');
    }
  }

  // ── Sim completion sync ──────────────────────────────────────────────────

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

  // ── Listen for messages from page-context scripts ────────────────────────
  window.addEventListener('message', async (event) => {
    if (!event.data?.type) return;

    switch (event.data.type) {
      case 'SUPABASE_CAPTAIN_SESSION':
        await syncCaptainSession(event.data.data);
        break;
      case 'SUPABASE_SIM_COMPLETE':
        const d = event.data.data;
        await syncSimCompletion(d.email, d.simId, d.processName, d.score, d.mode, d.timeSeconds);
        break;
    }
  });

  console.log('[Supabase Sync] Ready —', URL ? 'connected' : 'no config');

  return { insert, upsert, syncProfile, syncXP, syncAchievement, syncLevelUp, syncCaptainSession, syncARTMetrics, syncSimCompletion };
})();

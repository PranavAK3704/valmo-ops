/**
 * api.js — Supabase-backed data layer for the Valmo Training Hub
 *
 * Replaces the old Google Sheets placeholder URLs.
 * All data flows through Supabase REST API using the anon key.
 */

const SUPABASE_URL = 'https://wfnmltorfvaokqbzggkn.supabase.co';
const SUPABASE_KEY = 'sb_publishable_kVRokdcfNT-egywk-KbQ3g_mEs5QVGW';

// ── Supabase REST helper ─────────────────────────────────────────────────────

async function sb(table, params = '') {
  const url = `${SUPABASE_URL}/rest/v1/${table}${params}`;
  const res  = await fetch(url, {
    headers: {
      'apikey':        SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`,
      'Accept':        'application/json'
    }
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`[API] ${table}: ${res.status} ${err}`);
  }
  return res.json();
}

async function sbUpsert(table, data, onConflict) {
  const url = `${SUPABASE_URL}/rest/v1/${table}${onConflict ? `?on_conflict=${encodeURIComponent(onConflict)}` : ''}`;
  await fetch(url, {
    method:  'POST',
    headers: {
      'apikey':        SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`,
      'Content-Type':  'application/json',
      'Prefer':        'resolution=merge-duplicates,return=minimal'
    },
    body: JSON.stringify(data)
  });
}

async function sbInsert(table, data) {
  await fetch(`${SUPABASE_URL}/rest/v1/${table}`, {
    method:  'POST',
    headers: {
      'apikey':        SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`,
      'Content-Type':  'application/json',
      'Prefer':        'return=minimal'
    },
    body: JSON.stringify(data)
  });
}

// ── API Object ───────────────────────────────────────────────────────────────

const API = {

  /**
   * Get all simulations as training processes.
   * Returns array matching the shape that dashboard.js expects.
   */
  async getProcesses() {
    try {
      const rows = await sb('simulations', '?select=id,title,process_name,hub,step_count&order=created_at.desc');
      return rows.map(r => ({
        id:           r.id,
        Process_Name: r.process_name || r.title,
        Priority:     'MUST_KNOW',   // all captain processes are must-know
        Status:       'NEW',
        Video_Link:   null,          // sims are played in the extension, no external video
        Sim_ID:       r.id,
        Hub:          r.hub,
        Step_Count:   r.step_count
      }));
    } catch (e) {
      console.error('[API] getProcesses failed:', e);
      return [];
    }
  },

  /**
   * Get user progress from Supabase (agent_profiles + gamification_events).
   * Returns object matching the shape that dashboard.js expects.
   */
  async getUserProgress(email) {
    if (!email) return this._emptyProgress();

    try {
      const [profile, events, simCompletions] = await Promise.all([
        sb('agent_profiles', `?email=eq.${encodeURIComponent(email)}&select=*`).then(r => r[0] || null),
        sb('gamification_events', `?email=eq.${encodeURIComponent(email)}&order=created_at.desc&limit=50`),
        sb('sim_completions',     `?email=eq.${encodeURIComponent(email)}&select=sim_id,score,completed_at`)
      ]);

      const g    = profile || {};
      const xp   = g.total_xp    || 0;
      const level= g.level        || 1;

      // History from gamification_events
      const history = events
        .filter(e => e.xp_amount > 0)
        .slice(0, 15)
        .map(e => ({
          type:      e.event_type === 'level_up' ? 'xp' : e.event_type === 'achievement_unlocked' ? 'achievement' : 'xp',
          reason:    e.reason || e.event_type,
          amount:    e.xp_amount,
          timestamp: new Date(e.created_at).getTime()
        }));

      // Videos watched: events with reason starting "Watched:" or "Marked complete:"
      const videosWatched = events
        .filter(e => e.reason && (e.reason.startsWith('Watched:') || e.reason.startsWith('Marked complete:')))
        .map(e => e.process_name || e.reason.replace(/^(Watched:|Marked complete:)\s*/, '').trim());

      // Assessments passed: sim_completions with score >= 70
      const assessmentsPassed = simCompletions
        .filter(c => (c.score || 0) >= 70)
        .map(c => c.sim_id);

      // Achievements
      const achievements = events
        .filter(e => e.event_type === 'achievement_unlocked' && e.achievement_id)
        .map(e => ({ id: e.achievement_id, timestamp: new Date(e.created_at).getTime() }));

      return {
        totalXP:           xp,
        level:             level,
        stats: {
          totalVideos:      g.videos_watched      || videosWatched.length,
          totalAssessments: g.assessments_passed  || assessmentsPassed.length,
          averageScore:     g.avg_score           || 0
        },
        streak: {
          current: g.streak_current || 0,
          longest: g.streak_longest || 0
        },
        history,
        videosWatched:     [...new Set(videosWatched)],
        assessmentsPassed: [...new Set(assessmentsPassed)],
        achievements,
        assessmentScores:  simCompletions.reduce((acc, c) => { acc[c.sim_id] = c.score || 0; return acc; }, {})
      };
    } catch (e) {
      console.error('[API] getUserProgress failed:', e);
      return this._emptyProgress();
    }
  },

  /**
   * Save/sync user progress back to Supabase.
   */
  async saveUserProgress(email, progress) {
    if (!email) return;
    try {
      await sbUpsert('agent_profiles', {
        email,
        total_xp:           progress.totalXP,
        level:              progress.level,
        videos_watched:     progress.stats?.totalVideos      || 0,
        assessments_passed: progress.stats?.totalAssessments || 0,
        avg_score:          progress.stats?.averageScore     || 0,
        streak_current:     progress.streak?.current        || 0,
        streak_longest:     progress.streak?.longest        || 0,
        last_active:        new Date().toISOString(),
        updated_at:         new Date().toISOString()
      }, 'email');
    } catch (e) {
      console.error('[API] saveUserProgress failed:', e);
    }
  },

  /**
   * Award XP and write a gamification_event row.
   */
  async awardXP(email, amount, reason, processName) {
    if (!email || !amount) return;
    try {
      await sbInsert('gamification_events', {
        email,
        event_type:   'xp_earned',
        xp_amount:    amount,
        reason,
        process_name: processName || null,
        created_at:   new Date().toISOString()
      });
    } catch (e) {
      console.error('[API] awardXP failed:', e);
    }
  },

  /**
   * Get leaderboard (all captains ordered by XP).
   */
  async getLeaderboard() {
    try {
      const rows = await sb('agent_profiles', '?role=eq.Captain&order=total_xp.desc&limit=100&select=email,level,total_xp,streak_current,videos_watched,assessments_passed');
      return rows.map(r => ({
        email:             r.email,
        name:              r.email.split('@')[0],
        level:             r.level             || 1,
        totalXP:           r.total_xp          || 0,
        videosCompleted:   r.videos_watched    || 0,
        assessmentsPassed: r.assessments_passed|| 0,
        streak:            r.streak_current    || 0
      }));
    } catch (e) {
      console.error('[API] getLeaderboard failed:', e);
      return [];
    }
  },

  /**
   * Get sims assigned to this captain (direct or via hub).
   * Queries the captain_pending_sims view which already expands hub assignments.
   */
  async getAssignedSims(email) {
    if (!email) return [];
    try {
      const rows = await sb(
        'captain_pending_sims',
        `?email=eq.${encodeURIComponent(email)}&select=sim_id,sim_title,process_name,is_mandatory,due_date,completed_at&order=is_mandatory.desc,due_date.asc`
      );
      return rows.map(r => ({
        sim_id:       r.sim_id,
        title:        r.sim_title,
        process_name: r.process_name,
        is_mandatory: r.is_mandatory,
        due_date:     r.due_date,
        completed_at: r.completed_at
      }));
    } catch (e) {
      console.error('[API] getAssignedSims failed:', e);
      return [];
    }
  },

  // ── Internal ────────────────────────────────────────────────────────────────

  _emptyProgress() {
    return {
      totalXP: 0, level: 1,
      stats: { totalVideos: 0, totalAssessments: 0, averageScore: 0 },
      streak: { current: 0, longest: 0 },
      history: [], videosWatched: [], assessmentsPassed: [],
      achievements: [], assessmentScores: {}
    };
  }
};

console.log('[API] Supabase-backed API ready —', SUPABASE_URL);

/* ==================================================================
   Rhythm — online maps
   ------------------------------------------------------------------
   A small client for the Supabase REST API (PostgREST), using fetch
   directly so the game needs no SDK. Tables and functions are defined
   in supabase/rhythm_schema.sql.
   ================================================================== */
'use strict';

window.RhythmOnline = (() => {

const cfg = window.RHYTHM_SUPABASE || {};
const baseUrl = String(cfg.url || '').trim().replace(/\/+$/, '');
const key = String(cfg.anonKey || '').trim();
const configured = /^https?:\/\/[^/\s]+$/.test(baseUrl) && key.length >= 20;

const LIST_COLUMNS = 'id,title,author,song,note_count,duration_ms,plays,created_at,featured';
const OWNED_KEY = 'rhythm.ownedMaps';      // map id -> secret token, kept in this browser only
const PLAYER_KEY = 'rhythm.playerId';      // random id that ties leaderboard scores to this browser
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LIMITS = { title: 60, author: 24, notes: 5000, timeMs: 1200000 };

class OnlineError extends Error {
    constructor(message, status = 0, code = '') {
        super(message);
        this.status = status;
        this.code = code;
    }
}

function headers(extra) {
    const h = { apikey: key, Accept: 'application/json', 'Content-Type': 'application/json' };
    // Legacy anon keys are JWTs and go in Authorization too. New publishable
    // keys (sb_publishable_…) must only be sent as apikey.
    if (key.startsWith('eyJ')) h.Authorization = `Bearer ${key}`;
    return Object.assign(h, extra);
}

async function request(path, { method = 'GET', body, prefer } = {}) {
    if (!configured) throw new OnlineError('Online maps are not set up.', 0, 'not_configured');
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 12000);
    let res;
    try {
        res = await fetch(baseUrl + path, {
            method,
            headers: headers(prefer ? { Prefer: prefer } : {}),
            body: body === undefined ? undefined : JSON.stringify(body),
            signal: ctrl.signal,
        });
    } catch (err) {
        throw new OnlineError("Couldn't reach the map server. Check your connection and try again.", 0, 'network');
    } finally {
        clearTimeout(timer);
    }
    if (res.status === 204) return null;
    let data = null;
    try { data = await res.json(); } catch { /* empty or non-JSON body */ }
    if (!res.ok) throw describeError(res.status, data);
    return data;
}

function describeError(status, data) {
    const code = (data && data.code) || '';
    const detail = (data && (data.message || data.msg || data.error)) || '';
    if (code === '42P01' || code === 'PGRST205' || code === 'PGRST202' || /does not exist|schema cache/i.test(detail)) {
        return new OnlineError('Online maps aren’t set up on the server yet. Run supabase/rhythm_schema.sql in the Supabase SQL Editor.', status, code);
    }
    if (code === '22023') {
        if (/unknown map/.test(detail)) return new OnlineError('This map was deleted, so scores can’t be posted to it anymore.', status, code);
        return new OnlineError(`The server didn’t accept this score (${detail || 'invalid'}).`, status, code);
    }
    if (code === '23514' || code === '22P02' || code === '23502') {
        return new OnlineError('The server rejected this map because some of its data is invalid.', status, code);
    }
    if (status === 401 || status === 403) {
        return new OnlineError('The map server refused the request. Check the key in supabase-config.js.', status, code);
    }
    if (status >= 500) {
        return new OnlineError('The map server is having trouble right now. Try again in a moment.', status, code);
    }
    if (status === 429) {
        return new OnlineError('Too many requests. Wait a moment and try again.', status, code);
    }
    return new OnlineError(`The map server returned an error (${status}${detail ? `: ${detail}` : ''}).`, status, code);
}

// ---------- Ownership tokens ----------

function ownedTokens() {
    try { return JSON.parse(localStorage.getItem(OWNED_KEY)) || {}; } catch { return {}; }
}
function saveOwnedTokens(tokens) {
    try { localStorage.setItem(OWNED_KEY, JSON.stringify(tokens)); } catch { /* ignore */ }
}

function randomToken() {
    const bytes = new Uint8Array(32);
    crypto.getRandomValues(bytes);
    return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

async function sha256Hex(text) {
    if (!(window.crypto && crypto.subtle)) {
        throw new OnlineError('Sharing needs a secure page (https or localhost).', 0, 'insecure');
    }
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
    return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

// ---------- Public API ----------

function encodeNotes(notes) {
    return notes
        .map((n) => [n.lane, Math.round(n.time)])
        .filter(([lane, time]) => lane >= 0 && lane <= 3 && time >= 0 && time <= LIMITS.timeMs)
        .sort((a, b) => a[1] - b[1]);
}

function decodeNotes(rows) {
    if (!Array.isArray(rows)) return [];
    return rows
        .filter((r) => Array.isArray(r) && r.length === 2)
        .map(([lane, time]) => ({ lane: Number(lane), time: Number(time) }))
        .filter((n) => n.lane >= 0 && n.lane <= 3 && Number.isFinite(n.time));
}

async function listMaps({ sort = 'new', limit = 20, offset = 0 } = {}) {
    // Featured (built-in) maps always come first.
    const order = sort === 'popular' ? 'featured.desc,plays.desc,created_at.desc' : 'featured.desc,created_at.desc';
    const q = new URLSearchParams({ select: LIST_COLUMNS, order, limit: String(limit), offset: String(offset) });
    return (await request(`/rest/v1/rhythm_maps?${q}`)) || [];
}

async function getMap(id) {
    if (!UUID_RE.test(id)) return null;
    const q = new URLSearchParams({ select: `${LIST_COLUMNS},notes`, id: `eq.${id}` });
    const rows = (await request(`/rest/v1/rhythm_maps?${q}`)) || [];
    if (!rows.length) return null;
    const row = rows[0];
    row.notes = decodeNotes(row.notes);
    return row;
}

async function shareMap({ title, author, song, notes }) {
    title = String(title || '').trim().slice(0, LIMITS.title);
    author = String(author || '').trim().slice(0, LIMITS.author);
    if (!title) throw new OnlineError('Give the map a title.', 0, 'invalid');
    if (!author) throw new OnlineError('Enter your name.', 0, 'invalid');
    const encoded = encodeNotes(notes);
    if (!encoded.length) throw new OnlineError('This map has no notes to share.', 0, 'invalid');
    if (encoded.length > LIMITS.notes) throw new OnlineError(`Maps can have at most ${LIMITS.notes} notes.`, 0, 'invalid');

    const token = randomToken();
    const ownerHash = await sha256Hex(token);
    const rows = await request(`/rest/v1/rhythm_maps?select=${LIST_COLUMNS}`, {
        method: 'POST',
        prefer: 'return=representation',
        body: {
            title, author, song,
            notes: encoded,
            note_count: encoded.length,
            duration_ms: encoded[encoded.length - 1][1],
            owner_hash: ownerHash,
        },
    });
    const row = Array.isArray(rows) ? rows[0] : rows;
    if (!row || !row.id) throw new OnlineError('The map server didn’t confirm the upload. Refresh Community to check.', 0, 'no_row');
    const tokens = ownedTokens();
    tokens[row.id] = token;
    saveOwnedTokens(tokens);
    return row;
}

async function deleteMap(id) {
    const tokens = ownedTokens();
    const token = tokens[id];
    if (!token) throw new OnlineError('Only the browser that shared this map can delete it.', 0, 'not_owner');
    const ok = await request('/rest/v1/rpc/rhythm_delete_map', { method: 'POST', body: { p_id: id, p_token: token } });
    // Forget the token either way: false means the map is already gone.
    delete tokens[id];
    saveOwnedTokens(tokens);
    return ok === true;
}

function countPlay(id) {
    if (!configured || !UUID_RE.test(id)) return;
    request('/rest/v1/rpc/rhythm_count_play', { method: 'POST', body: { p_id: id } }).catch(() => {});
}

// ---------- Leaderboards ----------

function playerId() {
    let id = null;
    try { id = localStorage.getItem(PLAYER_KEY); } catch { /* ignore */ }
    if (!id || !UUID_RE.test(id)) {
        id = (crypto.randomUUID && crypto.randomUUID()) ||
            '10000000-1000-4000-8000-100000000000'.replace(/[018]/g, (c) =>
                (c ^ (crypto.getRandomValues(new Uint8Array(1))[0] & (15 >> (c / 4)))).toString(16));
        try { localStorage.setItem(PLAYER_KEY, id); } catch { /* ignore */ }
    }
    return id;
}

// Returns { rank, total, best, improved }.
async function submitScore({ mapId, name, score, maxCombo, counts }) {
    return request('/rest/v1/rpc/rhythm_submit_score', {
        method: 'POST',
        body: {
            p_map_id: mapId,
            p_player_id: playerId(),
            p_player_name: String(name || '').trim().slice(0, LIMITS.author),
            p_score: Math.round(score),
            p_max_combo: maxCombo,
            p_perfect: counts.perfect,
            p_great: counts.great,
            p_good: counts.good,
            p_miss: counts.miss,
        },
    });
}

// Top scores plus this player's own row; rows have { rank, player_name, score, accuracy, grade, max_combo, achieved_at, mine }.
async function getLeaderboard(mapId, limit = 10) {
    if (!UUID_RE.test(mapId)) return [];
    return (await request('/rest/v1/rpc/rhythm_leaderboard', {
        method: 'POST',
        body: { p_map_id: mapId, p_player_id: playerId(), p_limit: limit },
    })) || [];
}

function ownsMap(id) { return Object.prototype.hasOwnProperty.call(ownedTokens(), id); }

function mapLink(id) {
    const u = new URL(location.href);
    u.search = '';
    u.hash = '';
    u.searchParams.set('map', id);
    return u.toString();
}

return {
    configured, LIMITS, UUID_RE, OnlineError,
    listMaps, getMap, shareMap, deleteMap, countPlay, ownsMap, mapLink,
    submitScore, getLeaderboard, playerId,
};

})();

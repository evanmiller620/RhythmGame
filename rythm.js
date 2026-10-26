/* ==================================================================
   Rhythm — a four-lane rhythm game
   ------------------------------------------------------------------
   Beatmaps are CSV files with a `key,time` header and one note per
   line: the lane key (a, s, k, l) and the time in milliseconds from
   the start of the song.

   Timing is driven by the Web Audio clock rather than frame counts,
   so notes stay in sync with the music at any frame rate.
   ================================================================== */
'use strict';

(() => {

// ------------------------------------------------------------------
// Configuration
// ------------------------------------------------------------------

const LANE_COUNT = 4;
const LANE_IDS = ['a', 's', 'k', 'l'];              // lane names used in CSV files
const LANE_COLORS = ['#ff5c8a', '#49b6ff', '#4fe3a3', '#ffcc4d'];
const LANE_ARROWS = ['left', 'down', 'up', 'right'];

const SONGS = {
    night: { title: 'Night', src: 'night.mp3' },
};

// `offset` lines up maps made with the original engine. That engine spawned
// each note at the top of the screen at its CSV time, and the note took about
// 1 s (60 frames at 12 px/frame) to fall to the line, minus the time the song
// took to load. Net effect: notes were hit roughly 0.5-0.6 s after their CSV
// time. A negative offset reproduces that, tuned against the song's beats.
// Players can fine-tune each map in game (- and = keys, or the pause menu).
const CHARTS = [
    // onlineId matches the built-in rows seeded by supabase/rhythm_schema.sql (leaderboards, play counts).
    { id: 'night-normal', onlineId: '1a576d70-7964-4e49-bd79-bcbacb393451', song: 'night', title: 'Night', level: 'Normal', src: 'assets/night2.csv', offset: -614, accent: 1 },
    { id: 'night-hard',   onlineId: 'cd3f9ca2-bd42-4150-a466-1625a3a4bd47', song: 'night', title: 'Night', level: 'Hard',   src: 'assets/night.csv',  offset: -542, accent: 0 },
];

// Hit windows in milliseconds (either side of the note).
const WINDOW = { perfect: 40, great: 80, good: 125, early: 170 };

const JUDGMENTS = {
    perfect: { label: 'Perfect', points: 300, color: '#c9ecff' },
    great:   { label: 'Great',   points: 200, color: '#4fe3a3' },
    good:    { label: 'Good',    points: 100, color: '#ffcc4d' },
    miss:    { label: 'Miss',    points: 0,   color: '#ff6070' },
};

const DEFAULT_SETTINGS = {
    keys: ['KeyA', 'KeyS', 'KeyK', 'KeyL'],
    keyLabels: ['A', 'S', 'K', 'L'],
    speed: 6,          // 6 matches the original game's scroll speed
    offset: 0,         // ms; positive delays notes relative to the audio
    volume: 80,
    ghostPenalty: false,
};

const RECORD_LEAD_IN = 1800;   // ms of countdown before recording starts
const END_PADDING = 1600;      // ms after the last note before results

// ------------------------------------------------------------------
// Storage (wrapped: storage can be unavailable in private windows)
// ------------------------------------------------------------------

const store = {
    get(key, fallback) {
        try {
            const raw = localStorage.getItem('rhythm.' + key);
            return raw ? JSON.parse(raw) : fallback;
        } catch { return fallback; }
    },
    set(key, value) {
        try { localStorage.setItem('rhythm.' + key, JSON.stringify(value)); } catch { /* ignore */ }
    },
};

const settings = loadSettings();

// Saved settings are validated so a corrupted or outdated entry can't break the game.
function loadSettings() {
    const saved = store.get('settings', {});
    const s = Object.assign({}, DEFAULT_SETTINGS, saved && typeof saved === 'object' ? saved : {});
    const num = (v, lo, hi, d) => (Number.isFinite(Number(v)) ? Math.max(lo, Math.min(hi, Number(v))) : d);
    s.speed = num(s.speed, 2, 14, DEFAULT_SETTINGS.speed);
    s.offset = num(s.offset, -250, 250, DEFAULT_SETTINGS.offset);
    s.volume = num(s.volume, 0, 100, DEFAULT_SETTINGS.volume);
    s.ghostPenalty = !!s.ghostPenalty;
    const keysOk = Array.isArray(s.keys) && s.keys.length === LANE_COUNT &&
        s.keys.every((k) => typeof k === 'string' && k) && new Set(s.keys).size === LANE_COUNT &&
        Array.isArray(s.keyLabels) && s.keyLabels.length === LANE_COUNT;
    if (!keysOk) {
        s.keys = DEFAULT_SETTINGS.keys.slice();
        s.keyLabels = DEFAULT_SETTINGS.keyLabels.slice();
    }
    return s;
}
const bests = store.get('bests', {});
const mapTiming = store.get('mapTiming', {});   // chart id -> ms, positive = notes later

function saveSettings() { store.set('settings', settings); }

// ------------------------------------------------------------------
// DOM
// ------------------------------------------------------------------

const $ = (id) => document.getElementById(id);
const el = {
    canvas: $('playfield'),
    importBtn: $('import-btn'),
    recordBtn: $('record-btn'),
    loadInput: $('load-input'),
    settingsBtn: $('settings-btn'),
    keyHint: $('key-hint-keys'),
    hudTitle: $('hud-title'),
    hudSub: $('hud-sub'),
    hudScore: $('hud-score'),
    hudAcc: $('hud-acc'),
    progress: $('progress-fill'),
    pauseBtn: $('pause-btn'),
    pause: $('pause'),
    resumeBtn: $('resume-btn'),
    finishRecordBtn: $('finish-record-btn'),
    restartBtn: $('restart-btn'),
    pauseSettingsBtn: $('pause-settings-btn'),
    quitBtn: $('quit-btn'),
    results: $('results'),
    recordDone: $('record-done'),
    settings: $('settings'),
    keybinds: $('keybinds'),
    toast: $('toast'),
};

function setScreen(name) {
    state.screen = name;
    document.body.dataset.screen = name;
    el.pause.hidden = name !== 'pause';
    el.results.hidden = name !== 'results';
    el.recordDone.hidden = name !== 'record-done';
}

let toastTimer = 0;
function toast(message, isError = false) {
    el.toast.textContent = message;
    el.toast.classList.toggle('error', isError);
    el.toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.toast.hidden = true; }, isError ? 6000 : 3000);
}

// ------------------------------------------------------------------
// Audio
// ------------------------------------------------------------------

const audio = {
    ctx: null,
    gain: null,
    source: null,
    startAt: 0,
    duration: 0,
    fetches: new Map(),
    decodes: new Map(),
    lastTs: null,

    async ensure() {
        if (!this.ctx) {
            const Ctx = window.AudioContext || window.webkitAudioContext;
            this.ctx = new Ctx({ latencyHint: 'interactive' });
            this.gain = this.ctx.createGain();
            this.gain.connect(this.ctx.destination);
            this.applyVolume();
        }
        if (this.ctx.state !== 'running') {
            try { await this.ctx.resume(); } catch { /* ignore */ }
        }
    },

    prefetch(src) {
        if (!this.fetches.has(src)) {
            this.fetches.set(src, fetch(src).then((r) => {
                if (!r.ok) throw new Error(`Couldn't load ${src} (${r.status})`);
                return r.arrayBuffer();
            }));
        }
        return this.fetches.get(src);
    },

    load(src) {
        if (!this.decodes.has(src)) {
            const p = this.prefetch(src)
                .then((data) => new Promise((resolve, reject) => {
                    // Callback form for older Safari.
                    this.ctx.decodeAudioData(data.slice(0), resolve, reject);
                }));
            p.catch(() => { this.decodes.delete(src); this.fetches.delete(src); });
            this.decodes.set(src, p);
        }
        return this.decodes.get(src);
    },

    play(buffer, delayMs) {
        this.stop();
        this.gain.gain.cancelScheduledValues(this.ctx.currentTime);
        this.applyVolume();
        const src = this.ctx.createBufferSource();
        src.buffer = buffer;
        src.connect(this.gain);
        this.startAt = this.ctx.currentTime + delayMs / 1000;
        this.duration = buffer.duration * 1000;
        src.start(this.startAt);
        this.source = src;
        this.lastTs = null;
    },

    stop() {
        if (this.source) {
            try { this.source.stop(); } catch { /* already stopped */ }
            this.source.disconnect();
            this.source = null;
        }
    },

    fadeOut(ms) {
        if (!this.source) return;
        const now = this.ctx.currentTime;
        this.gain.gain.setValueAtTime(this.gain.gain.value, now);
        this.gain.gain.linearRampToValueAtTime(0, now + ms / 1000);
        const src = this.source;
        setTimeout(() => { if (this.source === src) this.stop(); }, ms + 50);
    },

    applyVolume() {
        if (this.gain) this.gain.gain.value = Math.pow(settings.volume / 100, 2);
    },

    // Milliseconds since the song started, as heard through the speakers.
    songTime() {
        const ctx = this.ctx;
        const perfNow = performance.now();
        let t = null;
        if (ctx.getOutputTimestamp) {
            const ts = ctx.getOutputTimestamp();
            // Only trust the timestamp when it is fresh (it can be stale right after resuming).
            if (ts && ts.performanceTime > 0 && perfNow - ts.performanceTime < 150) {
                t = ts.contextTime * 1000 + (perfNow - ts.performanceTime);
            }
        }
        if (t === null) {
            t = (ctx.currentTime - (ctx.outputLatency || ctx.baseLatency || 0)) * 1000;
        }
        return t - this.startAt * 1000;
    },
};

// ------------------------------------------------------------------
// Beatmaps
// ------------------------------------------------------------------

function parseBeatmap(text) {
    const notes = [];
    const lines = String(text).split(/\r?\n/);
    for (const line of lines) {
        const parts = line.split(',');
        if (parts.length < 2) continue;
        const key = parts[0].trim().toLowerCase();
        const time = Number(parts[1].trim());
        let lane = LANE_IDS.indexOf(key);
        if (lane === -1 && /^[0-3]$/.test(key)) lane = Number(key);
        if (lane === -1 || !Number.isFinite(time)) continue;   // skips the header and junk lines
        notes.push({ lane, time });
    }
    notes.sort((a, b) => a.time - b.time);
    // Two notes in the same lane a few ms apart can't be hit separately; keep one.
    const lastInLane = [-Infinity, -Infinity, -Infinity, -Infinity];
    return notes.filter((n) => {
        if (n.time - lastInLane[n.lane] < 15) return false;
        lastInLane[n.lane] = n.time;
        return true;
    });
}

function beatmapToCSV(notes) {
    return 'key,time\n' + notes.map((n) => `${LANE_IDS[n.lane]},${Math.round(n.time)}`).join('\n') + '\n';
}

const chartData = new Map();   // chart id -> parsed notes

async function loadChart(chart) {
    if (!chartData.has(chart.id)) {
        const r = await fetch(chart.src);
        if (!r.ok) throw new Error(`Couldn't load ${chart.src} (${r.status})`);
        chartData.set(chart.id, parseBeatmap(await r.text()));
    }
    return chartData.get(chart.id);
}

function formatDuration(ms) {
    const s = Math.max(0, Math.round(ms / 1000));
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

// ------------------------------------------------------------------
// Game state
// ------------------------------------------------------------------

const state = {
    screen: 'loading',
    mode: null,            // 'play' | 'record' | null
    chart: null,
    sourceNotes: null,     // notes as loaded, before chart offset
    notes: [],
    laneNotes: [[], [], [], []],
    laneHead: [0, 0, 0, 0],
    drawStart: 0,
    lastNoteTime: 0,
    buffer: null,

    paused: false,
    pausedAt: 0,
    resumeAt: 0,           // performance.now() when a resume countdown ends
    lastTime: 0,

    score: 0,
    combo: 0,
    maxCombo: 0,
    counts: { perfect: 0, great: 0, good: 0, miss: 0 },
    deltas: [],

    recorded: [],
    recordingSaved: true,  // false while a recording exists that hasn't been downloaded
    discardArmed: null,    // button awaiting a second click to discard it
    nudge: 0,              // per-map timing adjustment in ms
    nudgeAt: -Infinity,

    pressed: [false, false, false, false],
    releasedAt: [0, 0, 0, 0],
    judgment: null,        // { kind, at, delta }
    comboAt: 0,
    effects: [],
    particles: [],
};

function currentTime() {
    if (!state.mode) return 0;
    if (state.paused) return state.pausedAt;
    const t = audio.songTime() - settings.offset;
    // Keep time monotonic so tiny clock jitter never moves notes backwards.
    state.lastTime = Math.max(state.lastTime, t);
    return state.lastTime;
}

function resetRun() {
    state.score = 0;
    state.combo = 0;
    state.maxCombo = 0;
    state.counts = { perfect: 0, great: 0, good: 0, miss: 0 };
    state.deltas = [];
    state.recorded = [];
    state.judgment = null;
    state.effects = [];
    state.particles = [];
    state.paused = false;
    state.resumeAt = 0;
    state.lastTime = -Infinity;
    state.drawStart = 0;
    state.laneHead = [0, 0, 0, 0];
}

function accuracy() {
    const c = state.counts;
    const judged = c.perfect + c.great + c.good + c.miss;
    if (!judged) return 100;
    return (c.perfect * 300 + c.great * 200 + c.good * 100) / (judged * 300) * 100;
}

function gradeFor(acc, counts) {
    if (acc >= 100 && counts.miss === 0) return 'SS';
    if (acc >= 95) return 'S';
    if (acc >= 90) return 'A';
    if (acc >= 80) return 'B';
    if (acc >= 70) return 'C';
    return 'D';
}

function updateHud() {
    el.hudScore.textContent = Math.round(state.score).toLocaleString();
    el.hudAcc.textContent = accuracy().toFixed(2) + '%';
}

// ------------------------------------------------------------------
// Starting, pausing and finishing
// ------------------------------------------------------------------

let starting = false;

async function prepareSong(songId, button) {
    const song = SONGS[songId];
    const label = button ? button.innerHTML : '';
    if (button) { button.disabled = true; }
    try {
        await audio.ensure();
        if (button && !audio.decodes.has(song.src)) button.textContent = 'Loading song…';
        return await audio.load(song.src);
    } finally {
        if (button) { button.disabled = false; button.innerHTML = label; }
    }
}

async function startPlay(chart, sourceNotes, button) {
    if (starting) return;
    starting = true;
    try {
        const buffer = await prepareSong(chart.song, button);
        const nudge = chart.id === 'recording' ? 0 : (mapTiming[chart.id] || 0);
        const shift = nudge - (chart.offset || 0);
        const songEnd = buffer.duration * 1000;
        const notes = sourceNotes
            .map((n) => ({ lane: n.lane, time: n.time + shift, state: 0 }))
            .filter((n) => n.time <= songEnd);
        if (!notes.length) {
            toast('This map has no notes during the song, so there is nothing to play.', true);
            return;
        }
        const dropped = sourceNotes.length - notes.length;
        if (dropped) toast(`${dropped} note${dropped === 1 ? '' : 's'} after the end of the song ${dropped === 1 ? 'was' : 'were'} skipped.`);

        stopRun();
        state.chart = chart;
        state.sourceNotes = sourceNotes;
        state.buffer = buffer;
        state.nudge = nudge;
        state.notes = notes;
        state.laneNotes = [[], [], [], []];
        for (const n of state.notes) state.laneNotes[n.lane].push(n);
        state.lastNoteTime = state.notes.length ? state.notes[state.notes.length - 1].time : 0;
        resetRun();

        // Give the first note time to fall in from the top.
        const firstTime = state.notes.length ? state.notes[0].time : 0;
        const leadIn = Math.max(1000, layout.approachMs() + 400 - firstTime);

        state.mode = 'play';
        el.hudTitle.textContent = chart.title;
        el.hudSub.textContent = chart.level;
        el.hudSub.classList.remove('recording');
        updateHud();
        blurActive();
        setScreen('play');
        audio.play(buffer, leadIn);
    } catch (err) {
        console.error(err);
        toast(loadErrorMessage(err), true);
    } finally {
        starting = false;
    }
}

async function startRecording(button) {
    if (starting) return;
    starting = true;
    try {
        const buffer = await prepareSong('night', button);
        stopRun();
        state.chart = { id: 'recording', song: 'night', title: SONGS.night.title, level: 'Your recording', offset: 0 };
        state.recordingSaved = true;
        state.buffer = buffer;
        state.notes = [];
        state.laneNotes = [[], [], [], []];
        resetRun();
        state.mode = 'record';
        el.hudTitle.textContent = 'Recording';
        el.hudSub.textContent = '0 notes';
        el.hudSub.classList.add('recording');
        el.hudScore.textContent = '';
        el.hudAcc.textContent = '';
        blurActive();
        setScreen('record');
        audio.play(buffer, RECORD_LEAD_IN);
    } catch (err) {
        console.error(err);
        toast(loadErrorMessage(err), true);
    } finally {
        starting = false;
    }
}

function stopRun() {
    audio.stop();
    state.mode = null;
    state.paused = false;
    state.pressed = [false, false, false, false];
}

function pause() {
    if (!state.mode || state.screen === 'pause') return;
    if (!state.paused) {
        state.pausedAt = currentTime();
        state.paused = true;
        if (audio.ctx) audio.ctx.suspend();
    }
    state.resumeAt = 0;
    el.finishRecordBtn.hidden = state.mode !== 'record';
    $('map-timing').hidden = state.mode !== 'play';
    updateTimingUI();
    el.restartBtn.textContent = state.mode === 'record' ? 'Start over' : 'Restart';
    setScreen('pause');
    el.resumeBtn.focus();
}

function resume() {
    if (state.screen !== 'pause') return;
    blurActive();
    setScreen(state.mode);
    // A short countdown so the player can find the notes again.
    state.resumeAt = performance.now() + 1500;
}

function tickResume() {
    if (state.paused && state.resumeAt && performance.now() >= state.resumeAt) {
        state.resumeAt = 0;
        audio.ctx.resume().then(() => {
            if (state.screen === 'pause') audio.ctx.suspend();   // paused again meanwhile
            else state.paused = false;
        }).catch(() => {
            pause();
            toast("The browser didn't let the music resume. Press Resume to try again.", true);
        });
    }
}

function restart() {
    if (state.mode === 'record') { startRecording(); return; }
    const { chart, sourceNotes } = state;
    if (chart && sourceNotes) startPlay(chart, sourceNotes);
}

function quitToMenu() {
    stopRun();
    state.recordingSaved = true;      // leaving was confirmed, or there was nothing to save
    if (audio.ctx && audio.ctx.state === 'suspended') audio.ctx.resume();
    renderMenu();
    if (detail.key) loadLeaderboard();    // a score may have just been posted
    setScreen('menu');
    if (detail.key) $('detail-start').focus();
}

function finishPlay() {
    audio.fadeOut(1200);
    const mode = state.mode;
    state.mode = null;
    if (mode !== 'play') return;

    // Anything left unjudged (e.g. the song ended first) counts as a miss.
    for (const n of state.notes) {
        if (n.state === 0) { n.state = 2; state.counts.miss++; state.combo = 0; }
    }

    const acc = accuracy();
    const grade = gradeFor(acc, state.counts);
    const chart = state.chart;
    const score = Math.round(state.score);

    // Library maps (built-in and shared) keep a best score in this browser.
    let isBest = false;
    if (CHARTS.includes(chart) || chart.community) {
        const prev = bests[chart.id];
        if (!prev || score > prev.score) {
            bests[chart.id] = { score, acc: Math.round(acc * 100) / 100, grade };
            store.set('bests', bests);
            isBest = true;
        }
    }

    $('results-title').textContent = chart.title;
    $('results-sub').textContent = chart.level;
    const gradeEl = $('results-grade');
    gradeEl.textContent = grade;
    gradeEl.dataset.grade = grade;
    $('results-score').textContent = score.toLocaleString();
    $('results-best').hidden = !isBest;
    $('r-acc').textContent = acc.toFixed(2) + '%';
    $('r-combo').textContent = state.maxCombo.toLocaleString();
    $('r-perfect').textContent = state.counts.perfect;
    $('r-great').textContent = state.counts.great;
    $('r-good').textContent = state.counts.good;
    $('r-miss').textContent = state.counts.miss;

    afterLibraryRun(chart, {
        at: Date.now(), score, acc: Math.round(acc * 100) / 100, grade,
        combo: state.maxCombo, counts: { ...state.counts },
    });
    suggestOffset(state.deltas);
    const unsaved = chart.id === 'recording' && !state.recordingSaved;
    $('results-download').hidden = !unsaved;
    const shareable = chart.id === 'recording' || chart.id.startsWith('import:');
    const alreadyShared = sharedSigs.has(notesSig(state.sourceNotes)) || sharedSigs.has('chart:' + chart.id);
    $('results-share').hidden = !(online.configured && shareable && !alreadyShared);
    resetDiscardButton();
    setScreen('results');
    drawTimingChart(state.deltas);      // after the panel is visible so it can measure its width
    $('retry-btn').focus();
}

function finishRecording() {
    if (state.mode !== 'record') return;
    audio.stop();
    if (audio.ctx && audio.ctx.state === 'suspended') audio.ctx.resume();
    state.mode = null;
    state.paused = false;
    const notes = state.recorded.slice().sort((a, b) => a.time - b.time);
    state.recorded = notes;
    const count = notes.length;
    const span = count ? notes[count - 1].time : 0;
    $('record-summary').textContent = count
        ? `${count} note${count === 1 ? '' : 's'} over ${formatDuration(span)}.`
        : 'No notes were recorded. Press your lane keys along with the music.';
    state.recordingSaved = !count;
    resetDiscardButton();
    $('record-download').disabled = !count;
    $('record-share').hidden = !(online.configured && count && !sharedSigs.has(notesSig(notes)));
    $('record-play').disabled = !count;
    setScreen('record-done');
    (count ? $('record-download') : $('record-again')).focus();
}

function downloadRecording() {
    const blob = new Blob([beatmapToCSV(state.recorded)], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const d = new Date();
    const stamp = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}-${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}`;
    a.href = url;
    a.download = `night-beatmap-${stamp}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    state.recordingSaved = true;
    resetDiscardButton();
    toast('Beatmap downloaded. Use Import beatmap to play it later.');
}

function blurActive() {
    if (document.activeElement && document.activeElement !== document.body) document.activeElement.blur();
}

function loadErrorMessage(err) {
    if (location.protocol === 'file:') {
        return 'Browsers block loading music from a local file. Run the game from a web server, such as GitHub Pages or `npx serve`.';
    }
    return (err && err.message) ? err.message : 'Something went wrong while loading the song.';
}

// ------------------------------------------------------------------
// Judging
// ------------------------------------------------------------------

function pressLane(lane, t) {
    state.pressed[lane] = true;
    if (!state.mode || state.paused) return;

    if (state.mode === 'record') {
        if (t < 0) return;
        state.recorded.push({ lane, time: Math.round(t) });
        const n = state.recorded.length;
        el.hudSub.textContent = `${n} note${n === 1 ? '' : 's'}`;
        return;
    }

    const queue = state.laneNotes[lane];
    let i = state.laneHead[lane];
    while (i < queue.length && queue[i].state !== 0) i++;
    state.laneHead[lane] = i;
    const note = queue[i];
    const delta = note ? t - note.time : Infinity;
    const abs = Math.abs(delta);

    if (abs <= WINDOW.good) {
        const kind = abs <= WINDOW.perfect ? 'perfect' : abs <= WINDOW.great ? 'great' : 'good';
        judge(note, kind, delta);
    } else if (delta < 0 && -delta <= WINDOW.early) {
        judge(note, 'miss', delta);       // pressed far too early: the note is lost
    } else if (settings.ghostPenalty) {
        breakCombo();
    }
}

function releaseLane(lane) {
    if (state.pressed[lane]) state.releasedAt[lane] = performance.now();
    state.pressed[lane] = false;
}

function judge(note, kind, delta) {
    const now = performance.now();
    state.counts[kind]++;
    if (kind === 'miss') {
        note.state = 2;
        state.combo = 0;
    } else {
        note.state = 1;
        state.combo++;
        state.maxCombo = Math.max(state.maxCombo, state.combo);
        state.comboAt = now;
        // Combo multiplier ramps from 1x to 2x over the first 100 notes.
        state.score += JUDGMENTS[kind].points * (1 + Math.min(state.combo, 100) / 100);
        state.deltas.push(delta);
        spawnHitEffect(note.lane, kind, now);
    }
    state.judgment = { kind, at: now, delta };
    updateHud();
}

function breakCombo() {
    state.combo = 0;
    state.judgment = { kind: 'miss', at: performance.now(), delta: 0 };
}

function checkMisses(t) {
    for (let lane = 0; lane < LANE_COUNT; lane++) {
        const queue = state.laneNotes[lane];
        let i = state.laneHead[lane];
        while (i < queue.length) {
            const n = queue[i];
            if (n.state !== 0) { i++; continue; }
            if (t - n.time > WINDOW.good) { judge(n, 'miss', t - n.time); i++; continue; }
            break;
        }
        state.laneHead[lane] = i;
    }
}

// ------------------------------------------------------------------
// Input
// ------------------------------------------------------------------

let rebindLane = -1;
let dialogClosedAt = 0;

function eventSongTime(e) {
    const t = currentTime();
    // Account for the delay between the key press and this handler running.
    const lag = performance.now() - e.timeStamp;
    return (lag > 0 && lag < 100) ? t - lag : t;
}

window.addEventListener('keydown', (e) => {
    if (rebindLane !== -1) return;              // handled by the settings dialog
    if (anyDialogOpen()) return;                // typing in a dialog never hits lanes
    if (isTextField(e.target)) return;          // nor does typing a name on the results screen

    const lane = settings.keys.indexOf(e.code);
    const inRun = state.screen === 'play' || state.screen === 'record';

    if (e.code === 'Escape') {
        if (performance.now() - dialogClosedAt < 120) return;
        if (inRun) pause();
        else if (state.screen === 'pause') resume();
        else if (state.screen === 'results' && state.recordingSaved) quitToMenu();
        else if (state.screen === 'menu' && detail.key) closeDetail();
        // On the recording screen Esc does nothing, so a recording is never lost by accident.
        return;
    }

    // Live map timing: - and = (Shift for bigger steps).
    const nudgeKey = { Minus: -1, NumpadSubtract: -1, Equal: 1, NumpadAdd: 1 }[e.code];
    if (lane === -1 && nudgeKey && state.mode === 'play' && (inRun || state.screen === 'pause')) {
        e.preventDefault();
        nudgeTiming(nudgeKey * (e.shiftKey ? 50 : 10));
        return;
    }

    if (lane === -1) return;
    if (inRun) e.preventDefault();
    if (e.repeat) return;
    pressLane(lane, inRun ? eventSongTime(e) : 0);
});

function anyDialogOpen() { return !!document.querySelector('dialog[open]'); }
function isTextField(t) {
    return !!t && (t.isContentEditable || t.tagName === 'TEXTAREA' ||
        (t.tagName === 'INPUT' && !['range', 'checkbox', 'radio', 'button', 'submit', 'file'].includes(t.type)));
}

function formatMs(ms) { return `${ms > 0 ? '+' : ''}${Math.round(ms)} ms`; }

function nudgeTiming(delta) {
    if (state.mode !== 'play') return;
    const next = clamp(state.nudge + delta, -2000, 2000);
    delta = next - state.nudge;
    if (!delta) return;
    state.nudge = next;
    for (const n of state.notes) n.time += delta;
    state.lastNoteTime += delta;
    if (state.chart.id !== 'recording') {
        mapTiming[state.chart.id] = next;
        store.set('mapTiming', mapTiming);
    }
    state.nudgeAt = performance.now();
    updateTimingUI();
}

function updateTimingUI() {
    $('timing-value').textContent = formatMs(state.nudge || 0);
}

window.addEventListener('keyup', (e) => {
    const lane = settings.keys.indexOf(e.code);
    if (lane !== -1) releaseLane(lane);
});

window.addEventListener('blur', () => {
    for (let i = 0; i < LANE_COUNT; i++) releaseLane(i);
    if (state.screen === 'play' || state.screen === 'record') pause();
});
document.addEventListener('visibilitychange', () => {
    if (document.hidden && (state.screen === 'play' || state.screen === 'record')) pause();
});

// Touch / mouse: tap a lane to hit it.
const pointerLanes = new Map();
el.canvas.addEventListener('pointerdown', (e) => {
    if (state.screen !== 'play' && state.screen !== 'record') return;
    const lane = layout.laneAt(e.clientX);
    if (lane === -1) return;
    e.preventDefault();
    try { el.canvas.setPointerCapture(e.pointerId); } catch { /* ignore */ }
    pointerLanes.set(e.pointerId, lane);
    pressLane(lane, eventSongTime(e));
});
const endPointer = (e) => {
    const lane = pointerLanes.get(e.pointerId);
    if (lane !== undefined) { releaseLane(lane); pointerLanes.delete(e.pointerId); }
};
el.canvas.addEventListener('pointerup', endPointer);
el.canvas.addEventListener('pointercancel', endPointer);

// ------------------------------------------------------------------
// Layout
// ------------------------------------------------------------------

const ctx = el.canvas.getContext('2d');

const layout = {
    w: 0, h: 0, dpr: 1,
    laneW: 90,
    noteH: 24,
    receptorY: 0,
    centerX: 0,
    targetCenterX: 0,

    resize() {
        this.dpr = Math.min(window.devicePixelRatio || 1, 2);
        this.w = window.innerWidth;
        this.h = window.innerHeight;
        el.canvas.width = Math.round(this.w * this.dpr);
        el.canvas.height = Math.round(this.h * this.dpr);
        this.laneW = Math.round(clamp(Math.min((this.w - 24) / 4, this.h * 0.125), 56, 104));
        this.noteH = Math.round(this.laneW * 0.28);
        this.receptorY = Math.round(this.h - clamp(this.h * 0.15, 84, 140));
        this.updateTarget();
        this.centerX = this.targetCenterX;
    },

    updateTarget() {
        const menuW = Math.min(420, this.w);
        const sideMenu = state.screen === 'menu' && this.w > 760;
        this.targetCenterX = sideMenu ? menuW + (this.w - menuW) / 2 : this.w / 2;
    },

    get fieldW() { return this.laneW * LANE_COUNT; },
    get fieldX() { return Math.round(this.centerX - this.fieldW / 2); },

    // Pixels per millisecond. Speed 6 matches the original 12 px/frame.
    pxPerMs() { return settings.speed * 0.12 * (this.receptorY / 730); },
    approachMs() { return this.receptorY / this.pxPerMs(); },

    laneAt(x) {
        const lane = Math.floor((x - this.fieldX) / this.laneW);
        return lane >= 0 && lane < LANE_COUNT ? lane : -1;
    },
};

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

window.addEventListener('resize', () => {
    layout.resize();
    if (state.screen === 'results') drawTimingChart(state.deltas);
});
// Moving the window to a screen with a different pixel density doesn't always fire resize.
(function watchDpr() {
    if (!window.matchMedia) return;
    const mq = window.matchMedia(`(resolution: ${window.devicePixelRatio || 1}dppx)`);
    const onChange = () => { layout.resize(); watchDpr(); };
    if (mq.addEventListener) mq.addEventListener('change', onChange, { once: true });
})();

// ------------------------------------------------------------------
// Rendering
// ------------------------------------------------------------------

function roundRect(c, x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    c.beginPath();
    c.moveTo(x + r, y);
    c.arcTo(x + w, y, x + w, y + h, r);
    c.arcTo(x + w, y + h, x, y + h, r);
    c.arcTo(x, y + h, x, y, r);
    c.arcTo(x, y, x + w, y, r);
    c.closePath();
}

function hexA(hex, a) {
    const n = parseInt(hex.slice(1), 16);
    return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}

function drawArrow(cx, cy, size, dir, color, width) {
    const s = size / 2;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate({ left: Math.PI / 2, down: 0, up: Math.PI, right: -Math.PI / 2 }[dir]);
    ctx.beginPath();
    ctx.moveTo(-s, -s * 0.45);
    ctx.lineTo(0, s * 0.45);
    ctx.lineTo(s, -s * 0.45);
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.stroke();
    ctx.restore();
}

function spawnHitEffect(lane, kind, now) {
    state.effects.push({ lane, kind, at: now });
    const cx = layout.fieldX + lane * layout.laneW + layout.laneW / 2;
    const count = kind === 'perfect' ? 10 : 6;
    for (let i = 0; i < count; i++) {
        const a = -Math.PI / 2 + (Math.random() - 0.5) * Math.PI * 0.9;
        const v = 0.25 + Math.random() * 0.35;
        state.particles.push({
            lane, at: now,
            x: cx + (Math.random() - 0.5) * layout.laneW * 0.5,
            y: layout.receptorY,
            vx: Math.cos(a) * v, vy: Math.sin(a) * v,
            life: 320 + Math.random() * 200,
        });
    }
}

let lastFrame = performance.now();

function frame(now) {
    const dt = Math.min(50, now - lastFrame);
    lastFrame = now;

    tickResume();
    const t = currentTime();

    if (state.mode === 'play' && !state.paused) {
        checkMisses(t);
        if (t > state.lastNoteTime + END_PADDING || t > audio.duration + 200) finishPlay();
    } else if (state.mode === 'record' && !state.paused) {
        if (t >= audio.duration) finishRecording();
    }

    // Ease the playfield between its menu and in-game positions.
    layout.updateTarget();
    layout.centerX += (layout.targetCenterX - layout.centerX) * (1 - Math.exp(-dt / 90));

    render(t, now, dt);

    if (state.mode) {
        const total = state.mode === 'record' ? audio.duration : state.lastNoteTime + END_PADDING;
        el.progress.style.width = `${clamp(t / total, 0, 1) * 100}%`;
    }

    requestAnimationFrame(frame);
}

function render(t, now, dt) {
    const { w, h, dpr, laneW, receptorY, noteH } = layout;
    const fx = layout.fieldX;
    const fw = layout.fieldW;

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    // Playfield backdrop
    ctx.fillStyle = 'rgba(10, 10, 13, 0.78)';
    ctx.fillRect(fx, 0, fw, h);
    ctx.fillStyle = 'rgba(230, 233, 239, 0.16)';
    ctx.fillRect(fx - 1, 0, 1, h);
    ctx.fillRect(fx + fw, 0, 1, h);
    ctx.fillStyle = 'rgba(230, 233, 239, 0.06)';
    for (let i = 1; i < LANE_COUNT; i++) ctx.fillRect(fx + i * laneW, 0, 1, h);

    // Key-press beams
    for (let i = 0; i < LANE_COUNT; i++) {
        const fade = state.pressed[i] ? 1 : clamp(1 - (now - state.releasedAt[i]) / 160, 0, 1);
        if (fade <= 0) continue;
        const g = ctx.createLinearGradient(0, receptorY, 0, receptorY - h * 0.5);
        g.addColorStop(0, hexA(LANE_COLORS[i], 0.28 * fade));
        g.addColorStop(1, hexA(LANE_COLORS[i], 0));
        ctx.fillStyle = g;
        ctx.fillRect(fx + i * laneW, 0, laneW, receptorY);
    }

    // Combo, drawn behind the notes
    if (state.mode === 'play' && state.combo >= 5) {
        const pulse = 1 + 0.08 * Math.exp(-(now - state.comboAt) / 90);
        const size = Math.round(laneW * 0.95 * pulse);
        ctx.textAlign = 'center';
        ctx.textBaseline = 'alphabetic';
        ctx.fillStyle = 'rgba(230, 233, 239, 0.2)';
        ctx.font = `800 ${size}px Unbounded, "Arial Black", sans-serif`;
        ctx.fillText(String(state.combo), layout.centerX, h * 0.36);
        ctx.font = `500 ${Math.round(laneW * 0.17)}px "DM Sans", sans-serif`;
        ctx.fillStyle = 'rgba(230, 233, 239, 0.32)';
        ctx.fillText('combo', layout.centerX, h * 0.36 + laneW * 0.32);
    }

    // Receptors
    const pad = Math.round(laneW * 0.1);
    const rSize = laneW - pad * 2;
    for (let i = 0; i < LANE_COUNT; i++) {
        const x = fx + i * laneW + pad;
        const down = state.pressed[i];
        const s = down ? 0.92 : 1;
        const rw = rSize * s;
        const rx = x + (rSize - rw) / 2;
        const ry = receptorY - rw / 2;
        roundRect(ctx, rx, ry, rw, rw, laneW * 0.16);
        ctx.fillStyle = down ? hexA(LANE_COLORS[i], 0.3) : 'rgba(230, 233, 239, 0.04)';
        ctx.fill();
        ctx.lineWidth = 2;
        ctx.strokeStyle = down ? LANE_COLORS[i] : 'rgba(230, 233, 239, 0.32)';
        ctx.stroke();
        drawArrow(x + rSize / 2, receptorY, rSize * 0.34, LANE_ARROWS[i], down ? '#fff' : 'rgba(230, 233, 239, 0.55)', Math.max(2, laneW * 0.05));
    }

    // Key labels under the receptors
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `500 ${Math.round(laneW * 0.16)}px "DM Sans", sans-serif`;
    for (let i = 0; i < LANE_COUNT; i++) {
        ctx.fillStyle = state.pressed[i] ? LANE_COLORS[i] : 'rgba(230, 233, 239, 0.42)';
        ctx.fillText(settings.keyLabels[i], fx + i * laneW + laneW / 2, receptorY + laneW * 0.62);
    }

    const ppm = layout.pxPerMs();

    // Falling notes
    if (state.mode === 'play') {
        const notes = state.notes;
        while (state.drawStart < notes.length && notes[state.drawStart].state !== 0 &&
               (receptorY - (notes[state.drawStart].time - t) * ppm) > h + noteH) {
            state.drawStart++;
        }
        const nw = laneW - pad * 2;
        for (let i = state.drawStart; i < notes.length; i++) {
            const n = notes[i];
            const y = receptorY - (n.time - t) * ppm;
            if (y < -noteH) break;
            if (n.state === 1) continue;
            if (y > h + noteH) continue;
            const x = fx + n.lane * laneW + pad;
            drawNote(x, y, nw, n.lane, n.state === 2 ? 0.22 : 1);
        }
    }

    // Recorded notes rise from the receptors
    if (state.mode === 'record') {
        const nw = laneW - pad * 2;
        const rec = state.recorded;
        for (let i = rec.length - 1; i >= 0; i--) {
            const y = receptorY - (t - rec[i].time) * ppm;
            if (y < -noteH) break;
            drawNote(fx + rec[i].lane * laneW + pad, y, nw, rec[i].lane, 0.9);
        }
    }

    // Hit bursts
    state.effects = state.effects.filter((fxr) => now - fxr.at < 260);
    for (const e of state.effects) {
        const p = (now - e.at) / 260;
        const grow = rSize * (1 + p * 0.35);
        const x = fx + e.lane * laneW + laneW / 2 - grow / 2;
        roundRect(ctx, x, receptorY - grow / 2, grow, grow, laneW * 0.18);
        ctx.lineWidth = 3 * (1 - p) + 1;
        ctx.strokeStyle = hexA(e.kind === 'perfect' ? '#ffffff' : LANE_COLORS[e.lane], 0.9 * (1 - p));
        ctx.stroke();
    }
    state.particles = state.particles.filter((pt) => now - pt.at < pt.life);
    for (const pt of state.particles) {
        pt.x += pt.vx * dt;
        pt.y += pt.vy * dt;
        pt.vy += 0.0009 * dt;
        const life = 1 - (now - pt.at) / pt.life;
        ctx.fillStyle = hexA(LANE_COLORS[pt.lane], life);
        ctx.fillRect(pt.x - 2, pt.y - 2, 4, 4);
    }

    // Judgment
    const j = state.judgment;
    if (j && state.mode === 'play') {
        const age = now - j.at;
        if (age < 650) {
            const info = JUDGMENTS[j.kind];
            const pop = 1 + 0.22 * Math.exp(-age / 60);
            const alpha = age < 450 ? 1 : 1 - (age - 450) / 200;
            const y = receptorY - laneW * 1.65;
            ctx.save();
            ctx.globalAlpha = alpha;
            ctx.translate(layout.centerX, y);
            ctx.scale(pop, pop);
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.font = `700 ${Math.round(laneW * 0.34)}px Unbounded, "Arial Black", sans-serif`;
            ctx.fillStyle = info.color;
            ctx.fillText(info.label, 0, 0);
            if (j.kind === 'great' || j.kind === 'good') {
                ctx.font = `500 ${Math.round(laneW * 0.15)}px "DM Sans", sans-serif`;
                ctx.fillStyle = 'rgba(230, 233, 239, 0.7)';
                ctx.fillText(j.delta < 0 ? 'Early' : 'Late', 0, laneW * 0.34);
            }
            ctx.restore();
        }
    }

    // Map timing readout after a nudge
    if (state.mode === 'play' && now - state.nudgeAt < 1400) {
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.font = `500 ${Math.round(laneW * 0.17)}px "DM Sans", sans-serif`;
        ctx.fillStyle = `rgba(230, 233, 239, ${clamp((1400 - (now - state.nudgeAt)) / 300, 0, 1)})`;
        ctx.fillText(`Map timing ${formatMs(state.nudge)}`, layout.centerX, h * 0.16);
    }

    // Countdowns: recording lead-in and resuming from pause
    let count = 0;
    if (state.paused && state.resumeAt) count = Math.ceil((state.resumeAt - now) / 500);
    else if (state.mode === 'record' && !state.paused && t < 0) count = Math.ceil(-t / (RECORD_LEAD_IN / 3));
    if (count > 0) {
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.font = `800 ${Math.round(laneW * 1.1)}px Unbounded, "Arial Black", sans-serif`;
        ctx.fillStyle = 'rgba(230, 233, 239, 0.9)';
        ctx.fillText(String(Math.min(count, 3)), layout.centerX, h * 0.42);
        if (state.mode === 'record') {
            ctx.font = `500 ${Math.round(laneW * 0.18)}px "DM Sans", sans-serif`;
            ctx.fillStyle = 'rgba(230, 233, 239, 0.6)';
            ctx.fillText('Tap along with the music', layout.centerX, h * 0.42 + laneW * 0.85);
        }
    }
}

function drawNote(x, y, nw, lane, alpha) {
    const { noteH, laneW } = layout;
    const top = y - noteH / 2;
    ctx.globalAlpha = alpha;
    roundRect(ctx, x, top, nw, noteH, laneW * 0.09);
    ctx.fillStyle = LANE_COLORS[lane];
    ctx.fill();
    // Light top edge gives the note a little body.
    ctx.fillStyle = 'rgba(255, 255, 255, 0.42)';
    roundRect(ctx, x + 4, top + 3, nw - 8, Math.max(3, noteH * 0.16), 2);
    ctx.fill();
    ctx.globalAlpha = 1;
}

// ------------------------------------------------------------------
// Results extras
// ------------------------------------------------------------------

function drawTimingChart(deltas) {
    const canvas = $('timing-chart');
    const c = canvas.getContext('2d');
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const cssW = canvas.clientWidth || 540;
    const cssH = 90;
    canvas.width = Math.round(cssW * dpr);
    canvas.height = Math.round(cssH * dpr);
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.clearRect(0, 0, cssW, cssH);

    const range = WINDOW.good;
    const binMs = 5;
    const bins = new Array(Math.ceil(range * 2 / binMs)).fill(0);
    for (const d of deltas) {
        const b = Math.floor((clamp(d, -range, range - 0.001) + range) / binMs);
        bins[b]++;
    }
    const max = Math.max(1, ...bins);
    const bw = cssW / bins.length;
    bins.forEach((v, i) => {
        if (!v) return;
        const center = Math.abs((i + 0.5) * binMs - range);
        const color = center <= WINDOW.perfect ? JUDGMENTS.perfect.color
            : center <= WINDOW.great ? JUDGMENTS.great.color : JUDGMENTS.good.color;
        const bh = (v / max) * (cssH - 8);
        c.fillStyle = color;
        c.fillRect(i * bw + 1, cssH - bh, Math.max(1, bw - 2), bh);
    });
    c.fillStyle = 'rgba(230, 233, 239, 0.5)';
    c.fillRect(cssW / 2 - 0.5, 0, 1, cssH);

    const mean = deltas.length ? deltas.reduce((a, b) => a + b, 0) / deltas.length : 0;
    $('timing-mean').textContent = deltas.length
        ? `Average ${Math.abs(mean).toFixed(0)} ms ${mean < 0 ? 'early' : 'late'}`
        : 'No hits';
}

// After a run, offer to correct timing if hits leaned early or late.
// Saved maps get their own map timing; fresh recordings use the global offset.
let suggestion = null;
function suggestOffset(deltas) {
    const box = $('offset-suggest');
    box.hidden = true;
    suggestion = null;
    if (deltas.length < 20) return;
    const mean = deltas.reduce((a, b) => a + b, 0) / deltas.length;
    if (Math.abs(mean) < 15) return;
    const lean = `You hit ${Math.abs(mean).toFixed(0)} ms ${mean < 0 ? 'early' : 'late'} on average.`;
    const chart = state.chart;
    if (chart.id !== 'recording') {
        const value = clamp(Math.round(((mapTiming[chart.id] || 0) + mean) / 5) * 5, -2000, 2000);
        suggestion = { kind: 'map', id: chart.id, value };
        $('offset-suggest-text').textContent = `${lean} Set this map's timing to ${formatMs(value)}?`;
    } else {
        const value = clamp(Math.round((settings.offset + mean) / 5) * 5, -250, 250);
        if (value === settings.offset) return;
        suggestion = { kind: 'global', value };
        $('offset-suggest-text').textContent = `${lean} Set the audio offset to ${formatMs(value)}?`;
    }
    box.hidden = false;
}

$('offset-apply').addEventListener('click', () => {
    if (!suggestion) return;
    if (suggestion.kind === 'map') {
        mapTiming[suggestion.id] = suggestion.value;
        store.set('mapTiming', mapTiming);
        toast(`Map timing set to ${formatMs(suggestion.value)}. It applies next time you play this map.`);
    } else {
        settings.offset = suggestion.value;
        saveSettings();
        syncSettingsUI();
        toast(`Audio offset set to ${formatMs(settings.offset)}.`);
    }
    $('offset-suggest').hidden = true;
});

$('timing-minus').addEventListener('click', () => nudgeTiming(-10));
$('timing-plus').addEventListener('click', () => nudgeTiming(10));

// ------------------------------------------------------------------
// Menu
// ------------------------------------------------------------------

function renderMenu() {
    renderLibrary();
    if (detail.key) renderDetail();
    updateKeyHint();
}

function updateKeyHint() {
    const hint = el.keyHint.parentElement;
    if (window.matchMedia('(pointer: coarse)').matches && !window.matchMedia('(any-pointer: fine)').matches) {
        hint.textContent = 'Tap the lanes to hit notes.';
    } else {
        hint.innerHTML = 'Play with <span id="key-hint-keys"></span>. Esc pauses.';
        el.keyHint = $('key-hint-keys');
        el.keyHint.textContent = settings.keyLabels.join(' ');
    }
}

el.importBtn.addEventListener('click', () => {
    el.loadInput.value = '';
    el.loadInput.click();
});

el.loadInput.addEventListener('change', async () => {
    const file = el.loadInput.files && el.loadInput.files[0];
    if (!file) return;
    try {
        const notes = parseBeatmap(await file.text());
        if (!notes.length) {
            toast('That file has no notes. A beatmap is a CSV with a key,time header and one note per line, like "a,1200".', true);
            return;
        }
        const title = file.name.replace(/\.csv$/i, '');
        startPlay({ id: 'import:' + file.name, song: 'night', title, level: 'Imported map', offset: 0 }, notes, el.importBtn);
    } catch (err) {
        console.error(err);
        toast("Couldn't read that file. Choose a .csv beatmap.", true);
    }
});

el.recordBtn.addEventListener('click', () => startRecording(el.recordBtn));
el.pauseBtn.addEventListener('click', pause);
el.resumeBtn.addEventListener('click', resume);
el.finishRecordBtn.addEventListener('click', finishRecording);
el.restartBtn.addEventListener('click', restart);
el.quitBtn.addEventListener('click', quitToMenu);
$('retry-btn').addEventListener('click', restart);
$('results-menu-btn').addEventListener('click', () => confirmDiscard($('results-menu-btn'), quitToMenu));
$('results-download').addEventListener('click', () => { downloadRecording(); $('results-download').hidden = true; });
$('record-download').addEventListener('click', downloadRecording);
$('record-play').addEventListener('click', () => {
    const notes = state.recorded.slice();
    startPlay({ id: 'recording', song: 'night', title: SONGS.night.title, level: 'Your recording', offset: 0 }, notes, $('record-play'));
});
// Leaving the recording screen without downloading asks for a second click.
function resetDiscardButton() {
    $('record-menu').textContent = 'Back to song select';
    $('record-again').textContent = 'Record again';
    $('results-menu-btn').textContent = 'Back to song select';
    for (const id of ['record-menu', 'record-again', 'results-menu-btn']) $(id).classList.remove('btn-danger');
    state.discardArmed = null;
}
function confirmDiscard(button, action) {
    if (state.recordingSaved || state.discardArmed === button) { action(); return; }
    resetDiscardButton();
    state.discardArmed = button;
    button.textContent = 'Discard this recording?';
    button.classList.add('btn-danger');
}
$('record-again').addEventListener('click', () => confirmDiscard($('record-again'), () => startRecording($('record-again'))));
$('record-menu').addEventListener('click', () => confirmDiscard($('record-menu'), quitToMenu));

// ------------------------------------------------------------------
// Library: built-in and shared maps, song pages, leaderboards
// ------------------------------------------------------------------

const online = window.RhythmOnline || { configured: false };
const LIBRARY_PAGE = 20;
const ATTEMPT_LIMIT = 25;
const library = {
    sort: 'new',
    rows: [],                  // map rows from the server (built-in rows included, for play counts)
    loaded: false,
    loading: false,
    done: false,
    error: '',
    seq: 0,
    linked: null,              // shared map opened from a ?map= link
    notes: new Map(),          // map id -> notes, so replays don't refetch
};
const sharedSigs = new Set();  // maps shared from this page, so Share isn't offered twice
const attempts = store.get('attempts', {});   // chart id -> recent runs, newest first
const detail = { key: null, lb: [], lbLoading: false, lbError: '', lbSeq: 0 };

function notesSig(notes) {
    return (notes || []).map((n) => `${n.lane}:${Math.round(n.time)}`).join(',');
}

function plural(n, word) { return `${n.toLocaleString()} ${word}${n === 1 ? '' : 's'}`; }

const dateFormat = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

// ---------- Entries: one shape for built-in and shared maps ----------

function builtinEntry(chart) {
    const row = library.rows.find((r) => r.id === chart.onlineId);
    const notes = chartData.get(chart.id);
    return {
        key: chart.id,
        onlineId: chart.onlineId,
        builtin: true,
        chart,
        title: chart.title,
        level: chart.level,
        accent: LANE_COLORS[chart.accent],
        noteCount: notes ? notes.length : 0,
        durationMs: notes && notes.length ? notes[notes.length - 1].time - notes[0].time : 0,
        plays: row ? Number(row.plays) || 0 : null,
        available: !!(notes && notes.length),
    };
}

function sharedEntry(row) {
    let h = 0;
    for (const c of row.id) h = (h * 31 + c.charCodeAt(0)) >>> 0;
    return {
        key: 'community:' + row.id,
        onlineId: row.id,
        builtin: false,
        row,
        title: row.title,
        level: null,
        author: row.author,
        accent: LANE_COLORS[h % LANE_COUNT],
        noteCount: Number(row.note_count) || 0,
        durationMs: Number(row.duration_ms) || 0,
        plays: Number(row.plays) || 0,
        createdAt: row.created_at,
        owned: online.ownsMap(row.id),
        available: Object.prototype.hasOwnProperty.call(SONGS, row.song),
    };
}

function libraryEntries() {
    const builtinIds = new Set(CHARTS.map((c) => c.onlineId));
    const shared = library.rows.filter((r) => !builtinIds.has(r.id));
    const linked = library.linked;
    if (linked && !builtinIds.has(linked.id) && !shared.some((r) => r.id === linked.id)) shared.unshift(linked);
    return CHARTS.map(builtinEntry).concat(shared.map(sharedEntry));
}

function findEntry(key) { return libraryEntries().find((e) => e.key === key) || null; }

function entryChart(entry) {
    if (entry.builtin) return entry.chart;
    return {
        id: entry.key,
        onlineId: entry.onlineId,
        community: true,
        song: entry.row.song,
        title: entry.title,
        level: `by ${entry.author}`,
        offset: 0,
    };
}

function entryMeta(entry, long = false) {
    const parts = [];
    if (entry.builtin) parts.push(long ? 'Built-in map' : 'Built-in');
    else parts.push(`by ${entry.owned ? 'you' : entry.author}`);
    if (!entry.available) {
        parts.push(entry.builtin ? 'map file missing' : 'needs a song this version of the game doesn’t have');
        return parts.join(', ');
    }
    parts.push(`${plural(entry.noteCount, 'note')} in ${formatDuration(entry.durationMs)}`);
    if (entry.plays !== null) parts.push(plural(entry.plays, 'play'));
    if (long && entry.createdAt) parts.push(`shared ${dateFormat.format(new Date(entry.createdAt))}`);
    return parts.join(', ');
}

// ---------- Library list ----------

for (const btn of document.querySelectorAll('.seg')) {
    btn.addEventListener('click', () => {
        if (library.sort === btn.dataset.sort) return;
        library.sort = btn.dataset.sort;
        for (const b of document.querySelectorAll('.seg')) b.setAttribute('aria-pressed', String(b === btn));
        loadLibrary(true);
    });
}
$('library-refresh').addEventListener('click', () => loadLibrary(true));
$('library-more').addEventListener('click', () => loadLibrary(false));

async function loadLibrary(reset) {
    if (!online.configured) { renderLibrary(); return; }
    if (!reset && library.loading) return;
    const seq = ++library.seq;
    if (reset) { library.rows = []; library.done = false; }
    library.loading = true;
    library.error = '';
    renderLibrary();
    try {
        const rows = await online.listMaps({ sort: library.sort, limit: LIBRARY_PAGE, offset: library.rows.length });
        if (seq !== library.seq) return;              // a newer request replaced this one
        for (const r of rows) if (!library.rows.some((x) => x.id === r.id)) library.rows.push(r);
        library.done = rows.length < LIBRARY_PAGE;
        library.loaded = true;
    } catch (err) {
        if (seq !== library.seq) return;
        library.error = err.message;
    } finally {
        if (seq === library.seq) {
            library.loading = false;
            renderLibrary();
            if (detail.key) renderDetail();
        }
    }
}

function renderLibrary() {
    const list = $('library-list');
    const status = $('library-status');
    list.innerHTML = '';
    const entries = libraryEntries();
    for (const entry of entries) list.appendChild(libraryRow(entry));

    const sharedCount = entries.filter((e) => !e.builtin).length;
    if (!online.configured) status.textContent = 'Shared maps and leaderboards aren’t set up yet. Add your Supabase key to supabase-config.js.';
    else if (library.loading) status.textContent = 'Loading shared maps…';
    else if (library.error) status.textContent = library.error;
    else if (library.loaded && !sharedCount) status.textContent = 'No one has shared a map yet. Record one, then choose Share online.';
    else status.textContent = '';
    $('library-more').hidden = !online.configured || library.done || library.loading || !!library.error || !library.rows.length;
    $('library-refresh').hidden = !online.configured;
}

function libraryRow(entry) {
    const li = document.createElement('li');
    if (library.linked && entry.onlineId === library.linked.id) li.classList.add('linked');
    const btn = document.createElement('button');
    btn.className = 'chart';
    btn.dataset.key = entry.key;
    btn.style.setProperty('--accent', entry.accent);

    const name = document.createElement('span');
    name.className = 'chart-name';
    if (li.classList.contains('linked')) {
        const tag = document.createElement('span');
        tag.className = 'chart-tag';
        tag.textContent = 'Shared with you';
        name.appendChild(tag);
    }
    name.append(entry.title);
    if (entry.level) {
        const level = document.createElement('span');
        level.className = 'chart-level';
        level.textContent = entry.level;
        name.appendChild(level);
    }

    const meta = document.createElement('span');
    meta.className = 'chart-meta';
    meta.textContent = entryMeta(entry);

    const best = document.createElement('span');
    best.className = 'chart-best';
    const b = bests[entry.key];
    if (b) {
        const strong = document.createElement('strong');
        strong.textContent = b.grade;
        best.append(strong, Math.round(b.score).toLocaleString());
    } else {
        best.textContent = 'Not played';
    }

    btn.append(name, meta, best);
    btn.addEventListener('click', () => openDetail(entry.key));
    li.appendChild(btn);
    return li;
}

function forgetSharedMap(id) {
    library.rows = library.rows.filter((r) => r.id !== id);
    if (library.linked && library.linked.id === id) library.linked = null;
    library.notes.delete(id);
    if (detail.key === 'community:' + id) closeDetail();
    else renderLibrary();
}

// ---------- Song page ----------

function openDetail(key, { focus = true } = {}) {
    if (!findEntry(key)) return;
    if (detail.key !== key) {
        detail.lb = [];
        detail.lbError = '';
        detail.lbSeq++;
        detail.lbLoading = false;
    }
    detail.key = key;
    $('library-view').hidden = true;
    $('detail-view').hidden = false;
    $('menu').scrollTop = 0;
    renderDetail();
    loadLeaderboard();
    if (focus) $('detail-start').focus();
}

function closeDetail() {
    const key = detail.key;
    detail.key = null;
    detail.lbSeq++;
    $('detail-view').hidden = true;
    $('library-view').hidden = false;
    renderLibrary();
    const row = key && document.querySelector(`#library-list .chart[data-key="${CSS.escape(key)}"]`);
    if (row) row.focus();
}

function renderDetail() {
    const entry = findEntry(detail.key);
    if (!entry) { closeDetail(); return; }

    const title = $('detail-title');
    title.textContent = entry.title;
    title.style.setProperty('--accent', entry.accent);
    if (entry.level) {
        const level = document.createElement('span');
        level.className = 'chart-level';
        level.textContent = entry.level;
        title.appendChild(level);
    }
    $('detail-meta').textContent = entryMeta(entry, true);

    const start = $('detail-start');
    start.disabled = !entry.available || starting;
    if (!starting) start.textContent = 'Start';

    $('detail-speed').value = settings.speed;
    $('detail-speed-out').textContent = Number(settings.speed).toFixed(1);
    $('detail-timing-value').textContent = formatMs(mapTiming[entry.key] || 0);

    $('detail-copy').hidden = !(online.configured && entry.onlineId);
    const del = $('detail-delete');
    del.hidden = !entry.owned;
    disarmDelete();

    renderLeaderboard();
    renderAttempts();
}

function boardRow(cells, className) {
    const li = document.createElement('li');
    li.className = 'board-row' + (className ? ' ' + className : '');
    for (const [cls, text] of cells) {
        const span = document.createElement('span');
        span.className = cls;
        span.textContent = text;
        li.appendChild(span);
    }
    return li;
}

function renderLeaderboard() {
    const ol = $('leaderboard');
    const status = $('lb-status');
    ol.innerHTML = '';
    const entry = findEntry(detail.key);
    const enabled = online.configured && entry && entry.onlineId;
    $('lb-refresh').hidden = !enabled;
    if (!enabled) {
        status.textContent = 'Leaderboards need online maps. Add your Supabase key to supabase-config.js.';
        return;
    }
    let prevRank = 0;
    for (const r of detail.lb) {
        if (prevRank && Number(r.rank) > prevRank + 1) ol.appendChild(boardRow([['gap', '…']], 'board-gap'));
        prevRank = Number(r.rank);
        const li = boardRow([
            ['rank', `#${r.rank}`],
            ['who', r.mine ? `${r.player_name} (you)` : r.player_name],
            ['g', r.grade],
            ['num', Number(r.score).toLocaleString()],
            ['acc', `${Number(r.accuracy).toFixed(2)}%`],
        ], r.mine ? 'mine' : '');
        li.querySelector('.g').dataset.grade = r.grade;
        ol.appendChild(li);
    }
    if (detail.lbLoading && !detail.lb.length) status.textContent = 'Loading leaderboard…';
    else if (detail.lbError) status.textContent = detail.lbError;
    else if (!detail.lb.length) status.textContent = 'No scores yet. Finish a run to set the first one.';
    else status.textContent = '';
}

async function loadLeaderboard() {
    const entry = findEntry(detail.key);
    if (!online.configured || !entry || !entry.onlineId) { renderLeaderboard(); return; }
    const seq = ++detail.lbSeq;
    detail.lbLoading = true;
    detail.lbError = '';
    renderLeaderboard();
    try {
        const rows = await online.getLeaderboard(entry.onlineId, 10);
        if (seq !== detail.lbSeq) return;
        detail.lb = rows;
    } catch (err) {
        if (seq !== detail.lbSeq) return;
        detail.lbError = err.message;
    } finally {
        if (seq === detail.lbSeq) {
            detail.lbLoading = false;
            renderLeaderboard();
        }
    }
}

function renderAttempts() {
    const ol = $('attempts');
    const status = $('attempts-status');
    ol.innerHTML = '';
    const list = attempts[detail.key] || [];
    const bestScore = Math.max(-1, ...list.map((a) => a.score));
    let markedBest = false;
    for (const a of list.slice(0, 10)) {
        const isBest = !markedBest && a.score === bestScore;
        if (isBest) markedBest = true;
        const li = boardRow([
            ['when', dateFormat.format(new Date(a.at))],
            ['g', a.grade],
            ['num', Math.round(a.score).toLocaleString()],
            ['acc', `${Number(a.acc).toFixed(2)}%`],
        ], isBest ? 'best' : '');
        li.querySelector('.g').dataset.grade = a.grade;
        if (isBest) li.title = 'Your best run';
        ol.appendChild(li);
    }
    const older = list.length > 10 ? ` Showing your 10 latest of ${list.length}.` : '';
    status.textContent = list.length ? older.trim() : 'You haven’t played this map yet.';
}

function recordAttempt(chartId, run) {
    const list = attempts[chartId] || (attempts[chartId] = []);
    list.unshift(run);
    if (list.length > ATTEMPT_LIMIT) list.length = ATTEMPT_LIMIT;
    store.set('attempts', attempts);
}

$('detail-back').addEventListener('click', closeDetail);
$('lb-refresh').addEventListener('click', loadLeaderboard);

$('detail-start').addEventListener('click', async () => {
    const btn = $('detail-start');
    const entry = findEntry(detail.key);
    if (starting || !entry || !entry.available) return;
    let notes;
    if (entry.builtin) {
        notes = chartData.get(entry.key);
    } else {
        notes = library.notes.get(entry.onlineId) || (Array.isArray(entry.row.notes) && entry.row.notes.length ? entry.row.notes : null);
        if (!notes) {
            btn.disabled = true;
            btn.textContent = 'Loading map…';
            try {
                const full = await online.getMap(entry.onlineId);
                if (!full) {
                    toast('This map has been deleted.', true);
                    forgetSharedMap(entry.onlineId);
                    return;
                }
                notes = full.notes;
            } catch (err) {
                toast(err.message, true);
                return;
            } finally {
                btn.disabled = false;
                btn.textContent = 'Start';
            }
            library.notes.set(entry.onlineId, notes);
        }
    }
    startPlay(entryChart(entry), notes, btn);
});

$('detail-speed').addEventListener('input', () => {
    settings.speed = Number($('detail-speed').value);
    $('detail-speed-out').textContent = settings.speed.toFixed(1);
    saveSettings();
    syncSettingsUI();
});

function stepDetailTiming(delta) {
    const key = detail.key;
    if (!key) return;
    mapTiming[key] = clamp((mapTiming[key] || 0) + delta, -2000, 2000);
    store.set('mapTiming', mapTiming);
    $('detail-timing-value').textContent = formatMs(mapTiming[key]);
}
$('detail-timing-minus').addEventListener('click', () => stepDetailTiming(-10));
$('detail-timing-plus').addEventListener('click', () => stepDetailTiming(10));

$('detail-copy').addEventListener('click', async () => {
    const entry = findEntry(detail.key);
    if (!entry) return;
    const btn = $('detail-copy');
    const link = online.mapLink(entry.onlineId);
    try {
        await navigator.clipboard.writeText(link);
        btn.textContent = 'Link copied';
    } catch {
        toast(`Copy this link: ${link}`);
    }
    setTimeout(() => { btn.textContent = 'Copy link'; }, 2000);
});

function disarmDelete() {
    const del = $('detail-delete');
    del.dataset.armed = '';
    del.textContent = 'Delete map';
    del.classList.remove('btn-danger');
    del.disabled = false;
}
$('detail-delete').addEventListener('click', async () => {
    const del = $('detail-delete');
    const entry = findEntry(detail.key);
    if (!entry || !entry.owned) return;
    if (del.dataset.armed !== 'true') {
        del.dataset.armed = 'true';
        del.textContent = 'Delete this map and its leaderboard?';
        del.classList.add('btn-danger');
        setTimeout(() => { if (del.dataset.armed === 'true') disarmDelete(); }, 5000);
        return;
    }
    del.disabled = true;
    try {
        const deleted = await online.deleteMap(entry.onlineId);
        toast(deleted ? `Deleted “${entry.title}”.` : 'That map was already deleted.');
        forgetSharedMap(entry.onlineId);
    } catch (err) {
        disarmDelete();
        toast(err.message, true);
    }
});

// ---------- After a run: plays, attempts, leaderboard ----------

function countLibraryPlay(id) {
    online.countPlay && online.countPlay(id);
    for (const r of [...library.rows, library.linked]) if (r && r.id === id) r.plays = (Number(r.plays) || 0) + 1;
}

let pendingPost = null;
let postSeq = 0;

function showPostForm(show) {
    $('lb-name-form').hidden = !show;
    if (show) $('lb-name').value = '';
}

async function postScore() {
    const run = pendingPost;
    if (!run) return;
    const seq = ++postSeq;
    const text = $('lb-post-text');
    $('lb-retry').hidden = true;
    const name = String(store.get('playerName', '') || '').trim();
    if (!name) {
        text.textContent = 'Add your name to post this score to the leaderboard.';
        showPostForm(true);
        return;
    }
    showPostForm(false);
    text.textContent = 'Posting to the leaderboard…';
    try {
        const r = await online.submitScore({ mapId: run.mapId, name, score: run.score, maxCombo: run.maxCombo, counts: run.counts });
        if (seq !== postSeq) return;
        pendingPost = null;
        const place = `#${r.rank} of ${r.total}`;
        text.textContent = r.improved
            ? (r.total === 1 ? 'Posted. You’re the first on this leaderboard.' : `New personal best, ranked ${place}.`)
            : `Posted. Your best is still ${Number(r.best).toLocaleString()}, ranked ${place}.`;
    } catch (err) {
        if (seq !== postSeq) return;
        text.textContent = err.message;
        // Only offer a retry when trying again could help (connection or server trouble).
        $('lb-retry').hidden = err.code === '22023';
    }
}

$('lb-retry').addEventListener('click', postScore);
$('lb-name-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const name = $('lb-name').value.trim();
    if (!name) { $('lb-name').focus(); return; }
    store.set('playerName', name.slice(0, 24));
    syncSettingsUI();
    postScore();
});

function afterLibraryRun(chart, run) {
    const box = $('lb-post');
    pendingPost = null;
    postSeq++;
    showPostForm(false);
    $('lb-retry').hidden = true;
    if (!chart.onlineId) { box.hidden = true; return; }
    recordAttempt(chart.id, run);
    countLibraryPlay(chart.onlineId);
    box.hidden = false;
    if (!online.configured) {
        $('lb-post-text').textContent = 'Saved to your attempts. Leaderboards need online maps to be set up.';
        return;
    }
    pendingPost = { mapId: chart.onlineId, score: run.score, maxCombo: run.combo, counts: run.counts };
    postScore();
}

async function openSharedLink() {
    const id = new URLSearchParams(location.search).get('map') || '';
    const builtin = CHARTS.find((c) => c.onlineId === id);
    if (builtin) { openDetail(builtin.id, { focus: false }); return; }
    if (!online.configured) return;
    if (!online.UUID_RE.test(id)) {
        toast('That map link is incomplete. Ask for the link again.', true);
        return;
    }
    try {
        const row = await online.getMap(id);
        if (!row) {
            toast('That shared map was deleted.', true);
            return;
        }
        library.linked = row;
        library.notes.set(row.id, row.notes);
        renderLibrary();
        if (state.screen === 'menu' || state.screen === 'loading') openDetail('community:' + row.id, { focus: false });
    } catch (err) {
        toast(err.message, true);
    }
}

// ---------- Sharing ----------

const shareDialog = $('share-dialog');
let shareJob = null;   // { notes, song, onShared }

function openShare(notes, defaultTitle, song, onShared) {
    if (!online.configured) return;
    shareJob = { notes, song, onShared };
    $('share-edit').hidden = false;
    $('share-done').hidden = true;
    $('share-error').hidden = true;
    $('share-map-title').value = defaultTitle.slice(0, online.LIMITS.title);
    $('share-author').value = store.get('playerName', '');
    const last = notes.length ? notes[notes.length - 1].time : 0;
    $('share-summary').textContent = `${notes.length} note${notes.length === 1 ? '' : 's'} over ${formatDuration(last)}, played to ${SONGS[song].title}.`;
    $('share-submit').disabled = false;
    $('share-submit').textContent = 'Share map';
    $('share-copy').textContent = 'Copy link';
    shareDialog.showModal();
    ($('share-author').value ? $('share-map-title') : $('share-author')).focus();
}

$('share-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!shareJob || $('share-submit').disabled) return;
    const title = $('share-map-title').value.trim();
    const author = $('share-author').value.trim();
    const error = $('share-error');
    if (!title || !author) {
        error.textContent = !title ? 'Give the map a title.' : 'Enter your name so players know who made it.';
        error.hidden = false;
        (!title ? $('share-map-title') : $('share-author')).focus();
        return;
    }
    error.hidden = true;
    const submit = $('share-submit');
    submit.disabled = true;
    submit.textContent = 'Sharing…';
    const job = shareJob;
    try {
        const row = await online.shareMap({ title, author, song: job.song, notes: job.notes });
        store.set('playerName', author);
        sharedSigs.add(notesSig(job.notes));
        library.notes.set(row.id, job.notes.slice());
        if (library.loaded && library.sort === 'new') {
            const firstShared = library.rows.findIndex((r) => !r.featured);
            library.rows.splice(firstShared === -1 ? library.rows.length : firstShared, 0, row);
        }
        renderLibrary();
        if (job.onShared) job.onShared(row);
        $('share-link').value = online.mapLink(row.id);
        $('share-edit').hidden = true;
        $('share-done').hidden = false;
        $('share-copy').focus();
    } catch (err) {
        error.textContent = err.message;
        error.hidden = false;
    } finally {
        submit.disabled = false;
        submit.textContent = 'Share map';
    }
});

$('share-copy').addEventListener('click', async () => {
    const input = $('share-link');
    const btn = $('share-copy');
    let ok = true;
    try {
        await navigator.clipboard.writeText(input.value);
    } catch {
        input.select();
        try { ok = document.execCommand('copy'); } catch { ok = false; }
    }
    // A toast would sit behind the open dialog, so the button reports instead.
    btn.textContent = ok ? 'Copied' : 'Select the link and copy it';
    if (!ok) input.select();
    setTimeout(() => { btn.textContent = 'Copy link'; }, 2000);
});
$('share-cancel').addEventListener('click', () => shareDialog.close());
$('share-close').addEventListener('click', () => shareDialog.close());
shareDialog.addEventListener('close', () => {
    dialogClosedAt = performance.now();
    shareJob = null;
});

$('record-share').addEventListener('click', () => {
    openShare(state.recorded, `${SONGS.night.title} recording`, 'night', () => {
        state.recordingSaved = true;
        resetDiscardButton();
        $('record-share').hidden = true;
    });
});
$('results-share').addEventListener('click', () => {
    const chart = state.chart;
    const defaultTitle = chart.id === 'recording' ? `${SONGS.night.title} recording` : chart.title;
    // Bake in any map timing the player dialed in, so others get the corrected map.
    const shift = chart.id === 'recording' ? 0 : (mapTiming[chart.id] || 0);
    const notes = state.sourceNotes.map((n) => ({ lane: n.lane, time: n.time + shift }));
    openShare(notes, defaultTitle, chart.song, () => {
        if (chart.id.startsWith('import:')) sharedSigs.add('chart:' + chart.id);
        if (chart.id === 'recording') {
            state.recordingSaved = true;
            resetDiscardButton();
            $('results-download').hidden = true;
        }
        $('results-share').hidden = true;
    });
});

// ------------------------------------------------------------------
// Settings
// ------------------------------------------------------------------

const speedInput = $('set-speed');
const offsetInput = $('set-offset');
const volumeInput = $('set-volume');
const ghostInput = $('set-ghost');

function keyLabel(e) {
    const arrows = { ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→' };
    if (arrows[e.key]) return arrows[e.key];
    if (e.key === ' ') return 'Space';
    if (!e.key || e.key === 'Unidentified' || e.key === 'Dead') return e.code.replace(/^(Key|Digit)/, '');
    if (e.key.length === 1) return e.key.toUpperCase();
    return e.key;
}

function renderKeybinds() {
    el.keybinds.innerHTML = '';
    for (let i = 0; i < LANE_COUNT; i++) {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'keycap' + (rebindLane === i ? ' listening' : '');
        b.style.setProperty('--accent', LANE_COLORS[i]);
        b.textContent = rebindLane === i ? 'Press a key' : settings.keyLabels[i];
        b.setAttribute('aria-label', `Lane ${i + 1} key: ${settings.keyLabels[i]}`);
        b.addEventListener('click', () => {
            rebindLane = rebindLane === i ? -1 : i;
            renderKeybinds();
            if (rebindLane !== -1) el.keybinds.children[i].focus();
        });
        el.keybinds.appendChild(b);
    }
}

window.addEventListener('keydown', (e) => {
    if (rebindLane === -1) return;
    e.stopPropagation();
    if (e.code === 'Tab') {             // let Tab move focus as usual
        const lane = rebindLane;
        rebindLane = -1;
        el.keybinds.children[lane].classList.remove('listening');
        el.keybinds.children[lane].textContent = settings.keyLabels[lane];
        return;
    }
    e.preventDefault();
    if (e.code === 'Escape') { const lane = rebindLane; rebindLane = -1; renderKeybinds(); el.keybinds.children[lane].focus(); return; }
    if (e.code === 'Enter' || e.repeat) return;
    const lane = rebindLane;
    const existing = settings.keys.indexOf(e.code);
    if (existing !== -1 && existing !== lane) {
        // Swap so two lanes never share a key.
        settings.keys[existing] = settings.keys[lane];
        settings.keyLabels[existing] = settings.keyLabels[lane];
    }
    settings.keys[lane] = e.code;
    settings.keyLabels[lane] = keyLabel(e);
    rebindLane = -1;
    saveSettings();
    renderKeybinds();
    el.keybinds.children[lane].focus();
    updateKeyHint();
}, true);

function syncSettingsUI() {
    speedInput.value = settings.speed;
    $('set-speed-out').textContent = Number(settings.speed).toFixed(1);
    offsetInput.value = settings.offset;
    $('set-offset-out').textContent = `${settings.offset > 0 ? '+' : ''}${settings.offset} ms`;
    volumeInput.value = settings.volume;
    $('set-volume-out').textContent = `${settings.volume}%`;
    ghostInput.checked = !!settings.ghostPenalty;
    if (document.activeElement !== $('set-name')) $('set-name').value = store.get('playerName', '') || '';
}

speedInput.addEventListener('input', () => { settings.speed = Number(speedInput.value); saveSettings(); syncSettingsUI(); });
offsetInput.addEventListener('input', () => {
    const next = Number(offsetInput.value);
    // Move the paused clock by the same amount so the change shows right away,
    // and release the monotonic clamp so time can move backwards once.
    if (state.mode && state.paused) state.pausedAt -= next - settings.offset;
    state.lastTime = -Infinity;
    settings.offset = next;
    saveSettings();
    syncSettingsUI();
});
volumeInput.addEventListener('input', () => { settings.volume = Number(volumeInput.value); audio.applyVolume(); saveSettings(); syncSettingsUI(); });
ghostInput.addEventListener('change', () => { settings.ghostPenalty = ghostInput.checked; saveSettings(); });
$('set-name').addEventListener('change', () => { store.set('playerName', $('set-name').value.trim().slice(0, 24)); });

function openSettings() {
    rebindLane = -1;
    syncSettingsUI();
    renderKeybinds();
    el.settings.showModal();
}

el.settings.addEventListener('cancel', (e) => {
    if (rebindLane !== -1) e.preventDefault();
});
el.settings.addEventListener('close', () => {
    rebindLane = -1;
    dialogClosedAt = performance.now();
    renderMenu();
    if (state.screen === 'pause') el.resumeBtn.focus();
});
el.settingsBtn.addEventListener('click', openSettings);
el.pauseSettingsBtn.addEventListener('click', openSettings);

// ------------------------------------------------------------------
// Boot
// ------------------------------------------------------------------

// On non-QWERTY layouts the default physical keys print different letters
// (A is Q on AZERTY). Label them by what the keyboard actually shows.
async function labelKeysForLayout() {
    try {
        if (!navigator.keyboard || !navigator.keyboard.getLayoutMap) return;
        const map = await navigator.keyboard.getLayoutMap();
        settings.keys.forEach((code, i) => {
            const k = map.get(code);
            if (k && settings.keyLabels[i] === DEFAULT_SETTINGS.keyLabels[DEFAULT_SETTINGS.keys.indexOf(code)]) {
                settings.keyLabels[i] = k.length === 1 ? k.toUpperCase() : k;
            }
        });
    } catch { /* not available: keep the stored labels */ }
}

async function boot() {
    layout.resize();
    requestAnimationFrame(frame);

    const results = await Promise.allSettled(CHARTS.map(loadChart));
    const failed = results.some((r) => r.status === 'rejected');

    // Start downloading the song now so the first play starts quickly.
    audio.prefetch(SONGS.night.src).catch(() => {});

    try { await Promise.race([document.fonts.ready, new Promise((r) => setTimeout(r, 1500))]); } catch { /* ignore */ }

    await labelKeysForLayout();
    renderMenu();
    setScreen('menu');
    loadLibrary(true);                                                        // shared maps load in the background
    if (new URLSearchParams(location.search).has('map')) openSharedLink();
    if (failed) toast(loadErrorMessage(results.find((r) => r.status === 'rejected').reason), true);
}

// Exposed for automated tests and debugging.
window.__rhythm = { state, settings, layout, parseBeatmap, beatmapToCSV, WINDOW };

boot();

})();

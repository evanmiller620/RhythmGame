# Rhythm

A four-lane rhythm game that runs in the browser.

**Play it:** [https://evanmiller620.github.io/RhythmGame/](https://evanmiller620.github.io/RhythmGame/)

## How to play

Notes fall toward the receptors at the bottom of the screen. Press the lane's key as the note crosses the line.

| Lane | Default key |
| ---- | ----------- |
| ← | A |
| ↓ | S |
| ↑ | K |
| → | L |

On a touchscreen, tap the lanes. Press **Esc** to pause. Keys, scroll speed, audio offset and volume are in **Settings** and are saved in your browser.

Hits are judged Perfect (±40 ms), Great (±80 ms) or Good (±125 ms). Anything later is a miss, and so is a press 125–170 ms early. Your combo multiplies points up to 2×. The results screen shows your grade, a timing chart, and a suggested audio offset if your hits lean early or late.

## Beatmaps

A beatmap is a CSV file with a `key,time` header and one note per line: the lane (`a`, `s`, `k` or `l`) and the time in milliseconds from the start of the song.

```csv
key,time
a,2921
s,3113
```

- **Record beatmap** plays the song and records every key you press. When you finish (or open the pause menu and choose *Finish recording*), you can download the CSV or play it right away.
- **Import beatmap** plays any CSV in that format against the song.

The built-in maps in `assets/` were made with the first version of the game. It spawned each note at the top of the screen at its CSV time and let it fall for about a second, so notes were hit roughly 0.5–0.6 s after their CSV time. A per-map offset in `rythm.js` (`CHARTS`) reproduces that.

If a map feels early or late, adjust its timing while you play with the **−** and **=** keys (hold Shift for 50 ms steps), or with the Map timing buttons in the pause menu. Each map remembers its own setting, and the results screen suggests one based on your hits.

## Library, leaderboards and shared maps

The song-select screen is one **Library**: the two built-in Night maps are pinned at the top, followed by maps other players have shared (sort by newest or most played).

Click a map to open its page:

- **Start** the map, after setting scroll speed and map timing for it.
- **Leaderboard:** the top 10 players' best scores, plus your own place if you're further down. Every finished run is posted automatically. The first time, the results screen asks for a name (you can change it later in Settings).
- **Your attempts:** your last runs on this map in this browser, with your best marked.
- **Copy link** to send someone straight to the map (`?map=<id>`), and **Delete map** for maps you shared.

Sharing works as before: after recording (or after playing an imported map), choose **Share online**. Only the browser that shared a map can delete it, and deleting a map also removes its leaderboard. As the project owner, you can delete any map or score from the Supabase dashboard.

Everything is stored in the Supabase project this repo shares with Coup, under names prefixed `rhythm_`, so nothing touches Coup's tables.

### One-time setup

1. In the Supabase dashboard, open **SQL Editor**, paste the contents of `supabase/rhythm_schema.sql`, and run it. It's safe to run again: if you ran an earlier version, running the new one upgrades it in place and keeps existing shared maps. Notices like "already exists, skipping" are expected.
2. Open **Project Settings → API** and copy the **anon public** (or **publishable**) key.
3. Paste it into `supabase-config.js` as `anonKey`. This key is meant to be public, because row-level security decides what it can do. Never use the `service_role` / secret key here.

Without a key, the game still works: the Library shows the built-in maps, and your attempts are saved in the browser, but there are no shared maps or leaderboards.

### What the server allows

- Anyone can read maps and leaderboards and share new maps. Nobody can edit a map after sharing it.
- Scores can only be posted through `rhythm_submit_score()`, which checks them against the map: the judgments must add up to the map's notes, the combo can't exceed the hits, and the score must be possible for those judgments. The server works out accuracy and grade itself. Each player keeps only their best score per map, and player ids are never returned by the API.
- Play counts only change through `rhythm_count_play()`. Maps can only be deleted with the token held by the browser that shared them, and the built-in maps can't be deleted at all.

There is no sign-in, so a determined player could still post a made-up score that passes these checks, or flood the map list. Remove bad rows in the dashboard. Adding Supabase Auth would be the next step if that becomes a problem.

## Running locally

Browsers won't load the song from a `file://` page, so serve the folder:

```sh
npx serve .
# or
python3 -m http.server
```

Then open the address it prints.

## Project layout

- `index.html` – page structure and screens
- `rythm.js` – game engine (audio clock, judging, rendering, recording, settings)
- `rythm.css` – styles
- `online.js` – client for shared maps and leaderboards (Supabase REST API, no SDK)
- `supabase-config.js` – Supabase URL and public key
- `supabase/rhythm_schema.sql` – tables, security rules and functions for shared maps and leaderboards (safe to re-run)
- `night.mp3` – the song
- `assets/` – beatmaps, background image, and bundled fonts (Unbounded and DM Sans, SIL Open Font License)

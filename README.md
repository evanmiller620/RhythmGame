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

## Community maps (online)

Players can share the maps they record, and anyone can browse and play them under **Community** on the song-select screen.

- **Share:** after recording (or after playing an imported map), choose **Share online**, then give it a title and your name. You get a link that opens the map directly (`?map=<id>`).
- **Browse:** sort by newest or most played. Plays are counted when someone finishes a map.
- **Delete:** only the browser that shared a map can delete it (**Delete** on the row). Clearing your browser's site data loses that ability. As the project owner, you can delete any map from the Supabase dashboard.

Maps are stored in the Supabase project this repo shares with Coup. Everything is prefixed `rhythm_`, so nothing touches Coup's tables.

### One-time setup

1. In the Supabase dashboard, open **SQL Editor**, paste the contents of `supabase/rhythm_schema.sql`, and run it once.
2. Open **Project Settings → API** and copy the **anon public** (or **publishable**) key.
3. Paste it into `supabase-config.js` as `anonKey`. This key is meant to be public, because row-level security decides what it can do. Never use the `service_role` / secret key here.

Without a key, the game runs normally and the Community tab explains that online maps aren't set up.

### What the server allows

Anyone can read maps and share new ones. Nobody can edit a map after sharing it, change its play count except through `rhythm_count_play()`, or delete a map without the token held by the browser that shared it. Maps are checked on the server: 1–5000 notes, lanes 0–3, times 0–20 minutes, titles up to 60 characters, names up to 24.

There is no sign-in and no per-player rate limit, so anyone could flood the list with maps. If that becomes a problem, delete the rows in the dashboard. Adding Supabase Auth or a rate-limiting Edge Function would be the next step.

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
- `online.js` – client for the community map server (Supabase REST API, no SDK)
- `supabase-config.js` – Supabase URL and public key
- `supabase/rhythm_schema.sql` – tables, security rules and functions for community maps
- `night.mp3` – the song
- `assets/` – beatmaps, background image, and bundled fonts (Unbounded and DM Sans, SIL Open Font License)

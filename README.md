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
- `night.mp3` – the song
- `assets/` – beatmaps, background image, and bundled fonts (Unbounded and DM Sans, SIL Open Font License)

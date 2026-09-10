# CatatMD Demo Recorder

Operator handoff for recording a normal consultation with synthetic data. This suite was adapted from Perch's `scripts/demo` suite; its source describes inherited MakanLah/Cekgu lineage.

## Preparation Status

The port has offline tests. **No browser workflow, production interaction, recording, or speech synthesis was run during preparation.** Offline checks do not establish that the current deployed UI works with these selectors. The recording operator must review the resulting video before sharing it.

## Workflow And Safety

1. Authenticate a dedicated synthetic-only account offscreen.
2. Register a uniquely named synthetic adult patient.
3. Start a consultation and select **Paste**.
4. Submit `backend/src/fixtures/demo-consultation.txt` and wait for persistence.
5. Run analysis through the application's existing API and de-identification boundary.
6. Show the note and safety panels, including empty states where applicable.
7. Stop at **Awaiting Review**. Never approve the note.

Both recording and browser shot checks **create persistent records and invoke potentially billable analysis**. They are not read-only. Obtain authorization for the target and use an account that has no real patient data. The suite does not clean up created records.

Credentials and cookies stay in memory; authentication happens before the recording context opens. Browser error bodies are withheld. The recording context blocks mutations other than patient/consultation creation, transcript-only consultation PATCH, and analysis. These controls are defense in depth, not a substitute for a synthetic-only account.

## Operator Dependencies

| Component | Requirement |
| --- | --- |
| Runtime | Node 24 or Bun; Bash and Python 3 |
| Browser | External Playwright installation with Chromium; set `DEMO_PLAYWRIGHT` to its module entry path |
| Media | `ffmpeg` with libx264, libvpx and subtitle support; `ffprobe` |
| Narration | Local Python environment containing `kokoro-onnx` and `soundfile`; licensed model and voice files |
| Optional PDF Deck | `pdfinfo`, `pdftoppm`, and an operator-supplied PDF |

Keep dependencies, models, credentials, and all generated outputs outside this repository. Do not add Playwright to the application dependencies. Installing browser/model dependencies is an operator setup step and can require network access.

## Offline Verification

From the repository root:

```bash
bun run demo:offline
DEMO_URL=http://localhost:5173 bun scripts/demo/record.mjs --offline-check
bun scripts/demo/record.mjs --help
```

These commands do not connect to the application. Media tests use tiny generated local fixtures and mock speech, never Playwright or a TTS model. Tests requiring absent media/PDF tools are skipped; inspect the test summary. Root `bun run test` also includes this suite.

## Recording Later

Set the frontend origin explicitly. There is no production URL default. Remote origins must use HTTPS and require `DEMO_ALLOW_PRODUCTION=1`; localhost HTTP is allowed.

```bash
export DEMO_URL='https://your-authorized-frontend.example'
export DEMO_ALLOW_PRODUCTION=1
export DEMO_PLAYWRIGHT='/absolute/path/to/external/playwright/index.mjs'
export DEMO_DIR="$HOME/.cache/catatmd-demo"
read -r -p 'Synthetic account email: ' DEMO_EMAIL
read -r -s -p 'Synthetic account password: ' DEMO_PASSWORD
printf '\n'
export DEMO_EMAIL DEMO_PASSWORD
bun scripts/demo/record.mjs
unset DEMO_EMAIL DEMO_PASSWORD
```

Do not put actual credentials in command history, tracked files, screenshots, or logs. Configure secrets through an appropriate local mechanism for unattended operation. The command above is for an operator's Bash terminal.

The recorder creates a fresh `take-*` child directory. On success it prints that directory and `[demo-take-ok]`. Set `DEMO_DIR` to **that exact child**, not the parent, for post-processing. A successful take contains `capture.webm`, `beats.json`, and `take-ok` with `catatmd-demo-v1`. Never manufacture that marker for a failed take.

Optional controls: `DEMO_HEADLESS=false` shows the browser; `DEMO_TIMEOUT_MS` changes ordinary UI timeouts (default 30000). Analysis has a separate 180-second wait. Nominal shot holds are not an end-to-end duration guarantee.

`bun scripts/demo/check-shots.mjs` runs the same mutating workflow without recording video. Use it only when authorized to create another patient and consultation; it is not necessary before every recording.

## Narration And Export

Set `KOKORO_HOME` to a local model directory containing `kokoro-v1.0.onnx`, `voices-v1.0.bin`, and optionally `.venv/bin/python`. `DEMO_PYTHON` overrides the interpreter. Verify the actual model filenames against `speak.py` before staging a different model version.

```bash
export DEMO_DIR='/absolute/path/to/the/successful/take-directory'
export KOKORO_HOME="$HOME/.local/share/catatmd-demo/kokoro"
bash scripts/demo/narrate.sh
```

Default export: `$DEMO_DIR/CatatMD-Demo.mp4`. `DEMO_OUT` overrides it. Narration requires the successful-take marker before doing audio work.

| Setting | Purpose |
| --- | --- |
| `DEMO_SCRIPT` | Fixed narration text, default `scripts/demo/narration.txt` |
| `DEMO_SOURCE` | Source picture, default `$DEMO_DIR/capture.webm` |
| `DEMO_VOICE` / `DEMO_LANGUAGE` | Kokoro voice/language, default `af_heart` / `en-us` |
| `DEMO_SPEED` | Kokoro speaking rate |
| `DEMO_FILM_SPEED` | Final picture and voice speed together, 0.5–2.0 |
| `DEMO_MUSIC` / `DEMO_MUSIC_CREDIT` | Optional licensed bed and required attribution; creates a voice-only twin |

Narration uses `beat | offset_ms | text` lines. `schedule.py` resolves measured beats, rejects unknown beats, and shifts overlapping audio. `subtitles.py` derives captions from the same `lines.json`. Tail padding can extend the final picture when speech runs long. Review alignment manually rather than trusting nominal timings.

Use only approved, fixed narration with local speech tools, never patient transcripts or generated note bodies. Optional `speak-chatterbox.py` requires a consented voice reference via `CHATTERBOX_VOICE` and its own compatible Python environment; it is not required for the standard flow.

## Optional Deck Helpers

No deck or slide design is supplied. The standard recording does not need a deck.

`slides/render.mjs` is a standalone still renderer: set `DEMO_SLIDES_DIR` to external HTML files, `DEMO_SLIDES` to `name:duration_ms` pairs, and `DEMO_DIR` to a new output directory. It writes numbered PNGs and `slide-plan.json`; durations are metadata only. It rejects missing/duplicate inputs, empty-looking pages, and subtitle collisions. `shoot-deck.mjs` instead captures an interactive HTML deck with `section.slide` elements and requires a fresh `DECK_SHOTS` directory.

For an operator-supplied PDF, work on a copy of a successful take: `assemble.sh` appends pages and updates that copy's beat timeline. Set `DEMO_DECK` and a `DEMO_TOTAL_SECONDS` longer than the measured capture plus at least five seconds per page. Then narrate with `DEMO_SOURCE="$DEMO_DIR/capture-joined.mp4"` and narration covering the added `slide-*` beats. Do not narrate the original capture with the extended timeline.

The inherited HTML deck-only helpers are experimental and separate from the normal walkthrough. They require operator-supplied HTML, slide narration, and pre-rendered per-slide WAVs; they are not a one-command recording substitute. Do not point their output directories at a recorded take. `assemble-deck.sh` requires a nonexistent `DEMO_DIR`, explicit `DECK_SHOTS`, `DECK_SEGMENTS`, and `DEMO_SCRIPT`. The WAVs must be named `0.wav`, `1.wav`, etc. in slide-narration line order. It produces only `deck-silent.mp4`, `deck-beats.json`, and a separate `deck-ok` marker. It does not produce a narration-ready recording take; `narrate.sh` intentionally rejects it. Add its audio separately in an editor. See the helpers' environment checks before use.

## Review Before Sharing

- **Content:** Only the intended synthetic patient and consultation appear; no credentials or unrelated records are visible.
- **Clinical State:** The note remains unapproved, and narration does not portray suggestions as diagnosis or prescribing.
- **Picture:** Every named panel is readable; empty panels are not presented as positive findings.
- **Audio:** Listen to the entire film for pronunciation, clipping, timing, and subtitle alignment.
- **Failure:** Missing `take-ok`, browser errors, failed persistence/analysis, or missing anchors require investigation and a fresh authorized run, not manual marker creation.

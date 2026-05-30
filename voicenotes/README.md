# Voice Notes

A framework-free Progressive Web App for taking voice notes. Recordings are
transcribed **entirely on-device** with [Whisper](https://github.com/openai/whisper)
via [transformers.js](https://github.com/huggingface/transformers.js) — no
server, no API key. Notes are stored in `localStorage` and can be downloaded as
plain text.

## Features

- List notes and create new ones.
- Open a note and tap the big record button to record.
- On stop, the clip is transcribed in a background Web Worker and appended to the
  note. You can immediately start another recording while the previous clip is
  still transcribing.
- Notes persist locally (text only — audio is discarded after transcription).
- Download any note as a `.txt` file.
- Installable PWA with offline support (after the model is cached on first use).

## Tech

- Vanilla JS, ES6 modules, no build step.
- `MediaRecorder` for capture; `OfflineAudioContext` to resample to 16 kHz mono.
- `transformers.js` Whisper pipeline in a Web Worker (WebGPU when available,
  WASM fallback).

The Whisper model is configured by a single constant (`MODEL`) at the top of
[`js/transcription-worker.js`](js/transcription-worker.js). Default is
`Xenova/whisper-base` (multilingual). Swap to `Xenova/whisper-tiny` for speed or
`Xenova/whisper-base.en` for English-only.

## Running locally

A web server is required (ES modules, workers and service workers don't work over
`file://`):

```sh
python3 -m http.server 8000
# then open http://localhost:8000/voicenotes/
```

## Deployment

Pushing to the `voicenote` branch triggers
[`.github/workflows/deploy-voicenotes.yml`](../.github/workflows/deploy-voicenotes.yml),
which publishes the app to GitHub Pages under the `/voicenotes/` subdirectory.
The repo's Pages source must be set to **GitHub Actions**.

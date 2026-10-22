# RC003 hardware diagnostic

Windows-only developer probe. It is separate from the existing Rin Desktop UI and does not register global shortcuts, change application settings, install a driver or send anything to Codex.

## What it checks

- Win32 Raw Input filtered to RC003 VID 2717 / PID 32B8. Ordinary keyboard events are counted as ignored; their keys and device paths are never logged.
- Exactly one already-paired device with the selected name; standard GATT model/firmware readback and ATVV capability negotiation. It does not pair/unpair devices or write unknown characteristics.
- Physical press-to-talk audio at 16 kHz. ADPCM is decoded with a per-stream reset and an explicit later sync when present. Capture is limited to 60 seconds and event queues are bounded.
- The existing local SenseVoice worker, using the project's downloaded model. PCM goes through private process pipes in memory; audio and transcript bodies are not persisted. Reports only contain signal metrics and whether the fixed test phrase matched.

Protocol references: [MI-AO protocol notes](https://github.com/fanxeon/mi-ao/blob/main/docs/PROTOCOL.md), [SayAll stream reset](https://github.com/GetSayAll/remote-mic-app-windows/blob/main/crates/sayall-core/src/pipeline.rs), [miremote-vibe protocol implementation](https://github.com/qi-o/miremote-vibe/blob/main/miremote/voice.py). This is a bounded diagnostic implementation using protocol facts, not a copied bridge or driver-injection implementation. IMA/DVI ADPCM uses high-nibble-first decoding for this stream.

## Prerequisites and setup

Use the normal Windows user session, Node.js 24, a prepared Python 3.12 interpreter and the existing `.NET Framework` C# compiler. Administrator mode is not a requirement of the probe; an agent sandbox may require access to the actual user session to see hardware.

Create a dedicated venv under `work/runtime/rc003-probe`; install the versions in `requirements.txt` there. Keep the environment separate from the existing Qwen or app runtime. For example, with uv already installed, from the project root:

```powershell
$env:UV_CACHE_DIR = Join-Path (Get-Location) 'work/cache/remote-probe-uv'
uv --no-config venv work/runtime/rc003-probe --python '<existing Python 3.12 executable>' --no-python-downloads
uv --no-config pip install --python work/runtime/rc003-probe/Scripts/python.exe -r tools/remote-diagnostics/requirements.txt --index-url https://pypi.org/simple
```

SenseVoice files must already exist at `prototypes/live2d-codex/models/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-int8-2024-07-17`. This tool does not download an ASR model or fall back to cloud recognition.

## Run and stop

```powershell
pwsh -File tools/remote-diagnostics/run.ps1
```

The GUI is intentionally visible. Keep it in front while testing; this observer does not block keys from reaching whichever window is foreground. Test direction/OK/Home/Menu separately. Missing Back/volume events are reported as unobserved, not automatically repaired using injection. Then hold the microphone key for 4–6 seconds while saying the fixed phrase shown in the window, release, wait for `1/2`, and repeat until `2/2`. Finish using the window's close button.

Each run has a separate `work/runtime/rc003-*` directory. Closing the window requests graceful BLE shutdown via a stop marker. The backend has an overall deadline and issues MIC_CLOSE for a stream still active at exit, unsubscribes notifications and closes only its own connections. Do not run another bridge at the same time. A successful capability handshake alone is not an audio test.

The `--inspect` option on `ble_probe.py` does not record audio. `session.mjs` is the parent for PCM streaming; do not use the worker's `--stream-pcm` mode directly in a terminal or redirect its output into a log.

## Tests and limits

```powershell
node --test tests/remote-buttons.test.mjs
work/runtime/rc003-probe/Scripts/python.exe tests/remote-atvv-test.py
```

`button-state.mjs` normalizes first-down/final-up edges, filters stale generations, and cancels held buttons on disconnect. This addresses the actual F5 auto-repeat observed during a long voice press; it does not yet change the application's input implementation.

Two successful test recordings are smoke-test evidence only. This does not establish 100-cycle reliability, sleep/reconnect behavior, cross-firmware support, production packaging, or safe integration with an active coding session. The current application source now includes its own connection ownership, capability reporting and draft/target safeguards; see [RC003 integration](../../docs/development/remote-integration.md). This independent probe remains a diagnostic, and its results do not establish application hardware acceptance.

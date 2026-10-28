# Third-party components — Rin Desktop

Original application source is MIT. This distribution includes separately licensed components; the whole installation is not a single MIT-licensed work.

| Component | Version / license / location |
| --- | --- |
| Electron | 44.9.1; MIT and Chromium notices at installation root |
| Node.js | 24.16.0; `licenses/node-LICENSE` |
| OpenAI Codex CLI | User-installed external prerequisite; not bundled or updated by Rin Desktop |
| Claude Code, Grok Build, OpenCode V2 CLI | User-installed external programs; not bundled or updated by Rin Desktop; their own service terms apply |
| Claude Agent SDK | `@anthropic-ai/claude-agent-sdk` 0.3.240; governed by [Anthropic Commercial Terms](https://www.anthropic.com/legal/commercial-terms), with the upstream README retained in the packaged dependency; native CLI optional packages are excluded |
| Agent Client Protocol SDK | `@agentclientprotocol/sdk` 1.9.0; Apache-2.0; license retained in the packaged dependency |
| Koffi | 3.3.3; MIT; Windows x64 prebuilt FFI for application-local input handling; `licenses/koffi-LICENSE.txt` and the source package's notices retained in this distribution |
| PixiJS, marked, pixi-live2d-display | MIT; copies in `licenses/` |
| Live2D Cubism Core | Proprietary; unmodified runtime, `vendor/LICENSE-CubismCore.md` and `licenses/live2d-proprietary-agreement.html` |
| Rainy-window scene | Project-generated artwork and custom rig; permitted for display, modification and redistribution with this application; no claim of exclusive rights over generated imagery |
| Sherpa-onnx | 1.13.8; Apache-2.0 source with GPL-3.0-or-later eSpeak NG statically included in native speech binaries; see corresponding-source attachment |
| ONNX Runtime | Model runtime licenses and third-party notices in `licenses/onnxruntime-*` |
| SenseVoice int8 | Downloaded on demand from Hugging Face; 2024-07-17 model with its LICENSE retained |
| Kokoro-82M v1.1-zh int8 | Apache-2.0 model; eSpeak language data and dictionaries retain their own notices |
| Qwen3-TTS | CustomVoice 1.7B, revision `0c0e3051f131929182e2c023b9537f8b1c68adfe`; Apache-2.0, `licenses/Qwen-Apache-2.0.txt` |
| CPython | 3.12.14; Python license and incorporated third-party notices |
| PyTorch / Torchaudio | 2.9.1+cu128; complete LICENSE/NOTICE in installed distributions and `licenses/python-packages/` |
| CUDA / cuDNN | CUDA 12.8 / cuDNN 9.10.2; separate NVIDIA EULAs in `licenses/` |
| Python audio dependencies | Downloaded Qwen dependencies include LGPL-licensed libsndfile and soxr/libsoxr; upstream distributions retain their licenses |

Hiyori and earlier scene revisions are not included in the public installer. No account credentials, personal sessions or voice recordings are bundled. Voice models and the Qwen Python runtime are separate optional downloads. Qwen remains unloaded until enabled.

Rin Desktop 0.6.1 retains the CPU speech components and independent worker from 0.3.1 unchanged. Their corresponding-source materials remain available from the separate [0.3.1 developer source page](https://github.com/code-lawyer/Rin-Desktop/releases/tag/third-party-source-v0.3.1). Download `Third-Party-Corresponding-Source-0.3.1.zip` for the exact Sherpa tag, eSpeak/piper pins, native build files, dependencies and worker source. These native components retain their licenses and modification rights; this project's MIT license does not replace them. Application users do not need this archive to install or run Rin Desktop.

The CPU speech worker and linked Sherpa/eSpeak native components are conveyed as a GPL-3.0-or-later combination, with upstream Apache/MIT/BSD notices preserved. Recipients may modify, rebuild and redistribute that component under the GPL; the original MIT source files may also be used separately under MIT. The desktop/Live2D component is a separate program, communicating with the Node speech worker through JSON text and PCM. GPL and LGPL components are provided without warranty; see their full license texts. The corresponding-source archive includes the same-version worker source and build material.

The Qwen Python environment, including its audio DLLs, is installed directly from upstream when requested by the user. It is not redistributed in the base installer or the project's release assets. Its packages keep their upstream licenses and notices.

Model sources: [SenseVoice](https://github.com/FunAudioLLM/SenseVoice), [Sherpa models](https://github.com/k2-fsa/sherpa-onnx/releases), [Kokoro](https://huggingface.co/hexgrad/Kokoro-82M-v1.1-zh), [Qwen](https://huggingface.co/Qwen/Qwen3-TTS-12Hz-1.7B-CustomVoice). Fixed Python package versions and hashes are recorded in `backend/qwen-requirements.txt`; downloaded package METADATA and license directories are retained. Additional license origins are indexed in `licenses/SOURCES.json`.

Static wallpaper ambience includes CC0 1.0 recordings: Baconation, “Medium Light Rain” (https://freesound.org/people/Baconation/sounds/592482/), and Sorinious_Genious, “typing on laptop keyboard 1.wav” (https://freesound.org/people/Sorinious_Genious/sounds/561102/). Processing, source hashes and author links accompany the files in assets/ambience. New generated still poses and prompts accompany assets/stills; the project permits display, modification and redistribution without claiming exclusive rights.

The optional two-state female wallpaper contains four clips cut from one project-generated Dreamina Seedance 2.0 video, locally super-resolved from 720p to 3840×2160 with Real-ESRGAN x4plus and FFmpeg. Visible AI provenance is retained; the generated audio is excluded. These media are supplied for local display with this free application, without a claim of exclusive copyright or blanket commercial authorization. The applicable [Dreamina Terms of Service](https://www.capcut.com/clause/dreamina-terms-of-service) and regional/feature conditions govern generated assets; they are not relicensed as MIT source code. No Dreamina tools, Real-ESRGAN models, FFmpeg executable, Wallpaper Engine, Steam content or account credentials are distributed as runtime dependencies of this feature.

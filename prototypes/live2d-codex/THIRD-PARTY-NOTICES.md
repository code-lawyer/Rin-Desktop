# Third-party components — Rin Desktop

Original application source is MIT. This distribution includes separately licensed components; the whole installation is not a single MIT-licensed work.

| Component | Version / license / location |
| --- | --- |
| Electron | 44.7.2; MIT and Chromium notices at installation root |
| Node.js | 24.16.0; `licenses/node-LICENSE` |
| OpenAI Codex CLI | User-installed external prerequisite; not bundled or updated by Rin Desktop |
| PixiJS, marked, pixi-live2d-display | MIT; copies in `licenses/` |
| Live2D Cubism Core | Proprietary; unmodified runtime, `vendor/LICENSE-CubismCore.md` and `licenses/live2d-proprietary-agreement.html` |
| Rainy-window scene | Project-generated artwork and custom rig; permitted for display, modification and redistribution with this application; no claim of exclusive rights over generated imagery |
| Sherpa-onnx | 1.13.8; Apache-2.0 source with GPL-3.0-or-later eSpeak NG statically included in native speech binaries; see corresponding-source attachment |
| ONNX Runtime | Model runtime licenses and third-party notices in `licenses/onnxruntime-*` |
| SenseVoice int8 | Optional resource pack; 2024-07-17 official model with its LICENSE retained |
| Kokoro-82M v1.1-zh int8 | Apache-2.0 model; eSpeak language data and dictionaries retain their own notices |
| Qwen3-TTS | CustomVoice 1.7B, revision `0c0e3051f131929182e2c023b9537f8b1c68adfe`; Apache-2.0, `licenses/Qwen-Apache-2.0.txt` |
| CPython | 3.12.14; Python license and incorporated third-party notices |
| PyTorch / Torchaudio | 2.9.1+cu128; complete LICENSE/NOTICE in installed distributions and `licenses/python-packages/` |
| CUDA / cuDNN | CUDA 12.8 / cuDNN 9.10.2; separate NVIDIA EULAs in `licenses/` |
| Python audio dependencies | libsndfile 1.2.2 and soxr/libsoxr include LGPL code; license texts, pinned sources and build material are supplied |

Hiyori and earlier scene revisions are not included in the public installer. No account credentials, personal sessions or voice recordings are bundled. Voice models and the Qwen Python runtime are separate optional downloads. Qwen remains unloaded until enabled.

Corresponding-source materials are distributed as `Third-Party-Corresponding-Source` in the same [GitHub Release](https://github.com/code-lawyer/Rin-Desktop/releases). This contains the exact Sherpa tag and its eSpeak/piper pins, native build files and dependencies, and LGPL audio sources. These native components retain their licenses, including modification/relinking rights; this project's MIT license does not replace them.

The CPU speech worker and linked Sherpa/eSpeak native components are conveyed as a GPL-3.0-or-later combination, with upstream Apache/MIT/BSD notices preserved. Recipients may modify, rebuild and redistribute that component under the GPL; the original MIT source files may also be used separately under MIT. The desktop/Live2D component is a separate program, communicating with the Node speech worker through JSON text and PCM. GPL and LGPL components are provided without warranty; see their full license texts. The corresponding-source archive includes the same-version worker source and build material.

The libsndfile DLL is rebuilt from 1.2.2 with external codecs and MPEG disabled. Both the Python-soxr wrapper and libsoxr are LGPL-2.1-or-later. The source attachment includes their complete sources and instructions for replacing/relinking the dynamically loaded modules.

Model sources: [SenseVoice](https://github.com/FunAudioLLM/SenseVoice), [Sherpa models](https://github.com/k2-fsa/sherpa-onnx/releases), [Kokoro](https://huggingface.co/hexgrad/Kokoro-82M-v1.1-zh), [Qwen](https://huggingface.co/Qwen/Qwen3-TTS-12Hz-1.7B-CustomVoice). Fixed Python package versions are in the Qwen resource directory's `requirements.lock.txt`; package METADATA and license directories are retained. Additional license origins are indexed in `licenses/SOURCES.json`.

# Corresponding source — Rin Desktop 0.3.1

These materials accompany the same-version binary release at
https://github.com/code-lawyer/Rin-Desktop/releases/tag/v0.3.1 .
`SOURCES.json` records each original archive, URL and SHA-256. Original source
archives preserve upstream licenses, notices and build scripts. No warranty is
provided. GPL/LGPL recipients may modify, rebuild, replace and redistribute the
covered components under their licenses. The application's original MIT files
remain separately available under MIT.

## CPU speech process (GPL-3.0-or-later combination)

`speech-worker.cjs` is the exact worker shipped in this release. It loads Sherpa
1.13.8, whose native binaries statically include eSpeak NG. The worker/native
combination is distributed under GPL-3.0-or-later, preserving Apache/MIT/BSD
notices. The independent desktop program only exchanges JSON text and PCM with
this process. `espeak-COPYING` supplies the full GPL.

For rebuilding on Windows x64, use Visual Studio 2022 C++ with Windows SDK,
CMake >=3.15, Node 24 and the extracted Sherpa tree. The complete upstream
`.github/workflows/npm-addon-win-x64.yaml` and `.github/scripts/node-addon/`
are in the source archive. Do not run the workflow's publishing steps.

```powershell
cmake -S . -B build -DCMAKE_BUILD_TYPE=Release -DBUILD_SHARED_LIBS=ON -DCMAKE_INSTALL_PREFIX=build/install -DSHERPA_ONNX_ENABLE_WEBSOCKET=OFF -DSHERPA_ONNX_ENABLE_PORTAUDIO=OFF -DSHERPA_ONNX_ENABLE_BINARY=OFF -DBUILD_ESPEAK_NG_EXE=OFF -DSHERPA_ONNX_BUILD_C_API_EXAMPLES=OFF
cmake --build build --config Release --target install
```

The bundled static dependency archives match the CMake pins. For an offline
configuration, supply `FETCHCONTENT_SOURCE_DIR_<UPPERCASE_NAME>` for extracted
dependencies, or place archives in the exact locations/names documented in
upstream `cmake/*.cmake`. In particular, rename the short archive names
`espeak-ng.zip`, `piper-phonemize.zip`, `kissfft.zip` to include their full pinned
commit from `SOURCES.json` if using the upstream download lookup. Retain Sherpa's
`CMAKE_MODULE_PATH` precedence; OpenFst is the 2026-07-09 pin.

Copy ONNX Runtime's `.lib` and `.dll` into `build/install/lib`, set
`SHERPA_ONNX_INSTALL_DIR` to the absolute install directory, then in
`scripts/node-addon-api` run `npm install --ignore-scripts` and
`npx --no-install cmake-js compile --log-level verbose`. The source package keeps
upstream's dependency ranges; byte-for-byte reproduction of upstream npm
binaries is not claimed. Replace the native addon and its matching DLLs in
`resources/app/node_modules/sherpa-onnx-win-x64` while the application is closed.

The ONNX Runtime 1.28.2 source and the exact upstream binary-build workflow are
included. Windows CPU uses `--build_shared_lib --enable_msvc_static_runtime
--skip_tests`, Release /MT. Its `cmake/deps.txt` supplies pinned dependency URLs
and checksums. Preserve the packaged ONNX third-party notices.

`onnx-cpu-dependencies/` contains the 13 enabled CPU dependency archives, checked
against the upstream SHA-1 pins and separately indexed by SHA-256. Preserve the
patches from the full ONNX tree (including Abseil patches with CUDA in a filename,
which are also applied to CPU builds). When building from an archive, add
`--skip_submodule_sync --cmake_extra_defines onnxruntime_BUILD_UNIT_TESTS=OFF`;
`--skip_tests` alone only skips running tests. General compiler/SDK/build tools
are not shipped in this source attachment.

Model weights and the optional Qwen Python environment are not distributed in
this release. The application downloads them from their upstream publishers
only after the user selects Download and load model. Their original upstream
licenses remain applicable.

# Corresponding source — Rin Desktop 0.3.0

These materials accompany the same-version binary release at
https://github.com/code-lawyer/Rin-Desktop/releases/tag/v0.3.0 .
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

## libsndfile 1.2.2 (LGPL-2.1-or-later)

This release replaces the upstream Python wheel's multi-codec DLL with a build
from the supplied unmodified 1.2.2 source, with external codecs and MPEG disabled.
The build uses LLVM-MinGW 20261006 (Clang 23.1.3), CMake 4.4.4 and Ninja 1.13.2.
`build-sndfile.mjs` is the build script; its options are also readable without
Node. LLVM and MinGW runtime notices are retained. Source changes: none.

Set `BUILD_SHARED_LIBS=ON`, `ENABLE_EXTERNAL_LIBS=OFF`, `ENABLE_MPEG=OFF`,
`ENABLE_EXPERIMENTAL=OFF`, `BUILD_PROGRAMS=OFF`, `BUILD_EXAMPLES=OFF`,
`BUILD_TESTING=OFF`, `BUILD_REGTEST=OFF`, `ENABLE_CPACK=OFF`, Release mode.
CMake 4 needs `CMAKE_POLICY_VERSION_MINIMUM=3.5` for this upstream release.
Copy output `libsndfile.dll` as
`<Qwen resource directory>/python/Lib/site-packages/_soundfile_data/libsndfile_x64.dll`.
The default Qwen directory is `%LOCALAPPDATA%/VibeVoice/voice-resources/qwen-0.3.0`;
users may select another complete resource directory in voice settings.
It is dynamically loaded and may be replaced with an ABI-compatible rebuild.

## Python-soxr 1.1.0 and libsoxr (LGPL-2.1-or-later)

The PyPI sdist contains the complete libsoxr/PFFFT source, wrapper, generated
version files and CMake scripts. The separate libsoxr archive records the
upstream submodule revision. Nanobind 2.12.0, its robin-map source/notices and
scikit-build-core 0.12.2 are provided as reconstruction material; the original
wheel's unpinned nanobind build version is not proven byte-for-byte.

Use full CPython 3.12 x64 development files (headers and python3.lib), a compatible
C++17 compiler, and an isolated build environment. Modify `libsoxr/src` as needed.
Install `scikit-build-core==0.12.2`, `nanobind==2.12.0`, setuptools,
`setuptools_scm[toml]`, and numpy, then from the extracted soxr source run:

```powershell
python -m pip wheel --no-deps --no-build-isolation . -w wheelhouse -Ccmake.define.USE_SYSTEM_LIBSOXR=OFF
```

After closing the application/Qwen process, replace the installed `soxr` folder
under `<Qwen resource directory>/python/Lib/site-packages` with the rebuilt
wheel's directory, including the rebuilt `soxr_ext.pyd`; preserve licenses.
No integrity check prevents modification or loading compatible rebuilt modules.

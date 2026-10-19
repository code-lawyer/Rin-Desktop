// Rebuild the LGPL audio DLL without the unused static MPEG/FLAC/Vorbis codecs.
import {execFileSync} from 'node:child_process';
import {join,resolve} from 'node:path';
import {cp,mkdir} from 'node:fs/promises';
const root=resolve(import.meta.dirname,'../..'), tools=join(root,'work/release-build/tools');
const llvm=process.env.LLVM_MINGW||join(tools,'llvm-mingw-20261006-ucrt-x86_64/bin');
const cmake=process.env.CMAKE_BIN||join(tools,'cmake-4.4.4-windows-x86_64/bin/cmake.exe');
const ninja=process.env.NINJA_BIN||join(tools,'ninja.exe');
const source=join(root,'work/release-build/upstream/libsndfile-1.2.2');
const build=join(root,'work/release-build/sndfile-build');
const env={...process.env,PATH:`${llvm};${process.env.PATH}`};
const args=['--fresh','-S',source,'-B',build,'-G','Ninja',`-DCMAKE_MAKE_PROGRAM=${ninja}`,
  `-DCMAKE_C_COMPILER=${join(llvm,'x86_64-w64-mingw32-gcc.exe')}`,
  `-DCMAKE_CXX_COMPILER=${join(llvm,'x86_64-w64-mingw32-g++.exe')}`,
  `-DCMAKE_RC_COMPILER=${join(llvm,'x86_64-w64-mingw32-windres.exe')}`,
  '-DCMAKE_BUILD_TYPE=Release','-DCMAKE_POLICY_VERSION_MINIMUM=3.5','-DBUILD_SHARED_LIBS=ON',
  '-DENABLE_EXTERNAL_LIBS=OFF','-DENABLE_MPEG=OFF','-DENABLE_EXPERIMENTAL=OFF',
  '-DBUILD_PROGRAMS=OFF','-DBUILD_EXAMPLES=OFF','-DBUILD_TESTING=OFF','-DBUILD_REGTEST=OFF','-DENABLE_CPACK=OFF',
  `-DPYTHON_EXECUTABLE=${join(root,'work/release-build/qwen/python/python.exe')}`];
execFileSync(cmake,args.map(value=>value.replaceAll('\\','/')),{env,windowsHide:true,stdio:'inherit'});
execFileSync(cmake,['--build',build,'-j','4'],{env,windowsHide:true,stdio:'inherit'});
console.log(`Built ${join(build,'libsndfile.dll')}`);

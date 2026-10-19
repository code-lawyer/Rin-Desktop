import { mkdir, readFile, writeFile, readdir, cp, rename, unlink } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
const root=resolve(import.meta.dirname,'../..');
const output=join(root,'work/release-build/corresponding-source');await mkdir(output,{recursive:true});
const entries=[
 ['sherpa-onnx-1.13.8.tar.gz','https://github.com/k2-fsa/sherpa-onnx/archive/refs/tags/v1.13.8.tar.gz'],
 ['espeak-ng.zip','https://github.com/csukuangfj/espeak-ng/archive/ed530aa113046142eb5115cf2fc9157854d0ffe1.zip','e4e262cbe34f7fe21f91f1ba3397f2728e1f30eafbae7853f2b753a9ed13f0dd'],
 ['piper-phonemize.zip','https://github.com/csukuangfj/piper-phonemize/archive/f3ff95afc03640bc1399e113e83361192a2fafb4.zip','d9cca4e2bdc7d6dd8dffb96a4668283dbd3f77a9c194a3e530c1e8eba9406a5d'],
 ['kaldi-native-fbank-1.22.3.tar.gz','https://github.com/csukuangfj/kaldi-native-fbank/archive/refs/tags/v1.22.3.tar.gz','9176cc66fc7ce1edf85cf355b06e320c57db6297df74277f575183468893cf61'],
 ['kissfft.zip','https://github.com/mborgerding/kissfft/archive/febd4caeed32e33ad8b2e0bb5ea77542c40f18ec.zip','497103e664168ebe39580b757adbe616f6cf85a16572af581ca7bc42d0ab13fd'],
 ['kaldi-decoder-0.3.0.tar.gz','https://github.com/k2-fsa/kaldi-decoder/archive/refs/tags/v0.3.0.tar.gz','b9f34cfb4fd3b1344100eead79ef4d37aa15962274b9e3056de345021f76a1b0'],
 ['kaldifst-1.8.0.tar.gz','https://github.com/k2-fsa/kaldifst/archive/refs/tags/v1.8.0.tar.gz','3f247b7e5a2409071202f5e2bc6200060f66728c0a3443c03923ad2723e040b3'],
 ['openfst-1.8.5-2026-07-09.tar.gz','https://github.com/csukuangfj/openfst/archive/refs/tags/v1.8.5-2026-07-09.tar.gz','2ff712a32952fcb01d351121a6bc8ccf4fdc6b2aa06ce8df2b3095dedd518c0e'],
 ['simple-sentencepiece-0.7.tar.gz','https://github.com/pkufool/simple-sentencepiece/archive/refs/tags/v0.7.tar.gz','1748a822060a35baa9f6609f84efc8eb54dc0e74b9ece3d82367b7119fdc75af'],
 ['eigen-5.0.1.tar.gz','https://gitlab.com/libeigen/eigen/-/archive/5.0.1/eigen-5.0.1.tar.gz','e9c326dc8c05cd1e044c71f30f1b2e34a6161a3b6ecf445d56b53ff1669e3dec'],
 ['hclust-cpp-2026-02-25.tar.gz','https://github.com/csukuangfj/hclust-cpp/archive/refs/tags/2026-02-25.tar.gz','8f14e024c709d73afb40ae69cb22de4b73dba67cbce40f2e518813da8139ab56'],
 ['json-3.12.0.tar.gz','https://github.com/nlohmann/json/archive/refs/tags/v3.12.0.tar.gz','4b92eb0c06d10683f7447ce9406cb97cd4b453be18d7279320f7b2f025c10187'],
 ['onnxruntime-1.28.2.tar.gz','https://github.com/microsoft/onnxruntime/archive/33ca9628233dc8f002435e868d4c2e9f82766ca1.tar.gz'],
 ['onnxruntime-libs-build.tar.gz','https://github.com/csukuangfj/onnxruntime-libs/archive/5cc3d2e84d9eade2562cf29a93fa3a520a75ca57.tar.gz'],
];
const index=[];
for(const [name,url,expected] of entries){
  const file=join(output,name);let bytes;try{bytes=await readFile(file);}catch{}
  if(!bytes?.length||expected&&createHash('sha256').update(bytes).digest('hex')!==expected){
    execFileSync('curl.exe',['-fsSL','--retry','3','--max-time','300','-o',file+'.partial',url],{windowsHide:true});
    bytes=await readFile(file+'.partial');
    if(!bytes.length||expected&&createHash('sha256').update(bytes).digest('hex')!==expected)throw new Error(`Source checksum mismatch: ${name}`);
    await unlink(file).catch(error=>{if(error.code!=='ENOENT')throw error;});await rename(file+'.partial',file);
  }
  const sha256=createHash('sha256').update(bytes).digest('hex');if(expected&&sha256!==expected)throw new Error(`Source checksum mismatch: ${name}`);
  index.push({file:name,url,sha256});console.log(name);
}
await writeFile(join(output,'SOURCES.json'),JSON.stringify(index,null,2));
const expanded=join(root,'work/release-build/upstream');await mkdir(expanded,{recursive:true});
execFileSync('tar.exe',['-xf',join(output,'sherpa-onnx-1.13.8.tar.gz'),'-C',expanded,'sherpa-onnx-1.13.8/cmake'],{windowsHide:true});
console.log('Corresponding sources downloaded; preserve dependency pins in upstream/cmake.');

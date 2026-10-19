"""Optional resident Qwen worker; offline JSONL protocol, no audio playback.

Reading stdin on a separate thread makes cancellation and unload responsive
even while inference runs. EOF (including parent crashes) releases CUDA.
"""
import base64
import json
import os
from pathlib import Path
import queue
import sys
import threading

if os.environ.get('VIBE_SPEECH_DEBUG') == '1':
    import faulthandler
    faulthandler.dump_traceback_later(25)

protocol = sys.stdout
sys.stdout = sys.stderr  # Third-party progress/warnings must not corrupt JSONL.
jobs = queue.Queue()
tokens = {}
lock = threading.Lock()


def send(value):
    protocol.write(json.dumps(value, ensure_ascii=False) + "\n")
    protocol.flush()


def read_commands():
    for line in sys.stdin:
        try:
            command = json.loads(line)
            if command.get("kind") == "shutdown":
                os._exit(0)
            with lock:
                if command.get("kind") == "cancel":
                    event = tokens.get(command.get("id"))
                    if event:
                        event.set()
                elif command.get("kind") == "synthesize":
                    event = threading.Event()
                    tokens[command["id"]] = event
                    jobs.put((command, event))
        except (ValueError, KeyError, TypeError):
            continue
    os._exit(0)


try:
    send({"event": "loading", "stage": "imports"})
    import numpy as np
    import torch
    from transformers import StoppingCriteria, StoppingCriteriaList
    from qwen_tts import Qwen3TTSModel
    send({"event": "loading", "stage": "imports-ready"})

    # On Windows a thread blocked in stdin's CRT read can deadlock NumPy's
    # native module initialization. Import native libraries before that reader.
    # The parent still enforces shutdown during imports with a bounded tree kill.
    threading.Thread(target=read_commands, daemon=True).start()

    torch.set_num_threads(8)
    torch.set_num_interop_threads(2)
    if not torch.cuda.is_available():
        raise RuntimeError("Qwen 需要可用的 NVIDIA CUDA 显卡；未自动切换为慢速 CPU 推理。")
    send({"event": "loading", "stage": "weights"})
    model = Qwen3TTSModel.from_pretrained(
        str(Path(sys.argv[1]) / "models" / "Qwen3-TTS-12Hz-1.7B-CustomVoice"),
        device_map="cuda:0", dtype=torch.bfloat16,
        attn_implementation="sdpa", local_files_only=True,
    )
    torch.cuda.synchronize()
    if os.environ.get('VIBE_SPEECH_DEBUG') == '1':
        faulthandler.cancel_dump_traceback_later()
except Exception as error:
    send({"id": 0, "ok": False, "error": str(error)})
    sys.exit(1)


class Cancelled(Exception):
    pass


class CancelAtToken(StoppingCriteria):
    def __call__(self, input_ids, scores, **kwargs):
        if active_cancel.is_set():
            raise Cancelled("已停止本次播报。")
        return False


# qwen-tts 0.1.1's outer generate discards arbitrary generation kwargs.
# Attach the standard Transformers cancellation hook at the actual talker;
# don't edit installed packages or synthesize/decode cancelled partial audio.
talker_generate = model.model.talker.generate


def cancellable_generate(*args, **kwargs):
    kwargs["stopping_criteria"] = StoppingCriteriaList([CancelAtToken()])
    result = talker_generate(*args, **kwargs)
    if result.sequences.shape[-1] >= kwargs.get("max_new_tokens", 1024):
        raise RuntimeError("本段语音达到长度上限，请缩短文字后重试。")
    return result


model.model.talker.generate = cancellable_generate
send({"event": "ready", "pid": os.getpid()})
while True:
    command, active_cancel = jobs.get()
    try:
        if active_cancel.is_set():
            raise Cancelled("已停止本次播报。")
        text = command.get("text", "")
        if not isinstance(text, str) or not text.strip() or len(text) > 2000:
            raise ValueError("播报文字无效。")
        torch.manual_seed(42)
        torch.cuda.manual_seed_all(42)
        with torch.inference_mode():
            wavs, rate = model.generate_custom_voice(
                text=text, speaker=command.get("speaker", "Serena"), language="Chinese",
                instruct="用标准普通话自然地交谈。年轻成年女性，声音清澈，语气平静克制、清冷自信，语速适中，随语意自然停顿，句尾放松。",
                non_streaming_mode=True, max_new_tokens=1024, do_sample=True,
                temperature=0.9, top_k=50, top_p=1.0, repetition_penalty=1.05,
                subtalker_dosample=True, subtalker_temperature=0.9,
                subtalker_top_k=50, subtalker_top_p=1.0,
            )
        if active_cancel.is_set():
            raise Cancelled("已停止本次播报。")
        wave = np.asarray(wavs[0], dtype="<f4")
        if wave.ndim != 1 or not len(wave) or len(wave) > rate * 120 or not np.isfinite(wave).all():
            raise ValueError("语音输出无效。")
        send({"id": command["id"], "ok": True, "sampleRate": rate,
              "samplesBase64": base64.b64encode(wave.tobytes()).decode("ascii")})
        del wavs, wave
    except Exception as error:
        send({"id": command["id"], "ok": False, "error": str(error)})
    finally:
        with lock:
            tokens.pop(command["id"], None)

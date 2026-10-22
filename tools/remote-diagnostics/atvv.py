"""Bounded RC003 diagnostic codec. Protocol facts: see README.md, not a bridge fork."""
import array
import math
import struct
import sys

SERVICE = 'ab5e0001-5a21-4f05-bc7d-af01f617b664'
TX = 'ab5e0002-5a21-4f05-bc7d-af01f617b664'
AUDIO = 'ab5e0003-5a21-4f05-bc7d-af01f617b664'
CONTROL = 'ab5e0004-5a21-4f05-bc7d-af01f617b664'
GET_CAPS = bytes.fromhex('0a 01 00 00 03 03')
STEP = (7,8,9,10,11,12,13,14,16,17,19,21,23,25,28,31,34,37,41,45,50,55,60,66,73,80,88,97,107,118,130,143,157,173,190,209,230,253,279,307,337,371,408,449,494,544,598,658,724,796,876,963,1060,1166,1282,1411,1552,1707,1878,2066,2272,2499,2749,3024,3327,3660,4026,4428,4871,5358,5894,6484,7132,7845,8630,9493,10442,11487,12635,13899,15289,16818,18500,20350,22385,24623,27086,29794,32767)
INDEX = (-1,-1,-1,-1,2,4,6,8)


def parse_caps(data):
    if len(data) != 9 or data[:3] != bytes.fromhex('0b 01 00'):
        raise ValueError('UNSUPPORTED_CAPABILITIES')
    swapped = False
    # v1 codecs are bits 8/9; known firmware 2671 may swap adjacent fields.
    mask = data[3]
    if mask not in (0, 1, 2, 3): raise ValueError('UNKNOWN_CODEC_FLAGS')
    if mask == 0 and data[4] in (1, 2, 3):
        mask, swapped = data[4], True
    if not mask & 2:
        raise ValueError('ADPCM_16K_NOT_SUPPORTED')
    frame_size = int.from_bytes(data[5:7], 'big')
    if not 1 <= frame_size <= 512:
        raise ValueError('INVALID_FRAME_SIZE')
    return {'protocol': '1.0', 'sampleRate': 16000, 'codec': 2,
            'frameSize': frame_size, 'firmwareCapsSwap': swapped}


class Capture:
    """One bounded stream; start resets state, later explicit sync replaces it."""
    def __init__(self, rate=16000, max_seconds=60):
        self.rate = rate
        self.limit = rate * max_seconds
        self.samples = array.array('h')
        self.synced = False
        self.predictor = self.index = self.frames = self.unsynced_frames = 0

    def begin(self):
        # A validated STREAM_START establishes the initial zero codec state.
        # AUDIO_SYNC is a subsequent resynchronization, not a prerequisite.
        self.sync(0, 0)

    def sync(self, predictor, index):
        if not -32768 <= predictor <= 32767 or not 0 <= index <= 88:
            raise ValueError('INVALID_CODEC_SYNC')
        self.predictor, self.index, self.synced = predictor, index, True

    def feed(self, data):
        if not self.synced:
            self.unsynced_frames += 1
            return
        if len(self.samples) + len(data) * 2 > self.limit:
            raise ValueError('AUDIO_DURATION_LIMIT')
        for byte in data:
            for nibble in (byte >> 4, byte & 15):
                step = STEP[self.index]
                delta = step >> 3
                if nibble & 1: delta += step >> 2
                if nibble & 2: delta += step >> 1
                if nibble & 4: delta += step
                self.predictor = max(-32768, min(32767, self.predictor + (-delta if nibble & 8 else delta)))
                self.index = max(0, min(88, self.index + INDEX[nibble & 7]))
                self.samples.append(self.predictor)
        self.frames += 1

    def summary(self):
        n = len(self.samples)
        peak = max((abs(x) for x in self.samples), default=0)
        return {'frames': self.frames, 'samples': n, 'durationMs': round(n / self.rate * 1000),
                'peak': round(peak / 32768, 5),
                'rms': round(math.sqrt(sum(x*x for x in self.samples) / max(n, 1)) / 32768, 5),
                'unsyncedFrames': self.unsynced_frames}

    def pcm(self):
        if sys.byteorder == 'little': return self.samples.tobytes()
        result = array.array('h', self.samples)
        result.byteswap()
        return result.tobytes()

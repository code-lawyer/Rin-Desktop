import sys
import unittest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'tools/remote-diagnostics'))
from atvv import Capture, parse_caps

class ProtocolTest(unittest.TestCase):
    def test_caps_reject_unknown_and_accept_only_known_16k(self):
        for value in ['0b 01 00 02 03 00 78 00 00', '0b 01 00 00 03 00 78 00 00']:
            result = parse_caps(bytes.fromhex(value))
            self.assertEqual(result['sampleRate'], 16000)
            self.assertEqual(result['codec'], 2)
            self.assertEqual(result['frameSize'], 120)
        for value in [b'', bytes.fromhex('0b 01 00 01 00 00 78 00 00')]:
            with self.assertRaises(ValueError): parse_caps(value)
    def test_sync_required_and_high_nibble_first(self):
        capture = Capture(); capture.feed(b'\x17')
        self.assertEqual(len(capture.samples), 0)
        capture.sync(0, 0); capture.feed(b'\x17')
        self.assertEqual(list(capture.samples), [1, 12])
    def test_invalid_sync_and_saturation(self):
        capture = Capture()
        with self.assertRaises(ValueError): capture.sync(0, 89)
        capture.sync(32760, 88); capture.feed(b'\x77')
        self.assertEqual(list(capture.samples), [32767, 32767])
    def test_new_stream_decodes_without_optional_sync(self):
        capture = Capture(); capture.begin(); capture.feed(b'\x17')
        self.assertEqual(list(capture.samples), [1, 12])
    def test_capture_bound_and_stream_isolation(self):
        capture = Capture(rate=1, max_seconds=2); capture.sync(0,0); capture.feed(b'\x00')
        with self.assertRaises(ValueError): capture.feed(b'\x00')
        other = Capture(); self.assertEqual(other.summary()['samples'], 0)

if __name__ == '__main__': unittest.main()

"""WinRT RC003 test. Only paired target, known service, physical PTT, local PCM pipe."""
import argparse
import asyncio
import base64
import json
import struct
import time
import sys
import uuid
from collections import Counter
from pathlib import Path
from atvv import AUDIO, CONTROL, GET_CAPS, SERVICE, TX, Capture, parse_caps

if hasattr(sys.stdout, 'reconfigure'): sys.stdout.reconfigure(encoding='utf8')

def emit(kind, **values):
    print(json.dumps({'event': kind, **values}, ensure_ascii=False), flush=True)


async def main(args):
    from winrt.windows.devices.bluetooth import BluetoothLEDevice, BluetoothCacheMode
    from winrt.windows.devices.enumeration import DeviceInformation
    from winrt.windows.devices.bluetooth.genericattributeprofile import (
        GattCommunicationStatus as Status, GattClientCharacteristicConfigurationDescriptorValue as CCCD,
        GattWriteOption, GattCharacteristicProperties as Properties)
    from winrt.windows.storage.streams import DataReader, DataWriter

    report = {'schema': 1, 'protocolReady': False, 'audioUploaded': False,
              'rawAudioPersisted': False, 'deviceIdentifiersPersisted': False, 'sessions': [], 'controlCounts': {}}
    device = service = None
    chars, subscriptions, controls = {}, [], Counter()
    loop = asyncio.get_running_loop()
    queue = asyncio.Queue(maxsize=512)
    overflow = False
    capture, stream_id, mic_open = None, 0, False
    stream_active = False
    caps = None
    try:
        emit('phase', value='enumerating-paired-device')
        devices = await asyncio.wait_for(DeviceInformation.find_all_async_aqs_filter(BluetoothLEDevice.get_device_selector_from_pairing_state(True)), 15)
        matches = [item for item in devices if item.name == args.name]
        report['pairedNameMatches'] = len(matches)
        if len(matches) != 1: raise ValueError('NEED_EXACTLY_ONE_PAIRED_TARGET')
        device = await asyncio.wait_for(BluetoothLEDevice.from_id_async(matches[0].id), 20)
        if device is None: raise ValueError('DEVICE_UNAVAILABLE')
        # Do not emit the WinRT id or Bluetooth address.
        report['deviceName'] = matches[0].name
        emit('phase', value='reading-model-and-services')
        info = await asyncio.wait_for(device.get_gatt_services_for_uuid_with_cache_mode_async(uuid.UUID('0000180a-0000-1000-8000-00805f9b34fb'), BluetoothCacheMode.UNCACHED), 20)
        def read_bytes(buffer):
            reader = DataReader.from_buffer(buffer)
            return bytes(reader.read_byte() for _ in range(reader.unconsumed_buffer_length))
        if info.status == Status.SUCCESS:
            for entry in info.services:
                try:
                    for suffix, label in [('2a24', 'model'), ('2a26', 'firmware')]:
                        result = await entry.get_characteristics_for_uuid_async(uuid.UUID('0000'+suffix+'-0000-1000-8000-00805f9b34fb'))
                        if result.status == Status.SUCCESS and result.characteristics:
                            value = await result.characteristics[0].read_value_with_cache_mode_async(BluetoothCacheMode.UNCACHED)
                            if value.status == Status.SUCCESS:
                                text = read_bytes(value.value).decode('utf8', errors='replace').strip('\0')[:80]
                                report[label] = text
                finally: entry.close()
        found = await asyncio.wait_for(device.get_gatt_services_for_uuid_with_cache_mode_async(uuid.UUID(SERVICE), BluetoothCacheMode.UNCACHED), 20)
        if found.status != Status.SUCCESS or len(found.services) != 1:
            raise ValueError('STANDARD_ATVV_SERVICE_UNAVAILABLE')
        service = found.services[0]
        result = await asyncio.wait_for(service.get_characteristics_with_cache_mode_async(BluetoothCacheMode.UNCACHED), 20)
        if result.status != Status.SUCCESS: raise ValueError('CHARACTERISTICS_UNAVAILABLE')
        chars = {str(item.uuid).lower(): item for item in result.characteristics}
        if any(key not in chars for key in (AUDIO, CONTROL, TX)): raise ValueError('ATVV_CHARACTERISTICS_MISSING')
        async def write(payload):
            writer = DataWriter(); writer.write_bytes(payload)
            option = GattWriteOption.WRITE_WITH_RESPONSE if chars[TX].characteristic_properties & Properties.WRITE else GattWriteOption.WRITE_WITHOUT_RESPONSE
            status = await asyncio.wait_for(chars[TX].write_value_with_option_async(writer.detach_buffer(), option), 5)
            if status != Status.SUCCESS: raise ValueError('ATVV_WRITE_FAILED')
        def enqueue(kind, data):
            nonlocal overflow
            try: queue.put_nowait((kind, data))
            except asyncio.QueueFull: overflow = True
        def callback(kind):
            def received(sender, event):
                payload = read_bytes(event.characteristic_value)
                loop.call_soon_threadsafe(enqueue, kind, payload)
            return received
        for key, kind in [(CONTROL, 'control'), (AUDIO, 'audio')]:
            char = chars[key]
            token = char.add_value_changed(callback(kind))
            subscriptions.append((char, token))
            status = await asyncio.wait_for(char.write_client_characteristic_configuration_descriptor_async(CCCD.NOTIFY), 10)
            if status != Status.SUCCESS: raise ValueError('NOTIFICATION_SUBSCRIBE_FAILED')
        await write(GET_CAPS)
        deadline = time.monotonic() + (8 if args.inspect else args.seconds)
        emit('phase', value='waiting-for-capabilities')
        def finish(reason):
            nonlocal capture
            if capture is None: return
            summary = capture.summary(); summary['endReason'] = reason
            report['sessions'].append(summary)
            emit('capture', **summary)
            if args.stream_pcm and summary['durationMs'] >= 200:
                emit('pcm', sampleRate=capture.rate, samplesBase64=base64.b64encode(capture.pcm()).decode('ascii'))
            capture = None
        while time.monotonic() < deadline:
            if args.stop_file and Path(args.stop_file).exists(): break
            if overflow: raise ValueError('NOTIFICATION_QUEUE_OVERFLOW')
            try: kind, data = await asyncio.wait_for(queue.get(), min(1, max(.01, deadline-time.monotonic())))
            except asyncio.TimeoutError: continue
            if kind == 'audio':
                if capture is not None:
                    if len(data) > caps['frameSize']: raise ValueError('OVERSIZED_AUDIO_FRAME')
                    capture.feed(data)
                continue
            if not data: continue
            op = data[0]; controls[f'{op:02x}'] += 1
            if op == 0x0b:
                caps = parse_caps(data); report['caps'] = caps; report['protocolReady'] = True
                emit('ready', model=report.get('model'), firmware=report.get('firmware'), **caps)
                if args.inspect: break
            elif caps is None: continue
            elif op in (0x08, 0x10):
                if not mic_open:
                    await write(bytes([0x0c, 0])); mic_open = True
            elif op in (0x04, 0x11):
                finish('replaced-by-new-stream')
                if len(data) < 4: raise ValueError('INVALID_STREAM_START')
                if data[2] != caps['codec']: raise ValueError('STREAM_CODEC_MISMATCH')
                stream_id = data[3]
                stream_active = True
                capture = Capture()
                capture.begin()
                emit('stream-start', reason=data[1], codec=data[2], streamId=stream_id)
                emit('recording', active=True)
            elif op == 0x0a:
                if capture is None or len(data) < 7: raise ValueError('INVALID_SYNC_BOUNDARY')
                capture.sync(struct.unpack('>h', data[4:6])[0], data[6])
            elif op in (0x00, 0x13):
                if mic_open: await write(bytes([0x0d, stream_id]))
                mic_open = False
                stream_active = False
                finish('remote-release')
                emit('recording', active=False)
                if len(report['sessions']) >= args.max_sessions: break
        if capture is not None: finish('session-time-limit')
        if not report['protocolReady']: raise ValueError('CAPABILITIES_TIMEOUT')
    except Exception as error:
        # Never persist raw platform messages, device ids, addresses or audio.
        code = str(error) if isinstance(error, ValueError) and str(error).isupper() and len(str(error)) < 80 else type(error).__name__
        report['failure'] = code
        emit('failure', code=code)
    finally:
        if service is not None and TX in chars and (mic_open or stream_active):
            try: await write(bytes([0x0d, stream_id]))
            except Exception: report['closeCommandFailed'] = True
        for char, token in subscriptions:
            try:
                await asyncio.wait_for(char.write_client_characteristic_configuration_descriptor_async(CCCD.NONE), 3)
                char.remove_value_changed(token)
            except Exception: report['unsubscribeFailed'] = True
        if service is not None: service.close()
        if device is not None: device.close()
        report['controlCounts'] = dict(controls)
        emit('summary', **report)
        if args.report:
            path = Path(args.report); path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(json.dumps(report, ensure_ascii=False, indent=2)+'\n', encoding='utf8')


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--name', default='小米蓝牙语音遥控器')
    parser.add_argument('--inspect', action='store_true')
    parser.add_argument('--seconds', type=int, default=180, choices=range(10, 601))
    parser.add_argument('--max-sessions', type=int, default=3, choices=range(1, 11))
    parser.add_argument('--report')
    parser.add_argument('--stop-file')
    parser.add_argument('--stream-pcm', action='store_true', help='Private stdout pipe only; do not run directly with this flag')
    asyncio.run(main(parser.parse_args()))

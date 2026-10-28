"""Read-only geometry diagnosis for an idle loop and its decoded reference frame."""
import argparse
import json
from pathlib import Path


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--run', action='store_true')
    parser.add_argument('--reference')
    parser.add_argument('--candidate')
    parser.add_argument('--output')
    options = parser.parse_args()
    if not options.run:
        parser.print_help()
        return
    if not all([options.reference, options.candidate, options.output]):
        parser.error('reference, candidate and output are required with --run')
    import numpy as np
    from PIL import Image
    size = (640, 360)
    reference_image = Image.open(options.reference).convert('RGB').resize(size)
    candidate_image = Image.open(options.candidate).convert('RGB').resize(size)
    reference = np.asarray(reference_image, dtype=np.float32)
    candidate = np.asarray(candidate_image, dtype=np.float32)
    # Only the rainy window determines camera alignment. The person is excluded.
    box = (24, 20, 300, 330)
    left, top, right, bottom = box
    ref_region = reference[top:bottom, left:right].mean(axis=2)
    window = np.outer(np.hanning(bottom - top), np.hanning(right - left))
    reference_fft = np.fft.fft2((ref_region - ref_region.mean()) * window)
    candidates = []
    for scale in np.linspace(.90, 1.10, 81):
        # Evaluate a constant centered scale, then estimate its translation.
        transformed = candidate_image.transform(size, Image.Transform.AFFINE,
            (1 / scale, 0, 320 - 320 / scale, 0, 1 / scale, 180 - 180 / scale),
            resample=Image.Resampling.BILINEAR)
        array = np.asarray(transformed, dtype=np.float32)
        region = array[top:bottom, left:right].mean(axis=2)
        spectrum = reference_fft * np.conj(np.fft.fft2((region - region.mean()) * window))
        correlation = np.fft.ifft2(spectrum / np.maximum(np.abs(spectrum), 1e-9)).real
        row, col = np.unravel_index(correlation.argmax(), correlation.shape)
        dx = int(col if col <= region.shape[1] // 2 else col - region.shape[1])
        dy = int(row if row <= region.shape[0] // 2 else row - region.shape[0])
        if abs(dx) > 32 or abs(dy) > 32:
            continue
        moved = transformed.transform(size, Image.Transform.AFFINE, (1, 0, -dx, 0, 1, -dy), resample=Image.Resampling.BILINEAR)
        fitted = np.asarray(moved, dtype=np.float32)
        error = np.abs(reference[top:bottom, left:right] - fitted[top:bottom, left:right]).mean()
        diff = np.abs(reference - fitted)
        weighted = .55 * diff[10:200, 380:550].mean() + .2 * diff[224:280, 360:500].mean() + .25 * diff.mean()
        candidates.append({'scale': float(scale), 'translationAt1280': [dx * 2, dy * 2], 'backgroundMAE': float(error), 'wholeFrameMAE': float(diff.mean()), 'weightedMAE': float(weighted)})
    candidates.sort(key=lambda item: item['backgroundMAE'])
    report = {'reference': str(Path(options.reference)), 'candidate': str(Path(options.candidate)),
        'method': 'Constant centered scale plus translation estimated only from static rainy-window pixels; diagnostic only, no output image/video edits.',
        'baselineBackgroundMAE': float(np.abs(reference[top:bottom, left:right] - candidate[top:bottom, left:right]).mean()),
        'baselineWholeFrameMAE': float(np.abs(reference - candidate).mean()), 'bestCandidates': candidates[:10]}
    output = Path(options.output)
    with output.open('x', encoding='utf-8') as handle:
        json.dump(report, handle, ensure_ascii=False, indent=2)
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()

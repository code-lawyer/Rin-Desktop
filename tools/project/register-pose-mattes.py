"""Read original/cutout pixels and write registration coordinates only."""
import argparse
import json
from pathlib import Path
import cv2
import numpy as np

parser = argparse.ArgumentParser()
parser.add_argument('--run', action='store_true')
if not parser.parse_args().run:
    parser.exit(message='Use --run for local artwork correspondence analysis.\n')
root = Path(__file__).resolve().parents[2]
art = root / 'artwork/rin-poses-v1'

def read(path):
    value = cv2.imdecode(np.fromfile(str(path), np.uint8), cv2.IMREAD_UNCHANGED)
    if value is None:
        raise ValueError(f'Cannot read {path}')
    return cv2.resize(value, (1586, 992))

result = {}
for pose in ['attention', 'cup', 'work', 'thinking', 'window']:
    folder = 'scene-v3' if pose == 'thinking' else 'female-v2'
    original = read(root / f'prototypes/live2d-codex/assets/stills/{folder}/{pose}.png')
    matte = read(art / f'{pose}-matte.png')
    if matte.shape[2] != 4:
        raise ValueError(f'{pose}: missing generated alpha')
    sift = cv2.SIFT_create(nfeatures=6000, contrastThreshold=.025)
    mask = np.zeros((992, 1586), np.uint8)
    mask[45:, 700:1470] = 255
    a, da = sift.detectAndCompute(cv2.cvtColor(original[:, :, :3], cv2.COLOR_BGR2GRAY), mask)
    b, db = sift.detectAndCompute(cv2.cvtColor(matte[:, :, :3], cv2.COLOR_BGR2GRAY), np.uint8(matte[:, :, 3] > 220) * 255)
    matches = cv2.BFMatcher().knnMatch(da, db, k=2)
    good = [m for m, n in matches if m.distance < .7 * n.distance]
    pa = np.float32([a[m.queryIdx].pt for m in good])
    pb = np.float32([b[m.trainIdx].pt for m in good])
    matrix, inliers = cv2.estimateAffinePartial2D(pa, pb, method=cv2.RANSAC, ransacReprojThreshold=2.0, maxIters=10000)
    if matrix is None or inliers.sum() < 30:
        raise ValueError(f'{pose}: insufficient original-pixel correspondences')
    errors = np.linalg.norm(pa @ matrix[:, :2].T + matrix[:, 2] - pb, axis=1)[inliers.ravel() == 1]
    result[pose] = {'matrix': matrix.tolist(), 'inliers': int(inliers.sum()), 'medianError': float(np.median(errors)), 'p95Error': float(np.quantile(errors, .95))}
(art / 'registration.json').write_text(json.dumps(result, indent=2) + '\n', encoding='utf-8')
print(json.dumps(result, indent=2))

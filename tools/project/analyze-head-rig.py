"""Offline correspondence analysis: writes coordinates, never generated pixels.

Run in a disposable authoring environment with NumPy and OpenCV. Runtime users
do not need Python, OpenCV, accounts, a model download, or this source artwork.
"""
import argparse
import json
from pathlib import Path
import cv2
import numpy as np

parser = argparse.ArgumentParser()
parser.add_argument('--run', action='store_true')
args = parser.parse_args()
if not args.run:
    parser.exit(message='Use --run for local artwork correspondence analysis.\n')
root = Path(__file__).resolve().parents[2]
art = root / 'artwork/rin-actions-v3'
output = root / 'work/qa/action-authoring'

def read(path):
    data = cv2.imdecode(np.fromfile(str(path), dtype=np.uint8), cv2.IMREAD_COLOR)
    if data is None:
        raise ValueError(f'Cannot read {path.name}')
    return cv2.resize(data, (1586, 992), interpolation=cv2.INTER_LANCZOS4)

def registration(source, target):
    source_mask = np.zeros((992, 1586), np.uint8)
    source_mask[55:335, 1020:1360] = 255
    target_mask = np.zeros_like(source_mask)
    target_mask[45:400, 990:1430] = 255
    sift = cv2.SIFT_create(nfeatures=4000, contrastThreshold=.025)
    a, da = sift.detectAndCompute(cv2.cvtColor(source, cv2.COLOR_BGR2GRAY), source_mask)
    b, db = sift.detectAndCompute(cv2.cvtColor(target, cv2.COLOR_BGR2GRAY), target_mask)
    matches = cv2.BFMatcher().knnMatch(da, db, k=2)
    good = [m for m, n in matches if m.distance < .72*n.distance]
    pa = np.float32([a[m.queryIdx].pt for m in good])
    pb = np.float32([b[m.trainIdx].pt for m in good])
    matrix, inliers = cv2.estimateAffinePartial2D(pa, pb, method=cv2.RANSAC, ransacReprojThreshold=2.5, maxIters=10000)
    if matrix is None or int(inliers.sum()) < 12:
        raise ValueError('Not enough reliable head alignment features')
    error = np.linalg.norm(pa @ matrix[:, :2].T + matrix[:, 2] - pb, axis=1)[inliers.ravel() == 1]
    return {'matrix': matrix.tolist(), 'inliers': int(inliers.sum()), 'matches': len(good), 'medianError': float(np.median(error))}

front = read(root / 'prototypes/live2d-codex/assets/stills/female-v2/attention.png')
left = read(art / 'window-key.png')
registrations = {
    'front': registration(read(art / 'arms-clean.png'), read(art / 'body-cutout.png')),
    'left': registration(left, read(art / 'window-cutout.png')),
}
(art / 'matte-registration.json').write_text(json.dumps(registrations, indent=2) + '\n', encoding='utf-8')

print(json.dumps({'opencv': cv2.__version__, 'registration': registrations}))

const { POSES, ACTIVITY_LABELS } = require('./still-settings.cjs');

// A status refresh from the retained frame must not clear a later load error.
// Only a newly painted frame for the committed character can recover it.
function acceptWallpaperReport(status, info, appliedRequest, character) {
  if (!info || info.ready !== true || info.error
    || !['static-stills', 'motion-clips'].includes(info.model)
    || info.wallpaperKind !== 'artwork' || info.requestId !== status.requestId
    || info.requestId !== appliedRequest || info.character !== status.character
    || info.character !== character || !POSES.includes(info.pose)
    || !Object.hasOwn(ACTIVITY_LABELS, info.activity)
    || !Number.isSafeInteger(info.frameRevision) || info.frameRevision < 0
    || info.frameRevision < (status.frameRevision ?? -1)) return status;
  if (status.phase !== 'ready' && !(status.phase === 'error' && info.painted === true
    && info.frameRevision >= (status.errorFrameRevision ?? Infinity))) return status;
  const next = { ...status, phase: 'ready', pose: info.pose, activity: info.activity,
    model: info.model, motionPhase: info.motionPhase || null, frameRevision: info.frameRevision };
  delete next.error; delete next.errorFrameRevision;
  return JSON.stringify(next) === JSON.stringify(status) ? status : next;
}
module.exports = { acceptWallpaperReport };

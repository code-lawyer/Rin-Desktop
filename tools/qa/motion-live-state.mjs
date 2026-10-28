// A prepared hidden decoder does not prove that the wallpaper left its poster.
export function hasPresentedMotion(display) {
  return ['loop','transition','paused'].includes(display.host.motionPhase) && Number(display.host.motionPlayCount)>0
    && display.videos.some(video=>video.active&&video.width===3840&&video.height===2160&&video.readyState>=2);
}

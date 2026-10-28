import { startStillWallpaper } from './still-wallpaper.js';

// Keep the original render-ready acknowledgement and voice commit boundary.
export async function startWallpaperRenderer() {
  const api = window.companion, host = document.getElementById('wallpaper-view');
  const errorBox = document.getElementById('wallpaper-error');
  host.dataset.renderer = 'artwork';
  return startStillWallpaper({ host, api: {
    ...api,
    renderReady(info) {
      api.renderReady({ ...info, wallpaperKind: 'artwork' });
      if (info.error) { errorBox.textContent = info.error; errorBox.hidden = false; }
      else if (info.ready && info.painted) errorBox.hidden = true;
    },
  } });
}

// Adapted from Agent Avatar's MIT-licensed desktop/src/pixi.ts.
// Pixi's static shader polyfills avoid eval under the renderer's strict CSP.
import 'pixi.js/unsafe-eval';
import { loadTextures, TextureSource } from 'pixi.js';
loadTextures.config = { preferWorkers: false, preferCreateImageBitmap: false, crossOrigin: 'anonymous' };
TextureSource.defaultOptions.autoGenerateMipmaps = true;
const core = globalThis.Live2DCubismCore;
if (core?.Model?.fromMoc) {
  const original = core.Model.fromMoc.bind(core.Model);
  core.Model.fromMoc = moc => {
    const model = original(moc);
    if (model?.drawables && model.getRenderOrders && !('renderOrders' in model.drawables)) {
      const count = model.drawables.count, ranked = new Int32Array(count), indices = Array.from({ length: count }, (_, i) => i);
      Object.defineProperty(model.drawables, 'renderOrders', { get() {
        const orders = model.getRenderOrders(); indices.sort((a, b) => orders[a] - orders[b]);
        for (let rank = 0; rank < count; rank++) ranked[indices[rank]] = rank;
        return ranked;
      } });
    }
    return model;
  };
}

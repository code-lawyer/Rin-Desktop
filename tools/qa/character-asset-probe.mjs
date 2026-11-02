// Tested against requests made by the production renderer, so a resource
// layout change cannot silently disable this QA fault injection.
export function isCharacterImageRequest(url, style) {
  const target = new URL(url);
  const directory = style === 'anime' ? 'stills/female-v2-4k' : style === 'realistic' ? 'motion/female' : null;
  return !!directory && target.protocol === 'app:' && target.host === 'local'
    && target.pathname.startsWith(`/assets/${directory}/`) && target.pathname.endsWith('.png');
}

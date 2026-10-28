import { buildPreview, createPreviewServer, listenPreview } from './video-preview-server.mjs';

await buildPreview();
if (process.argv.includes('--build')) console.log('Independent video preview built.');
else {
  const port = Number(process.argv.find(arg => arg.startsWith('--port='))?.slice(7) || 5319);
  const server = await createPreviewServer();
  console.log(`Independent video preview: ${await listenPreview(server, port)}`);
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { server.closeAllConnections(); server.close(() => process.exit(0)); });
}

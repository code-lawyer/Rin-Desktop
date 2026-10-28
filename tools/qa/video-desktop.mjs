console.log('The legacy three-state video desktop check is retired. No fixture or report is created. Use npm run qa:motion -- --run for the current wallpaper; historical evidence remains in docs/development/video-desktop-trial.md.');
if (process.argv.includes('--run') && !process.argv.includes('--help') && !process.argv.includes('-h')) process.exitCode = 1;

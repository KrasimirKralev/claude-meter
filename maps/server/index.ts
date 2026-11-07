import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { createApp } from './app.ts';

const PORT = Number(process.env.PORT ?? 3417);
const dist = join(dirname(fileURLToPath(import.meta.url)), '..', 'dist');

// Started by the desktop app, this server must not outlive it, even when it is killed outright.
process.on('disconnect', () => process.exit(0));

if (!existsSync(dist)) {
  console.error('The app is not built yet. Run: npm start');
  process.exit(1);
}

const serve = (token?: string): void => {
  const app = createApp(undefined, token);

  // Asset names change with their content, so they can be kept for good. The page itself must not
  // be, or a new tab after a rebuild would ask for files that no longer exist.
  app.use('/assets', express.static(join(dist, 'assets'), { immutable: true, maxAge: '1y' }));
  app.use(express.static(dist, { index: 'index.html', maxAge: 0 }));

  // 127.0.0.1 only: this server holds the AI connection and must not be reachable from the network.
  app.listen(PORT, '127.0.0.1', (error?: Error) => {
    if (error) {
      console.error(`Balonche could not start on port ${PORT}: ${error.message}`);
      process.exit(1);
    }
    console.log(`Balonche is running at http://127.0.0.1:${PORT}`);
    // The desktop app trusts this message, not whatever happens to answer on the port.
    process.send?.({ type: 'listening' });
  });
};

// Started by the desktop app, which hands over this run's secret by message. An environment variable
// would stay readable in /proc by any program of the same user.
if (process.send) {
  process.once('message', (message: { token?: string }) => serve(message.token));
} else {
  serve();
}

import path from 'node:path';
import cookieParser from 'cookie-parser';
import dotenv from 'dotenv';
import express from 'express';
import helmet from 'helmet';
import { createServer as createViteServer } from 'vite';
import { ensureVaultKeyPairs } from './server/crypto';
import { getKeysDir, initDatabase } from './server/db';
import { registerApiRoutes } from './server/routes';

dotenv.config();

export async function createVeritasServer(options?: { dbPath?: string; keysDir?: string }) {
  const app = express();
  app.set('trust proxy', 1);

  // Security headers compatible with AI Studio preview iframe
  app.use(
    helmet({
      contentSecurityPolicy: false,
      crossOriginEmbedderPolicy: false,
      frameguard: false,
    })
  );
  app.use(cookieParser());
  app.use(express.json({ limit: '2mb' }));
  app.use(express.urlencoded({ extended: false }));

  const db = initDatabase(options?.dbPath);
  const keys = ensureVaultKeyPairs(options?.keysDir || getKeysDir());

  registerApiRoutes(app, db, keys);

  return { app, db, keys };
}

async function startServer() {
  const PORT = Number(process.env.PORT || 3000);
  const isProd = process.env.NODE_ENV === 'production';
  const { app } = await createVeritasServer();

  if (!isProd) {
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        hmr: process.env.DISABLE_HMR === 'true' ? false : undefined,
      },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`VERITAS DEMS server listening on http://0.0.0.0:${PORT}`);
  });
}

const isDirectRun =
  process.argv[1] &&
  (process.argv[1].endsWith('server.ts') || process.argv[1].endsWith('server.js'));

if (isDirectRun) {
  startServer().catch((err) => {
    console.error('Failed to start VERITAS server:', err);
    process.exit(1);
  });
}

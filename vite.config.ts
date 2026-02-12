import path from 'path';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
    const env = loadEnv(mode, '.', '');
    const isDev = mode === 'development';
    const useWorkerProxyInDev = isDev && env.VITE_DEV_PROXY_WORKER === 'true';

    const serverProxy = useWorkerProxyInDev
      ? {
          '/api': {
            target: env.VITE_WORKER_PROXY_TARGET || 'http://127.0.0.1:8787',
            changeOrigin: true,
            secure: false,
          },
        }
      : undefined;
    return {
      server: {
        port: 3000,
        host: '0.0.0.0',
        ...(serverProxy ? { proxy: serverProxy } : {}),
      },
      plugins: [react()],
      define: {
        // Keep legacy process.env references for local dev fallback only.
        'process.env.GEMINI_API_KEY': JSON.stringify(isDev ? env.GEMINI_API_KEY : ''),
        'process.env.OPENROUTER_API_KEY': JSON.stringify(isDev ? env.OPENROUTER_API_KEY : ''),
      },
      resolve: {
        alias: {
          '@': path.resolve(__dirname, '.'),
        }
      }
    };
});

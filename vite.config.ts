import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { defineConfig } from 'vite';

function createContentSecurityPolicy(isDev: boolean) {
  const connectSrc = [
    "'self'",
    'https://*.googleapis.com',
    'https://*.googleusercontent.com',
    'https://identitytoolkit.googleapis.com',
    'https://securetoken.googleapis.com',
    'https://firestore.googleapis.com',
    'https://www.googleapis.com',
    'https://openrouter.ai',
    'https://generativelanguage.googleapis.com',
  ];

  if (isDev) {
    connectSrc.push('ws://localhost:3000', 'http://localhost:3000');
  }

  return [
    "default-src 'self'",
    isDev ? "script-src 'self' 'unsafe-inline' 'unsafe-eval'" : "script-src 'self'",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "img-src 'self' data: blob: https://*.googleusercontent.com https://*.gstatic.com https://*.googleapis.com",
    "font-src 'self' data: https://fonts.gstatic.com",
    "media-src 'self' blob:",
    `connect-src ${connectSrc.join(' ')}`,
    "worker-src 'self' blob:",
    "manifest-src 'self'",
    "object-src 'none'",
    "frame-ancestors 'self'",
    "base-uri 'self'",
    "form-action 'self'",
    'upgrade-insecure-requests',
  ].join('; ');
}

function createSecurityHeaders(isDev: boolean) {
  return {
    'Content-Security-Policy': createContentSecurityPolicy(isDev),
    'Cross-Origin-Opener-Policy': 'same-origin-allow-popups',
    'Strict-Transport-Security': 'max-age=63072000; includeSubDomains; preload',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'X-Content-Type-Options': 'nosniff',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  };
}

export default defineConfig(({ command }) => {
  const isDevServer = command === 'serve';
  const securityHeaders = createSecurityHeaders(isDevServer);

  return {
    envDir: '.',
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modify—file watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      headers: securityHeaders,
    },
    preview: {
      headers: createSecurityHeaders(false),
    },
    build: {
      chunkSizeWarningLimit: 650,
      rollupOptions: {
        output: {
          manualChunks(id) {
            if (!id.includes('node_modules')) return;

            if (id.includes('firebase')) return 'firebase';
            if (id.includes('@google/genai')) return 'ai';
            if (id.includes('motion') || id.includes('lucide-react') || id.includes('canvas-confetti')) {
              return 'ui-vendor';
            }
            if (id.includes('react')) return 'react-vendor';
          },
        },
      },
    },
  };
});

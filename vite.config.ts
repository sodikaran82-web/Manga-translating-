import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig, loadEnv} from 'vite';

const safeStoragePlugin = () => {
  return {
    name: 'safe-storage-plugin',
    transform(code: string, id: string) {
      if (id.includes('@heyputer/puter.js') || id.includes('@heyputer_puter__js') || id.includes('@heyputer/kv.js')) {
        let transformed = code;
        
        // Wrap globalThis.localStorage assignments in try-catch
        transformed = transformed.replace(
          /if\s*\(\s*!\s*globalThis\.localStorage\s*\)\s*\{\s*globalThis\.localStorage\s*=\s*([a-zA-Z0-9_]+);\s*\}/g,
          (match, varName) => `try { if ( ! globalThis.localStorage ) { globalThis.localStorage = ${varName}; } } catch (e) {}`
        );

        // Replace direct localStorage.getItem/setItem/removeItem calls
        transformed = transformed.replace(
          /localStorage\.(getItem|setItem|removeItem)/g,
          (match, method) => `(function(){try{return localStorage.${method}.bind(localStorage)}catch(e){return function(){}}})()`
        );

        // Replace window.indexedDB to catch SecurityError
        transformed = transformed.replace(
          /window\.indexedDB/g,
          `(function(){try{return window.indexedDB}catch(e){return null}})()`
        );

        return {
          code: transformed,
          map: null
        };
      }
    }
  };
};

export default defineConfig(({mode}) => {
  const env = loadEnv(mode, '.', '');
  return {
    plugins: [react(), tailwindcss(), safeStoragePlugin()],
    ssr: {
      noExternal: ['@heyputer/puter.js']
    },
    define: {
      'process.env.GEMINI_API_KEY': JSON.stringify(env.GEMINI_API_KEY || ''),
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modifyâfile watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
    },
  };
});

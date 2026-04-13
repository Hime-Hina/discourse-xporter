import { defineConfig } from 'vite';
import monkey from 'vite-plugin-monkey';

export default defineConfig({
  resolve: {
    alias: {
      '@': new URL('./src', import.meta.url).pathname,
    },
  },
  plugins: [
    monkey({
      entry: 'src/main.ts',
      userscript: {
        name: 'Discourse Xporter',
        namespace: 'https://github.com/you/discourse-xporter',
        version: '1.0.0',
        description: 'Export Discourse topics to Obsidian Markdown',
        author: 'You',
        match: ['*://*/*'],
        grant: [
          'GM_getValue',
          'GM_setValue',
          'GM_setClipboard',
          'GM_xmlhttpRequest',
          'GM_addStyle',
          'GM_registerMenuCommand',
        ],
        connect: ['127.0.0.1', 'localhost', '*'],
        'run-at': 'document-idle',
      },
      build: {
        externalGlobals: {
          turndown: ['TurndownService', (version) => `https://unpkg.com/turndown@${version}/dist/turndown.js`],
          'turndown-plugin-gfm': ['turndownPluginGfm', (version) => `https://unpkg.com/turndown-plugin-gfm@${version}/dist/turndown-plugin-gfm.js`],
          fflate: ['fflate', (version) => `https://unpkg.com/fflate@${version}/umd/index.js`],
        },
      },
    }),
  ],
});

import { defineConfig, type Plugin } from 'vite';
import monkey from 'vite-plugin-monkey';

type DevServerRequest = {
  method?: string;
  url?: string;
};

const userscriptDevHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Private-Network': 'true',
  'Cross-Origin-Resource-Policy': 'cross-origin',
};

const userscriptDevPreflightHeaders = {
  'Access-Control-Allow-Methods': 'GET,HEAD,OPTIONS',
  'Access-Control-Allow-Headers': '*',
  Vary: 'Origin, Access-Control-Request-Headers, Access-Control-Request-Private-Network',
};

const userscriptDevEntryPath = '/__vite-plugin-monkey.entry.js';
const userscriptDevEntrySource = [
  'import "/__vite-plugin-monkey.gm.api.js";',
  'import "/src/main.ts";',
  '',
].join('\n');

function userscriptDevResourcePolicy(): Plugin {
  return {
    name: 'discourse-xporter:userscript-dev-resource-policy',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const request = req as DevServerRequest;
        for (const [name, value] of Object.entries(userscriptDevHeaders)) {
          res.setHeader(name, value);
        }
        if (request.method === 'OPTIONS') {
          for (const [name, value] of Object.entries(
            userscriptDevPreflightHeaders,
          )) {
            res.setHeader(name, value);
          }
          res.statusCode = 204;
          res.end();
          return;
        }
        const isEntryRequest =
          request.url?.split('?', 1)[0] === userscriptDevEntryPath;
        if (
          (request.method === 'GET' || request.method === 'HEAD') &&
          isEntryRequest
        ) {
          res.setHeader('content-type', 'application/javascript');
          res.end(request.method === 'HEAD' ? '' : userscriptDevEntrySource);
          return;
        }
        next();
      });
    },
  };
}

export default defineConfig({
  server: {
    hmr: false,
  },
  resolve: {
    alias: {
      '@': new URL('./src', import.meta.url).pathname,
    },
  },
  plugins: [
    userscriptDevResourcePolicy(),
    monkey({
      entry: 'src/main.ts',
      userscript: {
        name: 'Discourse Xporter',
        namespace: 'https://github.com/you/discourse-xporter',
        version: '1.0.0',
        description: 'Export Discourse topics to Obsidian Markdown',
        author: 'You',
        match: ['*://*/*'],
        noframes: true,
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
      server: {
        mountGmApi: true,
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

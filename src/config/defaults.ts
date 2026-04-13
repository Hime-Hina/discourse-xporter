import type { Config } from '../types';

export const DEFAULT_FLOOR_TEMPLATE = `---

## #{{post_number}} · {{author_full}} · {{date}}{{reply_to_display}}{{op_badge_display}}{{likes_display}}{{highlight}} {{block_ref}}

{{content}}
`;

export const DEFAULTS: Config = {
  // Export
  exportDir: 'Discourse',
  imgMode: 'file',
  imgDirMode: 'relative',
  imgDir: 'attachments',

  // Obsidian API
  obsApiUrl: 'https://127.0.0.1:27124',
  obsApiKey: '',
  obsWriteMode: 'overwrite',
  obsOpenAfterExport: true,

  // Floor template
  floorTemplate: DEFAULT_FLOOR_TEMPLATE,
  dateFormat: 'YYYY-MM-DD HH:mm',

  // Filter defaults
  defaultOnlyOp: false,
  defaultImgFilter: 'none',

  // Request
  batchSize: 100,
  batchDelayMin: 800,
  batchDelayMax: 1500,
  imageConcurrency: 3,
  imageDelayMin: 300,
  imageDelayMax: 800,

  // UI
  panelPos: null,

  // Debug
  debugMode: false,
};

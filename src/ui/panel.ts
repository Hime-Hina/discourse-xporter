import type {
  BatchItem,
  Config,
  FilterConfig,
  RangeMode,
  ImageMode,
  ImageDirMode,
  ImageFilter,
  PanelCorner,
} from '../types';
import { getConfig, saveConfig } from '../config/storage';
import { restoreExportProfile } from '../core/export-profile';
import { showToast } from './toast';
import type { ObsidianBatchReExportSummary } from '../export/obsidian-batch';

export interface PanelCallbacks {
  onCancelExport?: () => void;
  onExportObsidian: () => Promise<void>;
  onDownloadZip: () => Promise<void>;
  onDownloadMd: () => Promise<void>;
  onTestConnection: (apiUrl: string) => Promise<boolean>;
  onImagePathPreview?: (
    settings: Pick<Config, 'imgDirMode' | 'imgDir' | 'exportDir'>,
  ) => string;
  onBatchScan: () => Promise<BatchItem[]>;
  onBatchReExport: (
    items: BatchItem[],
    onProgress: (current: number, total: number, title: string) => void,
    replaceSavedSettings: boolean,
  ) => Promise<ObsidianBatchReExportSummary>;
  onBatchRefreshLinks?: (
    items: BatchItem[],
  ) => Promise<{ updated: number; ambiguous: number }>;
  formatVersion: number;
}

// ==================== DOM refs ====================

let panelEl: HTMLElement | null = null;
let credentialStatus: HTMLElement | null = null;
let refreshImagePath: (() => void) | null = null;
let progressContainer: HTMLElement | null = null;
let progressFill: HTMLElement | null = null;
let progressText: HTMLElement | null = null;
let callbacks: PanelCallbacks | null = null;
let filterSectionRefs: FilterSectionRefs | null = null;
let batchSectionRefs: BatchSectionRefs | null = null;

// Export button refs (for disabling during export)
let exportButtons: HTMLButtonElement[] = [];
let cancelButton: HTMLButtonElement | null = null;
let exporting = false;

// Batch state
let batchCache: BatchItem[] | null = null;
let batchScanning = false;
let batchExporting = false;

export interface FilterSectionRefs {
  rangeSelect: HTMLSelectElement;
  rangeStartInput: HTMLInputElement;
  rangeEndInput: HTMLInputElement;
  onlyOpInput: HTMLInputElement;
  imageFilterSelect: HTMLSelectElement;
  usersInput: HTMLInputElement;
  includeKeywordsInput: HTMLInputElement;
  excludeKeywordsInput: HTMLInputElement;
  minLengthInput: HTMLInputElement;
}

interface FilterSection {
  section: HTMLElement;
  refs: FilterSectionRefs;
}

interface BatchSectionRefs {
  statusEl: HTMLElement;
  listEl: HTMLElement;
  startBtn: HTMLButtonElement;
  refreshLinksBtn: HTMLButtonElement;
  selectionAllBtn: HTMLButtonElement;
  selectionOutdatedBtn: HTMLButtonElement;
  selectionNoneBtn: HTMLButtonElement;
  scanBtn: HTMLButtonElement;
  selectionGroup: HTMLElement;
  replaceSavedSettings: HTMLInputElement;
  selectionStates: Map<string, boolean>;
  checkboxEls: Map<string, HTMLInputElement>;
}

interface BatchSection {
  section: HTMLElement;
  refs: BatchSectionRefs;
}

// ==================== Helpers ====================

function h(
  tag: string,
  attrs?: Record<string, string>,
  children?: (Node | string)[],
): HTMLElement {
  const el = document.createElement(tag);
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (k === 'className') el.className = v;
      else el.setAttribute(k, v);
    }
  }
  if (children) {
    for (const c of children) {
      el.append(typeof c === 'string' ? document.createTextNode(c) : c);
    }
  }
  return el;
}

function field(
  labelText: string,
  input: HTMLElement,
  extraClass?: string,
): HTMLElement {
  const wrap = h('div', {
    className: `dxp-field${extraClass ? ' ' + extraClass : ''}`,
  });
  const lbl = h('label', undefined, [labelText]);
  wrap.append(lbl, input);
  return wrap;
}

function checkboxRow(
  labelText: string,
  checked: boolean,
  onChange: (v: boolean) => void,
): HTMLElement {
  const row = h('label', { className: 'dxp-checkbox-row' });
  const cb = h('input', { type: 'checkbox' }) as HTMLInputElement;
  cb.checked = checked;
  cb.addEventListener('change', () => onChange(cb.checked));
  row.append(cb, document.createTextNode(labelText));
  return row;
}

function collapsible(
  title: string,
  children: HTMLElement[],
  onToggle?: (open: boolean) => void,
): HTMLElement {
  const section = h('div', { className: 'dxp-section' });
  const header = h('div', { className: 'dxp-section-header' }, [
    h('span', undefined, [title]),
    h('span', { className: 'dxp-arrow' }, ['▶']),
  ]);
  const body = h('div', { className: 'dxp-section-body' });
  for (const c of children) body.append(c);
  header.addEventListener('click', () => {
    section.classList.toggle('dxp-open');
    onToggle?.(section.classList.contains('dxp-open'));
  });
  section.append(header, body);
  return section;
}

// ==================== Corner positioning ====================

const CORNER_MARGIN = 20;

function applyCorner(corner: PanelCorner): void {
  if (!panelEl) return;
  const s = panelEl.style;
  s.top = corner.startsWith('top') ? CORNER_MARGIN + 'px' : 'auto';
  s.bottom = corner.startsWith('bottom') ? CORNER_MARGIN + 'px' : 'auto';
  s.left = corner.endsWith('left') ? CORNER_MARGIN + 'px' : 'auto';
  s.right = corner.endsWith('right') ? CORNER_MARGIN + 'px' : 'auto';
}

function cycleCorner(): void {
  const order: PanelCorner[] = [
    'bottom-right',
    'bottom-left',
    'top-left',
    'top-right',
  ];
  const cfg = getConfig();
  const idx = order.indexOf(cfg.panelCorner);
  const next = order[(idx + 1) % order.length];
  cfg.panelCorner = next;
  saveConfig(cfg);
  applyCorner(next);
}

// ==================== Export lock ====================

function setExporting(val: boolean): void {
  exporting = val;
  for (const btn of exportButtons) btn.disabled = val;
  if (cancelButton) cancelButton.hidden = !val || !callbacks?.onCancelExport;
  updateBatchControls();
}

// ==================== Config save helper ====================

function patchConfig(fn: (cfg: Config) => void): void {
  const cfg = getConfig();
  fn(cfg);
  saveConfig(cfg);
}

// ==================== Build panel ====================

function buildPanel(cfg: Config): HTMLElement {
  const panel = h('div', { className: 'dxp-panel' });
  panel.style.display = 'none';

  // ---- Header ----
  const cornerBtn = h(
    'button',
    { className: 'dxp-drag-toggle', title: '切换面板位置' },
    ['📌'],
  );
  cornerBtn.addEventListener('click', cycleCorner);

  const closeBtn = h('button', { className: 'dxp-close-btn', title: '关闭' }, [
    '×',
  ]);
  closeBtn.addEventListener('click', () => hidePanel());

  const headerBtns = h('div', { className: 'dxp-header-btns' }, [
    cornerBtn,
    closeBtn,
  ]);

  const header = h('div', { className: 'dxp-panel-header' }, [
    h('span', undefined, ['Discourse Xporter']),
    headerBtns,
  ]);

  // ---- Progress ----
  const pFill = h('div', { className: 'dxp-progress-fill' });
  const pBar = h('div', { className: 'dxp-progress-bar' }, [pFill]);
  const pText = h('div', { className: 'dxp-progress-text' });
  const pContainer = h('div', { className: 'dxp-progress-container' }, [
    pBar,
    pText,
  ]);
  pContainer.style.display = 'none';
  cancelButton = h('button', { className: 'dxp-btn-mini' }, [
    '取消导出',
  ]) as HTMLButtonElement;
  cancelButton.hidden = true;
  cancelButton.addEventListener('click', (event) => {
    if (event.isTrusted) callbacks?.onCancelExport?.();
  });
  pContainer.append(cancelButton);

  progressContainer = pContainer;
  progressFill = pFill;
  progressText = pText;

  // ---- Main buttons ----
  const btnObsidian = h('button', { className: 'dxp-btn dxp-btn-primary' }, [
    '📤 导出到 Obsidian',
  ]) as HTMLButtonElement;
  btnObsidian.addEventListener('click', (event) => {
    if (!event.isTrusted) return;
    if (callbacks?.onExportObsidian) void callbacks.onExportObsidian();
  });

  const btnZip = h('button', { className: 'dxp-btn dxp-btn-secondary' }, [
    '📦 下载 ZIP',
  ]) as HTMLButtonElement;
  btnZip.addEventListener('click', (event) => {
    if (!event.isTrusted) return;
    if (callbacks?.onDownloadZip) void callbacks.onDownloadZip();
  });

  const btnMd = h('button', { className: 'dxp-btn dxp-btn-secondary' }, [
    '📝 下载 Markdown',
  ]) as HTMLButtonElement;
  btnMd.addEventListener('click', (event) => {
    if (!event.isTrusted) return;
    if (callbacks?.onDownloadMd) void callbacks.onDownloadMd();
  });

  const btnGroup = h('div', { className: 'dxp-btn-group' }, [btnZip, btnMd]);

  exportButtons = [btnObsidian, btnZip, btnMd];

  // ---- Obsidian connection settings ----
  const inApiUrl = h('input', {
    type: 'text',
    value: cfg.obsApiUrl,
  }) as HTMLInputElement;
  inApiUrl.addEventListener('change', () =>
    patchConfig((c) => {
      c.obsApiUrl = inApiUrl.value.trim();
    }),
  );

  const keyStatus = h('div', { className: 'dxp-credential-status' });
  credentialStatus = keyStatus;
  refreshCredentialStatus();
  const keyHint = h('div', { className: 'dxp-hint' }, [
    import.meta.env.DEV
      ? '开发模式不允许配置密钥。请使用生产脚本。'
      : '请从脚本管理器菜单设置、更换或清除 API Key。',
  ]);

  const btnTest = h(
    'button',
    {
      className: 'dxp-btn dxp-btn-secondary',
      style: 'margin-top:4px;width:100%',
    },
    ['🔗 测试连接'],
  );
  const sslHint = h(
    'div',
    {
      className: 'dxp-hint',
      style:
        'font-size:11px;color:var(--primary-medium,#888);margin-top:4px;display:none',
    },
    [],
  );
  btnTest.addEventListener('click', async (event) => {
    if (!event.isTrusted) return;
    if (!callbacks) return;

    btnTest.textContent = '⏳ 连接中…';
    sslHint.style.display = 'none';
    try {
      const connected = await callbacks.onTestConnection(inApiUrl.value.trim());
      btnTest.textContent = connected ? '✅ 连接成功' : '❌ 连接失败';
    } catch {
      btnTest.textContent = '❌ 连接失败';
      const url = inApiUrl.value.trim();
      if (/^https:\/\/(127\.0\.0\.1|localhost)/i.test(url)) {
        sslHint.textContent =
          '⚠️ HTTPS 本地连接需先在浏览器访问该地址并接受自签名证书，或改用 http://127.0.0.1:27124';
        sslHint.style.display = '';
      }
    }
    setTimeout(() => {
      btnTest.textContent = '🔗 测试连接';
    }, 2000);
  });

  const inExportDir = h('input', {
    type: 'text',
    value: cfg.exportDir,
  }) as HTMLInputElement;
  inExportDir.addEventListener('change', () =>
    patchConfig((c) => {
      c.exportDir = inExportDir.value.trim();
    }),
  );

  const selImgMode = h('select', undefined, [
    h('option', { value: 'file' }, ['下载文件 (file)']),
    h('option', { value: 'embed' }, ['嵌入链接 (embed)']),
    h('option', { value: 'none' }, ['忽略图片 (none)']),
  ]) as HTMLSelectElement;
  selImgMode.value = cfg.imgMode;

  const selImgDirMode = h('select', undefined, [
    h('option', { value: 'relative' }, ['导出目录下的子文件夹']),
    h('option', { value: 'absolute' }, ['Vault 中的指定路径']),
  ]) as HTMLSelectElement;
  selImgDirMode.value = cfg.imgDirMode;

  const inImgDir = h('input', {
    type: 'text',
    value: cfg.imgDir,
    placeholder:
      cfg.imgDirMode === 'relative'
        ? '留空则存放在导出目录下'
        : 'Discourse/attachments',
  }) as HTMLInputElement;
  inImgDir.addEventListener('change', () =>
    patchConfig((c) => {
      c.imgDir = inImgDir.value.trim();
    }),
  );

  const imgDirModeLabel = h('div', { className: 'dxp-hint dxp-image-path' });
  function updateImgDirHint(): void {
    const settings = {
      imgDirMode: selImgDirMode.value as ImageDirMode,
      imgDir: inImgDir.value.trim(),
      exportDir: inExportDir.value.trim(),
    };
    inImgDir.placeholder =
      settings.imgDirMode === 'relative'
        ? '留空则存放在导出目录下'
        : 'Discourse/attachments';
    imgDirModeLabel.textContent = callbacks?.onImagePathPreview
      ? `实际路径: ${callbacks.onImagePathPreview(settings)}`
      : '图片路径将在话题页显示';
  }
  refreshImagePath = updateImgDirHint;
  updateImgDirHint();

  selImgDirMode.addEventListener('change', () => {
    patchConfig((c) => {
      c.imgDirMode = selImgDirMode.value as ImageDirMode;
    });
    updateImgDirHint();
  });
  inImgDir.addEventListener('input', updateImgDirHint);
  inExportDir.addEventListener('input', updateImgDirHint);

  const imgDirGroup = h('div', { className: 'dxp-img-dir-group' });
  const imgDirModeField = field('图片存放位置', selImgDirMode);
  const imgDirPathField = field('文件夹名', inImgDir);
  imgDirGroup.append(imgDirModeField, imgDirPathField, imgDirModeLabel);
  imgDirGroup.style.display = cfg.imgMode === 'file' ? '' : 'none';

  selImgMode.addEventListener('change', () => {
    patchConfig((c) => {
      c.imgMode = selImgMode.value as ImageMode;
    });
    imgDirGroup.style.display = selImgMode.value === 'file' ? '' : 'none';
  });

  const obsSection = collapsible('Obsidian 连接设置', [
    field('API 地址', inApiUrl),
    field('API Key', keyStatus),
    keyHint,
    btnTest,
    sslHint,
    field('导出目录', inExportDir),
    field('图片模式', selImgMode),
    imgDirGroup,
  ]);

  const filterSection = buildFilterSection({
    rangeMode: 'all',
    rangeStart: 1,
    rangeEnd: Infinity,
    onlyOp: false,
    imgFilter: 'none',
    users: [],
    includeKeywords: [],
    excludeKeywords: [],
    minLength: 0,
  });
  filterSectionRefs = filterSection.refs;

  // ---- Batch re-export section ----
  const batchSection = buildBatchSection();
  batchSectionRefs = batchSection.refs;

  // ---- Advanced settings ----
  const taTemplate = h('textarea', {
    rows: '5',
    style: 'resize:vertical',
  }) as HTMLTextAreaElement;
  taTemplate.value = cfg.floorTemplate;
  taTemplate.addEventListener('change', () =>
    patchConfig((c) => {
      c.floorTemplate = taTemplate.value;
    }),
  );

  const inBatchSize = h('input', {
    type: 'number',
    value: String(cfg.batchSize),
    min: '1',
  }) as HTMLInputElement;
  inBatchSize.addEventListener('change', () =>
    patchConfig((c) => {
      c.batchSize = Math.max(1, Number(inBatchSize.value));
    }),
  );

  const inBatchDelay = h('input', {
    type: 'number',
    value: String(cfg.batchDelayMin),
    min: '0',
  }) as HTMLInputElement;
  inBatchDelay.addEventListener('change', () =>
    patchConfig((c) => {
      c.batchDelayMin = Math.max(0, Number(inBatchDelay.value));
    }),
  );

  const inImgConc = h('input', {
    type: 'number',
    value: String(cfg.imageConcurrency),
    min: '1',
  }) as HTMLInputElement;
  inImgConc.addEventListener('change', () =>
    patchConfig((c) => {
      c.imageConcurrency = Math.max(1, Number(inImgConc.value));
    }),
  );

  const cbDebug = { value: cfg.debugMode };
  const debugRow = checkboxRow('调试模式', cbDebug.value, (v) => {
    cbDebug.value = v;
    patchConfig((c) => {
      c.debugMode = v;
    });
  });

  const advSection = collapsible('高级设置', [
    field('楼层模板', taTemplate),
    field('请求批次大小', inBatchSize),
    field('批次延迟 (ms)', inBatchDelay),
    field('图片并发数', inImgConc),
    debugRow,
  ]);

  // ---- Assemble body ----
  const body = h('div', { className: 'dxp-panel-body' }, [
    pContainer,
    btnObsidian,
    btnGroup,
    obsSection,
    filterSection.section,
    batchSection.section,
    advSection,
  ]);

  panel.append(header, body);

  return panel;
}

function buildFilterSection(initial: FilterConfig): FilterSection {
  const rangeSelect = h('select', undefined, [
    h('option', { value: 'all' }, ['全部楼层']),
    h('option', { value: 'range' }, ['楼层范围']),
    h('option', { value: 'selected' }, ['手动选择']),
  ]) as HTMLSelectElement;
  rangeSelect.value = 'all';

  const rangeStartInput = h('input', {
    type: 'number',
    value: '1',
    min: '1',
  }) as HTMLInputElement;
  const rangeEndInput = h('input', {
    type: 'number',
    value: '100',
    min: '1',
  }) as HTMLInputElement;
  const rangeRow = h(
    'div',
    { className: 'dxp-field', style: 'display:flex;gap:6px' },
    [
      (() => {
        const wrapper = h('div', { style: 'flex:1' });
        wrapper.append(h('label', undefined, ['起始']), rangeStartInput);
        return wrapper;
      })(),
      (() => {
        const wrapper = h('div', { style: 'flex:1' });
        wrapper.append(h('label', undefined, ['结束']), rangeEndInput);
        return wrapper;
      })(),
    ],
  );
  rangeRow.style.display = 'none';
  rangeSelect.addEventListener('change', () => {
    rangeRow.style.display = rangeSelect.value === 'range' ? 'flex' : 'none';
  });

  const onlyOpInput = h('input', { type: 'checkbox' }) as HTMLInputElement;
  const onlyOpRow = h('label', { className: 'dxp-checkbox-row' }, [
    onlyOpInput,
    '只看楼主',
  ]);

  const imageFilterSelect = h('select', undefined, [
    h('option', { value: 'none' }, ['不筛选']),
    h('option', { value: 'withImg' }, ['仅含图片']),
    h('option', { value: 'noImg' }, ['无图片']),
  ]) as HTMLSelectElement;
  imageFilterSelect.value = 'none';

  const usersInput = h('input', {
    type: 'text',
    placeholder: '用逗号分隔多个用户名',
  }) as HTMLInputElement;
  const includeKeywordsInput = h('input', {
    type: 'text',
    placeholder: '用逗号分隔',
  }) as HTMLInputElement;
  const excludeKeywordsInput = h('input', {
    type: 'text',
    placeholder: '用逗号分隔',
  }) as HTMLInputElement;
  const minLengthInput = h('input', {
    type: 'number',
    value: '0',
    min: '0',
  }) as HTMLInputElement;

  const refs: FilterSectionRefs = {
    rangeSelect,
    rangeStartInput,
    rangeEndInput,
    onlyOpInput,
    imageFilterSelect,
    usersInput,
    includeKeywordsInput,
    excludeKeywordsInput,
    minLengthInput,
  };
  writePanelFilterConfig(refs, initial);
  return {
    section: collapsible('筛选设置', [
      field('楼层范围', rangeSelect),
      rangeRow,
      onlyOpRow,
      field('图片筛选', imageFilterSelect),
      field('指定用户', usersInput),
      field('包含关键词', includeKeywordsInput),
      field('排除关键词', excludeKeywordsInput),
      field('最少字数', minLengthInput),
    ]),
    refs,
  };
}

// ==================== Batch Re-export (inline section) ====================

function buildBatchSection(): BatchSection {
  const statusEl = h(
    'div',
    {
      className: 'dxp-batch-status',
      style:
        'font-size:12px;color:var(--primary-medium,#888);margin-bottom:6px',
    },
    ['点击扫描以查找已导出的笔记'],
  );

  const listEl = h('div', { className: 'dxp-batch-list' });

  const selectionAllBtn = h('button', { className: 'dxp-btn-mini' }, [
    '全选',
  ]) as HTMLButtonElement;
  const selectionOutdatedBtn = h('button', { className: 'dxp-btn-mini' }, [
    '选过期',
  ]) as HTMLButtonElement;
  const selectionNoneBtn = h('button', { className: 'dxp-btn-mini' }, [
    '取消',
  ]) as HTMLButtonElement;
  const startBtn = h(
    'button',
    {
      className: 'dxp-btn dxp-btn-primary',
      style: 'margin-top:6px;width:100%',
    },
    ['开始重导'],
  ) as HTMLButtonElement;
  startBtn.disabled = true;
  const refreshLinksBtn = h(
    'button',
    {
      className: 'dxp-btn dxp-btn-secondary',
      style: 'margin-top:6px;width:100%',
    },
    ['更新所选笔记链接'],
  ) as HTMLButtonElement;
  refreshLinksBtn.disabled = true;
  refreshLinksBtn.addEventListener('click', (event) => {
    if (event.isTrusted) void doBatchRefreshLinks();
  });

  const scanBtn = h(
    'button',
    {
      className: 'dxp-btn dxp-btn-secondary',
      style: 'width:100%;margin-bottom:6px',
    },
    ['🔍 扫描笔记'],
  ) as HTMLButtonElement;

  const replaceSavedSettings = h('input', {
    type: 'checkbox',
    className: 'dxp-batch-profile-override',
  }) as HTMLInputElement;
  const replacementRow = h('label', { className: 'dxp-checkbox-row' }, [
    replaceSavedSettings,
    '使用当前筛选与输出设置替换各篇历史策略',
  ]);

  const selectionGroup = h(
    'div',
    { className: 'dxp-batch-sel-group', style: 'display:none' },
    [selectionAllBtn, selectionOutdatedBtn, selectionNoneBtn],
  );

  scanBtn.addEventListener('click', (event) => {
    if (event.isTrusted) void doBatchScan();
  });
  selectionAllBtn.addEventListener('click', () => batchSelectAll(true));
  selectionOutdatedBtn.addEventListener('click', () => batchSelectOutdated());
  selectionNoneBtn.addEventListener('click', () => batchSelectAll(false));
  startBtn.addEventListener('click', (event) => {
    if (event.isTrusted) void doBatchExport();
  });

  const container = h('div', undefined, [
    scanBtn,
    statusEl,
    listEl,
    selectionGroup,
    replacementRow,
    startBtn,
    refreshLinksBtn,
  ]);

  const section = collapsible('批量重导', [container], (open) => {
    if (open && batchCache) {
      renderBatchList(batchCache);
      // Opening a section only renders cached data; privileged reads need a user action.
    }
  });

  return {
    section,
    refs: {
      statusEl,
      listEl,
      startBtn,
      refreshLinksBtn,
      selectionAllBtn,
      selectionOutdatedBtn,
      selectionNoneBtn,
      scanBtn,
      selectionGroup,
      replaceSavedSettings,
      selectionStates: new Map(),
      checkboxEls: new Map(),
    },
  };
}

async function doBatchScan(): Promise<void> {
  if (batchScanning || batchExporting || exporting) return;
  await scanBatchNotes();
}

async function scanBatchNotes(): Promise<boolean> {
  const refs = batchSectionRefs;
  if (!callbacks || !refs) return false;
  if (!getConfig().obsApiKey) {
    showToast('请先配置 Obsidian API Key', 'error');
    return false;
  }

  batchScanning = true;
  updateBatchControls();
  refs.statusEl.textContent = '扫描中…';
  try {
    const items = await callbacks.onBatchScan();
    const knownPaths = new Set(items.map((item) => item.path));
    for (const path of refs.selectionStates.keys()) {
      if (!knownPaths.has(path)) refs.selectionStates.delete(path);
    }
    for (const item of items) {
      if (!refs.selectionStates.has(item.path)) {
        refs.selectionStates.set(
          item.path,
          item.xporterVersion < callbacks.formatVersion,
        );
      }
    }
    batchCache = items;
    renderBatchList(items);
    return true;
  } catch {
    refs.statusEl.textContent = '扫描失败，可重新扫描';
    return false;
  } finally {
    batchScanning = false;
    updateBatchControls();
  }
}

function renderBatchList(items: BatchItem[]): void {
  const refs = batchSectionRefs;
  if (!refs || !callbacks) return;
  refs.listEl.innerHTML = '';
  refs.checkboxEls.clear();

  const formatVersion = callbacks.formatVersion;
  const hostname = window.location.hostname;

  if (items.length === 0) {
    refs.statusEl.textContent = '未找到来自当前论坛的导出笔记';
    refs.startBtn.disabled = true;
    refs.refreshLinksBtn.disabled = true;
    return;
  }

  let outdatedCount = 0;
  for (const item of items) {
    const isOutdated = item.xporterVersion < formatVersion;
    if (isOutdated) outdatedCount++;

    const row = h('label', { className: 'dxp-batch-row' });
    const cb = h('input', { type: 'checkbox' }) as HTMLInputElement;
    cb.checked = refs.selectionStates.get(item.path) ?? false;
    refs.checkboxEls.set(item.path, cb);

    cb.addEventListener('change', () => {
      refs.selectionStates.set(item.path, cb.checked);
      updateBatchStartBtn();
    });

    const versionLabel = isOutdated
      ? `v${item.xporterVersion || 0} → v${formatVersion}  ⚠️`
      : `v${item.xporterVersion}  ✅`;
    const versionSpan = h(
      'span',
      {
        className: isOutdated ? 'dxp-batch-outdated' : 'dxp-batch-uptodate',
        style: 'margin-left:auto;font-size:11px;white-space:nowrap',
      },
      [versionLabel],
    );

    const titleSpan = h(
      'span',
      {
        style:
          'flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap',
      },
      [item.title],
    );

    if (!item.exportProfile) {
      titleSpan.title = '缺少可恢复策略；请明确选择当前设置后重导';
      titleSpan.append(
        h('span', { className: 'dxp-batch-profile-warning' }, [
          ' ⚠ 缺少可恢复策略',
        ]),
      );
    }
    row.append(cb, titleSpan, versionSpan);
    if (item.exportProfile) {
      const loadFilters = h(
        'button',
        { className: 'dxp-btn-mini', type: 'button' },
        ['载入筛选'],
      );
      loadFilters.addEventListener('click', (event) => {
        event.preventDefault();
        if (!event.isTrusted || !filterSectionRefs || !item.exportProfile)
          return;
        writePanelFilterConfig(
          filterSectionRefs,
          restoreExportProfile(item.exportProfile).filters,
        );
        showToast(`已载入“${item.title}”的筛选条件`);
      });
      row.append(loadFilters);
    }
    refs.listEl.append(row);
  }

  refs.statusEl.textContent = `${hostname}: ${items.length} 篇 (${outdatedCount} 篇过期)`;
  refs.selectionGroup.style.display = '';

  updateBatchStartBtn();
}

function batchSelectAll(checked: boolean): void {
  const refs = batchSectionRefs;
  if (!refs) return;
  for (const [path, cb] of refs.checkboxEls) {
    cb.checked = checked;
    refs.selectionStates.set(path, checked);
  }
  updateBatchStartBtn();
}

function batchSelectOutdated(): void {
  const refs = batchSectionRefs;
  if (!callbacks || !batchCache || !refs) return;
  const formatVersion = callbacks.formatVersion;
  for (const item of batchCache) {
    const isOutdated = item.xporterVersion < formatVersion;
    const cb = refs.checkboxEls.get(item.path);
    if (cb) {
      cb.checked = isOutdated;
    }
  }
  updateBatchStartBtn();
}

function getBatchSelectedCount(): number {
  const refs = batchSectionRefs;
  if (!refs) return 0;
  let selectedCount = 0;
  for (const selected of refs.selectionStates.values()) {
    if (selected) selectedCount++;
  }
  return selectedCount;
}

function updateBatchStartBtn(): void {
  const refs = batchSectionRefs;
  if (!refs || !batchCache) return;
  const sel = getBatchSelectedCount();
  refs.startBtn.textContent = `开始重导 (${sel}/${batchCache.length})`;
  refs.startBtn.disabled =
    sel === 0 || batchExporting || batchScanning || exporting;
  refs.refreshLinksBtn.disabled =
    !callbacks?.onBatchRefreshLinks || refs.startBtn.disabled;
}

function updateBatchControls(): void {
  const refs = batchSectionRefs;
  if (!refs) return;
  const busy = batchScanning || batchExporting || exporting;
  refs.scanBtn.disabled = busy;
  refs.replaceSavedSettings.disabled = busy;
  refs.scanBtn.textContent = batchScanning ? '⏳ 扫描中…' : '🔍 扫描笔记';
  for (const button of [
    refs.selectionAllBtn,
    refs.selectionOutdatedBtn,
    refs.selectionNoneBtn,
  ]) {
    button.disabled = busy;
  }
  for (const checkbox of refs.checkboxEls.values()) checkbox.disabled = busy;
  updateBatchStartBtn();
  refs.refreshLinksBtn.disabled =
    !callbacks?.onBatchRefreshLinks || busy || getBatchSelectedCount() === 0;
}

async function doBatchExport(): Promise<void> {
  const refs = batchSectionRefs;
  if (
    !callbacks ||
    !batchCache ||
    !refs ||
    batchExporting ||
    batchScanning ||
    exporting
  )
    return;
  const selected = batchCache.filter((item) =>
    refs.selectionStates.get(item.path),
  );
  if (selected.length === 0) return;

  batchExporting = true;
  updateBatchControls();
  refs.startBtn.textContent = '重导中…';
  try {
    const summary = await callbacks.onBatchReExport(
      selected,
      (current, total, title) => {
        updateProgress(`重导 ${current}/${total}：${title}`, current / total);
      },
      refs.replaceSavedSettings.checked,
    );
    for (const entry of summary.results) {
      refs.selectionStates.set(entry.path, entry.status === 'failed');
    }
    const counts = `${summary.updated} 更新，${summary.unchanged} 未变化，${summary.failed} 失败`;
    // The operation owner has finished writing. Hold the local UI through the awaited read refresh.
    const refreshed = await scanBatchNotes();
    const message = `批量重导${summary.cancelled ? '已取消' : '完成'}：${counts}${refreshed ? '' : '；状态刷新失败，请重新扫描'}`;
    showToast(
      message,
      summary.failed > 0 || !refreshed ? 'error' : 'success',
      5000,
    );
  } catch (error) {
    showToast(
      `批量重导出错: ${error instanceof Error ? error.message : String(error)}`,
      'error',
      5000,
    );
  } finally {
    batchExporting = false;
    resetProgress();
    updateBatchControls();
  }
}

async function doBatchRefreshLinks(): Promise<void> {
  const refs = batchSectionRefs;
  if (
    !callbacks?.onBatchRefreshLinks ||
    !batchCache ||
    !refs ||
    batchExporting ||
    batchScanning ||
    exporting
  )
    return;
  const selected = batchCache.filter((item) =>
    refs.selectionStates.get(item.path),
  );
  if (selected.length === 0) return;
  batchExporting = true;
  updateBatchControls();
  try {
    const summary = await callbacks.onBatchRefreshLinks(selected);
    const refreshed = await scanBatchNotes();
    showToast(
      `链接更新完成：${summary.updated} 篇更新，${summary.ambiguous} 个目标不明确${refreshed ? '' : '；状态刷新失败，请重新扫描'}`,
      summary.ambiguous > 0 || !refreshed ? 'info' : 'success',
      5000,
    );
  } catch (error) {
    showToast(
      `链接更新出错: ${error instanceof Error ? error.message : String(error)}`,
      'error',
      5000,
    );
  } finally {
    batchExporting = false;
    resetProgress();
    updateBatchControls();
  }
}

// ==================== Public API ====================

export function initPanel(cb: PanelCallbacks): void {
  if (panelEl) return;
  callbacks = cb;
  const cfg = getConfig();
  panelEl = buildPanel(cfg);
  document.body.append(panelEl);
  applyCorner(cfg.panelCorner);
}

export function showPanel(): void {
  refreshCredentialStatus();
  refreshPathPreview();
  if (panelEl) panelEl.style.display = '';
}

export function hidePanel(): void {
  if (panelEl) panelEl.style.display = 'none';
}

export function togglePanel(): void {
  if (!panelEl) return;
  refreshCredentialStatus();
  refreshPathPreview();
  panelEl.style.display = panelEl.style.display === 'none' ? '' : 'none';
}

export function updateProgress(message: string, progress?: number): void {
  if (!progressContainer || !progressFill || !progressText) return;
  progressContainer.style.display = '';
  progressText.textContent = message;
  if (progress !== undefined) {
    progressFill.style.width = Math.min(100, Math.max(0, progress * 100)) + '%';
  }
}

export function resetProgress(): void {
  if (!progressContainer || !progressFill || !progressText) return;
  progressContainer.style.display = 'none';
  progressFill.style.width = '0%';
  progressText.textContent = '';
}

/** Called by main.ts before/after export to lock/unlock buttons */
export function setExportLock(locked: boolean): void {
  setExporting(locked);
}

export type PanelFilterConfig = FilterConfig;

export function getPanelFilterConfig(): PanelFilterConfig {
  if (!filterSectionRefs) throw new Error('导出面板尚未初始化');
  return readPanelFilterConfig(filterSectionRefs);
}

export function readPanelFilterConfig(
  refs: FilterSectionRefs,
): PanelFilterConfig {
  return {
    rangeMode: refs.rangeSelect.value as RangeMode,
    rangeStart: Math.max(1, Number(refs.rangeStartInput.value) || 1),
    rangeEnd: Number(refs.rangeEndInput.value) || Infinity,
    onlyOp: refs.onlyOpInput.checked,
    imgFilter: refs.imageFilterSelect.value as ImageFilter,
    users: splitFilterTerms(refs.usersInput.value),
    includeKeywords: splitFilterTerms(refs.includeKeywordsInput.value),
    excludeKeywords: splitFilterTerms(refs.excludeKeywordsInput.value),
    minLength: Math.max(0, Number(refs.minLengthInput.value) || 0),
  };
}

export function writePanelFilterConfig(
  refs: FilterSectionRefs,
  filters: FilterConfig,
): void {
  refs.rangeSelect.value = filters.rangeMode;
  refs.rangeStartInput.value = String(filters.rangeStart);
  refs.rangeEndInput.value = Number.isFinite(filters.rangeEnd)
    ? String(filters.rangeEnd)
    : '';
  refs.onlyOpInput.checked = filters.onlyOp;
  refs.imageFilterSelect.value = filters.imgFilter;
  refs.usersInput.value = filters.users.join(', ');
  refs.includeKeywordsInput.value = filters.includeKeywords.join(', ');
  refs.excludeKeywordsInput.value = filters.excludeKeywords.join(', ');
  refs.minLengthInput.value = String(filters.minLength);
  refs.rangeSelect.dispatchEvent(new Event('change'));
}

function splitFilterTerms(value: string): string[] {
  return value
    .split(/[,，]/)
    .map((term) => term.trim())
    .filter(Boolean);
}

/** A status flag is the only credential information placed in the shared page DOM. */
export function refreshCredentialStatus(): void {
  if (credentialStatus)
    credentialStatus.textContent = getConfig().obsApiKey ? '已配置' : '未配置';
}

export function refreshPathPreview(): void {
  refreshImagePath?.();
}

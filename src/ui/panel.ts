import type {
  BatchItem,
  Config,
  RangeMode,
  ImageMode,
  ImageDirMode,
  ImageFilter,
  PanelCorner,
} from '../types';
import { getConfig, saveConfig } from '../config/storage';
import { showToast } from './toast';

export interface PanelCallbacks {
  onExportObsidian: () => Promise<void>;
  onDownloadZip: () => Promise<void>;
  onDownloadMd: () => Promise<void>;
  onTestConnection: (apiUrl: string, apiKey: string) => Promise<boolean>;
  onBatchScan: () => Promise<BatchItem[]>;
  onBatchReExport: (
    items: BatchItem[],
    onProgress: (current: number, total: number, title: string) => void,
  ) => Promise<{ success: number; failed: number }>;
  formatVersion: number;
}

// ==================== DOM refs ====================

let panelEl: HTMLElement | null = null;
let progressContainer: HTMLElement | null = null;
let progressFill: HTMLElement | null = null;
let progressText: HTMLElement | null = null;
let callbacks: PanelCallbacks | null = null;

// Export button refs (for disabling during export)
let exportButtons: HTMLButtonElement[] = [];
let exporting = false;

// Batch state
let batchCache: BatchItem[] | null = null;
let batchScanning = false;
let batchExporting = false;

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
  const order: PanelCorner[] = ['bottom-right', 'bottom-left', 'top-left', 'top-right'];
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

  progressContainer = pContainer;
  progressFill = pFill;
  progressText = pText;

  // ---- Main buttons ----
  const btnObsidian = h('button', { className: 'dxp-btn dxp-btn-primary' }, [
    '📤 导出到 Obsidian',
  ]) as HTMLButtonElement;
  btnObsidian.addEventListener('click', () => {
    if (callbacks?.onExportObsidian) void callbacks.onExportObsidian();
  });

  const btnZip = h('button', { className: 'dxp-btn dxp-btn-secondary' }, [
    '📦 下载 ZIP',
  ]) as HTMLButtonElement;
  btnZip.addEventListener('click', () => {
    if (callbacks?.onDownloadZip) void callbacks.onDownloadZip();
  });

  const btnMd = h('button', { className: 'dxp-btn dxp-btn-secondary' }, [
    '📝 下载 Markdown',
  ]) as HTMLButtonElement;
  btnMd.addEventListener('click', () => {
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

  const inApiKey = h('input', {
    type: 'password',
    value: cfg.obsApiKey,
    placeholder: '留空则不验证',
  }) as HTMLInputElement;
  inApiKey.addEventListener('change', () =>
    patchConfig((c) => {
      c.obsApiKey = inApiKey.value;
    }),
  );

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
      style: 'font-size:11px;color:var(--primary-medium,#888);margin-top:4px;display:none',
    },
    [],
  );
  btnTest.addEventListener('click', async () => {
    if (!callbacks) return;

    btnTest.textContent = '⏳ 连接中…';
    sslHint.style.display = 'none';
    try {
      const connected = await callbacks.onTestConnection(
        inApiUrl.value.trim(),
        inApiKey.value,
      );
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
    placeholder: cfg.imgDirMode === 'relative' ? '留空则存放在导出目录下' : 'Discourse/attachments',
  }) as HTMLInputElement;
  inImgDir.addEventListener('change', () =>
    patchConfig((c) => {
      c.imgDir = inImgDir.value.trim();
    }),
  );

  const imgDirModeLabel = h('div', {
    style: 'font-size:11px;color:var(--primary-medium,#888);margin-bottom:4px',
  }, [
    cfg.imgDirMode === 'relative'
      ? `实际路径: ${cfg.exportDir}/${cfg.imgDir || ''}`.replace(/\/+$/, '')
      : `实际路径: ${cfg.imgDir}`,
  ]);

  function updateImgDirHint(): void {
    const mode = selImgDirMode.value as ImageDirMode;
    const dir = inImgDir.value.trim();
    const exportDir = inExportDir.value.trim();
    if (mode === 'relative') {
      inImgDir.placeholder = '留空则存放在导出目录下';
      imgDirModeLabel.textContent = `实际路径: ${dir ? exportDir + '/' + dir : exportDir}`;
    } else {
      inImgDir.placeholder = 'Discourse/attachments';
      imgDirModeLabel.textContent = `实际路径: ${dir || '(未指定)'}`;
    }
  }

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
    field('API Key', inApiKey),
    btnTest,
    sslHint,
    field('导出目录', inExportDir),
    field('图片模式', selImgMode),
    imgDirGroup,
  ]);

  // ---- Filter settings (NOT persisted) ----
  const selRange = h('select', undefined, [
    h('option', { value: 'all' }, ['全部楼层']),
    h('option', { value: 'range' }, ['楼层范围']),
    h('option', { value: 'selected' }, ['手动选择']),
  ]) as HTMLSelectElement;
  selRange.value = 'all';

  const inRangeStart = h('input', {
    type: 'number',
    value: '1',
    min: '1',
  }) as HTMLInputElement;
  const inRangeEnd = h('input', {
    type: 'number',
    value: '100',
    min: '1',
  }) as HTMLInputElement;
  const rangeRow = h(
    'div',
    { className: 'dxp-field', style: 'display:flex;gap:6px' },
    [
      (() => {
        const w = h('div', { style: 'flex:1' });
        w.append(h('label', undefined, ['起始']), inRangeStart);
        return w;
      })(),
      (() => {
        const w = h('div', { style: 'flex:1' });
        w.append(h('label', undefined, ['结束']), inRangeEnd);
        return w;
      })(),
    ],
  );
  rangeRow.style.display = 'none';
  selRange.addEventListener('change', () => {
    rangeRow.style.display = selRange.value === 'range' ? 'flex' : 'none';
  });

  const cbOnlyOp = { value: false };
  const onlyOpRow = checkboxRow('只看楼主', false, (v) => {
    cbOnlyOp.value = v;
  });

  const selImgFilter = h('select', undefined, [
    h('option', { value: 'none' }, ['不筛选']),
    h('option', { value: 'withImg' }, ['仅含图片']),
    h('option', { value: 'noImg' }, ['无图片']),
  ]) as HTMLSelectElement;
  selImgFilter.value = 'none';

  const inUsers = h('input', {
    type: 'text',
    placeholder: '用逗号分隔多个用户名',
  }) as HTMLInputElement;
  const inIncKw = h('input', {
    type: 'text',
    placeholder: '用逗号分隔',
  }) as HTMLInputElement;
  const inExcKw = h('input', {
    type: 'text',
    placeholder: '用逗号分隔',
  }) as HTMLInputElement;
  const inMinLen = h('input', {
    type: 'number',
    value: '0',
    min: '0',
  }) as HTMLInputElement;

  const filterSection = collapsible('筛选设置', [
    field('楼层范围', selRange),
    rangeRow,
    onlyOpRow,
    field('图片筛选', selImgFilter),
    field('指定用户', inUsers),
    field('包含关键词', inIncKw),
    field('排除关键词', inExcKw),
    field('最少字数', inMinLen),
  ]);

  // ---- Batch re-export section ----
  const batchSection = buildBatchSection();

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
    filterSection,
    batchSection,
    advSection,
  ]);

  panel.append(header, body);

  // ---- Store refs for getPanelFilterConfig ----
  panel.dataset.refRange = '';
  (panel as any)._refs = {
    selRange,
    inRangeStart,
    inRangeEnd,
    cbOnlyOp,
    selImgFilter,
    inUsers,
    inIncKw,
    inExcKw,
    inMinLen,
  };

  return panel;
}

// ==================== Batch Re-export (inline section) ====================

// Batch UI refs
let batchStatusEl: HTMLElement | null = null;
let batchListEl: HTMLElement | null = null;
let batchStartBtn: HTMLButtonElement | null = null;
let batchSelAllBtn: HTMLButtonElement | null = null;
let batchSelOutdatedBtn: HTMLButtonElement | null = null;
let batchSelNoneBtn: HTMLButtonElement | null = null;
let batchScanBtn: HTMLButtonElement | null = null;
let batchCheckStates = new Map<number, boolean>();
let batchCheckboxEls = new Map<number, HTMLInputElement>();

function buildBatchSection(): HTMLElement {
  batchStatusEl = h('div', {
    className: 'dxp-batch-status',
    style: 'font-size:12px;color:var(--primary-medium,#888);margin-bottom:6px',
  }, ['点击扫描以查找已导出的笔记']);

  batchListEl = h('div', { className: 'dxp-batch-list' });

  // Action buttons row
  batchSelAllBtn = h('button', { className: 'dxp-btn-mini' }, ['全选']) as HTMLButtonElement;
  batchSelOutdatedBtn = h('button', { className: 'dxp-btn-mini' }, ['选过期']) as HTMLButtonElement;
  batchSelNoneBtn = h('button', { className: 'dxp-btn-mini' }, ['取消']) as HTMLButtonElement;
  batchStartBtn = h('button', { className: 'dxp-btn dxp-btn-primary', style: 'margin-top:6px;width:100%' }, [
    '开始重导',
  ]) as HTMLButtonElement;
  batchStartBtn.disabled = true;

  batchScanBtn = h('button', { className: 'dxp-btn dxp-btn-secondary', style: 'width:100%;margin-bottom:6px' }, [
    '🔍 扫描笔记',
  ]) as HTMLButtonElement;

  const selBtnGroup = h('div', { className: 'dxp-batch-sel-group', style: 'display:none' }, [
    batchSelAllBtn, batchSelOutdatedBtn, batchSelNoneBtn,
  ]);

  batchScanBtn.addEventListener('click', () => void doBatchScan());
  batchSelAllBtn.addEventListener('click', () => batchSelectAll(true));
  batchSelOutdatedBtn.addEventListener('click', () => batchSelectOutdated());
  batchSelNoneBtn.addEventListener('click', () => batchSelectAll(false));
  batchStartBtn.addEventListener('click', () => void doBatchExport());

  const container = h('div', undefined, [
    batchScanBtn,
    batchStatusEl,
    batchListEl,
    selBtnGroup,
    batchStartBtn,
  ]);

  // Store selBtnGroup ref
  (container as any)._selGroup = selBtnGroup;

  const section = collapsible('批量重导', [container], (open) => {
    if (open && batchCache) {
      // Show cached list immediately, then refresh in background
      renderBatchList(batchCache);
      void doBatchScan();
    }
  });

  return section;
}

async function doBatchScan(): Promise<void> {
  if (!callbacks || batchScanning || batchExporting) return;

  const config = getConfig();
  if (!config.obsApiKey) {
    showToast('请先配置 Obsidian API Key', 'error');
    return;
  }

  batchScanning = true;
  if (batchScanBtn) {
    batchScanBtn.disabled = true;
    batchScanBtn.textContent = '⏳ 扫描中…';
  }
  if (batchStatusEl) batchStatusEl.textContent = '扫描中…';

  try {
    const items = await callbacks.onBatchScan();
    batchCache = items;
    renderBatchList(items);
  } catch {
    if (batchStatusEl) batchStatusEl.textContent = '扫描失败';
  } finally {
    batchScanning = false;
    if (batchScanBtn) {
      batchScanBtn.disabled = false;
      batchScanBtn.textContent = '🔍 扫描笔记';
    }
  }
}

function renderBatchList(items: BatchItem[]): void {
  if (!batchListEl || !batchStatusEl || !callbacks) return;
  batchListEl.innerHTML = '';
  batchCheckStates.clear();
  batchCheckboxEls.clear();

  const formatVersion = callbacks.formatVersion;
  const hostname = window.location.hostname;

  if (items.length === 0) {
    batchStatusEl.textContent = '未找到来自当前论坛的导出笔记';
    if (batchStartBtn) batchStartBtn.disabled = true;
    return;
  }

  let outdatedCount = 0;
  for (const item of items) {
    const isOutdated = item.xporterVersion < formatVersion;
    if (isOutdated) outdatedCount++;
    batchCheckStates.set(item.topicId, isOutdated);

    const row = h('label', { className: 'dxp-batch-row' });
    const cb = h('input', { type: 'checkbox' }) as HTMLInputElement;
    cb.checked = isOutdated;
    batchCheckboxEls.set(item.topicId, cb);

    cb.addEventListener('change', () => {
      batchCheckStates.set(item.topicId, cb.checked);
      updateBatchStartBtn();
    });

    const versionLabel = isOutdated
      ? `v${item.xporterVersion || 0} → v${formatVersion}  ⚠️`
      : `v${item.xporterVersion}  ✅`;
    const versionSpan = h('span', {
      className: isOutdated ? 'dxp-batch-outdated' : 'dxp-batch-uptodate',
      style: 'margin-left:auto;font-size:11px;white-space:nowrap',
    }, [versionLabel]);

    const titleSpan = h('span', {
      style: 'flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap',
    }, [item.title]);

    row.append(cb, titleSpan, versionSpan);
    batchListEl.append(row);
  }

  batchStatusEl.textContent = `${hostname}: ${items.length} 篇 (${outdatedCount} 篇过期)`;

  // Show selection buttons
  const container = batchListEl.parentElement;
  const selGroup = (container as any)?._selGroup as HTMLElement | undefined;
  if (selGroup) selGroup.style.display = '';

  updateBatchStartBtn();
}

function batchSelectAll(checked: boolean): void {
  for (const [topicId, cb] of batchCheckboxEls) {
    cb.checked = checked;
    batchCheckStates.set(topicId, checked);
  }
  updateBatchStartBtn();
}

function batchSelectOutdated(): void {
  if (!callbacks || !batchCache) return;
  const fv = callbacks.formatVersion;
  for (const item of batchCache) {
    const isOutdated = item.xporterVersion < fv;
    const cb = batchCheckboxEls.get(item.topicId);
    if (cb) {
      cb.checked = isOutdated;
      batchCheckStates.set(item.topicId, isOutdated);
    }
  }
  updateBatchStartBtn();
}

function getBatchSelectedCount(): number {
  let n = 0;
  for (const v of batchCheckStates.values()) if (v) n++;
  return n;
}

function updateBatchStartBtn(): void {
  if (!batchStartBtn || !batchCache) return;
  const sel = getBatchSelectedCount();
  batchStartBtn.textContent = `开始重导 (${sel}/${batchCache.length})`;
  batchStartBtn.disabled = sel === 0 || batchExporting || exporting;
}

async function doBatchExport(): Promise<void> {
  if (!callbacks || !batchCache || batchExporting || exporting) return;

  const selected = batchCache.filter((it) => batchCheckStates.get(it.topicId));
  if (selected.length === 0) return;

  batchExporting = true;
  setExporting(true);
  if (batchStartBtn) {
    batchStartBtn.textContent = '重导中…';
    batchStartBtn.disabled = true;
  }
  if (batchScanBtn) batchScanBtn.disabled = true;

  try {
    const result = await callbacks.onBatchReExport(
      selected,
      (current, total, title) => {
        updateProgress(`重导 ${current}/${total}：${title}`, current / total);
      },
    );

    const msg = `批量重导完成：${result.success} 成功${result.failed > 0 ? `，${result.failed} 失败` : ''}`;
    showToast(msg, result.failed > 0 ? 'error' : 'success', 4000);

    // Re-scan to refresh status
    void doBatchScan();
  } catch (err) {
    showToast(
      `批量重导出错: ${err instanceof Error ? err.message : String(err)}`,
      'error',
      5000,
    );
  } finally {
    batchExporting = false;
    setExporting(false);
    resetProgress();
    if (batchScanBtn) batchScanBtn.disabled = false;
    updateBatchStartBtn();
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
  if (panelEl) panelEl.style.display = '';
}

export function hidePanel(): void {
  if (panelEl) panelEl.style.display = 'none';
}

export function togglePanel(): void {
  if (!panelEl) return;
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

export interface PanelFilterConfig {
  rangeMode: RangeMode;
  rangeStart: number;
  rangeEnd: number;
  onlyOp: boolean;
  imgFilter: ImageFilter;
  users: string[];
  includeKeywords: string[];
  excludeKeywords: string[];
  minLength: number;
}

export function getPanelFilterConfig(): PanelFilterConfig {
  if (!panelEl) {
    return {
      rangeMode: 'all',
      rangeStart: 1,
      rangeEnd: Infinity,
      onlyOp: false,
      imgFilter: 'none',
      users: [],
      includeKeywords: [],
      excludeKeywords: [],
      minLength: 0,
    };
  }
  const refs = (panelEl as any)._refs as {
    selRange: HTMLSelectElement;
    inRangeStart: HTMLInputElement;
    inRangeEnd: HTMLInputElement;
    cbOnlyOp: { value: boolean };
    selImgFilter: HTMLSelectElement;
    inUsers: HTMLInputElement;
    inIncKw: HTMLInputElement;
    inExcKw: HTMLInputElement;
    inMinLen: HTMLInputElement;
  };

  const split = (v: string) =>
    v
      .split(/[,，]/)
      .map((s) => s.trim())
      .filter(Boolean);

  return {
    rangeMode: refs.selRange.value as RangeMode,
    rangeStart: Math.max(1, Number(refs.inRangeStart.value) || 1),
    rangeEnd: Number(refs.inRangeEnd.value) || Infinity,
    onlyOp: refs.cbOnlyOp.value,
    imgFilter: refs.selImgFilter.value as ImageFilter,
    users: split(refs.inUsers.value),
    includeKeywords: split(refs.inIncKw.value),
    excludeKeywords: split(refs.inExcKw.value),
    minLength: Math.max(0, Number(refs.inMinLen.value) || 0),
  };
}

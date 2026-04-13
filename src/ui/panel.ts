import type { Config, RangeMode, ImageMode, ImageFilter } from '../types';
import { getConfig, saveConfig } from '../config/storage';

export interface PanelCallbacks {
  onExportObsidian: () => Promise<void>;
  onDownloadZip: () => Promise<void>;
  onDownloadMd: () => Promise<void>;
}

// ==================== DOM refs ====================

let panelEl: HTMLElement | null = null;
let progressContainer: HTMLElement | null = null;
let progressFill: HTMLElement | null = null;
let progressText: HTMLElement | null = null;
let callbacks: PanelCallbacks | null = null;

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

function collapsible(title: string, children: HTMLElement[]): HTMLElement {
  const section = h('div', { className: 'dxp-section' });
  const header = h('div', { className: 'dxp-section-header' }, [
    h('span', undefined, [title]),
    h('span', { className: 'dxp-arrow' }, ['▶']),
  ]);
  const body = h('div', { className: 'dxp-section-body' });
  for (const c of children) body.append(c);
  header.addEventListener('click', () => {
    section.classList.toggle('dxp-open');
    // Auto-clamp panel within viewport after section expand/collapse
    requestAnimationFrame(clampToViewport);
  });
  section.append(header, body);
  return section;
}

// ==================== Viewport clamping ====================

function clampToViewport(): void {
  if (!panelEl) return;
  const rect = panelEl.getBoundingClientRect();
  const vw = window.innerWidth;
  const vh = window.innerHeight;

  let needsAdjust = false;
  let newTop = panelEl.offsetTop;
  let newLeft = panelEl.offsetLeft;

  // If panel extends beyond bottom, shift up
  if (rect.bottom > vh) {
    newTop = Math.max(0, vh - rect.height);
    needsAdjust = true;
  }
  // If panel extends beyond right, shift left
  if (rect.right > vw) {
    newLeft = Math.max(0, vw - rect.width);
    needsAdjust = true;
  }
  // Ensure top-left is within viewport
  if (rect.top < 0) {
    newTop = 0;
    needsAdjust = true;
  }
  if (rect.left < 0) {
    newLeft = 0;
    needsAdjust = true;
  }

  if (needsAdjust) {
    panelEl.style.top = newTop + 'px';
    panelEl.style.left = newLeft + 'px';
    panelEl.style.right = 'auto';
    panelEl.style.bottom = 'auto';
  }
}

// ==================== Dragging ====================

let dragging = false;
let dragOffsetX = 0;
let dragOffsetY = 0;

function onMouseDown(e: MouseEvent): void {
  if (!panelEl || !panelEl.classList.contains('dxp-draggable')) return;
  dragging = true;
  dragOffsetX = e.clientX - panelEl.offsetLeft;
  dragOffsetY = e.clientY - panelEl.offsetTop;
  panelEl.style.cursor = 'grabbing';
  e.preventDefault();
}

function onMouseMove(e: MouseEvent): void {
  if (!dragging || !panelEl) return;
  const x = Math.max(
    0,
    Math.min(e.clientX - dragOffsetX, window.innerWidth - panelEl.offsetWidth),
  );
  const y = Math.max(
    0,
    Math.min(
      e.clientY - dragOffsetY,
      window.innerHeight - panelEl.offsetHeight,
    ),
  );
  panelEl.style.left = x + 'px';
  panelEl.style.top = y + 'px';
  panelEl.style.right = 'auto';
  panelEl.style.bottom = 'auto';
}

function onMouseUp(): void {
  if (!dragging || !panelEl) return;
  dragging = false;
  panelEl.style.cursor = '';
  persistPosition();
}

function persistPosition(): void {
  if (!panelEl) return;
  const cfg = getConfig();
  cfg.panelPos = { top: panelEl.offsetTop, left: panelEl.offsetLeft };
  saveConfig(cfg);
}

function applyPosition(cfg: Config): void {
  if (!panelEl) return;
  if (cfg.panelPos) {
    panelEl.style.top = cfg.panelPos.top + 'px';
    panelEl.style.left = cfg.panelPos.left + 'px';
    panelEl.style.right = 'auto';
    panelEl.style.bottom = 'auto';
  } else {
    panelEl.style.right = '20px';
    panelEl.style.bottom = '20px';
    panelEl.style.top = 'auto';
    panelEl.style.left = 'auto';
  }
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
  const dragToggle = h(
    'button',
    { className: 'dxp-drag-toggle', title: '拖拽解锁' },
    ['🔒'],
  );
  let locked = true;

  dragToggle.addEventListener('click', () => {
    locked = !locked;
    dragToggle.textContent = locked ? '🔒' : '🔓';
    panel.classList.toggle('dxp-draggable', !locked);
    if (locked) persistPosition();
  });

  const closeBtn = h('button', { className: 'dxp-close-btn', title: '关闭' }, [
    '×',
  ]);
  closeBtn.addEventListener('click', () => hidePanel());

  const headerBtns = h('div', { className: 'dxp-header-btns' }, [
    dragToggle,
    closeBtn,
  ]);

  const header = h('div', { className: 'dxp-panel-header' }, [
    h('span', undefined, ['Discourse Xporter']),
    headerBtns,
  ]);
  header.addEventListener('mousedown', onMouseDown);

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
  ]);
  btnObsidian.addEventListener('click', () => {
    if (callbacks?.onExportObsidian) void callbacks.onExportObsidian();
  });

  const btnZip = h('button', { className: 'dxp-btn dxp-btn-secondary' }, [
    '📦 下载 ZIP',
  ]);
  btnZip.addEventListener('click', () => {
    if (callbacks?.onDownloadZip) void callbacks.onDownloadZip();
  });

  const btnMd = h('button', { className: 'dxp-btn dxp-btn-secondary' }, [
    '📝 下载 Markdown',
  ]);
  btnMd.addEventListener('click', () => {
    if (callbacks?.onDownloadMd) void callbacks.onDownloadMd();
  });

  const btnGroup = h('div', { className: 'dxp-btn-group' }, [btnZip, btnMd]);

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
  btnTest.addEventListener('click', async () => {
    btnTest.textContent = '⏳ 连接中…';
    try {
      const res = await fetch(inApiUrl.value.trim() + '/', {
        headers: inApiKey.value
          ? { Authorization: 'Bearer ' + inApiKey.value }
          : {},
      });
      btnTest.textContent = res.ok ? '✅ 连接成功' : `❌ ${res.status}`;
    } catch {
      btnTest.textContent = '❌ 连接失败';
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
  const imgDirField = field(
    '图片目录',
    (() => {
      const inp = h('input', {
        type: 'text',
        value: cfg.imgDir,
      }) as HTMLInputElement;
      inp.addEventListener('change', () =>
        patchConfig((c) => {
          c.imgDir = inp.value.trim();
        }),
      );
      return inp;
    })(),
  );
  imgDirField.style.display = cfg.imgMode === 'file' ? '' : 'none';
  selImgMode.addEventListener('change', () => {
    patchConfig((c) => {
      c.imgMode = selImgMode.value as ImageMode;
    });
    imgDirField.style.display = selImgMode.value === 'file' ? '' : 'none';
  });

  const obsSection = collapsible('Obsidian 连接设置', [
    field('API 地址', inApiUrl),
    field('API Key', inApiKey),
    btnTest,
    field('导出目录', inExportDir),
    field('图片模式', selImgMode),
    imgDirField,
  ]);

  // ---- Filter settings ----
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

  const cbOnlyOp = { value: cfg.defaultOnlyOp };
  const onlyOpRow = checkboxRow('只看楼主', cbOnlyOp.value, (v) => {
    cbOnlyOp.value = v;
    patchConfig((c) => {
      c.defaultOnlyOp = v;
    });
  });

  const selImgFilter = h('select', undefined, [
    h('option', { value: 'none' }, ['不筛选']),
    h('option', { value: 'withImg' }, ['仅含图片']),
    h('option', { value: 'noImg' }, ['无图片']),
  ]) as HTMLSelectElement;
  selImgFilter.value = cfg.defaultImgFilter;
  selImgFilter.addEventListener('change', () => {
    patchConfig((c) => {
      c.defaultImgFilter = selImgFilter.value as ImageFilter;
    });
  });

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

// ==================== Public API ====================

export function initPanel(cb: PanelCallbacks): void {
  if (panelEl) return;
  callbacks = cb;
  const cfg = getConfig();
  panelEl = buildPanel(cfg);
  document.body.append(panelEl);
  applyPosition(cfg);

  document.addEventListener('mousemove', onMouseMove);
  document.addEventListener('mouseup', onMouseUp);
  window.addEventListener('resize', clampToViewport);
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
    progressFill.style.width = Math.min(100, Math.max(0, progress)) + '%';
  }
}

export function resetProgress(): void {
  if (!progressContainer || !progressFill || !progressText) return;
  progressContainer.style.display = 'none';
  progressFill.style.width = '0%';
  progressText.textContent = '';
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

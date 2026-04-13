declare function GM_addStyle(css: string): void;

export function injectStyles(): void {
  const css = `
/* ==================== Discourse Xporter Styles ==================== */

/* Toast */
.dxp-toast {
  font-family: system-ui, -apple-system, sans-serif;
}

/* Panel */
.dxp-panel {
  position: fixed;
  z-index: 99990;
  width: 320px;
  max-height: 80vh;
  overflow-y: auto;
  background: var(--secondary, rgba(255, 255, 255, 0.95));
  backdrop-filter: blur(12px);
  border: 1px solid var(--primary-low, rgba(0, 0, 0, 0.1));
  border-radius: 12px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.15);
  font-family: system-ui, -apple-system, sans-serif;
  font-size: 13px;
  color: var(--primary, #222);
  transition: box-shadow 0.2s;
}

.dxp-panel.dxp-draggable {
  border-color: var(--tertiary, #0088cc);
  box-shadow: 0 8px 32px rgba(0, 136, 204, 0.25);
}

.dxp-panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 14px;
  border-bottom: 1px solid var(--primary-low, rgba(0, 0, 0, 0.08));
  font-weight: 600;
  font-size: 14px;
  user-select: none;
}

.dxp-panel-header .dxp-drag-toggle {
  background: none;
  border: none;
  cursor: pointer;
  font-size: 16px;
  padding: 2px 6px;
  border-radius: 4px;
  color: var(--primary-medium, #888);
}

.dxp-panel-header .dxp-drag-toggle:hover {
  background: var(--primary-low, rgba(0, 0, 0, 0.06));
}

.dxp-panel-body {
  padding: 12px 14px;
}

/* Buttons */
.dxp-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 8px 16px;
  border: none;
  border-radius: 6px;
  cursor: pointer;
  font-size: 13px;
  font-weight: 500;
  transition: background 0.15s, opacity 0.15s;
}

.dxp-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.dxp-btn-primary {
  background: var(--tertiary, #0088cc);
  color: var(--secondary, #fff);
  width: 100%;
}

.dxp-btn-primary:hover:not(:disabled) {
  background: var(--tertiary-hover, #0077b3);
}

.dxp-btn-secondary {
  background: var(--primary-low, rgba(0, 0, 0, 0.06));
  color: var(--primary, #222);
}

.dxp-btn-secondary:hover:not(:disabled) {
  background: var(--primary-low-mid, rgba(0, 0, 0, 0.1));
}

/* Button group */
.dxp-btn-group {
  display: flex;
  gap: 8px;
  margin-top: 8px;
}

.dxp-btn-group .dxp-btn {
  flex: 1;
}

/* Progress */
.dxp-progress-container {
  margin-bottom: 10px;
}

.dxp-progress-bar {
  height: 4px;
  border-radius: 2px;
  background: var(--primary-low, rgba(0, 0, 0, 0.08));
  overflow: hidden;
  margin-bottom: 4px;
}

.dxp-progress-fill {
  height: 100%;
  background: var(--tertiary, #0088cc);
  transition: width 0.3s;
  width: 0%;
}

.dxp-progress-text {
  font-size: 12px;
  color: var(--primary-medium, #888);
}

/* Collapsible section */
.dxp-section {
  margin-top: 10px;
  border: 1px solid var(--primary-low, rgba(0, 0, 0, 0.08));
  border-radius: 6px;
}

.dxp-section-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 10px;
  cursor: pointer;
  font-weight: 500;
  font-size: 12px;
  user-select: none;
  color: var(--primary-high, #333);
}

.dxp-section-header:hover {
  background: var(--primary-low, rgba(0, 0, 0, 0.03));
}

.dxp-section-body {
  padding: 8px 10px;
  border-top: 1px solid var(--primary-low, rgba(0, 0, 0, 0.08));
  display: none;
}

.dxp-section.dxp-open .dxp-section-body {
  display: block;
}

.dxp-section-header .dxp-arrow {
  transition: transform 0.2s;
}

.dxp-section.dxp-open .dxp-section-header .dxp-arrow {
  transform: rotate(90deg);
}

/* Form elements */
.dxp-field {
  margin-bottom: 8px;
}

.dxp-field label {
  display: block;
  font-size: 12px;
  font-weight: 500;
  color: var(--primary-high, #333);
  margin-bottom: 3px;
}

.dxp-field input[type="text"],
.dxp-field input[type="number"],
.dxp-field input[type="password"],
.dxp-field select,
.dxp-field textarea {
  width: 100%;
  padding: 6px 8px;
  border: 1px solid var(--primary-low-mid, rgba(0, 0, 0, 0.15));
  border-radius: 4px;
  font-size: 12px;
  background: var(--secondary, #fff);
  color: var(--primary, #222);
  box-sizing: border-box;
}

.dxp-field input:focus,
.dxp-field select:focus,
.dxp-field textarea:focus {
  outline: none;
  border-color: var(--tertiary, #0088cc);
  box-shadow: 0 0 0 2px rgba(0, 136, 204, 0.2);
}

.dxp-checkbox-row {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  cursor: pointer;
  margin-bottom: 6px;
}

.dxp-checkbox-row input[type="checkbox"] {
  cursor: pointer;
}

/* Floor buttons */
.dxp-floor-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  border: none;
  cursor: pointer;
  padding: 4px;
  border-radius: 4px;
  color: var(--primary-medium, #888);
  transition: color 0.15s, background 0.15s;
}

.dxp-floor-btn:hover {
  color: var(--tertiary, #0088cc);
  background: var(--primary-low, rgba(0, 0, 0, 0.05));
}

.dxp-floor-btn svg {
  width: 16px;
  height: 16px;
  fill: currentColor;
  pointer-events: none;
}

/* Selected floor highlight */
.dxp-selected {
  background: rgba(0, 136, 204, 0.06) !important;
  border-left: 3px solid var(--tertiary, #0088cc) !important;
}

.dxp-floor-btn.dxp-active {
  color: var(--tertiary, #0088cc);
}

/* Global toggle button */
.dxp-global-toggle {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  border: 1px solid var(--primary-low-mid, rgba(0, 0, 0, 0.15));
  border-radius: 6px;
  cursor: pointer;
  padding: 4px 8px;
  font-size: 16px;
  line-height: 1;
  margin-left: 8px;
  vertical-align: middle;
  color: var(--primary-medium, #888);
  transition: background 0.15s, border-color 0.15s;
}

.dxp-global-toggle:hover {
  background: var(--primary-low, rgba(0, 0, 0, 0.05));
  border-color: var(--tertiary, #0088cc);
  color: var(--tertiary, #0088cc);
}

/* Panel header buttons */
.dxp-header-btns {
  display: flex;
  align-items: center;
  gap: 4px;
}

.dxp-close-btn {
  background: none;
  border: none;
  cursor: pointer;
  font-size: 20px;
  line-height: 1;
  padding: 2px 6px;
  border-radius: 4px;
  color: var(--primary-medium, #888);
}

.dxp-close-btn:hover {
  background: var(--danger-low, rgba(200, 0, 0, 0.1));
  color: var(--danger, #d9534f);
}
`;

  GM_addStyle(css);
}

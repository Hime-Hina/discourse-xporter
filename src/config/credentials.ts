import { getConfig, saveConfig } from './storage';

declare function GM_registerMenuCommand(
  caption: string,
  callback: () => void,
): void;

/** Production @sandbox DOM keeps this browser dialog and its return value out of page JavaScript. */
export function registerCredentialMenu(onChange: () => void): void {
  if (import.meta.env.DEV) return;
  const requestKey = window.prompt.bind(window);
  GM_registerMenuCommand('🔑 设置或更换 Obsidian API Key', () => {
    // Never use a stored key as the default; even the trusted dialog only receives a new value.
    const entered = requestKey(
      '输入 Obsidian Local REST API Key（仅在本浏览器对话框中输入）',
      '',
    );
    if (entered === null || !entered.trim()) return;
    saveConfig({ ...getConfig(), obsApiKey: entered.trim() });
    onChange();
  });
  GM_registerMenuCommand('🗑️ 清除 Obsidian API Key', () => {
    saveConfig({ ...getConfig(), obsApiKey: '' });
    onChange();
  });
}

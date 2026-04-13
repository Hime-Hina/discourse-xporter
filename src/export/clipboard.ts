declare function GM_setClipboard(text: string, type?: string): void;

/**
 * Copy text to clipboard using GM_setClipboard (oil monkey API).
 */
export function copyToClipboard(text: string): void {
  GM_setClipboard(text, 'text');
}

import type { Config } from '../types';
import { DEFAULTS } from './defaults';

declare function GM_getValue<T>(key: string, defaultValue: T): T;
declare function GM_setValue(key: string, value: unknown): void;

function storageKey(): string {
  // Vite's GM bridge is shared with the page; never load production secrets there.
  return import.meta.env.DEV ? 'dxp_dev_config' : 'dxp_config';
}

function validConfigValue(key: keyof Config, value: unknown): boolean {
  switch (key) {
    case 'imgMode':
      return value === 'file' || value === 'embed' || value === 'none';
    case 'imgDirMode':
      return value === 'relative' || value === 'absolute';
    case 'panelCorner':
      return (
        typeof value === 'string' &&
        ['top-left', 'top-right', 'bottom-left', 'bottom-right'].includes(value)
      );
    case 'batchSize':
      return (
        typeof value === 'number' &&
        Number.isInteger(value) &&
        value >= 1 &&
        value <= 100
      );
    case 'imageConcurrency':
      return (
        typeof value === 'number' &&
        Number.isInteger(value) &&
        value >= 1 &&
        value <= 16
      );
    case 'batchDelayMin':
    case 'batchDelayMax':
    case 'imageDelayMin':
    case 'imageDelayMax':
      return (
        typeof value === 'number' &&
        Number.isFinite(value) &&
        value >= 0 &&
        value <= 60_000
      );
    default:
      return typeof value === typeof DEFAULTS[key];
  }
}

function normalizeConfig(stored: unknown): Config {
  const config = { ...DEFAULTS };
  if (typeof stored === 'object' && stored !== null && !Array.isArray(stored)) {
    for (const key of Object.keys(DEFAULTS) as (keyof Config)[]) {
      const value = Object.prototype.hasOwnProperty.call(stored, key)
        ? (stored as Record<string, unknown>)[key]
        : undefined;
      if (validConfigValue(key, value)) {
        (config as Record<keyof Config, unknown>)[key] = value;
      }
    }
  }
  config.batchDelayMax = Math.max(config.batchDelayMin, config.batchDelayMax);
  config.imageDelayMax = Math.max(config.imageDelayMin, config.imageDelayMax);
  if (import.meta.env.DEV) config.obsApiKey = '';
  return config;
}

/** Validate stored values once before internal callers receive a Config. */
export function getConfig(): Config {
  return normalizeConfig(GM_getValue<unknown>(storageKey(), {}));
}

/** Save only validated fields that differ from defaults. */
export function saveConfig(config: Config): void {
  const normalized = normalizeConfig(config);
  const diff: Partial<Config> = {};
  for (const key of Object.keys(DEFAULTS) as (keyof Config)[]) {
    if (normalized[key] !== DEFAULTS[key]) {
      (diff as Record<keyof Config, unknown>)[key] = normalized[key];
    }
  }
  GM_setValue(storageKey(), diff);
}

export function resetConfig(): void {
  GM_setValue(storageKey(), {});
}

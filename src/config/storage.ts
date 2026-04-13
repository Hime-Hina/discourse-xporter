import type { Config } from '../types';
import { DEFAULTS } from './defaults';

const STORAGE_KEY = 'dxp_config';

declare function GM_getValue<T>(key: string, defaultValue: T): T;
declare function GM_setValue(key: string, value: unknown): void;

/** Read config, merging stored values over defaults */
export function getConfig(): Config {
  const stored = GM_getValue<Partial<Config>>(STORAGE_KEY, {});
  return { ...DEFAULTS, ...stored };
}

/** Save only fields that differ from defaults */
export function saveConfig(config: Config): void {
  const diff: Partial<Config> = {};
  for (const key of Object.keys(config) as (keyof Config)[]) {
    if (JSON.stringify(config[key]) !== JSON.stringify(DEFAULTS[key])) {
      (diff as Record<string, unknown>)[key] = config[key];
    }
  }
  GM_setValue(STORAGE_KEY, diff);
}

/** Reset config to defaults */
export function resetConfig(): void {
  GM_setValue(STORAGE_KEY, {});
}

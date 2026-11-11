import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULTS } from '../src/config/defaults';
import { getConfig, resetConfig, saveConfig } from '../src/config/storage';

const read = vi.fn();
const write = vi.fn();

beforeEach(() => {
  vi.stubEnv('DEV', false);
  vi.stubGlobal('GM_getValue', read);
  vi.stubGlobal('GM_setValue', write);
  read.mockReset().mockReturnValue({});
  write.mockReset();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('stored config boundary', () => {
  it.each([null, [], 'invalid', 42])(
    'uses defaults for a non-object record: %j',
    (stored) => {
      read.mockReturnValue(stored);
      expect(getConfig()).toEqual(DEFAULTS);
    },
  );

  it('preserves valid legacy fields and ignores unknown fields', () => {
    read.mockReturnValue({
      imgMode: 'embed',
      imgDirMode: 'absolute',
      panelCorner: 'top-left',
      obsApiKey: 'SYNTHETIC_KEY',
      batchSize: 25,
      imageConcurrency: 4,
      batchDelayMin: 0,
      batchDelayMax: 0,
      debugMode: true,
      exportDir: 'Forum Notes',
      unused: 'ignore',
    });
    expect(getConfig()).toEqual({
      ...DEFAULTS,
      imgMode: 'embed',
      imgDirMode: 'absolute',
      panelCorner: 'top-left',
      obsApiKey: 'SYNTHETIC_KEY',
      batchSize: 25,
      imageConcurrency: 4,
      batchDelayMin: 0,
      batchDelayMax: 0,
      debugMode: true,
      exportDir: 'Forum Notes',
    });
    expect(read).toHaveBeenCalledWith('dxp_config', {});
  });

  it('rejects invalid numbers, enums and primitive types without coercion', () => {
    read.mockReturnValue({
      imgMode: 'invalid',
      imgDirMode: 'anywhere',
      panelCorner: { toString: () => 'top-left' },
      batchSize: NaN,
      imageConcurrency: Infinity,
      batchDelayMin: -1,
      batchDelayMax: 60_001,
      imageDelayMin: '300',
      imageDelayMax: null,
      obsApiKey: {},
      obsOpenAfterExport: 'false',
      floorTemplate: 42,
    });
    expect(getConfig()).toEqual(DEFAULTS);
  });

  it.each([0, -1, 0.5, 101, Infinity, '20'])(
    'bounds batch size: %j',
    (batchSize) => {
      read.mockReturnValue({ batchSize });
      expect(getConfig().batchSize).toBe(DEFAULTS.batchSize);
    },
  );

  it.each([0, -1, 0.5, 17, NaN, '3'])(
    'bounds concurrency: %j',
    (imageConcurrency) => {
      read.mockReturnValue({ imageConcurrency });
      expect(getConfig().imageConcurrency).toBe(DEFAULTS.imageConcurrency);
    },
  );

  it('normalizes delay pairs so maximum cannot be below minimum', () => {
    read.mockReturnValue({
      batchDelayMin: 3000,
      batchDelayMax: 1,
      imageDelayMin: 2000,
      imageDelayMax: 0,
    });
    expect(getConfig()).toMatchObject({
      batchDelayMin: 3000,
      batchDelayMax: 3000,
      imageDelayMin: 2000,
      imageDelayMax: 2000,
    });
  });

  it('validates writes and stores only differences', () => {
    saveConfig({
      ...DEFAULTS,
      batchSize: NaN,
      imageConcurrency: 0,
      imgMode: 'embed',
    });
    expect(write).toHaveBeenCalledWith('dxp_config', { imgMode: 'embed' });
    resetConfig();
    expect(write).toHaveBeenLastCalledWith('dxp_config', {});
  });

  it('uses independent development storage and never returns or saves its key', () => {
    vi.stubEnv('DEV', true);
    read.mockReturnValue({
      obsApiKey: 'SYNTHETIC_DEV_SECRET',
      imgMode: 'embed',
    });
    expect(getConfig()).toMatchObject({ obsApiKey: '', imgMode: 'embed' });
    expect(read).toHaveBeenCalledWith('dxp_dev_config', {});
    saveConfig({
      ...DEFAULTS,
      obsApiKey: 'SYNTHETIC_NEW_SECRET',
      imgMode: 'none',
    });
    expect(write).toHaveBeenCalledWith('dxp_dev_config', { imgMode: 'none' });
  });
});

// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import {
  buildExportProfile,
  restoreExportProfile,
} from '../src/core/export-profile';
import { DEFAULTS } from '../src/config/defaults';
import {
  getPanelFilterConfig,
  readPanelFilterConfig,
  writePanelFilterConfig,
  type FilterSectionRefs,
} from '../src/ui/panel';

function input(value: string): HTMLInputElement {
  const element = document.createElement('input');
  element.value = value;
  return element;
}

function select(value: string): HTMLSelectElement {
  const element = document.createElement('select');
  for (const item of ['all', 'range', 'selected', 'none', 'withImg', 'noImg']) {
    const option = document.createElement('option');
    option.value = item;
    element.append(option);
  }
  element.value = value;
  return element;
}

function filterRefs(
  overrides: Partial<FilterSectionRefs> = {},
): FilterSectionRefs {
  return {
    rangeSelect: select('all'),
    rangeStartInput: input('1'),
    rangeEndInput: input('100'),
    onlyOpInput: document.createElement('input'),
    imageFilterSelect: select('none'),
    usersInput: input(''),
    includeKeywordsInput: input(''),
    excludeKeywordsInput: input(''),
    minLengthInput: input('0'),
    ...overrides,
  };
}

describe('panel filter config', () => {
  it('requires initialized filter controls before starting an export', () => {
    expect(() => getPanelFilterConfig()).toThrow('尚未初始化');
  });

  it('normalizes typed filter refs into the export filter contract', () => {
    expect(
      readPanelFilterConfig(
        filterRefs({
          rangeSelect: select('range'),
          rangeStartInput: input('0'),
          rangeEndInput: input(''),
          onlyOpInput: Object.assign(document.createElement('input'), {
            checked: true,
          }),
          imageFilterSelect: select('withImg'),
          usersInput: input(' alice, bob，张三 '),
          includeKeywordsInput: input(' solution， answer '),
          excludeKeywordsInput: input(' draft,, hidden '),
          minLengthInput: input('-5'),
        }),
      ),
    ).toEqual({
      rangeMode: 'range',
      rangeStart: 1,
      rangeEnd: Infinity,
      onlyOp: true,
      imgFilter: 'withImg',
      users: ['alice', 'bob', '张三'],
      includeKeywords: ['solution', 'answer'],
      excludeKeywords: ['draft', 'hidden'],
      minLength: 0,
    });
  });
});

it('loads two saved strategies into the same form without losing open-ended ranges', () => {
  const refs = filterRefs();
  const first = {
    rangeMode: 'range' as const,
    rangeStart: 2,
    rangeEnd: Infinity,
    onlyOp: true,
    imgFilter: 'withImg' as const,
    users: ['Alice', 'Bob'],
    includeKeywords: ['answer'],
    excludeKeywords: ['draft'],
    minLength: 30,
  };
  const second = {
    ...first,
    rangeMode: 'all' as const,
    rangeStart: 1,
    rangeEnd: 20,
    onlyOp: false,
    imgFilter: 'noImg' as const,
    users: [],
    includeKeywords: [],
    minLength: 0,
  };
  for (const filters of [first, second]) {
    const profile = buildExportProfile(DEFAULTS, filters);
    const restored = restoreExportProfile(JSON.parse(JSON.stringify(profile)));
    writePanelFilterConfig(refs, restored.filters);
    expect(readPanelFilterConfig(refs)).toEqual(filters);
    expect(refs.onlyOpInput.checked).toBe(filters.onlyOp);
  }
});

// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import {
  getPanelFilterConfig,
  readPanelFilterConfig,
  type FilterSectionRefs,
} from '../src/ui/panel';

function input(value: string): HTMLInputElement {
  const element = document.createElement('input');
  element.value = value;
  return element;
}

function select(value: string): HTMLSelectElement {
  const element = document.createElement('select');
  const option = document.createElement('option');
  option.value = value;
  element.append(option);
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
    onlyOpState: { value: false },
    imageFilterSelect: select('none'),
    usersInput: input(''),
    includeKeywordsInput: input(''),
    excludeKeywordsInput: input(''),
    minLengthInput: input('0'),
    ...overrides,
  };
}

describe('panel filter config', () => {
  it('returns the default filter config before panel initialization', () => {
    expect(getPanelFilterConfig()).toEqual({
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
  });

  it('normalizes typed filter refs into the export filter contract', () => {
    expect(
      readPanelFilterConfig(
        filterRefs({
          rangeSelect: select('range'),
          rangeStartInput: input('0'),
          rangeEndInput: input(''),
          onlyOpState: { value: true },
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

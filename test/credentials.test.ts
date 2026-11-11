// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TopicLifecycleCallbacks } from '../src/runtime/topic-lifecycle';
import { installMemoryVault } from './vault-fixture';

vi.mock('../src/runtime/topic-lifecycle', async (original) => ({
  ...(await original<typeof import('../src/runtime/topic-lifecycle')>()),
  startTopicLifecycle: (callbacks: TopicLifecycleCallbacks) =>
    callbacks.activateTopic({ topicId: 42, isNested: false }),
}));
vi.mock('../src/ui/floor-buttons', () => ({
  initFloorButtons: () => () => undefined,
  setOnCopyPost: vi.fn(),
  clearSelectedPosts: vi.fn(),
  getSelectedPosts: () => new Set(),
  getSelectedPostIds: () => new Map(),
}));

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  document.body.innerHTML = '';
  document.head.innerHTML = '';
});
beforeEach(() => {
  vi.resetModules();
  vi.stubEnv('DEV', false);
  document.body.innerHTML = '<div id="topic-title"><h1>Fake topic</h1></div>';
  document.head.innerHTML = '<meta name="generator" content="Discourse">';
  window.history.replaceState({}, '', '/t/fake/42');
});

describe('credential isolation regressions with synthetic GM storage', () => {
  it('never mirrors a stored or newly entered key into host DOM and refuses synthetic privileged clicks', async () => {
    let stored: Record<string, unknown> = { obsApiKey: 'SYNTHETIC_OLD_KEY' };
    vi.stubGlobal('GM_getValue', () => stored);
    vi.stubGlobal(
      'GM_setValue',
      (_key: string, value: Record<string, unknown>) => {
        stored = value;
      },
    );
    vi.stubGlobal('GM_addStyle', vi.fn());
    const menus = new Map<string, () => void>();
    vi.stubGlobal(
      'GM_registerMenuCommand',
      (caption: string, callback: () => void) => {
        menus.set(caption, callback);
      },
    );
    const prompt = vi
      .spyOn(window, 'prompt')
      .mockReturnValue('SYNTHETIC_NEW_KEY');
    const vault = installMemoryVault();
    await import('../src/main');
    const { showPanel, hidePanel, togglePanel } =
      await import('../src/ui/panel');
    const assertNoKey = (): void => {
      expect(document.documentElement.outerHTML).not.toContain('SYNTHETIC_');
      for (const field of document.querySelectorAll<
        HTMLInputElement | HTMLTextAreaElement
      >('input,textarea'))
        expect(field.value).not.toContain('SYNTHETIC_');
      expect(document.querySelector('input[type="password"]')).toBeNull();
    };
    assertNoKey();
    showPanel();
    assertNoKey();
    hidePanel();
    togglePanel();
    assertNoKey();
    for (const button of document.querySelectorAll<HTMLButtonElement>('button'))
      button.click();
    expect(
      vault.requests.filter((request) => request.method === 'PUT'),
    ).toHaveLength(0);
    const configure = [...menus].find(([caption]) =>
      caption.includes('设置或更换'),
    )?.[1];
    expect(configure).toBeDefined();
    configure?.();
    expect(prompt).toHaveBeenCalledWith(expect.any(String), '');
    expect(stored.obsApiKey).toBe('SYNTHETIC_NEW_KEY');
    expect(document.querySelector('.dxp-credential-status')?.textContent).toBe(
      '已配置',
    );
    assertNoKey();
    [...menus].find(([caption]) => caption.includes('清除'))?.[1]();
    expect(stored.obsApiKey).toBeUndefined();
    expect(document.querySelector('.dxp-credential-status')?.textContent).toBe(
      '未配置',
    );
    assertNoKey();
  });

  it('does not open a secret-entry prompt from the development build', async () => {
    vi.stubEnv('DEV', true);
    const menu = vi.fn();
    vi.stubGlobal('GM_registerMenuCommand', menu);
    const prompt = vi.spyOn(window, 'prompt');
    const { registerCredentialMenu } =
      await import('../src/config/credentials');
    registerCredentialMenu(vi.fn());
    expect(menu).not.toHaveBeenCalled();
    expect(prompt).not.toHaveBeenCalled();
  });
});

// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  detectTopicIdentity,
  injectTopicPanelToggle,
  startTopicLifecycle,
  type TopicIdentity,
} from '../src/runtime/topic-lifecycle';

function setPath(pathname: string): void {
  window.history.pushState({}, '', pathname);
}

function addFlatTopicTitle(): void {
  document.body.innerHTML = '<div id="topic-title"><div class="title-wrapper"></div></div>';
}

async function waitForMutationObserver(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

beforeEach(() => {
  document.body.innerHTML = '';
  setPath('/latest');
});

describe('detectTopicIdentity', () => {
  it('returns null outside supported topic routes', () => {
    expect(detectTopicIdentity('/latest')).toBeNull();
    expect(detectTopicIdentity('/u/alice')).toBeNull();
  });

  it('detects flat topic routes', () => {
    expect(detectTopicIdentity('/t/refactor-plan/12345')).toEqual({
      topicId: 12345,
      isNested: false,
    });
    expect(detectTopicIdentity('/t/refactor-plan/12345/6')).toEqual({
      topicId: 12345,
      isNested: false,
    });
  });

  it('detects nested topic routes', () => {
    expect(detectTopicIdentity('/nested/refactor-plan/12345')).toEqual({
      topicId: 12345,
      isNested: true,
    });
  });
});

describe('injectTopicPanelToggle', () => {
  it('injects one toggle per title target and wires panel toggling', () => {
    addFlatTopicTitle();
    const togglePanel = vi.fn();

    injectTopicPanelToggle(togglePanel);
    injectTopicPanelToggle(togglePanel);

    const toggles = document.querySelectorAll('.dxp-global-toggle');
    expect(toggles).toHaveLength(1);

    toggles[0].dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(togglePanel).toHaveBeenCalledOnce();
  });
});

describe('startTopicLifecycle', () => {
  it('activates topic UI after SPA navigation from a non-topic route', async () => {
    const activatedTopics: TopicIdentity[] = [];
    const lifecycle = startTopicLifecycle({
      activateTopic: (topicIdentity) => activatedTopics.push(topicIdentity),
      resetTopicState: vi.fn(),
      checkOutdatedTopic: vi.fn(),
      togglePanel: vi.fn(),
    });

    expect(activatedTopics).toEqual([]);

    setPath('/t/runtime-lifecycle/9001');
    addFlatTopicTitle();
    await waitForMutationObserver();

    expect(activatedTopics).toEqual([{ topicId: 9001, isNested: false }]);
    expect(document.querySelectorAll('.dxp-global-toggle')).toHaveLength(1);

    lifecycle.stop();
  });

  it('resets topic state when the active topic changes', () => {
    setPath('/t/first-topic/100');
    const resetTopicState = vi.fn();
    const activatedTopicIds: number[] = [];
    const lifecycle = startTopicLifecycle({
      activateTopic: (topicIdentity) =>
        activatedTopicIds.push(topicIdentity.topicId),
      resetTopicState,
      checkOutdatedTopic: vi.fn(),
      togglePanel: vi.fn(),
    });

    lifecycle.refresh();
    setPath('/t/second-topic/200');
    lifecycle.refresh();
    lifecycle.refresh();

    expect(activatedTopicIds).toEqual([100, 200]);
    expect(resetTopicState).toHaveBeenCalledOnce();

    lifecycle.stop();
  });

  it('clears topic state when navigation leaves a topic route', () => {
    setPath('/t/first-topic/100');
    const resetTopicState = vi.fn();
    const lifecycle = startTopicLifecycle({
      activateTopic: vi.fn(),
      resetTopicState,
      checkOutdatedTopic: vi.fn(),
      togglePanel: vi.fn(),
    });

    setPath('/latest');
    lifecycle.refresh();
    lifecycle.refresh();

    expect(resetTopicState).toHaveBeenCalledOnce();

    lifecycle.stop();
  });

  it('checks outdated notes once per topic ID', () => {
    setPath('/t/first-topic/100');
    const checkedTopicIds: number[] = [];
    const lifecycle = startTopicLifecycle({
      activateTopic: vi.fn(),
      resetTopicState: vi.fn(),
      checkOutdatedTopic: (topicId) => checkedTopicIds.push(topicId),
      togglePanel: vi.fn(),
    });

    lifecycle.refresh();
    setPath('/t/second-topic/200');
    lifecycle.refresh();
    setPath('/t/first-topic/100');
    lifecycle.refresh();

    expect(checkedTopicIds).toEqual([100, 200]);

    lifecycle.stop();
  });
});

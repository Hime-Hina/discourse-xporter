export interface TopicIdentity {
  topicId: number;
  isNested: boolean;
}

export interface TopicLifecycleCallbacks {
  activateTopic: (topicIdentity: TopicIdentity) => void;
  resetTopicState: () => void;
  checkOutdatedTopic: (topicId: number) => void | Promise<void>;
  togglePanel: () => void;
}

export interface TopicLifecycle {
  refresh: () => void;
  stop: () => void;
}

export function detectTopicIdentity(
  pathname = window.location.pathname,
): TopicIdentity | null {
  const topicPath = pathname.match(/^\/(t|nested)\/[^/]+\/(\d+)(?:\/|$)/);
  if (!topicPath) return null;

  return {
    isNested: topicPath[1] === 'nested',
    topicId: Number(topicPath[2]),
  };
}

export function injectTopicPanelToggle(togglePanel: () => void): void {
  const toggleClass = 'dxp-global-toggle';
  const targets = [
    document.querySelector('#topic-title .title-wrapper'),
    document.querySelector('.extra-info-wrapper .topic-header-extra'),
    document.querySelector('.nested-view__header'),
  ];

  for (const target of targets) {
    if (!target || target.querySelector(`.${toggleClass}`)) continue;

    const toggleButton = document.createElement('button');
    toggleButton.className = toggleClass;
    toggleButton.title = 'Discourse Xporter';
    toggleButton.textContent = '📤';
    toggleButton.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      togglePanel();
    });
    target.appendChild(toggleButton);
  }
}

export function startTopicLifecycle(
  callbacks: TopicLifecycleCallbacks,
): TopicLifecycle {
  let activeTopicId: number | null = null;
  const checkedOutdatedTopicIds = new Set<number>();

  function checkOutdatedTopicOnce(topicId: number): void {
    if (checkedOutdatedTopicIds.has(topicId)) return;
    checkedOutdatedTopicIds.add(topicId);
    void Promise.resolve(callbacks.checkOutdatedTopic(topicId)).catch(
      () => undefined,
    );
  }

  function refresh(): void {
    const topicIdentity = detectTopicIdentity();

    if (!topicIdentity) {
      if (activeTopicId !== null) {
        activeTopicId = null;
        callbacks.resetTopicState();
      }
      return;
    }

    if (activeTopicId !== topicIdentity.topicId) {
      if (activeTopicId !== null) callbacks.resetTopicState();
      activeTopicId = topicIdentity.topicId;
      callbacks.activateTopic(topicIdentity);
    }

    injectTopicPanelToggle(callbacks.togglePanel);
    checkOutdatedTopicOnce(topicIdentity.topicId);
  }

  const observer = new MutationObserver(refresh);
  observer.observe(document.body, { childList: true, subtree: true });
  refresh();

  return {
    refresh,
    stop: () => observer.disconnect(),
  };
}

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

  const topicId = Number(topicPath[2]);
  if (!Number.isSafeInteger(topicId) || topicId <= 0) return null;

  return {
    isNested: topicPath[1] === 'nested',
    topicId,
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

  let stopped = false;
  let scheduled = false;
  function scheduleRefresh(): void {
    if (scheduled || stopped) return;
    scheduled = true;
    queueMicrotask(() => {
      scheduled = false;
      if (!stopped) refresh();
    });
  }
  const history = window.history;
  const originalPushState = history.pushState;
  const originalReplaceState = history.replaceState;
  const pushState: History['pushState'] = function (this: History, ...args) {
    originalPushState.apply(this, args);
    scheduleRefresh();
  };
  const replaceState: History['replaceState'] = function (
    this: History,
    ...args
  ) {
    originalReplaceState.apply(this, args);
    scheduleRefresh();
  };
  history.pushState = pushState;
  history.replaceState = replaceState;
  window.addEventListener('popstate', scheduleRefresh);
  window.addEventListener('hashchange', scheduleRefresh);
  // Prefer the browser route notification when available.
  const navigation = (window as Window & { navigation?: EventTarget })
    .navigation;
  navigation?.addEventListener('navigatesuccess', scheduleRefresh);

  const observer = new MutationObserver(scheduleRefresh);
  observer.observe(document.body, { childList: true, subtree: true });
  refresh();

  return {
    refresh,
    stop: () => {
      stopped = true;
      observer.disconnect();
      window.removeEventListener('popstate', scheduleRefresh);
      window.removeEventListener('hashchange', scheduleRefresh);
      navigation?.removeEventListener('navigatesuccess', scheduleRefresh);
      if (history.pushState === pushState)
        history.pushState = originalPushState;
      if (history.replaceState === replaceState)
        history.replaceState = originalReplaceState;
      if (activeTopicId !== null) callbacks.resetTopicState();
    },
  };
}

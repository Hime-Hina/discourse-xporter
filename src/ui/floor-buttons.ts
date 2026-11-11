import { showToast } from './toast';

// ==================== State ====================

const selectedPosts = new Set<number>();
const selectedPostIds = new Map<number, number>();

let onCopyPost: ((postNumber: number, postId: number) => Promise<void>) | null =
  null;

export function setOnCopyPost(
  fn: (postNumber: number, postId: number) => Promise<void>,
): void {
  onCopyPost = fn;
}

export function getSelectedPosts(): Set<number> {
  return new Set(selectedPosts);
}

export function getSelectedPostIds(): ReadonlyMap<number, number> {
  return new Map(selectedPostIds);
}

export function clearSelectedPosts(): void {
  selectedPosts.clear();
  selectedPostIds.clear();
  document
    .querySelectorAll('.dxp-selected')
    .forEach((el) => el.classList.remove('dxp-selected'));
  document
    .querySelectorAll('.dxp-select-btn.dxp-active')
    .forEach((el) => el.classList.remove('dxp-active'));
}

// ==================== SVG Icons ====================

const ICON_COPY = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width="16" height="16"><path d="M0 6.75C0 5.784.784 5 1.75 5h1.5a.75.75 0 0 1 0 1.5h-1.5a.25.25 0 0 0-.25.25v7.5c0 .138.112.25.25.25h7.5a.25.25 0 0 0 .25-.25v-1.5a.75.75 0 0 1 1.5 0v1.5A1.75 1.75 0 0 1 9.25 16h-7.5A1.75 1.75 0 0 1 0 14.25Z"/><path d="M5 1.75C5 .784 5.784 0 6.75 0h7.5C15.216 0 16 .784 16 1.75v7.5A1.75 1.75 0 0 1 14.25 11h-7.5A1.75 1.75 0 0 1 5 9.25Zm1.75-.25a.25.25 0 0 0-.25.25v7.5c0 .138.112.25.25.25h7.5a.25.25 0 0 0 .25-.25v-7.5a.25.25 0 0 0-.25-.25Z"/></svg>`;

const ICON_UNCHECKED = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width="16" height="16"><path d="M2.75 2a.75.75 0 0 0-.75.75v10.5c0 .414.336.75.75.75h10.5a.75.75 0 0 0 .75-.75V2.75a.75.75 0 0 0-.75-.75Zm-2.25.75A2.25 2.25 0 0 1 2.75.5h10.5a2.25 2.25 0 0 1 2.25 2.25v10.5a2.25 2.25 0 0 1-2.25 2.25H2.75A2.25 2.25 0 0 1 .5 13.25Z"/></svg>`;

const ICON_CHECKED = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width="16" height="16"><path d="M2.75 2a.75.75 0 0 0-.75.75v10.5c0 .414.336.75.75.75h10.5a.75.75 0 0 0 .75-.75V2.75a.75.75 0 0 0-.75-.75ZM2.75.5h10.5a2.25 2.25 0 0 1 2.25 2.25v10.5a2.25 2.25 0 0 1-2.25 2.25H2.75A2.25 2.25 0 0 1 .5 13.25V2.75A2.25 2.25 0 0 1 2.75.5Z"/><path d="M11.78 4.72a.75.75 0 0 1 0 1.06l-4.25 4.25a.75.75 0 0 1-1.06 0L4.22 7.78a.75.75 0 0 1 1.06-1.06L7 8.44l3.72-3.72a.75.75 0 0 1 1.06 0Z"/></svg>`;

// ==================== DOM Selectors ====================

interface ViewSelector {
  postContainer: string;
  actionsArea: string;
  actionsContainer?: string;
}

const VIEW_SELECTORS: ViewSelector[] = [
  // flat view: outer .topic-post div has data-post-number, inner article has data-post-id
  {
    postContainer: '.topic-post[data-post-number]',
    actionsArea: 'nav.post-controls .actions',
  },
  // flat view fallback: article directly
  {
    postContainer: '.post-stream article[data-post-id]',
    actionsArea: 'nav.post-controls .actions',
  },
  // nested OP
  {
    postContainer: '.nested-view__op article[data-post-id]',
    actionsContainer: '.nested-view__op',
    actionsArea: 'section.nested-view__op-menu .actions',
  },
  // nested reply
  {
    postContainer: '.nested-post__article[data-post-id]',
    actionsContainer: '.nested-post',
    actionsArea: 'section.nested-post__menu .actions',
  },
];

// ==================== Button Creation ====================

function createButton(
  className: string,
  title: string,
  iconHtml: string,
): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.className = `dxp-floor-btn ${className}`;
  btn.title = title;
  btn.innerHTML = iconHtml;
  return btn;
}

function findLikeButton(actionsArea: Element): Element | null {
  return (
    actionsArea.querySelector('.discourse-reactions-actions-button-shim') ??
    actionsArea.querySelector('.reaction-button') ??
    actionsArea.querySelector('.like') ??
    null
  );
}

function getPostMeta(
  postElement: Element,
): { postNumber: number; postId: number } | null {
  // data-post-id is on article element
  let postId = Number(postElement.getAttribute('data-post-id'));
  if (!postId) {
    const article = postElement.querySelector('article[data-post-id]');
    postId = Number(article?.getAttribute('data-post-id'));
  }

  // data-post-number can be on the .topic-post div (flat view), or extracted from id="post_N"
  let postNumber = Number(postElement.getAttribute('data-post-number'));
  if (!postNumber) {
    const parent = postElement.closest('.topic-post[data-post-number]');
    postNumber = Number(parent?.getAttribute('data-post-number'));
  }
  if (!postNumber) {
    // Try id="post_N" pattern
    const id = postElement.id || postElement.querySelector('article')?.id || '';
    const m = id.match(/^post_(\d+)/);
    if (m) postNumber = Number(m[1]);
  }

  if (
    !Number.isSafeInteger(postId) ||
    postId <= 0 ||
    !Number.isSafeInteger(postNumber) ||
    postNumber <= 0
  )
    return null;
  return { postNumber, postId };
}

// ==================== Injection ====================

export function injectButtonsToPost(postElement: Element): void {
  const meta = getPostMeta(postElement);
  if (!meta) return;

  const selector = VIEW_SELECTORS.find((candidate) =>
    postElement.matches(candidate.postContainer),
  );
  if (!selector) return;
  const actionsContainer = selector.actionsContainer
    ? postElement.closest(selector.actionsContainer)
    : postElement;
  const actionsArea = actionsContainer?.querySelector(selector.actionsArea);

  if (!actionsArea) return;

  // Robust dedup: check if buttons already exist in this actions area
  if (actionsArea.querySelector('.dxp-floor-btn')) return;

  const { postNumber, postId } = meta;

  // --- Copy button ---
  const copyBtn = createButton('dxp-copy-btn', '复制楼层 Markdown', ICON_COPY);
  copyBtn.addEventListener('click', async (e) => {
    if (!e.isTrusted) return;
    e.preventDefault();
    e.stopPropagation();
    if (!onCopyPost) {
      showToast('复制功能未初始化', 'error');
      return;
    }
    try {
      await onCopyPost(postNumber, postId);
    } catch (err) {
      showToast(`复制失败: ${(err as Error).message}`, 'error');
    }
  });

  // --- Select button ---
  const isSelected = selectedPosts.has(postNumber);
  const selectBtn = createButton(
    'dxp-select-btn',
    '选中/取消楼层',
    isSelected ? ICON_CHECKED : ICON_UNCHECKED,
  );
  if (isSelected) selectBtn.classList.add('dxp-active');

  selectBtn.addEventListener('click', (e) => {
    if (!e.isTrusted) return;
    e.preventDefault();
    e.stopPropagation();

    if (selectedPosts.has(postNumber)) {
      selectedPosts.delete(postNumber);
      selectedPostIds.delete(postNumber);
      selectBtn.innerHTML = ICON_UNCHECKED;
      selectBtn.classList.remove('dxp-active');
      postElement.classList.remove('dxp-selected');
    } else {
      selectedPosts.add(postNumber);
      selectedPostIds.set(postNumber, postId);
      selectBtn.innerHTML = ICON_CHECKED;
      selectBtn.classList.add('dxp-active');
      postElement.classList.add('dxp-selected');
    }
  });

  // --- Insert into DOM ---
  const likeBtn = findLikeButton(actionsArea);
  if (likeBtn) {
    actionsArea.insertBefore(selectBtn, likeBtn);
    actionsArea.insertBefore(copyBtn, likeBtn);
  } else {
    actionsArea.appendChild(copyBtn);
    actionsArea.appendChild(selectBtn);
  }
}

// ==================== Patrol ====================

function scanAndInject(root: ParentNode = document): void {
  for (const selector of VIEW_SELECTORS) {
    if (root instanceof Element) {
      const post = root.closest(selector.postContainer);
      if (post) injectButtonsToPost(post);
    }
    root.querySelectorAll(selector.postContainer).forEach(injectButtonsToPost);
  }
}

/** The topic lifecycle owns this observer and must stop it on departure. */
export function initFloorButtons(): () => void {
  scanAndInject();
  const pendingRoots = new Set<Element>();
  let scheduled = false;
  let stopped = false;
  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) {
        if (node instanceof Element && !node.matches('.dxp-floor-btn')) {
          pendingRoots.add(node);
        }
      }
    }
    if (scheduled || pendingRoots.size === 0) return;
    scheduled = true;
    queueMicrotask(() => {
      scheduled = false;
      if (stopped) return;
      for (const root of pendingRoots) scanAndInject(root);
      pendingRoots.clear();
    });
  });
  observer.observe(document.body, { childList: true, subtree: true });
  return () => {
    stopped = true;
    observer.disconnect();
    pendingRoots.clear();
  };
}

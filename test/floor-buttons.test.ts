// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { captureUserClicks } from './trusted-click';
import {
  initFloorButtons,
  injectButtonsToPost,
  setOnCopyPost,
  getSelectedPosts,
  getSelectedPostIds,
  clearSelectedPosts,
} from '../src/ui/floor-buttons';

async function flushMutations(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

afterEach(() => {
  clearSelectedPosts();
  vi.restoreAllMocks();
  document.body.innerHTML = '';
});

describe('floor button DOM boundary', () => {
  it('binds flat, nested OP and adjacent nested replies within their own action containers', async () => {
    const userClick = captureUserClicks();
    const copyPost = vi.fn().mockResolvedValue(undefined);
    setOnCopyPost(copyPost);
    document.body.innerHTML = `
      <div class="topic-post" data-post-number="2"><article data-post-id="101"></article><nav class="post-controls"><div class="actions"></div></nav></div>
      <div class="nested-view__op"><article data-post-id="102" id="post_1"></article><section class="nested-view__op-menu"><div class="actions"></div></section></div>
      <div class="nested-post"><article class="nested-post__article" data-post-id="103" id="post_3"></article><section class="nested-post__menu"><div class="actions"></div></section></div>
      <div class="nested-post"><article class="nested-post__article" data-post-id="104" id="post_4"></article><section class="nested-post__menu"><div class="actions"></div></section></div>`;
    const stop = initFloorButtons();
    expect(document.querySelectorAll('.dxp-copy-btn')).toHaveLength(4);
    expect(document.querySelectorAll('.dxp-select-btn')).toHaveLength(4);
    for (const button of document.querySelectorAll('.dxp-copy-btn'))
      await userClick(button);
    expect(copyPost.mock.calls).toEqual([
      [2, 101],
      [1, 102],
      [3, 103],
      [4, 104],
    ]);
    const select = document.querySelector('.dxp-select-btn');
    if (!select) throw new Error('Missing select button');
    await userClick(select);
    const selected = getSelectedPosts();
    const ids = getSelectedPostIds();
    clearSelectedPosts();
    expect([...selected]).toEqual([2]);
    expect([...ids]).toEqual([[2, 101]]);
    expect([...getSelectedPosts()]).toEqual([]);
    const first = document.querySelector('.topic-post');
    if (!first) throw new Error('Missing test post');
    injectButtonsToPost(first);
    expect(document.querySelectorAll('.dxp-copy-btn')).toHaveLength(4);
    stop();
  });

  it('injects late actions once, stops on departure, and restarts without a polling timer', async () => {
    const interval = vi.spyOn(window, 'setInterval');
    document.body.innerHTML =
      '<div class="topic-post" data-post-number="2"><article data-post-id="101"></article></div>';
    const stop = initFloorButtons();
    const first = document.querySelector('.topic-post');
    if (!first) throw new Error('Missing test post');
    first.insertAdjacentHTML(
      'beforeend',
      '<nav class="post-controls"><div class="actions"></div></nav>',
    );
    await flushMutations();
    expect(document.querySelectorAll('.dxp-copy-btn')).toHaveLength(1);
    stop();
    document.body.insertAdjacentHTML(
      'beforeend',
      '<div class="topic-post" data-post-number="3"><article data-post-id="999"></article><nav class="post-controls"><div class="actions"></div></nav></div>',
    );
    await flushMutations();
    expect(document.querySelectorAll('.dxp-copy-btn')).toHaveLength(1);
    const stopAgain = initFloorButtons();
    expect(document.querySelectorAll('.dxp-copy-btn')).toHaveLength(2);
    expect(interval).not.toHaveBeenCalled();
    stopAgain();
    interval.mockRestore();
  });
});

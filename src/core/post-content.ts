import type { DiscoursePost, PipelineContext } from '../types';
import { cookedToMarkdown } from './cooked-fallback';
import { processRaw } from './raw-pipeline';

export type PostContentContext = Pick<
  PipelineContext,
  'origin' | 'topicId' | 'uploadMap' | 'renderedPostNumbers'
>;

/** Both export entry points share raw preference and one observable fallback. */
export function postToMarkdown(
  post: Pick<DiscoursePost, 'id' | 'post_number' | 'raw' | 'cooked' | 'polls'>,
  context: PostContentContext,
): string {
  if (post.raw) {
    try {
      return processRaw(post.raw, {
        ...context,
        polls: post.polls ?? [],
        cookedHtml: post.cooked,
      });
    } catch {
      // Only source identity is logged; credentials and post contents are excluded.
      console.warn('[DXP] Raw conversion failed; using cooked fallback', {
        topicId: context.topicId,
        postNumber: post.post_number,
        postId: post.id,
      });
    }
  }
  try {
    return cookedToMarkdown(post.cooked, context);
  } catch {
    throw new Error(
      `Cooked conversion failed for topic ${context.topicId}, post #${post.post_number}`,
    );
  }
}

import { postToMarkdown } from './post-content';
import { protectMarkdownCode } from '../utils/markdown-code';
import { fetchPostById, fetchTopic, resolveUploadUrls } from './api';

export interface SinglePostMarkdownRequest {
  topicId: number;
  postNumber: number;
  postId: number;
  origin: string;
}

export async function buildSinglePostMarkdown(
  request: SinglePostMarkdownRequest,
): Promise<string> {
  const { topicId, postId, postNumber, origin } = request;
  const context = { origin };
  const topic = await fetchTopic(topicId, context);
  const post =
    topic.post_stream.posts.find(
      (candidate) => candidate.post_number === postNumber,
    ) ?? (await fetchPostById(topicId, postId, context));

  if (!post || post.id !== postId || post.post_number !== postNumber) {
    throw new Error(`Post #${postNumber} was not found in topic ${topicId}`);
  }

  const uploadUrls =
    protectMarkdownCode(post.raw ?? '').text.match(
      /upload:\/\/[a-zA-Z0-9._-]+/g,
    ) ?? [];
  const uploadMap = await resolveUploadUrls(uploadUrls, context);
  return postToMarkdown(post, {
    origin,
    topicId,
    uploadMap,
  });
}

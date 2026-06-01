import type { Config, PipelineContext } from '../types';
import { fetchPostById, fetchTopic, resolveUploadUrls } from './api';
import { cookedToMarkdown } from './cooked-fallback';
import { processRaw } from './raw-pipeline';

export interface SinglePostMarkdownRequest {
  topicId: number;
  postNumber: number;
  postId: number;
  origin: string;
  config: Config;
}

export async function buildSinglePostMarkdown(
  request: SinglePostMarkdownRequest,
): Promise<string> {
  const topic = await fetchTopic(request.topicId);
  const post =
    topic.post_stream.posts.find(
      (candidate) => candidate.post_number === request.postNumber,
    ) ?? (await fetchPostById(request.topicId, request.postId));

  if (!post) {
    throw new Error(
      `Post #${request.postNumber} was not found in topic ${request.topicId}`,
    );
  }

  const uploadUrls = post.raw?.match(/upload:\/\/[a-zA-Z0-9._-]+/g) ?? [];
  const uploadMap = await resolveUploadUrls(uploadUrls);
  const pipelineContext: PipelineContext = {
    origin: request.origin,
    topicId: request.topicId,
    topicSlug: topic.slug,
    polls: post.polls ?? [],
    cookedHtml: post.cooked,
    config: request.config,
    uploadMap,
  };

  if (post.raw) {
    return processRaw(post.raw, pipelineContext);
  }
  return cookedToMarkdown(post.cooked);
}

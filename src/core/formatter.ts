import type {
  DiscourseTopic,
  DiscoursePost,
  ProcessedPost,
  Config,
  PipelineContext,
} from '../types';
import { processRaw } from './raw-pipeline';
import { cookedToMarkdown } from './cooked-fallback';
import { avatarUrl, topicUrl } from '../utils/url';

// ==================== Frontmatter ====================

export interface FrontmatterData {
  title: string;
  source: string;
  author: string;
  category: string;
  tags: string[];
  created: string;
  exported: string;
  forum: string;
  topic_id: number;
  slug: string;
  posts_count: number;
  reply_count: number;
  views: number;
  likes: number;
  word_count: number;
  participants: number;
  closed: boolean;
  archived: boolean;
  xporter_version: number;
}

/** Escape a YAML string value */
function yamlStr(str: string): string {
  if (!str) return '""';
  if (/[:#\[\]{}&*!|>'"%@`,?]/.test(str) || str.trim() !== str) {
    return `"${str.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
  }
  return str;
}

/** Format ISO date string to local date/time */
function formatDate(dateStr: string, format?: string): string {
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return dateStr;

  const pad = (n: number) => String(n).padStart(2, '0');
  const Y = d.getFullYear();
  const M = pad(d.getMonth() + 1);
  const D = pad(d.getDate());
  const h = pad(d.getHours());
  const m = pad(d.getMinutes());

  if (format === 'iso') return d.toISOString();
  return `${Y}-${M}-${D} ${h}:${m}`;
}

export function buildFrontmatter(data: FrontmatterData): string {
  const tags =
    data.tags.length > 0
      ? '\n' + data.tags.map((t) => `  - ${t}`).join('\n')
      : ' []';

  const lines = [
    '---',
    `xporter_version: ${data.xporter_version}`,
    `title: ${yamlStr(data.title)}`,
    `source: ${yamlStr(data.source)}`,
    `author: ${yamlStr(data.author)}`,
    `category: ${yamlStr(data.category)}`,
    `forum: ${yamlStr(data.forum)}`,
    `tags:${tags}`,
    `created: ${data.created}`,
    `exported: ${data.exported}`,
    `topic_id: ${data.topic_id}`,
    `slug: ${yamlStr(data.slug)}`,
    `posts_count: ${data.posts_count}`,
    `reply_count: ${data.reply_count}`,
    `views: ${data.views}`,
    `likes: ${data.likes}`,
    `word_count: ${data.word_count}`,
    `participants: ${data.participants}`,
  ];

  if (data.closed) lines.push('closed: true');
  if (data.archived) lines.push('archived: true');

  lines.push('---');
  return lines.join('\n');
}

// ==================== Floor Template ====================

export interface TemplateVars {
  post_number: number;
  floor_link: string;
  username: string;
  author: string;
  author_full: string;
  avatar_url: string;
  date: string;
  date_iso: string;
  likes: number;
  likes_display: string;
  reply_to: string;
  reply_to_display: string;
  trust_level: number;
  is_op: boolean;
  op_badge: string;
  op_badge_display: string;
  post_url: string;
  reactions: string;
  edit_count: number;
  is_wiki: boolean;
  content: string;
  highlight: string;
  block_ref: string;
}

/** Build template variables from a processed post */
export function buildTemplateVars(
  post: ProcessedPost,
  origin: string,
  topicId: number,
): TemplateVars {
  const authorFull =
    post.name && post.name !== post.username
      ? `${post.name} (@${post.username})`
      : `@${post.username}`;

  const date = formatDate(post.created_at);
  const dateIso = formatDate(post.created_at, 'iso');

  const likesDisplay = post.likes > 0 ? ` · ❤️ ${post.likes}` : '';
  const replyToDisplay =
    post.reply_to_post_number !== null
      ? ` · → [[#^floor-${post.reply_to_post_number}|#${post.reply_to_post_number}]]`
      : '';
  const opBadge = post.is_op ? '🏠 楼主' : '';
  const opBadgeDisplay = post.is_op ? ' · 🏠 楼主' : '';

  const reactionsStr = post.reactions
    .filter((r) => r.count > 0)
    .map((r) => `${r.type} ${r.count}`)
    .join(' · ');

  const highlight = post.selected ? ' · ==已选中==' : '';
  // Always add block ref so reply links work via [[#^floor-N]]
  const blockRef = `^floor-${post.post_number}`;

  return {
    post_number: post.post_number,
    floor_link: `#${post.post_number}`,
    username: post.username,
    author: post.name || post.username,
    author_full: authorFull,
    avatar_url: post.avatar_url,
    date,
    date_iso: dateIso,
    likes: post.likes,
    likes_display: likesDisplay,
    reply_to:
      post.reply_to_post_number !== null
        ? String(post.reply_to_post_number)
        : '',
    reply_to_display: replyToDisplay,
    trust_level: post.trust_level,
    is_op: post.is_op,
    op_badge: opBadge,
    op_badge_display: opBadgeDisplay,
    post_url: topicUrl(origin, topicId, post.post_number),
    reactions: reactionsStr,
    edit_count: post.edit_count,
    is_wiki: post.is_wiki,
    content: post.content,
    highlight,
    block_ref: blockRef,
  };
}

/** Render a floor template with variables */
export function renderTemplate(template: string, vars: TemplateVars): string {
  let result = template;
  for (const [key, value] of Object.entries(vars)) {
    const str = String(value);
    // Use function replacement to avoid $ being interpreted as special pattern
    result = result.replaceAll(`{{${key}}}`, () => str);
  }
  return result;
}

// ==================== Document Assembly ====================

/**
 * Process a single Discourse post into a ProcessedPost.
 */
export function processPost(
  post: DiscoursePost,
  opUserId: number,
  ctx: PipelineContext,
  selected: boolean,
): ProcessedPost {
  let content: string;

  try {
    if (post.raw) {
      content = processRaw(post.raw, {
        ...ctx,
        polls: post.polls ?? [],
        cookedHtml: post.cooked,
      });
    } else {
      // Fallback to cooked
      content = cookedToMarkdown(post.cooked);
    }
  } catch {
    // Ultimate fallback
    content = cookedToMarkdown(post.cooked);
  }

  const likeAction = post.actions_summary.find((a) => a.id === 2);
  const likes = likeAction?.count ?? 0;

  return {
    post_number: post.post_number,
    username: post.username,
    name: post.name,
    avatar_url: avatarUrl(post.avatar_template, 48, ctx.origin),
    created_at: post.created_at,
    trust_level: post.trust_level,
    is_op: post.user_id === opUserId,
    reply_to_post_number: post.reply_to_post_number,
    likes,
    reactions: post.reactions ?? [],
    edit_count: post.version > 1 ? post.version - 1 : 0,
    is_wiki: post.wiki,
    post_url: topicUrl(ctx.origin, ctx.topicId, post.post_number),
    content,
    selected,
  };
}

/**
 * Assemble the full Markdown document from topic data and processed posts.
 */
export function assembleDocument(
  frontmatter: string,
  posts: ProcessedPost[],
  template: string,
  origin: string,
  topicId: number,
): string {
  const parts: string[] = [frontmatter, '\n\n'];

  for (const post of posts) {
    const vars = buildTemplateVars(post, origin, topicId);
    const rendered = renderTemplate(template, vars);
    parts.push(rendered);
    parts.push('\n');
  }

  // Highlight summary section
  const highlighted = posts.filter((p) => p.selected);
  if (highlighted.length > 0) {
    parts.push('\n---\n\n## 📌 高亮楼层\n\n');
    for (const p of highlighted) {
      const date = formatDate(p.created_at);
      parts.push(
        `- [[#^floor-${p.post_number}|#${p.post_number} · ${p.username} · ${date}]]\n`,
      );
    }
  }

  return parts.join('');
}

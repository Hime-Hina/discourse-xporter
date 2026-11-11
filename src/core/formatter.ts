import type { DiscoursePost, ExportProfile, ProcessedPost } from '../types';
import { postToMarkdown, type PostContentContext } from './post-content';
import { avatarUrl, topicUrl } from '../utils/url';
import { floorLink, getRenderedPostNumbers } from '../utils/obsidian';

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
  export_profile?: ExportProfile;
}

/** Escape a YAML string value */
function yamlJson(value: string | ExportProfile): string {
  // YAML treats these additional Unicode characters as line breaks.
  return JSON.stringify(value).replace(/[\u0085\u2028\u2029]/g, (char) =>
    `\\u${char.charCodeAt(0).toString(16).padStart(4, '0')}`,
  );
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
      ? '\n' + data.tags.map((t) => `  - ${yamlJson(t)}`).join('\n')
      : ' []';

  const lines = [
    '---',
    `xporter_version: ${data.xporter_version}`,
    `title: ${yamlJson(data.title)}`,
    `source: ${yamlJson(data.source)}`,
    `author: ${yamlJson(data.author)}`,
    `category: ${yamlJson(data.category)}`,
    `forum: ${yamlJson(data.forum)}`,
    `tags:${tags}`,
    `created: ${yamlJson(data.created)}`,
    `exported: ${yamlJson(data.exported)}`,
    `topic_id: ${data.topic_id}`,
    `slug: ${yamlJson(data.slug)}`,
    `posts_count: ${data.posts_count}`,
    `reply_count: ${data.reply_count}`,
    `views: ${data.views}`,
    `likes: ${data.likes}`,
    `word_count: ${data.word_count}`,
    `participants: ${data.participants}`,
  ];

  if (data.closed) lines.push('closed: true');
  if (data.archived) lines.push('archived: true');
  if (data.export_profile) lines.push(`export_profile: ${yamlJson(data.export_profile)}`);

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
  solution_badge: string;
  solution_badge_display: string;
  block_ref: string;
}

/** Build template variables from a processed post */
export function buildTemplateVars(
  post: ProcessedPost,
  origin: string,
  topicId: number,
  renderedPostNumbers?: ReadonlySet<number>,
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
      ? ` · → ${floorLink(origin, topicId, post.reply_to_post_number, renderedPostNumbers)}`
      : '';
  const opBadge = post.is_op ? '🏠 楼主' : '';
  const opBadgeDisplay = post.is_op ? ' · 🏠 楼主' : '';

  const reactionsStr = post.reactions
    .filter((r) => r.count > 0)
    .map((r) => `${r.type} ${r.count}`)
    .join(' · ');

  const highlight = post.selected ? ' · ==已选中==' : '';
  const solutionBadge = post.is_solution ? '✅ 解决方案' : '';
  const solutionBadgeDisplay = post.is_solution ? ' · ✅ 解决方案' : '';
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
    solution_badge: solutionBadge,
    solution_badge_display: solutionBadgeDisplay,
    block_ref: blockRef,
  };
}

/** Render a floor template with variables */
export function renderTemplate(template: string, vars: TemplateVars): string {
  return template.replace(/{{(\w+)}}/g, (placeholder, key: string) =>
    Object.prototype.hasOwnProperty.call(vars, key)
      ? String(vars[key as keyof TemplateVars])
      : placeholder,
  );
}

// ==================== Document Assembly ====================

/**
 * Process a single Discourse post into a ProcessedPost.
 */
export function processPost(
  post: DiscoursePost,
  opUserId: number,
  ctx: PostContentContext,
  selected: boolean,
): ProcessedPost {
  const content = postToMarkdown(post, ctx);

  const likeAction = post.actions_summary?.find((a) => a.id === 2);
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
    is_solution:
      post.accepted_answer === true || post.topic_accepted_answer === true,
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
  acceptedAnswerPostNumber?: number,
): string {
  const parts: string[] = [frontmatter, '\n\n'];
  const renderedPostNumbers = getRenderedPostNumbers(
    posts.map((post) => post.post_number),
    template,
  );

  for (const post of posts) {
    const vars = buildTemplateVars(post, origin, topicId, renderedPostNumbers);
    const rendered = renderTemplate(template, vars);
    parts.push(rendered);
    if (post.post_number === 1 && acceptedAnswerPostNumber !== undefined) {
      parts.push(
        `\n> [!success] 解决方案：${floorLink(origin, topicId, acceptedAnswerPostNumber, renderedPostNumbers)}\n`,
      );
    }
    parts.push('\n');
  }

  // Highlight summary section
  const highlighted = posts.filter((p) => p.selected);
  if (highlighted.length > 0) {
    parts.push('\n---\n\n## 📌 高亮楼层\n\n');
    for (const p of highlighted) {
      const date = formatDate(p.created_at);
      parts.push(
        `- ${floorLink(origin, topicId, p.post_number, renderedPostNumbers, `#${p.post_number} · ${p.username} · ${date}`)}\n`,
      );
    }
  }

  return parts.join('');
}

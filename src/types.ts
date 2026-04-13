// ==================== Discourse API Types ====================

/** Topic-level metadata from /t/{id}.json */
export interface DiscourseTopic {
  id: number;
  title: string;
  fancy_title: string;
  slug: string;
  category_id: number;
  tags: DiscourseTag[];
  posts_count: number;
  created_at: string;
  views: number;
  reply_count: number;
  like_count: number;
  word_count: number;
  user_id: number;
  highest_post_number: number;
  participant_count: number;
  visible: boolean;
  closed: boolean;
  archived: boolean;
  image_url: string | null;
  post_stream: {
    posts: DiscoursePost[];
    stream: number[];
  };
  details: {
    participants: DiscourseParticipant[];
    created_by: DiscourseUser;
    last_poster: DiscourseUser;
    links?: DiscourseTopicLink[];
  };
}

export interface DiscourseTag {
  id: number;
  name: string;
  slug: string;
}

export interface DiscourseUser {
  id: number;
  username: string;
  name: string;
  avatar_template: string;
}

export interface DiscourseParticipant extends DiscourseUser {
  post_count: number;
  trust_level: number;
}

export interface DiscourseTopicLink {
  url: string;
  title: string | null;
  internal: boolean;
  attachment: boolean;
  clicks: number;
}

/** Single post object from Discourse API */
export interface DiscoursePost {
  id: number;
  post_number: number;
  post_type: number;
  username: string;
  name: string;
  avatar_template: string;
  user_id: number;
  created_at: string;
  updated_at: string;
  cooked: string;
  raw?: string;
  reply_count: number;
  reply_to_post_number: number | null;
  quote_count: number;
  reads: number;
  score: number;
  topic_id: number;
  topic_slug: string;
  display_username: string;
  version: number;
  trust_level: number;
  moderator: boolean;
  admin: boolean;
  staff: boolean;
  hidden: boolean;
  deleted_at: string | null;
  wiki: boolean;
  user_title: string | null;
  actions_summary: DiscourseActionSummary[];
  link_counts?: DiscourseLinkCount[];
  polls?: DiscoursePoll[];
  reactions?: DiscourseReaction[];
  post_url: string;
}

export interface DiscourseActionSummary {
  id: number;
  count?: number;
  can_act?: boolean;
}

export interface DiscourseLinkCount {
  url: string;
  internal: boolean;
  title: string | null;
  clicks: number;
}

export interface DiscoursePoll {
  id: number;
  name: string;
  type: 'regular' | 'multiple' | 'number';
  status: 'open' | 'closed';
  public: boolean;
  results: 'always' | 'on_vote' | 'on_close' | 'staff_only';
  options: DiscoursePollOption[];
  voters: number;
  chart_type: string;
}

export interface DiscoursePollOption {
  id: string;
  html: string;
  votes: number;
}

export interface DiscourseReaction {
  id: string;
  type: string;
  count: number;
}

export interface UploadLookupResult {
  short_url: string;
  url: string;
  short_path: string;
}

// ==================== App Types ====================

export type ImageMode = 'file' | 'embed' | 'none';
export type WriteMode = 'overwrite' | 'append';
export type ImageFilter = 'none' | 'withImg' | 'noImg';
export type RangeMode = 'all' | 'range' | 'selected';

export interface Config {
  // Export
  exportDir: string;
  imgMode: ImageMode;
  imgDir: string;

  // Obsidian API
  obsApiUrl: string;
  obsApiKey: string;
  obsWriteMode: WriteMode;
  obsOpenAfterExport: boolean;

  // Floor template
  floorTemplate: string;
  dateFormat: string;

  // Filter defaults
  defaultOnlyOp: boolean;
  defaultImgFilter: ImageFilter;

  // Request
  batchSize: number;
  batchDelayMin: number;
  batchDelayMax: number;
  imageConcurrency: number;
  imageDelayMin: number;
  imageDelayMax: number;

  // UI
  panelPos: { top: number; left: number } | null;

  // Debug
  debugMode: boolean;
}

/** Processed post data ready for formatting */
export interface ProcessedPost {
  post_number: number;
  username: string;
  name: string;
  avatar_url: string;
  created_at: string;
  trust_level: number;
  is_op: boolean;
  reply_to_post_number: number | null;
  likes: number;
  reactions: DiscourseReaction[];
  edit_count: number;
  is_wiki: boolean;
  post_url: string;
  content: string;
  selected: boolean;
}

/** Context passed to the raw pipeline */
export interface PipelineContext {
  origin: string;
  topicId: number;
  topicSlug: string;
  polls: DiscoursePoll[];
  cookedHtml: string;
  config: Config;
  uploadMap: Map<string, string>;
}

/** Onebox info extracted from cooked HTML */
export interface OneboxInfo {
  url: string;
  /** Pre-rendered callout Markdown */
  rendered: string;
}

/** Quote preview info extracted from cooked HTML (aside.quote.quote-modified) */
export interface QuotePreviewInfo {
  url: string;
  title: string;
  topicId: number;
  postNumber: number;
  body: string;
  username: string;
}

/** Export progress callback */
export type ProgressCallback = (message: string, progress?: number) => void;

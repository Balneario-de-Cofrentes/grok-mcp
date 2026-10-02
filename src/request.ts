import { ModelOptions, isMultiAgent, resolveModel } from './profiles.js';

export const SEARCH_TOOLS = ['web_search', 'x_search'] as const;

export type SearchTool = (typeof SEARCH_TOOLS)[number];

const MAX_DOMAINS = 5;
const MAX_X_HANDLES = 20;
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

export interface SearchOptions {
  search_tools?: string[];
  allowed_domains?: string[];
  excluded_domains?: string[];
  allowed_x_handles?: string[];
  excluded_x_handles?: string[];
  from_date?: string;
  to_date?: string;
  enable_image_understanding?: boolean;
  enable_video_understanding?: boolean;
}

export interface ResponsesOptions extends ModelOptions, SearchOptions {
  max_tokens?: number;
  temperature?: number;
  max_turns?: number;
}

function hasItems(list?: unknown[]): list is unknown[] {
  return Array.isArray(list) && list.length > 0;
}

/** Checks an allowed_<name> / excluded_<name> pair: only one may be set, with at most `max` entries. */
function assertFilterLists(name: string, max: number, allowed?: string[], excluded?: string[]) {
  if (hasItems(allowed) && hasItems(excluded)) {
    throw new Error(`allowed_${name} and excluded_${name} cannot be set together`);
  }
  for (const [key, list] of Object.entries({ [`allowed_${name}`]: allowed, [`excluded_${name}`]: excluded })) {
    if (hasItems(list) && list.length > max) {
      throw new Error(`${key} accepts at most ${max} entries, got ${list.length}`);
    }
  }
}

/** The API silently ignores dates in any other format, so reject them here. */
function assertDate(name: string, value?: string) {
  if (value !== undefined && (!DATE_ONLY.test(value) || Number.isNaN(Date.parse(value)))) {
    throw new Error(`${name} must be a YYYY-MM-DD date, got "${value}"`);
  }
}

const stripAt = (handle: string) => handle.replace(/^@/, '');

function webSearchTool(options: SearchOptions) {
  assertFilterLists('domains', MAX_DOMAINS, options.allowed_domains, options.excluded_domains);
  const filters = {
    ...(hasItems(options.allowed_domains) && { allowed_domains: options.allowed_domains }),
    ...(hasItems(options.excluded_domains) && { excluded_domains: options.excluded_domains }),
  };
  return {
    type: 'web_search',
    ...(Object.keys(filters).length > 0 && { filters }),
    ...(options.enable_image_understanding && { enable_image_understanding: true }),
  };
}

function xSearchTool(options: SearchOptions) {
  assertFilterLists('x_handles', MAX_X_HANDLES, options.allowed_x_handles, options.excluded_x_handles);
  assertDate('from_date', options.from_date);
  assertDate('to_date', options.to_date);
  if (options.from_date && options.to_date && options.from_date > options.to_date) {
    throw new Error(`from_date ${options.from_date} is after to_date ${options.to_date}`);
  }
  return {
    type: 'x_search',
    ...(hasItems(options.allowed_x_handles) && {
      allowed_x_handles: options.allowed_x_handles.map(stripAt),
    }),
    ...(hasItems(options.excluded_x_handles) && {
      excluded_x_handles: options.excluded_x_handles.map(stripAt),
    }),
    ...(options.from_date && { from_date: options.from_date }),
    ...(options.to_date && { to_date: options.to_date }),
    ...(options.enable_image_understanding && { enable_image_understanding: true }),
    ...(options.enable_video_understanding && { enable_video_understanding: true }),
  };
}

const TOOL_BUILDERS: Record<SearchTool, (options: SearchOptions) => object> = {
  web_search: webSearchTool,
  x_search: xSearchTool,
};

export function buildSearchTools(options: SearchOptions): object[] {
  const requested = [...new Set(options.search_tools ?? [])];
  return requested.map((name) => {
    if (!SEARCH_TOOLS.includes(name as SearchTool)) {
      throw new Error(`Unknown search tool "${name}". Use: ${SEARCH_TOOLS.join(', ')}`);
    }
    return TOOL_BUILDERS[name as SearchTool](options);
  });
}

/** Builds the body of a POST /v1/responses request. */
export function buildResponsesRequest(input: unknown[], options: ResponsesOptions = {}) {
  if (!Array.isArray(input) || input.length === 0) {
    throw new Error('Messages must be a non-empty array');
  }
  const { model, effort } = resolveModel(options);
  const tools = buildSearchTools(options);
  return {
    model,
    input,
    reasoning: { effort },
    ...(tools.length > 0 && { tools }),
    ...(options.max_tokens !== undefined && !isMultiAgent(model) && { max_output_tokens: options.max_tokens }),
    ...(options.temperature !== undefined && { temperature: options.temperature }),
    ...(options.max_turns !== undefined && { max_turns: options.max_turns }),
  };
}

export interface ImageOptions extends ModelOptions {
  prompt?: string;
  image_url?: string;
  base64_image?: string;
  mime_type?: string;
}

/** Builds the `input` of a Responses request that asks about one image. */
export function buildImageInput({ prompt, image_url, base64_image, mime_type = 'image/jpeg' }: ImageOptions) {
  if (!prompt) {
    throw new Error('Prompt is required');
  }
  if (!image_url && !base64_image) {
    throw new Error('Either image_url or base64_image is required');
  }
  const url = image_url ?? `data:${mime_type};base64,${base64_image}`;
  return [
    {
      role: 'user',
      content: [
        { type: 'input_image', image_url: url, detail: 'high' },
        { type: 'input_text', text: prompt },
      ],
    },
  ];
}

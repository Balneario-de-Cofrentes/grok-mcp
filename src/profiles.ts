/**
 * Depth profiles: the single place that decides which Grok model and reasoning
 * effort a request uses. Costs and latencies were measured on 2026-10-02 with
 * one X search over a week of posts; X Search bills $5 per 1k posts fetched,
 * so the number of posts a profile reads drives most of its cost.
 */
export const DEPTHS = {
  quick: {
    model: 'grok-4.3',
    effort: 'low',
    summary: 'grok-4.3, low effort. ~15 s, ~$0.11 per X search (~20 posts). Default.',
  },
  standard: {
    model: 'grok-4.7',
    effort: 'low',
    summary: 'grok-4.7, low effort. ~20 s, ~$0.22 per X search (~40 posts). When the user asks for more effort.',
  },
  deep: {
    model: 'grok-4.7',
    effort: 'high',
    summary: 'grok-4.7, high effort. ~60 s, ~$0.42 per X search (~55 posts). Questions that need judgement.',
  },
  research: {
    model: 'grok-4.20-multi-agent',
    effort: 'low',
    summary:
      'grok-4.20-multi-agent with 4 agents. ~40 s, ~$0.90 per X search (~140 posts). Set reasoning_effort "high" for 16 agents.',
  },
} as const;

export type Depth = keyof typeof DEPTHS;

export const DEFAULT_DEPTH: Depth = 'quick';

export const REASONING_EFFORTS = ['none', 'low', 'medium', 'high', 'xhigh'] as const;

export type ReasoningEffort = (typeof REASONING_EFFORTS)[number];

export interface ModelChoice {
  model: string;
  effort: ReasoningEffort;
}

export interface ModelOptions {
  depth?: string;
  model?: string;
  reasoning_effort?: string;
}

/** An explicit `model` or `reasoning_effort` overrides the depth profile. */
export function resolveModel({ depth, model, reasoning_effort }: ModelOptions): ModelChoice {
  if (depth !== undefined && !Object.keys(DEPTHS).includes(depth)) {
    throw new Error(`Unknown depth "${depth}". Use one of: ${Object.keys(DEPTHS).join(', ')}`);
  }
  if (reasoning_effort !== undefined && !REASONING_EFFORTS.includes(reasoning_effort as ReasoningEffort)) {
    throw new Error(
      `Unknown reasoning_effort "${reasoning_effort}". Use one of: ${REASONING_EFFORTS.join(', ')}`
    );
  }
  const profile = DEPTHS[(depth as Depth | undefined) ?? DEFAULT_DEPTH];
  return {
    model: model ?? profile.model,
    effort: (reasoning_effort as ReasoningEffort | undefined) ?? profile.effort,
  };
}

/** The multi-agent model rejects `max_output_tokens`. */
export function isMultiAgent(model: string): boolean {
  return model.includes('multi-agent');
}

export function depthGuide(): string {
  return Object.entries(DEPTHS)
    .map(([name, profile]) => `"${name}": ${profile.summary}`)
    .join(' ');
}

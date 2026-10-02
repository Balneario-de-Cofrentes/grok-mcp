import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  extractText,
  extractUnlinkedSources,
  formatApiError,
  formatResponse,
  formatUsage,
} from '../build/format.js';

const POST_A = 'https://x.com/a/status/1';
const POST_B = 'https://x.com/i/status/2';

const response = (overrides = {}) => ({
  model: 'grok-4.7',
  status: 'completed',
  reasoning: { effort: 'low' },
  output: [
    { type: 'reasoning' },
    { type: 'custom_tool_call', name: 'x_keyword_search' },
    {
      type: 'message',
      content: [
        {
          type: 'output_text',
          text: `Answer citing ${POST_A}`,
          annotations: [
            { type: 'url_citation', url: POST_A },
            { type: 'url_citation', url: POST_B },
            { type: 'url_citation', url: POST_B },
          ],
        },
      ],
    },
  ],
  usage: {
    total_tokens: 26402,
    cost_in_usd_ticks: 2248960000,
    server_side_tool_usage_details: {
      web_search_calls: 0,
      x_search_calls: 4,
      x_posts_fetched: 37,
      x_users_fetched: 1,
    },
  },
  ...overrides,
});

test('extractText joins the output_text blocks and ignores tool calls', () => {
  assert.equal(extractText(response()), `Answer citing ${POST_A}`);
  assert.equal(extractText({}), '');
});

test('extractUnlinkedSources dedupes and skips links already in the answer', () => {
  const full = response();
  assert.deepEqual(extractUnlinkedSources(full, extractText(full)), [POST_B]);
});

test('formatUsage reports model, effort, search usage, cost and time', () => {
  assert.equal(
    formatUsage(response(), 18400),
    '[grok-4.7 · effort low · 4 X searches · 37 posts fetched · 1 profile fetched · 26402 tokens · $0.2249 · 18 s]'
  );
});

test('formatUsage omits what did not happen', () => {
  const plain = response({ usage: { total_tokens: 320, cost_in_usd_ticks: 3559000 } });
  assert.equal(formatUsage(plain), '[grok-4.7 · effort low · 320 tokens · $0.0004]');
  const web = response({ usage: { server_side_tool_usage_details: { web_search_calls: 1 } } });
  assert.equal(formatUsage(web), '[grok-4.7 · effort low · 1 web search]');
});

test('formatResponse stacks answer, other sources and usage', () => {
  assert.equal(
    formatResponse(response(), 18400),
    [
      `Answer citing ${POST_A}`,
      `Other sources read:\n- ${POST_B}`,
      '[grok-4.7 · effort low · 4 X searches · 37 posts fetched · 1 profile fetched · 26402 tokens · $0.2249 · 18 s]',
    ].join('\n\n')
  );
});

test('formatResponse flags a truncated response', () => {
  const truncated = response({ status: 'incomplete', incomplete_details: { reason: 'max_output_tokens' } });
  assert.match(formatResponse(truncated), /Response truncated \(max_output_tokens\)\./);
});

test('formatApiError shows the reason xAI gives, not just the status', () => {
  const error = {
    message: 'Request failed with status code 403',
    response: {
      status: 403,
      data: { code: 'permission-denied', error: 'Your team has used all available credits.' },
    },
  };
  assert.equal(formatApiError(error), 'xAI API 403 permission-denied: Your team has used all available credits.');
});

test('formatApiError handles OpenAI-style, string and transport errors', () => {
  assert.equal(
    formatApiError({ response: { status: 400, data: { error: { message: 'bad model' } } } }),
    'xAI API 400: bad model'
  );
  assert.equal(formatApiError({ response: { status: 502, data: 'Bad Gateway' } }), 'xAI API 502: Bad Gateway');
  assert.equal(formatApiError(new Error('timeout of 900000ms exceeded')), 'timeout of 900000ms exceeded');
});

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildImageInput, buildResponsesRequest, buildSearchTools } from '../build/request.js';

const INPUT = [{ role: 'user', content: 'hello' }];

test('a plain request carries model, input and reasoning effort only', () => {
  assert.deepEqual(buildResponsesRequest(INPUT), {
    model: 'grok-4.3',
    input: INPUT,
    reasoning: { effort: 'low' },
  });
});

test('empty or missing messages are rejected', () => {
  assert.throws(() => buildResponsesRequest([]), /non-empty array/);
  assert.throws(() => buildResponsesRequest(undefined), /non-empty array/);
});

test('optional tuning is sent only when given', () => {
  const body = buildResponsesRequest(INPUT, { max_tokens: 500, temperature: 0, max_turns: 2 });
  assert.equal(body.max_output_tokens, 500);
  assert.equal(body.temperature, 0);
  assert.equal(body.max_turns, 2);
});

test('the multi-agent model never receives max_output_tokens', () => {
  const body = buildResponsesRequest(INPUT, { depth: 'research', max_tokens: 500 });
  assert.equal(body.model, 'grok-4.20-multi-agent');
  assert.equal('max_output_tokens' in body, false);
});

test('x_search puts its filters at the top level and strips @ from handles', () => {
  const [tool] = buildSearchTools({
    search_tools: ['x_search'],
    allowed_x_handles: ['@xai', 'elonmusk'],
    from_date: '2026-09-24',
    to_date: '2026-10-02',
    enable_image_understanding: true,
    enable_video_understanding: true,
  });
  assert.deepEqual(tool, {
    type: 'x_search',
    allowed_x_handles: ['xai', 'elonmusk'],
    from_date: '2026-09-24',
    to_date: '2026-10-02',
    enable_image_understanding: true,
    enable_video_understanding: true,
  });
});

test('web_search nests domains under filters', () => {
  assert.deepEqual(buildSearchTools({ search_tools: ['web_search'], allowed_domains: ['x.ai'] }), [
    { type: 'web_search', filters: { allowed_domains: ['x.ai'] } },
  ]);
  assert.deepEqual(buildSearchTools({ search_tools: ['web_search'], excluded_domains: ['x.ai'] }), [
    { type: 'web_search', filters: { excluded_domains: ['x.ai'] } },
  ]);
});

test('a bare search tool has no filters, and each tool only gets its own options', () => {
  const tools = buildSearchTools({
    search_tools: ['web_search', 'x_search', 'x_search'],
    allowed_domains: ['x.ai'],
    from_date: '2026-09-24',
  });
  assert.deepEqual(tools, [
    { type: 'web_search', filters: { allowed_domains: ['x.ai'] } },
    { type: 'x_search', from_date: '2026-09-24' },
  ]);
  assert.deepEqual(buildSearchTools({ search_tools: ['x_search'] }), [{ type: 'x_search' }]);
  assert.deepEqual(buildSearchTools({}), []);
});

test('search tools are attached to the request', () => {
  const body = buildResponsesRequest(INPUT, { search_tools: ['x_search'], depth: 'standard' });
  assert.deepEqual(body.tools, [{ type: 'x_search' }]);
  assert.equal(body.model, 'grok-4.7');
});

test('allowed and excluded lists cannot be combined', () => {
  assert.throws(
    () => buildSearchTools({ search_tools: ['x_search'], allowed_x_handles: ['a'], excluded_x_handles: ['b'] }),
    /allowed_x_handles and excluded_x_handles cannot be set together/
  );
  assert.throws(
    () => buildSearchTools({ search_tools: ['web_search'], allowed_domains: ['a.com'], excluded_domains: ['b.com'] }),
    /allowed_domains and excluded_domains cannot be set together/
  );
});

test('list limits match the API: 20 handles, 5 domains', () => {
  const handles = Array.from({ length: 21 }, (_, i) => `user${i}`);
  assert.throws(
    () => buildSearchTools({ search_tools: ['x_search'], allowed_x_handles: handles }),
    /allowed_x_handles accepts at most 20 entries, got 21/
  );
  assert.doesNotThrow(() => buildSearchTools({ search_tools: ['x_search'], allowed_x_handles: handles.slice(0, 20) }));
  const domains = ['a.com', 'b.com', 'c.com', 'd.com', 'e.com', 'f.com'];
  assert.throws(
    () => buildSearchTools({ search_tools: ['web_search'], excluded_domains: domains }),
    /excluded_domains accepts at most 5 entries, got 6/
  );
});

test('dates must be real YYYY-MM-DD dates in order', () => {
  const xSearch = (options) => buildSearchTools({ search_tools: ['x_search'], ...options });
  assert.throws(() => xSearch({ from_date: '2026-10-02T10:00:00Z' }), /from_date must be a YYYY-MM-DD date/);
  assert.throws(() => xSearch({ to_date: '02/10/2026' }), /to_date must be a YYYY-MM-DD date/);
  assert.throws(() => xSearch({ from_date: '2026-13-40' }), /from_date must be a YYYY-MM-DD date/);
  assert.throws(() => xSearch({ from_date: '2026-10-02', to_date: '2026-09-01' }), /is after to_date/);
});

test('unknown search tools are rejected', () => {
  assert.throws(() => buildSearchTools({ search_tools: ['news_search'] }), /Unknown search tool "news_search"/);
  assert.throws(() => buildSearchTools({ search_tools: ['toString'] }), /Unknown search tool "toString"/);
});

test('image input accepts a URL or base64 with its mime type', () => {
  assert.deepEqual(buildImageInput({ prompt: 'What is this?', image_url: 'https://example.com/a.png' }), [
    {
      role: 'user',
      content: [
        { type: 'input_image', image_url: 'https://example.com/a.png', detail: 'high' },
        { type: 'input_text', text: 'What is this?' },
      ],
    },
  ]);
  const [message] = buildImageInput({ prompt: 'p', base64_image: 'AAAA', mime_type: 'image/png' });
  assert.equal(message.content[0].image_url, 'data:image/png;base64,AAAA');
  assert.equal(buildImageInput({ prompt: 'p', base64_image: 'AAAA' })[0].content[0].image_url, 'data:image/jpeg;base64,AAAA');
});

test('image input needs a prompt and an image', () => {
  assert.throws(() => buildImageInput({ image_url: 'https://example.com/a.png' }), /Prompt is required/);
  assert.throws(() => buildImageInput({ prompt: 'p' }), /image_url or base64_image is required/);
});

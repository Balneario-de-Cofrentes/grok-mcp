/** xAI reports cost in ticks of 1e-10 USD. */
const TICKS_PER_USD = 1e10;

function outputBlocks(response: any): any[] {
  return (response?.output ?? [])
    .filter((item: any) => item.type === 'message')
    .flatMap((item: any) => item.content ?? []);
}

export function extractText(response: any): string {
  return outputBlocks(response)
    .filter((block) => block.type === 'output_text')
    .map((block) => block.text)
    .join('\n');
}

/** Sources the model read but did not link in the answer itself. */
export function extractUnlinkedSources(response: any, text: string): string[] {
  const urls = outputBlocks(response)
    .flatMap((block) => block.annotations ?? [])
    .filter((annotation: any) => annotation.type === 'url_citation')
    .map((annotation: any) => annotation.url as string);
  return [...new Set(urls)].filter((url) => !text.includes(url));
}

const plural = (count: number, noun: string, pluralNoun = `${noun}s`) => `${count} ${count === 1 ? noun : pluralNoun}`;

/** One line with what the request used and what it cost. */
export function formatUsage(response: any, elapsedMs?: number): string {
  const usage = response?.usage ?? {};
  const tools = usage.server_side_tool_usage_details ?? {};
  const parts = [
    response?.model,
    response?.reasoning?.effort && `effort ${response.reasoning.effort}`,
    tools.x_search_calls > 0 && plural(tools.x_search_calls, 'X search', 'X searches'),
    tools.x_posts_fetched > 0 && plural(tools.x_posts_fetched, 'post') + ' fetched',
    tools.x_users_fetched > 0 && plural(tools.x_users_fetched, 'profile') + ' fetched',
    tools.web_search_calls > 0 && plural(tools.web_search_calls, 'web search', 'web searches'),
    usage.total_tokens > 0 && `${usage.total_tokens} tokens`,
    usage.cost_in_usd_ticks > 0 && `$${(usage.cost_in_usd_ticks / TICKS_PER_USD).toFixed(4)}`,
    elapsedMs !== undefined && `${Math.round(elapsedMs / 1000)} s`,
  ].filter(Boolean);
  return `[${parts.join(' · ')}]`;
}

export function formatResponse(response: any, elapsedMs?: number): string {
  const text = extractText(response);
  const sources = extractUnlinkedSources(response, text);
  return [
    text,
    response?.status === 'incomplete' &&
      `Response truncated (${response.incomplete_details?.reason ?? 'unknown reason'}).`,
    sources.length > 0 && 'Other sources read:\n' + sources.map((url) => `- ${url}`).join('\n'),
    formatUsage(response, elapsedMs),
  ]
    .filter(Boolean)
    .join('\n\n');
}

/** Surfaces the API's own explanation, e.g. exhausted credits behind a bare 403. */
export function formatApiError(error: any): string {
  const status = error?.response?.status;
  if (status === undefined) {
    return error?.message ?? String(error);
  }
  const data = error.response.data;
  const detail =
    typeof data === 'string' ? data : data?.error?.message ?? data?.error ?? data?.message ?? JSON.stringify(data);
  const code = typeof data?.code === 'string' ? ` ${data.code}` : '';
  return `xAI API ${status}${code}: ${detail}`;
}

# Grok MCP Plugin

A Model Context Protocol (MCP) server that gives Claude Code, Codex and Cline access to Grok: X search, web search, chat, image understanding and function calling.

> **Fork notice:** fork of [Bob-lance/grok-mcp](https://github.com/Bob-lance/grok-mcp), rewritten on top of the xAI Responses API with dedicated search tools and cost reporting.

## Tools

| Tool | Use it for |
|---|---|
| `x_search` | Anything on X: posts, threads, users, sentiment |
| `web_search` | Live web search and browsing |
| `chat_completion` | Plain chat, or one request that searches the web and X together |
| `image_understanding` | Questions about a jpg or png |
| `function_calling` | Letting Grok choose a function call for your own tools |

Every answer from `x_search`, `web_search`, `chat_completion` and `image_understanding` ends with a usage line:

```
[grok-4.7 · effort low · 4 X searches · 37 posts fetched · 26402 tokens · $0.2249 · 18 s]
```

## Depth profiles

`depth` picks the model and the reasoning effort. `model` and `reasoning_effort` override it.

| `depth` | Model | Effort | Measured on one X search |
|---|---|---|---|
| `quick` (default) | `grok-4.3` | `low` | ~15 s, ~$0.11, ~20 posts |
| `standard` | `grok-4.7` | `low` | ~20 s, ~$0.22, ~40 posts |
| `deep` | `grok-4.7` | `high` | ~60 s, ~$0.42, ~55 posts |
| `research` | `grok-4.20-multi-agent` | `low` (4 agents) | ~40 s, ~$0.90, ~140 posts |

Measured on 2026-10-02 with one query over a week of posts; one run per profile. The profiles live in `src/profiles.ts`.

### What drives cost

X Search bills **$5 per 1,000 posts fetched** and $10 per 1,000 profiles, on top of tokens ([xAI pricing](https://docs.x.ai/developers/pricing)). At `quick` depth the posts were about 90% of the bill. To spend less:

- Set `from_date` (and `to_date`) so the model reads fewer posts.
- Set `allowed_x_handles` when you know who to read.
- Stay on `quick` unless the question needs more; `standard`, `deep` and `research` read more posts.

Web search costs $5 per 1,000 calls: about $0.02 to $0.03 per query.

### Models

| Model | Context | Input / output per 1M tokens | Reasoning effort |
|---|---|---|---|
| `grok-4.7` | 500k | $2.00 / $6.00 | `low` to `xhigh`, default `high`, cannot be disabled |
| `grok-4.3` | 1M | $1.25 / $2.50 | `none` to `xhigh`, default `low` |
| `grok-4.20-multi-agent` | 1M | $1.25 / $2.50 | `low`/`medium` = 4 agents, `high`/`xhigh` = 16 |

Source: `GET https://api.x.ai/v1/models` and the [models page](https://docs.x.ai/developers/models), read on 2026-10-02. Slugs retired on 2026-05-15 (`grok-4-1-fast`, `grok-3`, `grok-code-fast-1` and others) still resolve but redirect to `grok-4.3` or `grok-build-0.1`.

## Prerequisites

- Node.js 20 or higher
- An xAI API key from [console.x.ai](https://console.x.ai/)

## Installation

```bash
git clone https://github.com/Balneario-de-Cofrentes/grok-mcp.git
cd grok-mcp
npm install
npm run build
```

Register the server in your MCP client:

```json
{
  "mcpServers": {
    "grok": {
      "command": "node",
      "args": ["/path/to/grok-mcp/build/index.js"],
      "env": {
        "XAI_API_KEY": "your-xai-api-key"
      }
    }
  }
}
```

## Usage

### X search

```json
{
  "query": "What are people saying about longevity clinics this week? 5 posts with handle, date and link.",
  "from_date": "2026-09-25"
}
```

```json
{
  "query": "What has the team announced this month?",
  "allowed_x_handles": ["xai"],
  "from_date": "2026-10-01"
}
```

### Web search

```json
{
  "query": "What changed in xAI API pricing in September 2026?",
  "allowed_domains": ["docs.x.ai"]
}
```

### Web and X in one request

```json
{
  "messages": [{ "role": "user", "content": "What is the reaction to the Galleri trial results?" }],
  "search_tools": ["web_search", "x_search"],
  "from_date": "2026-09-23"
}
```

### Image understanding

```json
{
  "image_url": "https://example.com/chart.png",
  "prompt": "What does this chart show?"
}
```

## API reference

### Shared parameters

| Parameter | Tools | Description |
|---|---|---|
| `depth` | all but `function_calling` | `quick` (default), `standard`, `deep`, `research` |
| `model` | all | Overrides the model chosen by `depth` |
| `reasoning_effort` | all but `function_calling` | `none`, `low`, `medium`, `high`, `xhigh`; overrides `depth` |
| `max_tokens` | all but `function_calling` | Cap on output tokens, reasoning included. Not sent to the multi-agent model |
| `max_turns` | search tools, `chat_completion` | Cap on search/reasoning turns |
| `enable_image_understanding` | search tools, `chat_completion` | Let the model look at images it finds |

### `x_search`

- `query` (required)
- `allowed_x_handles` / `excluded_x_handles`: up to 20 handles, mutually exclusive; a leading `@` is removed
- `from_date` / `to_date`: `YYYY-MM-DD`. Other formats are rejected because the API ignores them without an error
- `enable_video_understanding`

### `web_search`

- `query` (required)
- `allowed_domains` / `excluded_domains`: up to 5 domains, mutually exclusive

### `chat_completion`

- `messages` (required): `{ role, content }` objects
- `search_tools`: `"web_search"` and/or `"x_search"`; accepts every parameter of both search tools
- `temperature`

`search_parameters` was removed by xAI and is rejected with a message pointing to `search_tools`.

### `image_understanding`

- `prompt` (required)
- `image_url` or `base64_image` (one is required); `mime_type` for base64: `image/jpeg` (default) or `image/png`
- Images must be at least 8x8 pixels and at most 20 MiB

### `function_calling`

- `messages` (required), `tools` (required), `tool_choice` (`auto`, `required`, `none`), `model`
- Uses the Chat Completions endpoint. The multi-agent model does not support it.

## Errors

API errors include the status and the reason xAI returns, for example:

```
Error: xAI API 403 permission-denied: Your team has either used all available credits or reached its monthly spending limit.
```

## Development

### Project structure

- `src/index.ts`: MCP server and tool schemas
- `src/profiles.ts`: depth profiles and model selection
- `src/request.ts`: request building and validation
- `src/format.ts`: answer, sources, usage line and error formatting
- `src/grok-api-client.ts`: HTTP client
- `test/`: unit tests, run against the compiled build with Node's test runner

### Building and testing

```bash
npm run build
npm test
```

### Running

```bash
XAI_API_KEY="your-xai-api-key" node build/index.js
```

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## Acknowledgements

- [Model Context Protocol](https://github.com/modelcontextprotocol/mcp)
- [xAI API](https://docs.x.ai/)

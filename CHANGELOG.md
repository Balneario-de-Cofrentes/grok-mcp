# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [2.0.0] - 2026-10-02

### Added
- `x_search` and `web_search` tools with a plain `query` parameter
- `depth` profiles (`quick`, `standard`, `deep`, `research`) that choose model and reasoning effort
- X Search filters: `allowed_x_handles`, `excluded_x_handles`, `from_date`, `to_date`, `enable_video_understanding`
- `excluded_domains`, `enable_image_understanding`, `max_turns` and `reasoning_effort` parameters
- Usage line on every answer: model, effort, searches, posts fetched, tokens, cost and time
- Unit tests (`npm test`)

### Changed
- Default depth is `quick` (`grok-4.3` at low reasoning effort); `grok-4.7` runs from `standard` depth up. `grok-4-1-fast` was retired by xAI on 2026-05-15
- Chat and image understanding go through the Responses API
- API errors report the status and the reason returned by xAI
- `max_tokens` and `temperature` are sent only when given

### Removed
- `search_parameters` (removed by xAI); the tool now rejects it with a pointer to `search_tools`
- Logging of request headers, which wrote the API key to stderr on errors

## [1.0.0] - 2025-03-08

### Added
- Initial release
- Chat completion tool
- Image understanding tool
- Function calling tool
- Comprehensive documentation

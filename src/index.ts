#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
} from '@modelcontextprotocol/sdk/types.js';
import { GrokApiClient } from './grok-api-client.js';
import { formatApiError, formatResponse } from './format.js';
import { DEFAULT_DEPTH, DEPTHS, REASONING_EFFORTS, depthGuide, resolveModel } from './profiles.js';
import { ResponsesOptions, SEARCH_TOOLS, SearchTool, buildImageInput, buildResponsesRequest } from './request.js';

// Get API key from environment variable
const API_KEY = process.env.XAI_API_KEY;
if (!API_KEY) {
  throw new Error('[Error] XAI_API_KEY environment variable is required');
}

const stringList = (description: string) => ({ type: 'array', description, items: { type: 'string' } });

const MODEL_PROPERTIES = {
  depth: {
    type: 'string',
    description: `How much model and reasoning to spend. ${depthGuide()}`,
    enum: Object.keys(DEPTHS),
    default: DEFAULT_DEPTH,
  },
  model: {
    type: 'string',
    description:
      'Overrides the model chosen by depth. Current models: grok-4.7, grok-4.6, grok-4.5, grok-4.3, grok-4.20-multi-agent, grok-build-0.1.',
  },
  reasoning_effort: {
    type: 'string',
    description:
      'Overrides the reasoning effort chosen by depth. grok-4.7 accepts low to xhigh; only grok-4.3 accepts none. On grok-4.20-multi-agent, low/medium run 4 agents and high/xhigh run 16.',
    enum: REASONING_EFFORTS,
  },
  max_tokens: {
    type: 'integer',
    description: 'Cap on output tokens, reasoning included. Omit to use the API default.',
  },
};

const SEARCH_TUNING_PROPERTIES = {
  enable_image_understanding: {
    type: 'boolean',
    description: 'Let the model look at images it finds while searching. Billed as image tokens.',
  },
  max_turns: {
    type: 'integer',
    description: 'Cap on search/reasoning turns. 1-2 for quick lookups, 3-5 balanced, omit for the server default.',
  },
};

const WEB_SEARCH_PROPERTIES = {
  allowed_domains: stringList('Only search these domains (max 5). Cannot be combined with excluded_domains.'),
  excluded_domains: stringList('Never search these domains (max 5).'),
};

const X_SEARCH_PROPERTIES = {
  allowed_x_handles: stringList('Only consider posts from these X handles (max 20). Cannot be combined with excluded_x_handles.'),
  excluded_x_handles: stringList('Ignore posts from these X handles (max 20).'),
  from_date: {
    type: 'string',
    description: 'Earliest post date, YYYY-MM-DD. Narrowing the range reduces posts fetched and cost.',
  },
  to_date: {
    type: 'string',
    description: 'Latest post date, YYYY-MM-DD.',
  },
  enable_video_understanding: {
    type: 'boolean',
    description: 'Let the model watch videos in the posts it finds. Billed as tokens.',
  },
};

/** Input schema shared by x_search and web_search: a query, the source's own filters and the common tuning. */
const searchInputSchema = (sourceProperties: object) => ({
  type: 'object',
  properties: {
    query: {
      type: 'string',
      description: 'What to find out, in natural language. Say how many results and which fields you want.',
    },
    ...sourceProperties,
    ...SEARCH_TUNING_PROPERTIES,
    ...MODEL_PROPERTIES,
  },
  required: ['query'],
});

const messagesProperty = (roles: string[], extraProperties: object = {}) => ({
  type: 'array',
  description: 'Array of message objects with role and content',
  items: {
    type: 'object',
    properties: {
      role: {
        type: 'string',
        description: `Role of the message sender (${roles.join(', ')})`,
        enum: roles,
      },
      content: {
        type: 'string',
        description: 'Content of the message',
      },
      ...extraProperties,
    },
    required: ['role', 'content'],
  },
});

const TOOLS = [
  {
    name: 'x_search',
    description:
      'Search X (Twitter) with Grok: keyword and semantic post search, user search and thread fetch. Returns an answer with post links and a usage line. X Search bills $5 per 1,000 posts fetched, so cost follows how many posts the model reads: narrow with from_date/to_date and allowed_x_handles, and pick the lowest depth that answers the question.',
    inputSchema: searchInputSchema(X_SEARCH_PROPERTIES),
  },
  {
    name: 'web_search',
    description:
      'Search and browse the live web with Grok. Returns an answer with source links and a usage line. Costs about $0.02 to $0.03 per query.',
    inputSchema: searchInputSchema(WEB_SEARCH_PROPERTIES),
  },
  {
    name: 'chat_completion',
    description:
      'Generate a response with Grok from a list of messages. Pass search_tools to let it search the web, X or both in one request; without them Grok knows nothing after its training cutoff. For a single-source search prefer the x_search or web_search tools.',
    inputSchema: {
      type: 'object',
      properties: {
        messages: messagesProperty(['system', 'user', 'assistant']),
        search_tools: {
          type: 'array',
          description: 'Built-in search tools to enable: "web_search" and/or "x_search".',
          items: {
            type: 'string',
            enum: SEARCH_TOOLS,
          },
          default: [],
        },
        ...WEB_SEARCH_PROPERTIES,
        ...X_SEARCH_PROPERTIES,
        ...SEARCH_TUNING_PROPERTIES,
        ...MODEL_PROPERTIES,
        temperature: {
          type: 'number',
          description: 'Sampling temperature (0-2)',
          minimum: 0,
          maximum: 2,
        },
      },
      required: ['messages'],
    },
  },
  {
    name: 'image_understanding',
    description: 'Analyze an image with Grok vision. Accepts jpg/jpeg or png, up to 20 MiB.',
    inputSchema: {
      type: 'object',
      properties: {
        image_url: {
          type: 'string',
          description: 'Public URL that points directly to the image',
        },
        base64_image: {
          type: 'string',
          description: 'Base64-encoded image data (without the data:image prefix)',
        },
        mime_type: {
          type: 'string',
          description: 'MIME type of base64_image',
          enum: ['image/jpeg', 'image/png'],
          default: 'image/jpeg',
        },
        prompt: {
          type: 'string',
          description: 'Text prompt to accompany the image',
        },
        ...MODEL_PROPERTIES,
      },
      required: ['prompt'],
    },
  },
  {
    name: 'function_calling',
    description: 'Use Grok AI to call functions based on user input',
    inputSchema: {
      type: 'object',
      properties: {
        messages: messagesProperty(['system', 'user', 'assistant', 'tool'], {
          tool_call_id: {
            type: 'string',
            description: 'ID of the tool call (for tool messages)',
          },
        }),
        tools: {
          type: 'array',
          description: 'Array of tool objects with type, function name, description, and parameters',
          items: {
            type: 'object',
          },
        },
        tool_choice: {
          type: 'string',
          description: 'Tool choice mode (auto, required, none)',
          enum: ['auto', 'required', 'none'],
          default: 'auto',
        },
        model: MODEL_PROPERTIES.model,
      },
      required: ['messages', 'tools'],
    },
  },
];

/**
 * GrokMcpServer - MCP server for Grok AI API integration
 */
class GrokMcpServer {
  private server: Server;
  private grokClient: GrokApiClient;

  constructor(apiKey: string) {
    this.server = new Server(
      {
        name: 'grok-mcp',
        version: '2.0.0',
      },
      {
        capabilities: {
          tools: {},
        },
      }
    );

    this.grokClient = new GrokApiClient(apiKey);

    this.setupToolHandlers();

    this.server.onerror = (error) => console.error('[MCP Error]', error);
    process.on('SIGINT', async () => {
      await this.server.close();
      process.exit(0);
    });
  }

  /**
   * Set up the MCP tool handlers
   */
  private setupToolHandlers() {
    this.server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const args: any = request.params.arguments ?? {};
      try {
        switch (request.params.name) {
          case 'x_search':
            return await this.handleSearch(args, 'x_search');
          case 'web_search':
            return await this.handleSearch(args, 'web_search');
          case 'chat_completion':
            return await this.handleChatCompletion(args);
          case 'image_understanding':
            return await this.handleImageUnderstanding(args);
          case 'function_calling':
            return await this.handleFunctionCalling(args);
          default:
            throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${request.params.name}`);
        }
      } catch (error) {
        const message = formatApiError(error);
        console.error(`[Error] ${request.params.name}: ${message}`);
        return {
          content: [{ type: 'text', text: `Error: ${message}` }],
          isError: true,
        };
      }
    });
  }

  /** Sends a Responses API request and renders the answer, its sources and its cost. */
  private async respond(input: unknown[], options: ResponsesOptions) {
    const startedAt = Date.now();
    const response = await this.grokClient.createResponse(buildResponsesRequest(input, options));
    return {
      content: [{ type: 'text', text: formatResponse(response, Date.now() - startedAt) }],
    };
  }

  private async handleSearch(args: any, tool: SearchTool) {
    const { query, ...options } = args;
    if (typeof query !== 'string' || query.trim() === '') {
      throw new Error('query is required');
    }
    return this.respond([{ role: 'user', content: query }], { ...options, search_tools: [tool] });
  }

  private async handleChatCompletion(args: any) {
    const { messages, search_parameters, ...options } = args;
    if (search_parameters) {
      throw new Error(
        'search_parameters was removed by xAI. Pass search_tools: ["web_search", "x_search"] instead.'
      );
    }
    return this.respond(messages, options);
  }

  private async handleImageUnderstanding(args: any) {
    return this.respond(buildImageInput(args), args);
  }

  private async handleFunctionCalling(args: any) {
    const { messages, tools, tool_choice, model, ...otherOptions } = args;

    if (!Array.isArray(messages) || messages.length === 0) {
      throw new Error('Messages must be a non-empty array');
    }

    if (!Array.isArray(tools) || tools.length === 0) {
      throw new Error('Tools must be a non-empty array');
    }

    const response = await this.grokClient.createChatCompletion({
      ...otherOptions,
      messages,
      tools,
      tool_choice: tool_choice || 'auto',
      model: resolveModel({ model }).model,
    });

    const message = response.choices[0].message;
    return {
      content: [
        {
          type: 'text',
          text: message.tool_calls ? JSON.stringify({ message, usage: response.usage }, null, 2) : message.content,
        },
      ],
    };
  }

  /**
   * Run the MCP server
   */
  async run() {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error('[Setup] Grok MCP server running on stdio');
  }
}

const server = new GrokMcpServer(API_KEY);
server.run().catch(console.error);

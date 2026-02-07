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

// Get API key from environment variable
const API_KEY = process.env.XAI_API_KEY;
if (!API_KEY) {
  throw new Error('[Error] XAI_API_KEY environment variable is required');
}

/**
 * GrokMcpServer - MCP server for Grok AI API integration
 */
class GrokMcpServer {
  private server: Server;
  private grokClient: GrokApiClient;

  constructor() {
    console.error('[Setup] Initializing Grok MCP server...');
    
    this.server = new Server(
      {
        name: 'grok-mcp',
        version: '1.0.0',
      },
      {
        capabilities: {
          tools: {},
        },
      }
    );

    // Initialize Grok API client
    this.grokClient = new GrokApiClient(API_KEY as string);

    // Set up tool handlers
    this.setupToolHandlers();
    
    // Error handling
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
    // List available tools
    this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: [
        {
          name: 'chat_completion',
          description: 'Generate a response using Grok AI chat completion',
          inputSchema: {
            type: 'object',
            properties: {
              messages: {
                type: 'array',
                description: 'Array of message objects with role and content',
                items: {
                  type: 'object',
                  properties: {
                    role: {
                      type: 'string',
                      description: 'Role of the message sender (system, user, assistant)',
                      enum: ['system', 'user', 'assistant']
                    },
                    content: {
                      type: 'string',
                      description: 'Content of the message'
                    }
                  },
                  required: ['role', 'content']
                }
              },
              model: {
                type: 'string',
                description: 'Grok model to use. Options: grok-4-1-fast (2M context, reasoning, recommended), grok-4-1-fast-non-reasoning (2M context, fast), grok-code-fast-1 (256K context, coding), grok-3-mini-beta (economical)',
                default: 'grok-4-1-fast'
              },
              temperature: {
                type: 'number',
                description: 'Sampling temperature (0-2)',
                minimum: 0,
                maximum: 2,
                default: 1
              },
              max_tokens: {
                type: 'integer',
                description: 'Maximum number of tokens to generate',
                default: 16384
              },
              search_tools: {
                type: 'array',
                description: 'Enable built-in search tools via the Responses API. Array of tool types: "web_search" and/or "x_search". Example: ["web_search", "x_search"]. Omit or pass empty array to disable search.',
                items: {
                  type: 'string',
                  enum: ['web_search', 'x_search']
                },
                default: []
              },
              allowed_domains: {
                type: 'array',
                description: 'When using web_search, restrict results to these domains (e.g., ["wikipedia.org"])',
                items: { type: 'string' }
              }
            },
            required: ['messages']
          }
        },
        {
          name: 'image_understanding',
          description: 'Analyze images using Grok AI vision capabilities (Note: Grok 3 may support image creation)',
          inputSchema: {
            type: 'object',
            properties: {
              image_url: {
                type: 'string',
                description: 'URL of the image to analyze'
              },
              base64_image: {
                type: 'string',
                description: 'Base64-encoded image data (without the data:image prefix)'
              },
              prompt: {
                type: 'string',
                description: 'Text prompt to accompany the image'
              },
              model: {
                type: 'string',
                description: 'Grok vision model to use (e.g., grok-2-vision-latest, potentially grok-3 variants)',
                default: 'grok-2-vision-latest'
              }
            },
            required: ['prompt']
          }
        },
        {
          name: 'function_calling',
          description: 'Use Grok AI to call functions based on user input',
          inputSchema: {
            type: 'object',
            properties: {
              messages: {
                type: 'array',
                description: 'Array of message objects with role and content',
                items: {
                  type: 'object',
                  properties: {
                    role: {
                      type: 'string',
                      description: 'Role of the message sender (system, user, assistant, tool)',
                      enum: ['system', 'user', 'assistant', 'tool']
                    },
                    content: {
                      type: 'string',
                      description: 'Content of the message'
                    },
                    tool_call_id: {
                      type: 'string',
                      description: 'ID of the tool call (for tool messages)'
                    }
                  },
                  required: ['role', 'content']
                }
              },
              tools: {
                type: 'array',
                description: 'Array of tool objects with type, function name, description, and parameters',
                items: {
                  type: 'object'
                }
              },
              tool_choice: {
                type: 'string',
                description: 'Tool choice mode (auto, required, none)',
                enum: ['auto', 'required', 'none'],
                default: 'auto'
              },
              model: {
                type: 'string',
                description: 'Grok model to use (e.g., grok-2-latest, grok-3, grok-3-reasoner, grok-3-deepsearch, grok-3-mini-beta)',
                default: 'grok-3-mini-beta'
              }
            },
            required: ['messages', 'tools']
          }
        }
      ],
    }));

    // Handle tool calls
    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      try {
        switch (request.params.name) {
          case 'chat_completion':
            return await this.handleChatCompletion(request.params.arguments);
          case 'image_understanding':
            return await this.handleImageUnderstanding(request.params.arguments);
          case 'function_calling':
            return await this.handleFunctionCalling(request.params.arguments);
          default:
            throw new McpError(
              ErrorCode.MethodNotFound,
              `Unknown tool: ${request.params.name}`
            );
        }
      } catch (error: any) {
        console.error(`[Error] Tool call error: ${error.message}`);
        return {
          content: [
            {
              type: 'text',
              text: `Error: ${error.message}`,
            },
          ],
          isError: true,
        };
      }
    });
  }

  /**
   * Handle chat completion tool calls
   * @param args - Tool arguments
   * @returns Tool response
   */
  private async handleChatCompletion(args: any) {
    console.error('[Tool] Handling chat_completion tool call');

    const { messages, model, temperature, max_tokens, search_tools, allowed_domains, search_parameters, ...otherOptions } = args;

    // Validate messages
    if (!Array.isArray(messages) || messages.length === 0) {
      throw new Error('Messages must be a non-empty array');
    }

    // Determine if search is requested (support both new search_tools and legacy search_parameters)
    const hasSearchTools = Array.isArray(search_tools) && search_tools.length > 0;
    const hasLegacySearch = search_parameters && search_parameters.mode && search_parameters.mode !== 'off';

    if (hasSearchTools || hasLegacySearch) {
      // Route through Responses API with built-in tools
      console.error('[Tool] Using Responses API for search');

      let builtInTools: any[];
      if (hasSearchTools) {
        builtInTools = search_tools.map((t: string) => {
          const tool: any = { type: t };
          if (t === 'web_search' && allowed_domains && allowed_domains.length > 0) {
            tool.filters = { allowed_domains };
          }
          return tool;
        });
      } else {
        // Legacy fallback: map search_parameters to built-in tools
        builtInTools = [{ type: 'web_search' }, { type: 'x_search' }];
      }

      const options = {
        model: model || 'grok-4-1-fast',
        temperature: temperature !== undefined ? temperature : 1,
        max_tokens: max_tokens !== undefined ? max_tokens : 16384,
      };

      const response = await this.grokClient.createResponse(messages, builtInTools, options);

      // Extract text from the Responses API output
      const text = this.extractResponseText(response);
      const citations = this.extractCitations(response);

      return {
        content: [
          {
            type: 'text',
            text: citations ? `${text}\n\n${citations}` : text,
          },
        ],
      };
    }

    // Standard chat completion (no search)
    const options = {
      model: model || 'grok-4-1-fast',
      temperature: temperature !== undefined ? temperature : 1,
      max_tokens: max_tokens !== undefined ? max_tokens : 16384,
      ...otherOptions
    };

    const response = await this.grokClient.createChatCompletion(messages, options);

    return {
      content: [
        {
          type: 'text',
          text: response.choices[0].message.content,
        },
      ],
    };
  }

  /**
   * Extract text content from Responses API output
   */
  private extractResponseText(response: any): string {
    if (!response.output) return '';
    for (const item of response.output) {
      if (item.type === 'message' && item.content) {
        for (const block of item.content) {
          if (block.type === 'output_text') {
            return block.text;
          }
        }
      }
    }
    return '';
  }

  /**
   * Extract citations from Responses API output
   */
  private extractCitations(response: any): string {
    if (!response.output) return '';
    for (const item of response.output) {
      if (item.type === 'message' && item.content) {
        for (const block of item.content) {
          if (block.annotations && block.annotations.length > 0) {
            const urls = block.annotations
              .filter((a: any) => a.type === 'url_citation')
              .map((a: any) => a.url);
            if (urls.length > 0) {
              const unique = [...new Set(urls)] as string[];
              return 'Sources:\n' + unique.map((u) => `- ${u}`).join('\n');
            }
          }
        }
      }
    }
    return '';
  }

  /**
   * Handle image understanding tool calls
   * @param args - Tool arguments
   * @returns Tool response
   */
  private async handleImageUnderstanding(args: any) {
    console.error('[Tool] Handling image_understanding tool call');
    
    const { image_url, base64_image, prompt, model, ...otherOptions } = args;
    
    // Validate inputs
    if (!prompt) {
      throw new Error('Prompt is required');
    }
    
    if (!image_url && !base64_image) {
      throw new Error('Either image_url or base64_image is required');
    }
    
    // Prepare message content
    const content: any[] = [];
    
    // Add image
    if (image_url) {
      content.push({
        type: 'image_url',
        image_url: {
          url: image_url,
          detail: 'high',
        },
      });
    } else if (base64_image) {
      content.push({
        type: 'image_url',
        image_url: {
          url: `data:image/jpeg;base64,${base64_image}`,
          detail: 'high',
        },
      });
    }
    
    // Add text prompt
    content.push({
      type: 'text',
      text: prompt,
    });
    
    // Create messages array
    const messages = [
      {
        role: 'user',
        content,
      },
    ];
    
    // Create options object
    const options = {
      model: model || 'grok-2-vision-latest',
      ...otherOptions
    };
    
    // Call Grok API
    const response = await this.grokClient.createImageUnderstanding(messages, options);
    
    return {
      content: [
        {
          type: 'text',
          text: response.choices[0].message.content,
        },
      ],
    };
  }

  /**
   * Handle function calling tool calls
   * @param args - Tool arguments
   * @returns Tool response
   */
  private async handleFunctionCalling(args: any) {
    console.error('[Tool] Handling function_calling tool call');
    
    const { messages, tools, tool_choice, model, ...otherOptions } = args;
    
    // Validate inputs
    if (!Array.isArray(messages) || messages.length === 0) {
      throw new Error('Messages must be a non-empty array');
    }
    
    if (!Array.isArray(tools) || tools.length === 0) {
      throw new Error('Tools must be a non-empty array');
    }
    
    // Create options object
    const options = {
      model: model || 'grok-4-1-fast',
      tool_choice: tool_choice || 'auto',
      ...otherOptions
    };
    
    // Call Grok API
    const response = await this.grokClient.createFunctionCall(messages, tools, options);
    
    // Check if there are tool calls in the response
    if (response.choices[0].message.tool_calls) {
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              message: response.choices[0].message,
              usage: response.usage
            }, null, 2),
          },
        ],
      };
    } else {
      return {
        content: [
          {
            type: 'text',
            text: response.choices[0].message.content,
          },
        ],
      };
    }
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

// Create and run the server
const server = new GrokMcpServer();
server.run().catch(console.error);

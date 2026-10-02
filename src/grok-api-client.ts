import axios, { AxiosInstance } from 'axios';

/** Reasoning models with server-side search can run for minutes. */
const REQUEST_TIMEOUT_MS = 15 * 60 * 1000;

/**
 * GrokApiClient - A client for interacting with the xAI API
 */
export class GrokApiClient {
  private axiosInstance: AxiosInstance;

  constructor(apiKey: string, baseURL: string = 'https://api.x.ai/v1') {
    this.axiosInstance = axios.create({
      baseURL,
      timeout: REQUEST_TIMEOUT_MS,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
    });
  }

  /** Responses API: text, image input and the built-in web_search / x_search tools. */
  async createResponse(body: object): Promise<any> {
    return this.post('/responses', body);
  }

  /** Chat Completions API (legacy), kept for client-side function calling. */
  async createChatCompletion(body: object): Promise<any> {
    return this.post('/chat/completions', body);
  }

  private async post(path: string, body: object): Promise<any> {
    const response = await this.axiosInstance.post(path, body);
    return response.data;
  }
}

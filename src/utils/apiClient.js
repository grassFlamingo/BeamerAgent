import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import config from '../config.js';
import fs from 'fs';
import path from 'path';
import { log as _log } from './logger.js';

/**
 * MessageBuilder - Helper class for creating OpenAI-style messages
 * Simplifies message creation for multi-turn conversations
 */
export class MessageBuilder {
  static user(content) {
    if (typeof content === 'string') {
      return { role: 'user', content };
    }
    return { role: 'user', content };
  }

  static system(content) {
    return { role: 'system', content };
  }

  static assistant(content, toolCalls = null) {
    const msg = { role: 'assistant', content: content || '' };
    if (toolCalls) {
      msg.tool_calls = toolCalls;
    }
    return msg;
  }

  static tool(toolCallId, content) {
    return {
      role: 'tool',
      tool_call_id: toolCallId,
      content: typeof content === 'string' ? content : JSON.stringify(content)
    };
  }

  static textContent(text) {
    return { type: 'text', text };
  }

  static imageContent(base64Data, mimeType = 'image/png') {
    return {
      type: 'image_url',
      image_url: {
        url: `data:${mimeType};base64,${base64Data}`
      }
    };
  }

  static imageFromFile(filePath) {
    const ext = path.extname(filePath).toLowerCase();
    const mimeTypes = {
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.gif': 'image/gif',
      '.webp': 'image/webp'
    };
    const mimeType = mimeTypes[ext] || 'image/png';
    const imageData = fs.readFileSync(filePath);
    const base64Data = imageData.toString('base64');
    return this.imageContent(base64Data, mimeType);
  }

  static userWithImage(imagePath, text) {
    return {
      role: 'user',
      content: [this.textContent(text), this.imageFromFile(imagePath)]
    };
  }

  static userWithImages(imagePaths, text) {
    const content = imagePaths.map(p => this.imageFromFile(p));
    if (text) {
      content.push(this.textContent(text));
    }
    return { role: 'user', content };
  }
}

/**
 * ChatSession - A simple, user-friendly interface for multi-turn conversations
 * Automatically manages message history and tool calling
 * 
 * @example
 * const chat = new ChatSession(
 *   'You are a helpful assistant.',
 *   tools,
 *   { model: 'gpt-4o' }
 * );
 * 
 * const response1 = await chat.generate('Hello!');
 * // or with image: await chat.generateImage('image.png', 'Describe this');
 * 
 * const response2 = await chat.generate('Tell me more.');
 */
export class ChatSession {
  constructor(systemPrompt, tools = [], tool_handlers = {}, options = {}) {
    this.conversation = [MessageBuilder.system(systemPrompt)];
    this._tools = tools;
    this._toolHandlers = tool_handlers;
    this._options = options;
    this._apiClient = null;
  }

  _getApiClient() {
    if (!this._apiClient) {
      this._apiClient = this._options.apiClient || new APIClient();
    }
    return this._apiClient;
  }

  async generate(userMessage, options = {}) {
    const client = this._getApiClient();
    const hasTools = this._tools.length > 0 && Object.keys(this._toolHandlers).length > 0;

    this.conversation.push(MessageBuilder.user(userMessage));

    let response;
    if (hasTools) {
      const result = await client.generateWithTools(
        this.conversation,
        this._tools,
        { ...this._options, ...options, toolHandlers: this._toolHandlers }
      );
      // result is { content, messages } - update conversation with full message history
      this.conversation = result.messages;
      response = result.content;
    } else {
      response = await client.generateText(
        this.conversation,
        { ...this._options, ...options }
      );
      this.conversation.push(MessageBuilder.assistant(response));
    }

    return response;
  }

  async generateImage(imagePath, textPrompt, options = {}) {
    const client = this._getApiClient();

    // this.conversation.addUserWithImage(imagePath, textPrompt);
    this.conversation.push(MessageBuilder.userWithImage(imagePath, textPrompt));

    const response = await client.analyzeImageWithMessages(
      this.conversation.getMessages(),
      { ...this._options, ...options }
    );

    this.conversation.push(MessageBuilder.assistant(response));
    return response;
  }

  onTool(toolName, handler) {
    this._toolHandlers[toolName] = handler;
    return this;
  }

  get history() {
    return this.conversation;
  }

  get turns() {
    return this.conversation.length;
  }

  clear() {
    this.conversation.clear();
    return this;
  }

  reset() {
    this.conversation.clear();
    return this;
  }

  static from(tools, options = {}) {
    return (systemPrompt) => new ChatSession(systemPrompt, tools, options);
  }
}

/**
 * JSONResponseParser - Utility for extracting and parsing JSON from model responses
 */
class JSONResponseParser {
  /**
   * Extract JSON from response content
   * Tries multiple strategies: code block extraction, JSON object matching
   * @param {string} content - Response content
   * @param {string} requiredKey - Optional key that must exist in JSON (e.g., 'slides', 'latex')
   * @returns {object|null} - Parsed JSON object or null if extraction fails
   */
  static extractJSON(content, requiredKey = null) {
    if (!content) {
      this.log.warn('extractJSON called with empty content');
      return null;
    }

    this.log.debug('Attempting to extract JSON from response...');
    let jsonStr = content.trim();

    // Strategy 1: Extract from markdown code block
    const codeBlockMatch = jsonStr.match(/```json\s*([\s\S]*?)```/);
    if (codeBlockMatch) {
      this.log.debug('Found JSON in markdown code block');
      jsonStr = codeBlockMatch[1];
    } else {
      // Strategy 2: Find JSON object with required key using brace counting
      if (requiredKey) {
        const extracted = this._extractJSONWithKey(jsonStr, requiredKey);
        if (extracted) {
          this.log.debug(`Found JSON object with required key: "${requiredKey}"`);
          jsonStr = extracted;
        } else {
          this.log.warn(`No JSON object found with key: "${requiredKey}"`);
        }
      } else {
        // Strategy 3: Find any JSON object using brace counting
        const extracted = this._extractFirstJSONObject(jsonStr);
        if (extracted) {
          this.log.debug('Found JSON object by pattern matching');
          jsonStr = extracted;
        }
      }
    }

    this.log.debug(`Extracted JSON string length: ${jsonStr.length} chars`);

    try {
      const parsed = JSON.parse(jsonStr);
      this.log.success(`Successfully parsed JSON. Keys: ${Object.keys(parsed).join(', ')}`);
      return parsed;
    } catch (error) {
      this.log.error(`Failed to parse JSON: ${error.message}`);
      this.log.error(`Content type: ${typeof content}`);
      this.log.error(`Content length: ${content.length} chars`);
      this.log.error(`JSON string length: ${jsonStr.length} chars`);
      this.log.error(`JSON string preview: ${jsonStr}`);
      this.log.error(`Required key: ${requiredKey || 'none'}`);
      return null;
    }
  }

  /**
   * Extract the first complete JSON object from content using brace counting
   * @param {string} content - Content to search
   * @returns {string|null} - Extracted JSON string or null
   */
  static _extractFirstJSONObject(content) {
    let braceCount = 0;
    let inString = false;
    let escape = false;
    let startIndex = -1;

    for (let i = 0; i < content.length; i++) {
      const char = content[i];

      if (escape) {
        escape = false;
        continue;
      }

      if (char === '\\') {
        escape = true;
        continue;
      }

      if (char === '"' && !escape) {
        inString = !inString;
        continue;
      }

      if (!inString) {
        if (char === '{') {
          if (braceCount === 0) {
            startIndex = i;
          }
          braceCount++;
        } else if (char === '}') {
          braceCount--;
          if (braceCount === 0 && startIndex !== -1) {
            return content.substring(startIndex, i + 1);
          }
        }
      }
    }

    return null;
  }

  /**
   * Extract JSON object containing a specific key using brace counting
   * @param {string} content - Content to search
   * @param {string} requiredKey - Key that must be in the JSON object
   * @returns {string|null} - Extracted JSON string or null
   */
  static _extractJSONWithKey(content, requiredKey) {
    // First find the position of the required key
    const keyPattern = `"${requiredKey}"`;
    const keyIndex = content.indexOf(keyPattern);
    if (keyIndex === -1) {
      return null;
    }

    // Find the start of the JSON object (go backwards from key to find opening brace)
    let braceCount = 0;
    let inString = false;
    let escape = false;
    let startIndex = -1;

    for (let i = keyIndex; i >= 0; i--) {
      const char = content[i];

      if (escape) {
        escape = false;
        continue;
      }

      if (char === '\\') {
        escape = true;
        continue;
      }

      if (char === '"' && !escape) {
        inString = !inString;
        continue;
      }

      if (!inString) {
        if (char === '}') {
          braceCount++;
        } else if (char === '{') {
          braceCount--;
          if (braceCount === 0) {
            startIndex = i;
            break;
          }
        }
      }
    }

    if (startIndex === -1) {
      return null;
    }

    // Now find the end of the JSON object (go forwards from key)
    braceCount = 0;
    inString = false;
    escape = false;

    for (let i = startIndex; i < content.length; i++) {
      const char = content[i];

      if (escape) {
        escape = false;
        continue;
      }

      if (char === '\\') {
        escape = true;
        continue;
      }

      if (char === '"' && !escape) {
        inString = !inString;
        continue;
      }

      if (!inString) {
        if (char === '{') {
          braceCount++;
        } else if (char === '}') {
          braceCount--;
          if (braceCount === 0) {
            return content.substring(startIndex, i + 1);
          }
        }
      }
    }

    return null;
  }

  /**
   * Parse JSON response with validation
   * @param {string} content - Response content
   * @param {string} requiredKey - Required key in the JSON response
   * @returns {object} - Parsed JSON object
   * @throws {Error} If JSON parsing fails or required key is missing
   */
  static parseJSON(content, requiredKey = null) {
    this.log.debug(`parseJSON called with requiredKey: ${requiredKey || 'none'}`);
    const parsed = this.extractJSON(content, requiredKey);
    if (!parsed) {
      this.log.error(`extractJSON returned null for requiredKey: ${requiredKey}`);
      throw new Error('Failed to parse JSON response');
    }
    if (requiredKey && !(requiredKey in parsed)) {
      this.log.error(`Parsed JSON missing required key "${requiredKey}". Available keys: ${Object.keys(parsed).join(', ')}`);
      throw new Error(`JSON response missing required key: ${requiredKey}`);
    }
    this.log.success(`parseJSON successful. Keys: ${Object.keys(parsed).join(', ')}`);
    return parsed;
  }

  /**
   * Safely parse JSON, returning null on failure
   * @param {string} content - Response content
   * @param {string} requiredKey - Optional required key
   * @returns {object|null} - Parsed JSON or null
   */
  static safeParse(content, requiredKey = null) {
    try {
      return this.parseJSON(content, requiredKey);
    } catch (error) {
      this.log.warn(`Safe parse failed: ${error.message}`);
      this.log.warn(`Stack trace: ${error.stack}`);
      return null;
    }
  }
}

class BaseAPIClient {
  constructor() {
    this.log = _log.create(this.constructor.name);
  }

  async generateText(prompt, systemPrompt = null, options = {}) {
    throw new Error('Not implemented');
  }

  async generateTextLegacy(prompt, systemPrompt = null, options = {}) {
    throw new Error('Not implemented');
  }

  async generateWithTools(messages, tools = [], options = {}) {
    throw new Error('Not implemented');
  }

  async generateWithToolsLegacy(prompt, systemPrompt = null, tools = [], options = {}) {
    throw new Error('Not implemented');
  }

  async analyzeImage(imagePath, prompt, systemPrompt = null, options = {}) {
    throw new Error('Not implemented');
  }

  async analyzeImageWithMessages(messages, options = {}) {
    throw new Error('Not implemented');
  }

  getMimeType(filePath) {
    const ext = path.extname(filePath).toLowerCase();
    const mimeTypes = {
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.gif': 'image/gif',
      '.webp': 'image/webp',
    };
    return mimeTypes[ext] || 'image/png';
  }
}

class AnthropicAPIClient extends BaseAPIClient {
  constructor() {
    super();
    const clientOptions = {
      apiKey: config.anthropic.apiKey,
    };
    if (config.anthropic.baseUrl) {
      clientOptions.baseURL = config.anthropic.baseUrl;
    }
    if (config.anthropic.timeout) {
      clientOptions.timeout = config.anthropic.timeout;
    }
    this.client = new Anthropic(clientOptions);
  }

  async generateText(prompt, systemPrompt = null, options = {}) {
    const messages = [
      {
        role: 'user',
        content: prompt,
      },
    ];

    const requestOptions = {
      model: options.model || config.anthropic.model,
      max_tokens: options.max_tokens || config.anthropic.maxTokens,
      temperature: options.temperature ?? config.anthropic.temperature,
      messages,
    };

    if (systemPrompt) {
      requestOptions.system = systemPrompt;
    }

    const timeout = options.timeout || config.anthropic.timeout;
    const response = await this.client.messages.create(requestOptions, { timeout });
    return response.content[0].text;
  }

  async analyzeImage(imagePath, prompt, systemPrompt = null, options = {}) {
    const imageData = fs.readFileSync(imagePath);
    const base64Image = imageData.toString('base64');
    const mimeType = this.getMimeType(imagePath);

    const messages = [
      {
        role: 'user',
        content: [
          {
            type: 'image',
            source: {
              type: 'base64',
              media_type: mimeType,
              data: base64Image,
            },
          },
          {
            type: 'text',
            text: prompt,
          },
        ],
      },
    ];

    const requestOptions = {
      model: options.model || config.anthropic.visionModel,
      max_tokens: options.max_tokens || config.anthropic.maxTokens,
      temperature: options.temperature ?? config.anthropic.temperature,
      messages,
    };

    if (systemPrompt) {
      requestOptions.system = systemPrompt;
    }

    const timeout = options.timeout || config.anthropic.timeout;
    const response = await this.client.messages.create(requestOptions, { timeout });
    return response.content[0].text;
  }

  async analyzeImageWithMessages(messages, options = {}) {
    const systemMessage = messages.find(m => m.role === 'system');
    const userMessages = messages.filter(m => m.role === 'user');

    let combinedContent = [];
    for (const msg of userMessages) {
      if (Array.isArray(msg.content)) {
        combinedContent.push(...msg.content);
      } else if (typeof msg.content === 'string') {
        combinedContent.push({ type: 'text', text: msg.content });
      }
    }

    const requestMessages = [{
      role: 'user',
      content: combinedContent
    }];

    const requestOptions = {
      model: options.model || config.anthropic.visionModel,
      max_tokens: options.max_tokens || config.anthropic.maxTokens,
      temperature: options.temperature ?? config.anthropic.temperature,
      messages: requestMessages,
    };

    if (systemMessage) {
      requestOptions.system = systemMessage.content;
    }

    const timeout = options.timeout || config.anthropic.timeout;
    const response = await this.client.messages.create(requestOptions, { timeout });
    return response.content[0].text;
  }
}

class OpenAIAPIClient extends BaseAPIClient {
  constructor() {
    super();
    const modelConfig = config.openai.textModel;
    const clientOptions = {
      apiKey: modelConfig.apiKey,
      baseURL: modelConfig.baseUrl,
    };
    if (config.openai.timeout) {
      clientOptions.timeout = config.openai.timeout;
    }
    this.client = new OpenAI(clientOptions);
  }

  async generateText(messages, options = {}) {
    const modelConfig = config.openai.textModel;

    const requestOptions = {
      model: options.model || modelConfig.modelName,
      messages,
      max_tokens: options.max_tokens || config.openai.maxTokens,
      temperature: options.temperature ?? config.openai.temperature,
    };

    if (modelConfig.enableThinking !== undefined) {
      requestOptions.enable_thinking = modelConfig.enableThinking;
    }

    const timeout = options.timeout || modelConfig.timeout || config.openai.timeout;
    // this.log.debug(requestOptions);
    const response = await this.client.chat.completions.create(requestOptions, { timeout });
    return response.choices[0].message.content;
  }

  async generateTextLegacy(prompt, systemPrompt = null, options = {}) {
    const modelConfig = config.openai.textModel;
    const messages = [];

    if (systemPrompt) {
      messages.push({
        role: 'system',
        content: systemPrompt,
      });
    }

    messages.push({
      role: 'user',
      content: [
        {
          type: 'text',
          text: prompt,
        },
      ],
    });

    return this.generateText(messages, options);
  }

  /**
   * Generate response with tool calling support
   * @param {Array} messages - Conversation messages
   * @param {Array} tools - Tool definitions
   * @param {object} options - Options including toolHandlers
   * @returns {Promise<{content: string, messages: Array}>} - Object with final content and full message history
   */
  async generateWithTools(messages, tools = [], options = {}) {
    const modelConfig = config.openai.textModel;
    const maxTurns = options.maxTurns || 64;
    const model = options.model || modelConfig.modelName;
    const toolHandlers = options.toolHandlers || {};

    const toolCallStats = {};
    let finalContent = '';

    for (let turn = 0; turn < maxTurns; turn++) {
      const requestOptions = {
        model,
        messages,
        max_tokens: options.max_tokens || config.openai.maxTokens,
        temperature: options.temperature ?? config.openai.temperature,
      };

      if (tools.length > 0) {
        requestOptions.tools = tools;
        if (options.toolChoice) {
          requestOptions.tool_choice = options.toolChoice;
        }
      }

      const timeout = options.timeout || modelConfig.timeout || config.openai.timeout;
      // this.log.debug(requestOptions);
      this.log.debug(`[Turn ${turn + 1}] Sending ${messages.length} messages to API`);

      const response = await this.client.chat.completions.create(requestOptions, { timeout });
      const message = response.choices[0].message;

      if (message.tool_calls && message.tool_calls.length > 0) {
        messages.push({
          role: 'assistant',
          content: message.content,
          tool_calls: message.tool_calls,
        });

        for (const toolCall of message.tool_calls) {
          const toolName = toolCall.function.name;
          const toolArgs = JSON.parse(toolCall.function.arguments || '{}');

          toolCallStats[toolName] = (toolCallStats[toolName] || 0) + 1;
          this.log.info(`[Tool Call] ${toolName} (turn ${turn + 1}/${maxTurns})`);
          this.log.debug(`[Tool Args] ${JSON.stringify(toolArgs)}`);

          let toolResult;
          if (toolHandlers[toolName]) {
            try {
              toolResult = await toolHandlers[toolName](toolArgs);
              this.log.debug(`[Tool Result] ${toolName} succeeded`);
            } catch (error) {
              this.log.error(`[Tool Error] ${toolName}: ${error.message}`);
              toolResult = { success: false, error: error.message };
            }
          } else {
            this.log.warn(`[Tool Error] Unknown tool: ${toolName}`);
            toolResult = { success: false, error: `Unknown tool: ${toolName}` };
          }

          messages.push({
            role: 'tool',
            tool_call_id: toolCall.id,
            content: JSON.stringify(toolResult),
          });
        }

        this.log.debug(`[Turn ${turn + 1}] Tool calls executed, continuing to next turn...`);
      } else {
        finalContent = message.content || '';

        if (Object.keys(toolCallStats).length > 0) {
          const stats = Object.entries(toolCallStats).map(([name, count]) => `${name}: ${count}`).join(', ');
          const total = Object.values(toolCallStats).reduce((a, b) => a + b, 0);
          this.log.info(`[Tool Usage] Total: ${total} calls (${stats})`);
        }

        this.log.debug(`[Turn ${turn + 1}] No more tool calls, returning content (${finalContent.length} chars)`);
        return { content: finalContent, messages };
      }
    }

    if (Object.keys(toolCallStats).length > 0) {
      const stats = Object.entries(toolCallStats).map(([name, count]) => `${name}: ${count}`).join(', ');
      const total = Object.values(toolCallStats).reduce((a, b) => a + b, 0);
      this.log.warn(`[Tool Usage] Max turns (${maxTurns}) reached. Total: ${total} calls (${stats})`);
    } else {
      this.log.warn(`[Turn ${maxTurns}] Reached max turns without tool calls`);
    }

    return { content: messages[messages.length - 1].content || finalContent, messages };
  }

  /**
   * Analyze an image using OpenAI's vision capabilities
   * @param {string} imagePath - Path to the image file
   * @param {string} prompt - Text prompt/question about the image
   * @param {string} systemPrompt - Optional system prompt
   * @param {object} options - Additional options
   * @returns {Promise<string>} - Analysis result
   */
  async analyzeImage(imagePath, prompt, systemPrompt = null, options = {}) {
    const imageData = fs.readFileSync(imagePath);
    const base64Image = imageData.toString('base64');
    const mimeType = this.getMimeType(imagePath);

    const messages = [];

    if (systemPrompt) {
      messages.push({ role: 'system', content: systemPrompt });
    }

    messages.push({
      role: 'user',
      content: [
        {
          type: 'text',
          text: prompt
        },
        {
          type: 'image_url',
          image_url: {
            url: `data:${mimeType};base64,${base64Image}`
          }
        }
      ]
    });

    const modelConfig = config.openai.textModel;
    const requestOptions = {
      model: options.model || modelConfig.modelName,
      messages,
      max_tokens: options.max_tokens || config.openai.maxTokens,
      temperature: options.temperature ?? config.openai.temperature,
    };

    const timeout = options.timeout || modelConfig.timeout || config.openai.timeout;
    this.log.debug(`Analyzing image: ${imagePath}`);
    const response = await this.client.chat.completions.create(requestOptions, { timeout });
    return response.choices[0].message.content;
  }

  /**
   * Analyze image with pre-built messages array
   * @param {Array} messages - Messages array with image content
   * @param {object} options - Additional options
   * @returns {Promise<string>} - Analysis result
   */
  async analyzeImageWithMessages(messages, options = {}) {
    const modelConfig = config.openai.textModel;
    const systemMessage = messages.find(m => m.role === 'system');
    
    const requestOptions = {
      model: options.model || modelConfig.modelName,
      messages,
      max_tokens: options.max_tokens || config.openai.maxTokens,
      temperature: options.temperature ?? config.openai.temperature,
    };

    const timeout = options.timeout || modelConfig.timeout || config.openai.timeout;
    this.log.debug(`Analyzing image with messages: ${messages.length} messages`);
    const response = await this.client.chat.completions.create(requestOptions, { timeout });
    return response.choices[0].message.content;
  }

  /**
   * Generate response with tool calling support (legacy signature with prompt/systemPrompt)
   * @param {string} prompt - User prompt
   * @param {string} systemPrompt - System prompt
   * @param {Array} tools - Tool definitions
   * @param {object} options - Options including toolHandlers
   * @returns {Promise<{content: string, messages: Array}>} - Object with final content and full message history
   */
  async generateWithToolsLegacy(prompt, systemPrompt = null, tools = [], options = {}) {
    const modelConfig = config.openai.textModel;
    const maxTurns = options.maxTurns || 64;
    const model = options.model || modelConfig.modelName;
    const toolHandlers = options.toolHandlers || {};

    const messages = [];

    if (systemPrompt) {
      messages.push({ role: 'system', content: systemPrompt });
    }

    messages.push({ role: 'user', content: prompt });

    const toolCallStats = {};
    let finalContent = '';

    for (let turn = 0; turn < maxTurns; turn++) {
      const requestOptions = {
        model,
        messages,
        max_tokens: options.max_tokens || config.openai.maxTokens,
        temperature: options.temperature ?? config.openai.temperature,
      };

      if (tools.length > 0) {
        requestOptions.tools = tools;
        if (options.toolChoice) {
          requestOptions.tool_choice = options.toolChoice;
        }
      }

      const timeout = options.timeout || modelConfig.timeout || config.openai.timeout;
      this.log.debug(requestOptions);
      this.log.debug(`[Turn ${turn + 1}] Sending ${messages.length} messages to API`);

      const response = await this.client.chat.completions.create(requestOptions, { timeout });
      const message = response.choices[0].message;

      if (message.tool_calls && message.tool_calls.length > 0) {
        messages.push({
          role: 'assistant',
          content: message.content,
          tool_calls: message.tool_calls,
        });

        for (const toolCall of message.tool_calls) {
          const toolName = toolCall.function.name;
          const toolArgs = JSON.parse(toolCall.function.arguments || '{}');

          toolCallStats[toolName] = (toolCallStats[toolName] || 0) + 1;
          this.log.info(`[Tool Call] ${toolName} (turn ${turn + 1}/${maxTurns})`);
          this.log.debug(`[Tool Args] ${JSON.stringify(toolArgs)}`);

          let toolResult;
          if (toolHandlers[toolName]) {
            try {
              toolResult = await toolHandlers[toolName](toolArgs);
              this.log.debug(`[Tool Result] ${toolName} succeeded`);
            } catch (error) {
              this.log.error(`[Tool Error] ${toolName}: ${error.message}`);
              toolResult = { success: false, error: error.message };
            }
          } else {
            this.log.warn(`[Tool Error] Unknown tool: ${toolName}`);
            toolResult = { success: false, error: `Unknown tool: ${toolName}` };
          }

          messages.push({
            role: 'tool',
            tool_call_id: toolCall.id,
            content: JSON.stringify(toolResult),
          });
        }

        this.log.debug(`[Turn ${turn + 1}] Tool calls executed, continuing to next turn...`);
      } else {
        finalContent = message.content || '';

        if (Object.keys(toolCallStats).length > 0) {
          const stats = Object.entries(toolCallStats).map(([name, count]) => `${name}: ${count}`).join(', ');
          const total = Object.values(toolCallStats).reduce((a, b) => a + b, 0);
          this.log.info(`[Tool Usage] Total: ${total} calls (${stats})`);
        }

        this.log.debug(`[Turn ${turn + 1}] No more tool calls, returning content (${finalContent.length} chars)`);
        return { content: finalContent, messages };
      }
    }

    if (Object.keys(toolCallStats).length > 0) {
      const stats = Object.entries(toolCallStats).map(([name, count]) => `${name}: ${count}`).join(', ');
      const total = Object.values(toolCallStats).reduce((a, b) => a + b, 0);
      this.log.warn(`[Tool Usage] Max turns (${maxTurns}) reached. Total: ${total} calls (${stats})`);
    } else {
      this.log.warn(`[Turn ${maxTurns}] Reached max turns without tool calls`);
    }

    return { content: messages[messages.length - 1].content || finalContent, messages };
  }

  /**
   * Generate content using OpenAI Responses API with tool support
   * @param {string} prompt - User prompt
   * @param {string} systemPrompt - System prompt (optional)
   * @param {array} tools - Array of tool definitions (e.g., [{type: "image_generation"}])
   * @param {object} options - Request options
   * @returns {Promise<{text: string, images: Array<{base64: string}>}>}
   */
  async generateWithResponses(prompt, systemPrompt = null, tools = [], options = {}) {
    const modelConfig = config.openai.textModel;
    const model = options.model || modelConfig.modelName;

    const requestOptions = {
      model,
      input: prompt,
      tools: tools || [],
    };

    if (systemPrompt) {
      requestOptions.instructions = systemPrompt;
    }

    const timeout = options.timeout || modelConfig.timeout || config.openai.timeout;
    this.log.debug(`Responses API request: ${JSON.stringify(requestOptions, null, 2)}`);

    const response = await this.client.responses.create(requestOptions, { timeout });

    // Extract text output
    const textOutput = response.output
      .filter((out) => out.type === 'message')
      .map((out) => out.content?.[0]?.text || '')
      .join('');

    // Extract generated images
    const images = response.output
      .filter((out) => out.type === 'image_generation_call')
      .map((out) => ({
        base64: out.result,
        type: 'image/png',
      }));

    this.log.info(`Responses API: received ${images.length} image(s), ${textOutput.length} chars of text`);

    return {
      text: textOutput,
      images,
      rawResponse: response,
    };
  }

  async _executeToolCall(toolCall, toolHandlers) {
    const toolName = toolCall.function.name;
    const args = JSON.parse(toolCall.function.arguments || '{}');

    this.log.debug(`Executing tool: ${toolName}`);

    if (toolHandlers[toolName]) {
      try {
        const result = await toolHandlers[toolName](args);
        return { success: true, result };
      } catch (error) {
        this.log.error(`Tool ${toolName} failed: ${error.message}`);
        return { success: false, error: error.message };
      }
    }

    return { success: false, error: `Unknown tool: ${toolName}` };
  }

  async analyzeImage(imagePath, prompt, systemPrompt = null, options = {}) {
    const modelConfig = config.openai.visionModel;
    const imageData = fs.readFileSync(imagePath);
    const base64Image = imageData.toString('base64');
    const mimeType = this.getMimeType(imagePath);

    const messages = [];

    if (systemPrompt) {
      messages.push({
        role: 'system',
        content: systemPrompt,
      });
    }

    messages.push({
      role: 'user',
      content: [
        {
          type: 'text',
          text: prompt,
        },
        {
          type: 'image_url',
          image_url: {
            url: `data:${mimeType};base64,${base64Image}`,
          },
        },
      ],
    });

    const requestOptions = {
      model: options.model || modelConfig.modelName,
      messages,
      max_tokens: options.max_tokens || config.openai.maxTokens,
      temperature: options.temperature ?? config.openai.temperature,
    };

    const timeout = options.timeout || modelConfig.timeout || config.openai.timeout;
    const response = await this.client.chat.completions.create(requestOptions, { timeout });
    return response.choices[0].message.content;
  }
}

/**
 * QwenThinkingAPIClient - Extends OpenAIAPIClient with thinking tag handling and JSON parsing
 * Automatically strips <think>...</think> tags and can parse JSON responses
 */
class QwenThinkingAPIClient extends OpenAIAPIClient {
  /**
   * Strip thinking tags from response content
   * Handles both complete <think>...</think> tags and incomplete tags missing the opening tag
   * @param {string} content - Raw response content
   * @returns {string} - Content with thinking tags removed
   */
  stripThinkingTags(content) {
    if (!content) return '';

    const openTag = '<think>';
    const closeTag = '</think>';
    let result = content;

    // Find all opening and closing tag positions
    const openIndex = result.indexOf(openTag);
    const closeIndex = result.lastIndexOf(closeTag);

    if (openIndex !== -1 && closeIndex !== -1 && closeIndex > openIndex) {
      // Both tags found - remove everything from open tag to end of close tag
      result = result.slice(0, openIndex) + result.slice(closeIndex + closeTag.length);
    } else if (closeIndex !== -1) {
      // Only closing tag found (missing opening tag) - just remove the closing tag
      result = result.slice(0, closeIndex) + result.slice(closeIndex + closeTag.length);
    }

    return result.trim();
  }

  async generateText(messages, options = {}) {
    const {
      parseJSON = false,
      requiredJSONKey = null,
      stripThinking = true,
      maxRetries = 2,
      retryDelay = 1000,
      ...apiOptions
    } = options;

    this.log.debug(`generateText called with message format. parseJSON=${parseJSON}, stripThinking=${stripThinking}`);
    this.log.debug(`Messages count: ${Array.isArray(messages) ? messages.length : 'not array'}`);

    let lastError = null;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        if (attempt > 0) {
          this.log.warn(`Retry attempt ${attempt}/${maxRetries} for API call...`);
          await this._delay(retryDelay * attempt);
        }

        const rawResponse = await super.generateText(messages, apiOptions);

        this.log.debug(`Raw response received. Length: ${rawResponse?.length || 0} chars`);

        const cleanedResponse = stripThinking ? this.stripThinkingTags(rawResponse) : rawResponse;

        if (stripThinking && rawResponse !== cleanedResponse) {
          this.log.debug('Thinking tags were stripped from response');
        }

        if (parseJSON) {
          this.log.debug(`Attempting to parse response as JSON with requiredKey: ${requiredJSONKey || 'none'}`);
          const parsed = JSONResponseParser.extractJSON(cleanedResponse, requiredJSONKey);
          if (parsed) {
            this.log.debug('JSON parsing successful');
            return parsed;
          }
          this.log.warn('JSON parsing failed, returning raw response');
        }

        return cleanedResponse;
      } catch (error) {
        lastError = error;
        this.log.error(`generateText attempt ${attempt + 1} failed: ${error.message}`);

        if (error.status && error.status >= 400 && error.status < 500) {
          this.log.error('Client error detected, not retrying');
          break;
        }
      }
    }

    this.log.error(`All ${maxRetries} retries failed`);
    throw lastError;
  }

  async generateTextLegacy(prompt, systemPrompt = null, options = {}) {
    const messages = [];
    if (systemPrompt) {
      messages.push({ role: 'system', content: systemPrompt });
    }
    messages.push({ role: 'user', content: prompt });
    return this.generateText(messages, options);
  }

  async generateJSON(messages, requiredKey = null, options = {}) {
    const result = await this.generateText(messages, {
      ...options,
      parseJSON: true,
      requiredJSONKey: requiredKey,
    });

    if (typeof result === 'string') {
      throw new Error(`Failed to parse JSON response. Required key: ${requiredKey}`);
    }

    if (requiredKey && !(requiredKey in result)) {
      throw new Error(`JSON response missing required key: ${requiredKey}`);
    }

    return result;
  }

  async generateWithTools(messages, tools = [], options = {}) {
    const {
      stripThinking = true,
      maxRetries = 2,
      retryDelay = 1000,
      ...apiOptions
    } = options;

    this.log.debug(`generateWithTools with message format: ${tools.length} tools, maxTurns: ${apiOptions.maxTurns || 10}, stripThinking: ${stripThinking}`);

    let lastError = null;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        if (attempt > 0) {
          this.log.warn(`Retry attempt ${attempt}/${maxRetries} for generateWithTools...`);
          await this._delay(retryDelay * attempt);
        }

        const rawResult = await super.generateWithTools(messages, tools, apiOptions);
        // Handle new return format { content, messages }
        const rawResponse = rawResult.content || rawResult;

        const cleanedResponse = stripThinking ? this.stripThinkingTags(rawResponse) : rawResponse;

        if (stripThinking && rawResponse !== cleanedResponse) {
          this.log.debug('Thinking tags stripped from final response');
        }

        // Return full result object with messages for conversation tracking
        return { content: cleanedResponse, messages: rawResult.messages };
      } catch (error) {
        lastError = error;
        this.log.error(`generateWithTools attempt ${attempt + 1} failed: ${error.message}`);

        if (error.status && error.status >= 400 && error.status < 500) {
          this.log.error('Client error detected, not retrying');
          break;
        }
      }
    }

    this.log.error(`All ${maxRetries} retries failed`);
    throw lastError;
  }

  async generateWithToolsLegacy(prompt, systemPrompt = null, tools = [], options = {}) {
    const messages = [];
    if (systemPrompt) {
      messages.push({ role: 'system', content: systemPrompt });
    }
    messages.push({ role: 'user', content: prompt });
    return this.generateWithTools(messages, tools, options);
  }

  _delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

class APIClient {
  constructor() {
    if (config.apiProvider === 'openai') {
      this.client = new QwenThinkingAPIClient();
    } else {
      this.client = new AnthropicAPIClient();
    }
    this.log = _log.create("APIClient");
    this.log.info(`Using provider: ${config.apiProvider}`);
  }

  async generateText(pessages, options = {}) {
    if (Array.isArray(pessages)) {
      return this.client.generateText(pessages, options);
    }
    return this.client.generateTextLegacy(pessages, options?.systemPrompt, options);
  }

  async generateTextLegacy(prompt, systemPrompt = null, options = {}) {
    return this.client.generateTextLegacy(prompt, systemPrompt, options);
  }

  async generateJSON(messages, requiredKey = null, options = {}) {
    if (Array.isArray(messages)) {
      return this.client.generateJSON(messages, requiredKey, options);
    }
    const prompt = messages;
    const systemPrompt = requiredKey;
    const key = options?.requiredKey;
    const opts = { ...options };
    if (opts.requiredKey) delete opts.requiredKey;
    return this.client.generateJSON ?
      this.client.generateJSON(prompt, systemPrompt, key, opts) :
      this._generateJSONFallback(prompt, systemPrompt, key, opts);
  }

  async _generateJSONFallback(prompt, systemPrompt = null, requiredKey = null, options = {}) {
    const response = await this.client.generateTextLegacy(prompt, systemPrompt, options);
    const cleanedResponse = this._stripThinkingTags(response);
    try {
      return JSONResponseParser.parseJSON(cleanedResponse, requiredKey);
    } catch (error) {
      throw new Error(`Failed to parse JSON response: ${error.message}`);
    }
  }

  _stripThinkingTags(content) {
    if (!content) return '';
    const openTag = '<think>';
    const closeTag = '</think>';
    let result = content;
    const openIndex = result.indexOf(openTag);
    const closeIndex = result.lastIndexOf(closeTag);
    if (openIndex !== -1 && closeIndex !== -1 && closeIndex > openIndex) {
      result = result.slice(0, openIndex) + result.slice(closeIndex + closeTag.length);
    } else if (closeIndex !== -1) {
      result = result.slice(0, closeIndex) + result.slice(closeIndex + closeTag.length);
    }
    return result.trim();
  }

  async analyzeImage(imagePath, prompt, systemPrompt = null, options = {}) {
    return this.client.analyzeImage(imagePath, prompt, systemPrompt, options);
  }

  async analyzeImageWithMessages(messages, options = {}) {
    if (this.client.analyzeImageWithMessages) {
      return this.client.analyzeImageWithMessages(messages, options);
    }
    const systemMsg = messages.find(m => m.role === 'system');
    const userMsg = messages.find(m => m.role === 'user');
    if (!userMsg) {
      throw new Error('No user message found in messages array');
    }
    let imagePath = null;
    let text = '';
    if (Array.isArray(userMsg.content)) {
      for (const item of userMsg.content) {
        if (item.type === 'image') {
          if (item.source?.type === 'base64') {
            throw new Error('Cannot use base64 image directly with legacy analyzeImage');
          }
          imagePath = item.source?.data;
        } else if (item.type === 'text') {
          text = item.text;
        }
      }
    }
    return this.client.analyzeImage(imagePath, text, systemMsg?.content, options);
  }

  async generateWithTools(messages, tools = [], options = {}) {
    if (Array.isArray(messages)) {
      return this.client.generateWithTools(messages, tools, options);
    }
    return this.client.generateWithToolsLegacy(messages, tools, options);
  }

  async generateWithToolsLegacy(prompt, systemPrompt = null, tools = [], options = {}) {
    return this.client.generateWithToolsLegacy(prompt, systemPrompt, tools, options);
  }

  async generateWithResponses(prompt, systemPrompt = null, tools = [], options = {}) {
    this.log.debug(`generateWithResponses called. Tools: ${tools.length}`);
    this.log.debug(`Provider: ${config.apiProvider}`);
    if (this.client instanceof OpenAIAPIClient) {
      this.log.debug('Using OpenAIAPIClient for Responses API');
      return this.client.generateWithResponses(prompt, systemPrompt, tools, options);
    }
    throw new Error('Responses API is only supported with OpenAI provider');
  }

  getMimeType(filePath) {
    return this.client.getMimeType(filePath);
  }

  createConversationManager(systemPrompt = null) {
    return new ConversationManager(systemPrompt);
  }
}

export default new APIClient();
export { JSONResponseParser };

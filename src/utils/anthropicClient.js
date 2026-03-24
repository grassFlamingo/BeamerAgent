import Anthropic from '@anthropic-ai/sdk';
import config from '../src/config.js';
import fs from 'fs';
import path from 'path';

class AnthropicClient {
  constructor() {
    this.client = new Anthropic({
      apiKey: config.anthropic.apiKey,
    });
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

    const response = await this.client.messages.create(requestOptions);
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

    const response = await this.client.messages.create(requestOptions);
    return response.content[0].text;
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

export default new AnthropicClient();

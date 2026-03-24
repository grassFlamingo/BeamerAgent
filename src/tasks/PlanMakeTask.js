import Task from './Task.js';
import apiClient, { MessageBuilder } from '../../utils/apiClient.js';
import config from '../config.js';
import { log } from '../../utils/logger.js';
import { parseJSONResponse } from '../../utils/jsonParser.js';
import TexResourcesTool from '../llm_tools/TexResourcesTool.js';
import fs from 'fs';
import path from 'path';

export class PlanMakeTask extends Task {

  constructor() {
    super();
    this.log = log.create(this.name);
  }

  static get name() {
    return 'PlanMakeTask';
  }

  static get inputSchema() {
    return {
      simplifiedContent: { type: 'string', required: true },
      paperInfo: { type: 'object', required: false },
      analysisResult: { type: 'object', required: false },
      resources: { type: 'object', required: false },
      cacheDir: { type: 'string', required: false },
      memory: { type: 'object', required: false }
    };
  }

  static get outputSchema() {
    return {
      plan: { type: 'object' },
      recommendedSlides: { type: 'number' }
    };
  }

  getTools() {
    const texResourcesTool = new TexResourcesTool({
      analysisResult: analysisResult || { content: resources },
      cacheDir,
      logger: this.log
    });

    return 
  }

  getToolHandlers() {
    const { analysisResult, resources = {}, cacheDir = '', memory } = this.input;

    if (memory && typeof memory.getToolHandlers === 'function') {
      return memory.getToolHandlers();
    }

    const texResourcesTool = new TexResourcesTool({
      analysisResult: analysisResult || { content: resources },
      cacheDir,
    });

    return texResourcesTool.getHandlers();
  }

  _getMimeType(filePath) {
    const ext = path.extname(filePath).toLowerCase();
    const mimeTypes = {
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.gif': 'image/gif',
      '.pdf': 'application/pdf',
      '.svg': 'image/svg+xml'
    };
    return mimeTypes[ext] || 'application/octet-stream';
  }

  async execute(input) {
    this.input = input;
    const { simplifiedContent, paperInfo = {}, texResourcesTool, cacheDir = '' } = input;

    if (!simplifiedContent || typeof simplifiedContent !== 'string') {
      this.log.error('simplifiedContent is required but not provided or invalid');
      throw new Error('simplifiedContent is required. Please provide a valid simplifiedContent string.');
    }

    this.log.info('Getting slide count recommendation and creating slide plan...');

    const systemPrompt = `You are a PaperReader agent. Create a slide plan for a Beamer presentation based on the provided paper content.

## Your Task
Analyze the simplified paper content and create a complete slide-by-slide plan.

## Input Context
- Simplified markdown content with UUID-indexed placeholders for figures, tables, and algorithms
- Paper metadata available: title, authors (use if relevant)
- Default presentation length: 10-15 minutes (aim for ~1 slide per minute)

## Function Calling
You have access to "getResourceDetails" tool to get full resource information by UUID.

When you need more info about a figure, table, or algorithm:
1. Call getResourceDetails with the UUID from the placeholder
2. For figures: returns original image (base64) + caption + label
3. For tables/algorithms: returns LaTeX source + caption

Example placeholders:
- [Figure caption](figure uuid=abc123)
- [Table caption](table uuid=def456)
- [Algorithm caption](algorithm uuid=ghi789)

## Output Requirements
- Inline equations should be LaTeX format with \\( \\)
- Block equations should be LaTeX format with \\begin{equation} ... \\end{equation}

Return JSON with:
{
  "recommendedSlides": <number>,
  "slides": [
    {
      "slideNumber": 1,
      "title": "<slide title>",
      "purpose": "<why this slide exists>",
      "contentType": "title|bullet|figure|table|text|mixed",
      "keyPoints": ["<point1>", "<point2>"],
      "contentRefs": [{"type": "figure|table|algorithm", "uuid": "<uuid>", "caption": "<caption>"}]
    }
  ],
  "summary": "<2-3 sentence summary>",
  "audience": "<target audience>",
  "style": "<presentation style>"
}

For figure/table slides, use getResourceDetails to understand the visual content.`;

    const userPrompt = `Analyze this simplified paper content and create a complete slide plan:

${simplifiedContent}`;

    try {
      const messages = [
        MessageBuilder.system(systemPrompt),
        MessageBuilder.user(userPrompt)
      ];

      const result = await apiClient.generateWithTools(
        messages,
        texResourcesTool.getTools(),
        {
          maxTokens: 1024 * 16,
          toolHandlers: texResourcesTool.toolHandlers(),
        }
      );

      // Handle new return format { content, messages }
      const response = result.content || result;

      const parsed = this._parseJsonResponse(response);

      this.log.info(parsed);
      
      this.log.success(`Created slide plan with ${parsed.slides?.length || 0} slides`);

      return {
        plan: parsed,
        recommendedSlides: parsed.recommendedSlides || parsed.slides?.length || 10
      };
    } catch (error) {
      this.log.error('Failed to create slide plan:', error.message);
      throw error;
    }
  }

  _parseJsonResponse(response) {
    const fallbackValues = {
      recommendedSlides: 10,
      slides: [],
      summary: '',
      audience: 'Academic',
      style: 'Professional'
    };

    const result = parseJSONResponse(response, {
      fallbackValues,
      logLevel: 'warn'
    });

    if (result.success) {
      if (result.data.slides && Array.isArray(result.data.slides)) {
        return result.data;
      }
      if (Array.isArray(result.data) && result.data.length > 0) {
        return result.data[0];
      }
      if (typeof result.data === 'object' && result.data !== null && Object.keys(result.data).length > 0) {
        return result.data;
      }
    }
    throw new Error('Failed to parse JSON response');
  }
}

export default PlanMakeTask;

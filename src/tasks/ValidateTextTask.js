import Task from './Task.js';
import apiClient, { MessageBuilder } from '../../utils/apiClient.js';
import config from '../config.js';
import { log } from '../../utils/logger.js';
import { parseJSONResponse } from '../../utils/jsonParser.js';
import TexResourcesTool from '../llm_tools/TexResourcesTool.js';

export class ValidateTextTask extends Task {
  static get name() {
    return 'ValidateTextTask';
  }

  static get inputSchema() {
    return {
      slideLatex: { type: 'string', required: true },
      slidePlan: { type: 'object', required: true },
      visionResult: { type: 'object', required: false },
      retryCount: { type: 'number', required: false },
      analysisResult: { type: 'object', required: false },
      resources: { type: 'object', required: false },
      cacheDir: { type: 'string', required: false },
      memory: { type: 'object', required: false }
    };
  }

  static get outputSchema() {
    return {
      isApproved: { type: 'boolean' },
      feedback: { type: 'object' },
      approvalRecommendation: { type: 'string' }
    };
  }

  getTools() {
    const { memory, analysisResult, resources = {}, cacheDir = '' } = this.input;

    if (memory && typeof memory.getTools === 'function') {
      return memory.getTools();
    }

    const texResourcesTool = new TexResourcesTool({
      analysisResult: analysisResult || { content: resources },
      cacheDir,
      logger: log.create(this.constructor.name)
    });

    return texResourcesTool.getTools();
  }

  getToolHandlers() {
    const { analysisResult, resources = {}, cacheDir = '', memory } = this.input;

    if (memory && typeof memory.getToolHandlers === 'function') {
      return memory.getToolHandlers();
    }

    const texResourcesTool = new TexResourcesTool({
      analysisResult: analysisResult || { content: resources },
      cacheDir,
      logger: log.create(this.constructor.name)
    });

    return texResourcesTool.getHandlers();
  }

  async execute(input) {
    this.input = input;
    const { slideLatex, slidePlan, visionResult, retryCount = 0, resources = {}, cacheDir = '' } = input;
    
    log.info(`Validating slide text: ${slidePlan?.title || 'Unknown'}`);

    const systemPrompt = `You are a TextValidator agent. Compare the slide LaTeX content against the expected slide plan.

## Your Task
Validate that the slide content matches the plan and is correct.

## Evaluation Criteria
1. Content accuracy - are key points from the plan included?
2. Correctness - no factual errors?
3. Completeness - all required content present?
4. Readability - clear and understandable?

## IMPORTANT: Tool Calling
If the slide plan contains contentRefs with UUIDs, you MUST call getResourceDetails to verify the resources in the slide match the original paper resources.

## Output Format
Return EXACTLY this JSON (no markdown):
{"isApproved": true, "missingContent": [], "inaccuracies": [], "confidenceScore": 90, "approvalRecommendation": "approve", "recommendations": []}`;

    const contentRefs = slidePlan?.contentRefs || [];
    const hasResources = contentRefs.some(ref => ref.uuid);

    const userPrompt = `Compare this slide LaTeX content against the expected plan:

SLIDE PLAN:
- Title: ${slidePlan?.title || 'N/A'}
- Purpose: ${slidePlan?.purpose || 'N/A'}
- Content Type: ${slidePlan?.contentType || 'N/A'}
- Key Points: ${slidePlan?.keyPoints?.join(', ') || 'N/A'}
- Content References: ${JSON.stringify(contentRefs)}

VISION ANALYSIS (if available):
${visionResult ? JSON.stringify(visionResult, null, 2) : 'N/A'}

SLIDE LATEX:
${slideLatex}

${hasResources ? 'Note: This slide has content references. Use getResourceDetails tool to verify resource accuracy.' : ''}

Check if all key points are present and accurate.`;

    const tools = this.getTools();
    const toolHandlers = this.getToolHandlers();

    try {
      const messages = [
        MessageBuilder.system(systemPrompt),
        MessageBuilder.user(userPrompt)
      ];

      const result = await apiClient.generateWithTools(
        messages,
        tools,
        {
          model: config.openai?.textModel?.modelName || 'gpt-4o',
          toolHandlers
        }
      );

      // Handle new return format { content, messages }
      const response = result.content || result;
      const parsed = this._parseResponse(response);
      
      const isApproved = parsed.approvalRecommendation === 'approve' || parsed.isApproved;
      
      log.info(`Text validation: ${isApproved ? 'APPROVED' : 'NEEDS REVISION'}`);

      return {
        isApproved,
        feedback: {
          missingContent: parsed.missingContent || [],
          inaccuracies: parsed.inaccuracies || [],
          recommendations: parsed.recommendations || []
        },
        approvalRecommendation: parsed.approvalRecommendation || 'needs_revision',
        confidenceScore: parsed.confidenceScore || 50
      };
    } catch (error) {
      log.error(`Text validation failed: ${error.message}`);
      
      return {
        isApproved: false,
        feedback: { error: error.message },
        approvalRecommendation: 'needs_revision'
      };
    }
  }

  _parseResponse(response) {
    const fallbackValues = { isApproved: false, approvalRecommendation: 'needs_revision' };

    const result = parseJSONResponse(response, {
      requiredKeys: ['approvalRecommendation'],
      fallbackValues,
      logLevel: 'warn'
    });

    return result.success ? result.data : fallbackValues;
  }
}

export default ValidateTextTask;

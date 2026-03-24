import Task from './Task.js';
import apiClient, { MessageBuilder } from '../utils/apiClient.js';
import config from '../config.js';
import { log } from '../utils/logger.js';
import { parseJSONResponse } from '../utils/jsonParser.js';

/**
 * ValidateFrameAlignmentTask - Validates that generated frame content aligns with original source text
 *
 * This task performs a text-only comparison between:
 * 1. The generated LaTeX frame content
 * 2. The original source text from the paper
 *
 * It ensures that:
 * - Key information from the source is accurately represented
 * - No factual errors or misrepresentations are introduced
 * - The content is complete and nothing critical is missing
 */
export class ValidateFrameAlignmentTask extends Task {
  static get name() {
    return 'ValidateFrameAlignmentTask';
  }

  static get inputSchema() {
    return {
      frameContent: { type: 'string', required: true },
      slidePlan: { type: 'object', required: true },
      originalSourceText: { type: 'string', required: true },
      retryCount: { type: 'number', required: false }
    };
  }

  static get outputSchema() {
    return {
      isAligned: { type: 'boolean' },
      alignmentScore: { type: 'number' },
      discrepancies: { type: 'array' },
      missingContent: { type: 'array' },
      inaccuracies: { type: 'array' },
      recommendations: { type: 'array' }
    };
  }

  async execute(input) {
    const { frameContent, slidePlan, originalSourceText, retryCount = 0 } = input;

    log.info(`Validating frame alignment for: ${slidePlan?.title || 'Unknown'}`);

    const systemPrompt = `You are a Frame Alignment Validator. Your task is to compare the generated LaTeX frame content against the original source text and validate that the content is accurately represented.

## Your Task
Perform a detailed text-only comparison between:
1. The generated LaTeX frame content (what will appear in the presentation)
2. The original source text from the paper

## Validation Criteria

### 1. Content Accuracy (CRITICAL)
- Are all facts, numbers, and data accurately represented?
- Are there any misrepresentations or factual errors?
- Is the meaning preserved from the original source?

### 2. Completeness
- Are all key points from the source included?
- Is any critical information missing?
- Are important context or qualifications preserved?

### 3. Faithful Representation
- Is the content a faithful summary/representation of the source?
- Are claims properly attributed and qualified?
- Are limitations and assumptions preserved?

### 4. No Hallucination
- Does the frame contain any information NOT present in the source?
- Are there any fabricated details, numbers, or claims?

## Scoring Guidelines
- **90-100**: Perfect alignment - all content accurate, complete, and faithful
- **70-89**: Good alignment - minor omissions or simplifications, no errors
- **50-69**: Fair alignment - noticeable omissions or minor inaccuracies
- **Below 50**: Poor alignment - major inaccuracies, missing content, or hallucinations

## Output Format
Return EXACTLY this JSON structure (no markdown code blocks):
{
  "isAligned": true,
  "alignmentScore": 85,
  "discrepancies": [
    {
      "type": "inaccuracy" | "omission" | "hallucination",
      "description": "Clear description of the discrepancy",
      "sourceText": "Relevant quote from original source",
      "frameContent": "Problematic content in frame",
      "severity": "minor" | "moderate" | "severe"
    }
  ],
  "missingContent": [
    {
      "description": "What important content is missing",
      "sourceText": "Quote from original source",
      "importance": "critical" | "important" | "optional"
    }
  ],
  "inaccuracies": [
    {
      "description": "What is inaccurate",
      "sourceText": "Original source content",
      "frameContent": "Inaccurate frame content",
      "correction": "How to fix it"
    }
  ],
  "recommendations": [
    "Actionable suggestions for improving alignment"
  ]
}

## Important Notes
- Be thorough but reasonable - slides are summaries, not verbatim copies
- Focus on factual accuracy and faithful representation
- Flag any hallucinated content (information not in source) as severe
- Consider the slide's purpose when evaluating completeness
- Provide specific, actionable feedback for improvements`;

    const userPrompt = `Compare the generated frame content against the original source text.

## SLIDE PLAN
- **Title**: ${slidePlan?.title || 'N/A'}
- **Purpose**: ${slidePlan?.purpose || 'N/A'}
- **Content Type**: ${slidePlan?.contentType || 'N/A'}
- **Key Points**: ${slidePlan?.keyPoints?.join('\n- ') || 'N/A'}

## ORIGINAL SOURCE TEXT
${originalSourceText || 'N/A'}

## GENERATED FRAME CONTENT (LaTeX)
${frameContent || 'N/A'}

## Instructions
1. Read the original source text carefully
2. Examine the generated frame content
3. Compare them for accuracy, completeness, and faithfulness
4. Identify any discrepancies, missing content, or inaccuracies
5. Provide a detailed alignment assessment with specific examples

Be thorough in your comparison. Focus on:
- **Factual accuracy**: Are numbers, facts, and claims correct?
- **Completeness**: Are key points from the source included?
- **Faithfulness**: Is the meaning preserved without distortion?
- **No hallucination**: Is all content grounded in the source?`;

    try {
      const messages = [
        MessageBuilder.system(systemPrompt),
        MessageBuilder.user(userPrompt)
      ];

      const response = await apiClient.generateText(
        messages,
        { model: config.openai?.textModel?.modelName || 'gpt-4o' }
      );

      const parsed = this._parseResponse(response);

      const isAligned = parsed.isAligned || (parsed.alignmentScore >= 70);

      log.info(`Frame alignment: ${isAligned ? 'ALIGNED' : 'MISALIGNED'} (score: ${parsed.alignmentScore}/100)`);

      return {
        isAligned,
        alignmentScore: parsed.alignmentScore || 50,
        discrepancies: parsed.discrepancies || [],
        missingContent: parsed.missingContent || [],
        inaccuracies: parsed.inaccuracies || [],
        recommendations: parsed.recommendations || []
      };
    } catch (error) {
      log.error(`Frame alignment validation failed: ${error.message}`);

      return {
        isAligned: false,
        alignmentScore: 0,
        discrepancies: [],
        missingContent: [],
        inaccuracies: [{
          description: `Validation failed: ${error.message}`,
          correction: 'Retry validation or manually review the frame content'
        }],
        recommendations: ['Manual review required due to validation error']
      };
    }
  }

  _parseResponse(response) {
    const fallbackValues = {
      isAligned: false,
      alignmentScore: 0,
      discrepancies: [],
      missingContent: [],
      inaccuracies: [{
        description: 'Unable to parse validation response',
        correction: 'Manual review required'
      }],
      recommendations: ['Manual review recommended due to parsing error']
    };

    const result = parseJSONResponse(response, {
      requiredKeys: ['alignmentScore'],
      fallbackValues,
      logLevel: 'warn'
    });

    return result.success ? result.data : fallbackValues;
  }
}

export default ValidateFrameAlignmentTask;

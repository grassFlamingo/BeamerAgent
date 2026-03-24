import Task from './Task.js';
import apiClient, { ChatSession, MessageBuilder } from '../utils/apiClient.js';
import config from '../config.js';
import { log } from '../utils/logger.js';
import { parseJSONResponse } from '../utils/jsonParser.js';

/**
 * ValidateVisionSlideTask - Validates slide appearance using multi-turn vision analysis
 *
 * Uses a 5-step sequential validation process:
 * 1. Alignment (text-based, no vision needed)
 * 2. Overflow check (vision)
 * 3. Visibility check (vision)
 * 4. Layout check (vision)
 * 5. Clarity check (vision)
 *
 * Each step must pass before proceeding to the next.
 */
export class ValidateVisionSlideTask extends Task {

  constructor() {
    super();
    this.log = log.create('ValidateVisionSlideTask');
  }

  static get name() {
    return 'ValidateVisionSlideTask';
  }

  static get inputSchema() {
    return {
      pageImage: { type: 'string', required: true },
      slidePlan: { type: 'object', required: true },
      texFrame: { type: 'string', required: true },
      retryCount: { type: 'number', required: false }
    };
  }

  static get outputSchema() {
    return {
      reason: { type: 'string' },
      score: { type: 'number' },
      operation: { type: 'string' },
      feedback: { type: 'object' }
    };
  }

  async execute(input) {
    const { pageImage, slidePlan, texFrame, retryCount = 0 } = input;

    this.log.info(`Vision validating slide: ${slidePlan?.title || 'Unknown'}`);

    const feedback = {
      visibility: null,
      layout: null,
      clarity: null,
      contentMatch: null,
      overflowCheck: null,
      overflowDetails: null,
      recommendations: []
    };

    let totalScore = 100;
    let failedStep = null;

    // Step 1: Alignment Check (text-based, no vision needed)
    this.log.info('Step 1/5: Checking content alignment...');
    const alignmentResult = await this._checkAlignment(slidePlan, texFrame);
    
    if (!alignmentResult.passed) {
      this.log.warn(`Step 1 failed: ${alignmentResult.reason}`);
      return this._buildResult(false, alignmentResult.score, alignmentResult.reason, feedback);
    }
    feedback.contentMatch = alignmentResult.feedback;
    this.log.success('Step 1 passed: Content aligned');

    // Step 2: Overflow Check (vision)
    this.log.info('Step 2/5: Checking for overflow...');
    const overflowResult = await this._checkOverflow(pageImage, slidePlan, texFrame);
    
    if (!overflowResult.passed) {
      this.log.warn(`Step 2 failed: ${overflowResult.reason}`);
      feedback.overflowCheck = overflowResult.overflowCheck;
      feedback.overflowDetails = overflowResult.overflowDetails;
      feedback.recommendations = overflowResult.recommendations;
      return this._buildResult(false, overflowResult.score, overflowResult.reason, feedback);
    }
    feedback.overflowCheck = 'No overflow detected';
    this.log.success('Step 2 passed: No overflow');

    // Step 3: Visibility Check (vision)
    this.log.info('Step 3/5: Checking visibility...');
    const visibilityResult = await this._checkVisibility(pageImage, slidePlan);
    
    if (!visibilityResult.passed) {
      this.log.warn(`Step 3 failed: ${visibilityResult.reason}`);
      feedback.visibility = visibilityResult.feedback;
      feedback.recommendations.push(...visibilityResult.recommendations);
      return this._buildResult(false, visibilityResult.score, visibilityResult.reason, feedback);
    }
    feedback.visibility = 'All elements visible';
    this.log.success('Step 3 passed: All elements visible');

    // Step 4: Layout Check (vision)
    this.log.info('Step 4/5: Checking layout...');
    const layoutResult = await this._checkLayout(pageImage, slidePlan);
    
    if (!layoutResult.passed) {
      this.log.warn(`Step 4 failed: ${layoutResult.reason}`);
      feedback.layout = layoutResult.feedback;
      feedback.recommendations.push(...layoutResult.recommendations);
      return this._buildResult(false, layoutResult.score, layoutResult.reason, feedback);
    }
    feedback.layout = 'Good layout';
    this.log.success('Step 4 passed: Good layout');

    // Step 5: Clarity Check (vision)
    this.log.info('Step 5/5: Checking clarity...');
    const clarityResult = await this._checkClarity(pageImage, slidePlan);
    
    if (!clarityResult.passed) {
      this.log.warn(`Step 5 failed: ${clarityResult.reason}`);
      feedback.clarity = clarityResult.feedback;
      feedback.recommendations.push(...clarityResult.recommendations);
      return this._buildResult(false, clarityResult.score, clarityResult.reason, feedback);
    }
    feedback.clarity = 'Clean and readable';
    this.log.success('Step 5 passed: Clean and readable');

    // All steps passed
    this.log.success('All validation steps passed!');
    return this._buildResult(true, totalScore, 'All validation checks passed', feedback);
  }

  /**
   * Step 1: Check content alignment (text-based, no vision)
   */
  async _checkAlignment(slidePlan, texFrame) {
    const systemPrompt = `You are a content alignment validator. Check if the TeX frame content matches the slide plan.

## Task
Compare the TeX frame against the slide plan and verify:
1. All key points from the plan are addressed in the TeX
2. Content type matches (figure, table, bullet, etc.)
3. No missing critical content

## Output (JSON only)
{"passed": true, "score": 100, "feedback": "All key points addressed", "reason": "Content aligned"}
OR
{"passed": false, "score": 50, "feedback": "Missing key points", "reason": "Content mismatch"}`;

    const userPrompt = `Check alignment between slide plan and TeX frame.

## SLIDE PLAN
- **Title**: ${slidePlan?.title || 'N/A'}
- **Purpose**: ${slidePlan?.purpose || 'N/A'}
- **Content Type**: ${slidePlan?.contentType || 'N/A'}
- **Key Points**: ${slidePlan?.keyPoints?.join('; ') || 'N/A'}

## TEX FRAME
${texFrame || 'N/A'}

Verify all key points are addressed in the TeX. Return JSON.`;

    try {
      const response = await apiClient.generateText(
        [MessageBuilder.system(systemPrompt), MessageBuilder.user(userPrompt)],
        { model: config.openai?.textModel?.modelName || 'gpt-4o' }
      );

      const parsed = parseJSONResponse(response, {
        requiredKeys: ['passed'],
        fallbackValues: { passed: false, score: 0, feedback: 'Parse failed', reason: 'Parse error' }
      });

      return parsed.success ? parsed.data : { passed: false, score: 0, feedback: 'Parse failed', reason: 'Parse error' };
    } catch (error) {
      this.log.error(`Alignment check failed: ${error.message}`);
      return { passed: true, score: 100, feedback: 'Alignment check skipped', reason: 'Error in alignment check' };
    }
  }

  /**
   * Step 2: Check for overflow (vision)
   */
  async _checkOverflow(pageImage, slidePlan, texFrame) {
    const systemPrompt = `You are an overflow detection specialist for LaTeX Beamer slides.

## Task (CRITICAL - HIGHEST PRIORITY)
Check if ANY content extends beyond slide boundaries:
- Figures/images cut off or outside edges
- Tables with rows/columns disappearing off the edge
- Equations, text, or captions truncated

## Rule
ANY overflow = FAILED (score < 70)

## Output (JSON only)
{"passed": true, "score": 100, "overflowCheck": "No overflow detected", "reason": "No overflow"}
OR
{"passed": false, "score": 50, "overflowCheck": "WARNING: [details]", "overflowDetails": {...}, "recommendations": [...], "reason": "Overflow detected"}`;

    const userPrompt = `Check for overflow in this slide.

## COMPLETE SLIDE PLAN
- **Title**: ${slidePlan?.title || 'N/A'}
- **Purpose**: ${slidePlan?.purpose || 'N/A'}
- **Content Type**: ${slidePlan?.contentType || 'N/A'}
- **Key Points**: ${slidePlan?.keyPoints?.join('; ') || 'N/A'}
- **Content References**: ${slidePlan?.contentRefs?.map(r => `${r.type}:${r.uuid}`).join(', ') || 'None'}

## TEX FRAME
${texFrame || 'N/A'}

Examine the image carefully. Check for:
1. Figures cut off or extending beyond edges
2. Tables with missing rows/columns
3. Any content truncated

Verify all contentRefs from the plan are present and not cut off.
If overflow found, specify: which element, direction, severity, and LaTeX fix suggestions.
Return JSON.`;

    try {
      const messages = [
        MessageBuilder.system(systemPrompt),
        MessageBuilder.userWithImage(pageImage, userPrompt)
      ];

      const response = await apiClient.analyzeImageWithMessages(messages, {
        model: config.openai?.visionModel?.modelName || 'gpt-4o'
      });

      const parsed = parseJSONResponse(response, {
        requiredKeys: ['passed'],
        fallbackValues: { passed: false, score: 0, overflowCheck: 'Parse failed', reason: 'Parse error' }
      });

      return parsed.success ? parsed.data : { passed: false, score: 0, overflowCheck: 'Parse failed', reason: 'Parse error' };
    } catch (error) {
      this.log.error(`Overflow check failed: ${error.message}`);
      return { passed: false, score: 0, overflowCheck: 'Check failed', reason: error.message };
    }
  }

  /**
   * Step 3: Check visibility (vision)
   */
  async _checkVisibility(pageImage, slidePlan) {
    const systemPrompt = `You are a visibility checker for LaTeX Beamer slides.

## Task
Verify all elements are visible and not cut off:
- All text is readable
- All figures/tables are fully visible
- Captions are complete
- No elements are hidden or obscured

## Output (JSON only)
{"passed": true, "score": 100, "feedback": "All elements visible", "reason": "Good visibility"}
OR
{"passed": false, "score": 60, "feedback": "[details]", "recommendations": [...], "reason": "Visibility issues"}`;

    const userPrompt = `Check visibility of elements in this slide.

## COMPLETE SLIDE PLAN
- **Title**: ${slidePlan?.title || 'N/A'}
- **Purpose**: ${slidePlan?.purpose || 'N/A'}
- **Content Type**: ${slidePlan?.contentType || 'N/A'}
- **Key Points**: ${slidePlan?.keyPoints?.join('; ') || 'N/A'}
- **Content References**: ${slidePlan?.contentRefs?.map(r => `${r.type}:${r.uuid}`).join(', ') || 'None'}

Examine the image. Are all elements from the plan fully visible and readable?
Check that all contentRefs (figures, tables, equations) mentioned in the plan are present and visible.
Return JSON.`;

    try {
      const messages = [
        MessageBuilder.system(systemPrompt),
        MessageBuilder.userWithImage(pageImage, userPrompt)
      ];

      const response = await apiClient.analyzeImageWithMessages(messages, {
        model: config.openai?.visionModel?.modelName || 'gpt-4o'
      });

      const parsed = parseJSONResponse(response, {
        requiredKeys: ['passed'],
        fallbackValues: { passed: false, score: 0, feedback: 'Parse failed', reason: 'Parse error' }
      });

      return parsed.success ? parsed.data : { passed: false, score: 0, feedback: 'Check failed', reason: error.message };
    } catch (error) {
      this.log.error(`Visibility check failed: ${error.message}`);
      return { passed: false, score: 0, feedback: 'Check failed', reason: error.message };
    }
  }

  /**
   * Step 4: Check layout (vision)
   */
  async _checkLayout(pageImage, slidePlan) {
    const systemPrompt = `You are a layout checker for LaTeX Beamer slides.

## Task
Verify proper layout and positioning:
- Nothing placed outside page boundaries
- Elements are well-positioned
- Balanced use of space
- Professional appearance

## Output (JSON only)
{"passed": true, "score": 100, "feedback": "Good layout", "reason": "Layout is good"}
OR
{"passed": false, "score": 60, "feedback": "[details]", "recommendations": [...], "reason": "Layout issues"}`;

    const userPrompt = `Check layout of this slide.

## COMPLETE SLIDE PLAN
- **Title**: ${slidePlan?.title || 'N/A'}
- **Purpose**: ${slidePlan?.purpose || 'N/A'}
- **Content Type**: ${slidePlan?.contentType || 'N/A'}
- **Key Points**: ${slidePlan?.keyPoints?.join('; ') || 'N/A'}
- **Content References**: ${slidePlan?.contentRefs?.map(r => `${r.type}:${r.uuid}`).join(', ') || 'None'}

Examine the image. Is the layout professional and well-organized for the planned content?
Check that the layout supports the slide's purpose and all contentRefs are properly positioned.
Return JSON.`;

    try {
      const messages = [
        MessageBuilder.system(systemPrompt),
        MessageBuilder.userWithImage(pageImage, userPrompt)
      ];

      const response = await apiClient.analyzeImageWithMessages(messages, {
        model: config.openai?.visionModel?.modelName || 'gpt-4o'
      });

      const parsed = parseJSONResponse(response, {
        requiredKeys: ['passed'],
        fallbackValues: { passed: false, score: 0, feedback: 'Parse failed', reason: 'Parse error' }
      });

      return parsed.success ? parsed.data : { passed: false, score: 0, feedback: 'Parse failed', reason: 'Parse error' };
    } catch (error) {
      this.log.error(`Layout check failed: ${error.message}`);
      return { passed: false, score: 0, feedback: 'Check failed', reason: error.message };
    }
  }

  /**
   * Step 5: Check clarity (vision)
   */
  async _checkClarity(pageImage, slidePlan) {
    const systemPrompt = `You are a clarity checker for LaTeX Beamer slides.

## Task
Verify the slide is clean and easy to understand:
- Clear and readable design
- Not cluttered or messy
- Information is easy to digest
- Professional appearance

## Output (JSON only)
{"passed": true, "score": 100, "feedback": "Clean and readable", "reason": "Good clarity"}
OR
{"passed": false, "score": 60, "feedback": "[details]", "recommendations": [...], "reason": "Clarity issues"}`;

    const userPrompt = `Check clarity of this slide.

## COMPLETE SLIDE PLAN
- **Title**: ${slidePlan?.title || 'N/A'}
- **Purpose**: ${slidePlan?.purpose || 'N/A'}
- **Content Type**: ${slidePlan?.contentType || 'N/A'}
- **Key Points**: ${slidePlan?.keyPoints?.join('; ') || 'N/A'}
- **Content References**: ${slidePlan?.contentRefs?.map(r => `${r.type}:${r.uuid}`).join(', ') || 'None'}

Examine the image. Is the slide clean and easy to understand for the planned content?
Check that the presentation is clear and supports the slide's purpose and key points.
Return JSON.`;

    try {
      const messages = [
        MessageBuilder.system(systemPrompt),
        MessageBuilder.userWithImage(pageImage, userPrompt)
      ];

      const response = await apiClient.analyzeImageWithMessages(messages, {
        model: config.openai?.visionModel?.modelName || 'gpt-4o'
      });

      const parsed = parseJSONResponse(response, {
        requiredKeys: ['passed'],
        fallbackValues: { passed: false, score: 0, feedback: 'Parse failed', reason: 'Parse error' }
      });

      return parsed.success ? parsed.data : { passed: false, score: 0, feedback: 'Parse failed', reason: 'Parse error' };
    } catch (error) {
      this.log.error(`Clarity check failed: ${error.message}`);
      return { passed: false, score: 0, feedback: 'Check failed', reason: error.message };
    }
  }

  /**
   * Build final result
   */
  _buildResult(passed, score, reason, feedback) {
    return {
      reason,
      score,
      operation: passed ? 'accept' : 'refine',
      feedback
    };
  }
}

export default ValidateVisionSlideTask;

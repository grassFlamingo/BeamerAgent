import Task from './Task.js';
import apiClient, { MessageBuilder } from '../utils/apiClient.js';
import config from '../config.js';
import { log } from '../utils/logger.js';
import { parseJSONResponse } from '../utils/jsonParser.js';

/**
 * ValidateTextAlignmentTask - Validates that rendered slide content matches original source tex
 *
 * Given a slide screenshot, TeX frame, and original source tex for contentRefs,
 * this task verifies that the rendered content aligns with the original source.
 * 
 * Uses VISION to verify:
 * - Figures/diagrams match the original content
 * - Tables have correct data and structure
 * - Equations have correct symbols and layout
 * - Text content matches the source
 */
export class ValidateTextAlignmentTask extends Task {

  constructor() {
    super();
    this.log = log.create('ValidateTextAlignmentTask');
  }

  static get name() {
    return 'ValidateTextAlignmentTask';
  }

  static get inputSchema() {
    return {
      pageImage: { type: 'string', required: true },
      slidePlan: { type: 'object', required: true },
      texFrame: { type: 'string', required: true },
      contentRefsRawTex: { type: 'array', required: true }
    };
  }

  static get outputSchema() {
    return {
      isAligned: { type: 'boolean' },
      score: { type: 'number' },
      sourceAlignment: { type: 'string' },
      sourceAlignmentDetails: { type: 'object' }
    };
  }

  async execute(input) {
    const { pageImage, slidePlan, texFrame, contentRefsRawTex } = input;

    // this.log.info(`Text alignment validating slide: ${slidePlan?.title || 'Unknown'}`);

    // If no contentRefs provided, skip alignment check
    if (!contentRefsRawTex || contentRefsRawTex.length === 0) {
      this.log.info('No contentRefs provided, skipping text alignment validation');
      return {
        isAligned: true,
        score: 100,
        sourceAlignment: 'No contentRefs to validate',
        sourceAlignmentDetails: null
      };
    }

    const systemPrompt = `You are a TextAlignmentValidator agent for LaTeX Beamer presentations.
Your task is to VISUALLY verify that the rendered slide content matches the original source tex.

## Your Task
LOOK at the slide screenshot and COMPARE it against the original LaTeX source tex provided.
Verify that what you SEE in the image matches what the LaTeX code should produce.

## Critical: Understand LaTeX Figure Structure

### Pre-Composed Figures (SINGLE PNG with Multiple Subplots)
**MOST IMPORTANT RULE**: ONE \\includegraphics{filename.png} = ONE image file
- That ONE image file CAN contain multiple subplots INSIDE it
- This is a PRE-COMPOSED figure (subplots already combined in the PNG)
- Side-by-side, stacked, or grid layouts are ALL VALID for a single PNG

**COMMON SCENARIOS:**
1. Comparison Figure:
   Source: \\includegraphics{comparison.png}
   Screenshot: Two plots side-by-side
   → VALID ✓ (comparison.png contains both plots)

2. Multi-panel Figure:
   Source: \\includegraphics{results.png}
   Screenshot: Four subplots in 2x2 grid
   → VALID ✓ (results.png contains all four subplots)

3. Multiple \\includegraphics (separate files):
   Source: \\includegraphics{plot1.png} \\includegraphics{plot2.png}
   Screenshot: Two separate figures
   → VALID ✓ (two separate image files)

**CRITICAL VALIDATION RULES:**
- ONE \\includegraphics{single.png} → ONE figure with 1+ subplots → VALID ✓
- ONE \\includegraphics{comparison.png} → Two plots side-by-side → VALID ✓
- ONE \\includegraphics{grid.png} → Four subplots in 2x2 grid → VALID ✓
- DO NOT flag pre-composed figures as mismatches
- Only flag if: WRONG figure entirely, WRONG data, or MISSING content

### What Constitutes a REAL Mismatch
- WRONG data: Values/labels in screenshot don't match source
- MISSING content: Subplot/table row/equation term is absent
- EXTRA content: Content in screenshot not in source tex
- WRONG type: Source has table, screenshot shows figure
- WRONG figure entirely: Completely different image shown

## Visual Alignment Checks

### 1. Figures/Diagrams
LOOK at the figure in the screenshot, COMPARE with source tex:
- COUNT \\includegraphics commands in source = expected number of image FILES
- ONE \\includegraphics can show multiple subplots (pre-composed in PNG)
- Are ALL images/subplots PRESENT in screenshot?
- Are labels and annotations CORRECT?
- Does the LAYOUT (side-by-side, stacked, grid) make sense?

### 2. Tables
LOOK at the table in the screenshot, COMPARE with source tex:
- COUNT: Same number of rows and columns?
- DATA: Are the values VISIBLE in the screenshot the same as in the tex?
- HEADERS: Do column headers match?
- STRUCTURE: Same table layout (rules, borders, alignment)?

### 3. Equations
LOOK at the equation in the screenshot, COMPARE with source tex:
- SYMBOLS: Are all mathematical symbols VISIBLE and CORRECT?
- STRUCTURE: Same equation layout (fractions, integrals, sums)?
- INDICES: Correct subscripts/superscripts VISIBLE?

### 4. Text Content
READ the text in the screenshot, COMPARE with source tex:
- Are all key phrases PRESENT?
- Is the wording CONSISTENT?
- No MISSING paragraphs or sentences?

## Scoring Guidelines
- 90-100: Perfect alignment - all content matches original source exactly
- 70-89: Good alignment - minor differences (formatting, spacing) but content is correct
- 50-69: Fair alignment - some content mismatches or missing elements
- Below 50: Poor alignment - significant content differences, wrong data, or missing major elements

## Output Format
Return EXACTLY this JSON structure (no markdown code blocks):
{
  "sourceAlignment": "Content aligns with original source tex" or "WARNING: Content does NOT match original source - [details]",
  "sourceAlignmentDetails": null or {
    "hasMisalignment": true,
    "affectedElements": [
      {
        "type": "figure|table|equation|text",
        "uuid": "uuid-if-available",
        "issue": "Description of mismatch"
      }
    ],
    "severity": "minor|moderate|severe",
    "recommendations": ["Use the original source tex exactly", "Verify data values match"]
  },
  "isAligned": true,
  "score": 85
}

## Important
- Return ONLY the JSON object, no markdown formatting
- Be specific about what matches and what doesn't
- If content aligns, set isAligned: true and score >= 70
- If content does NOT align, set isAligned: false and score < 70
- Remember: Pre-composed figures with multiple subplots are VALID ✓
- If source tex shows "RESOURCE NOT FOUND", the resource is missing from the source - report this as a potential issue`;

    const userPrompt = `VISUALLY verify the slide content against the original source tex.

## SLIDE PLAN
${JSON.stringify(slidePlan, "", 2)}

## TEX FRAME
${texFrame || 'N/A'}

## ORIGINAL SOURCE TEX (for Content Alignment Check)
${contentRefsRawTex.map(ref => {
  const typeLabel = ref.type ? ref.type.toUpperCase() : 'RESOURCE';
  const uuid = ref.uuid || 'unknown';
  const caption = ref.caption || ref.label || 'N/A';
  const latex = ref.latex || ref.text || 'N/A';
  return `null
### ${typeLabel} (UUID: ${uuid})
Caption: ${caption}
LaTeX Source:
${latex}
`;
}).join('\n')}

## YOUR TASK
For EACH contentRef above:
1. FIND the content in the screenshot
2. VERIFY it matches the source tex
3. REPORT: FOUND (Yes/No), VALID (Yes/No), CONTENT MATCH (Yes/No)

Remember: 
- ONE \\includegraphics can show multiple subplots (pre-composed PNG) - this is VALID.
- If LaTeX Source shows "RESOURCE NOT FOUND", the resource is missing from source tex - report this.

Return JSON validation result.`;

    try {
      const messages = [
        MessageBuilder.system(systemPrompt),
        MessageBuilder.userWithImage(pageImage, userPrompt)
      ];

      // this.log.debug(userPrompt);

      const response = await apiClient.analyzeImageWithMessages(
        messages,
        { model: config.openai?.visionModel?.modelName || 'gpt-4o' }
      );

      const parsed = this._parseResponse(response);

      const score = parsed.score || 50;
      const isAligned = parsed.isAligned || (score >= 70);

      this.log.info(`Text alignment validation: ${score}/100 - ${isAligned ? 'ALIGNED' : 'MISALIGNED'}`);

      return {
        isAligned,
        score,
        sourceAlignment: parsed.sourceAlignment || (isAligned ? 'Content aligns with original source' : 'Content does not match original source'),
        sourceAlignmentDetails: parsed.sourceAlignmentDetails || null
      };
    } catch (error) {
      this.log.error(`Text alignment validation failed: ${error.message}`);

      return {
        isAligned: false,
        score: 0,
        sourceAlignment: `Validation failed: ${error.message}`,
        sourceAlignmentDetails: {
          hasMisalignment: false,
          affectedElements: [],
          severity: 'unknown',
          recommendations: ['Retry validation or manually review the slide']
        }
      };
    }
  }

  _parseResponse(response) {
    const fallbackValues = {
      isAligned: false,
      score: 0,
      sourceAlignment: 'Parsing failed',
      sourceAlignmentDetails: {
        hasMisalignment: false,
        affectedElements: [],
        severity: 'unknown',
        recommendations: ['Manual review recommended due to parsing error']
      }
    };

    this.log.debug(`Received response: ${response}`);

    const result = parseJSONResponse(response, {
      requiredKeys: ['score'],
      fallbackValues,
      logLevel: 'warn',
      handleLatexEscaping: true,  // Enable LaTeX math delimiter escaping
    });

    return result.success ? result.data : fallbackValues;
  }
}

export default ValidateTextAlignmentTask;

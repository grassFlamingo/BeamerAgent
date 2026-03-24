import Task from './Task.js';
import apiClient, { ChatSession, MessageBuilder } from '../utils/apiClient.js';
import { LatexUtils, TeXCompilerError } from '../utils/latexUtils.js';
import config from '../config.js';
import { log } from '../utils/logger.js';
import { parseJSONResponse } from '../utils/jsonParser.js';
import TexResourcesTool from '../llm_tools/TexResourcesTool.js';
import fs from 'fs';
import path from 'path';

const SYSTEM_PROMPT = `You are a Beamer presentation slide planner expert. Your task is to analyze academic papers and create detailed slide skeletons/outlines for Beamer presentations.

## Your Role
- Analyze paper content to identify key sections and concepts
- Create a logical slide flow that tells the paper's story
- Plan slide content with appropriate detail levels
- Identify which figures, tables, and equations to include

## CRITICAL: Maximize ContentRefs Usage
**You MUST include contentRefs for EVERY slide that can benefit from visual/mathematical/textual content:**

### Why ContentRefs Are Essential
1. **Visual Evidence**: Figures/tables provide concrete evidence for claims
2. **Mathematical Rigor**: Equations show the formal foundation of methods
3. **Source Text**: Section/subsection/paragraph text provides the original paper's exact wording
4. **Credibility**: Directly using paper's original content ensures accuracy
5. **Completeness**: Slides without contentRefs are often too abstract

### ContentRefs Requirements
- **Every results/experiments slide MUST reference at least one figure or table**
- **Every method slide SHOULD reference at least one equation, algorithm, OR section text**
- **Introduction/motivation slides SHOULD reference overview figures OR introduction section text**
- **Background slides SHOULD reference related section/subsection text**
- **Aim for 80%+ of slides to have at least one contentRef**

### ContentRefs Can Include:
- **figures**: Visual elements, diagrams, plots
- **tables**: Data tables, comparison results
- **algorithms**: Algorithm environments, pseudocode
- **equations**: Mathematical formulas, theorems
- **section**: Section headings and content
- **subsection**: Subsection headings and content
- **paragraph**: Paragraph text for specific concepts
- **text**: General text blocks from the paper

### How to Use ContentRefs (CRITICAL - FOLLOW THESE STEPS)
1. **Use getResourceDetails tool** to fetch figure/table/algorithm/equation/section details by UUID
2. **Review the fetched content** - understand what it shows or says
3. **Add to contentRefs** with the EXACT UUID from the fetched resource
4. **Describe in keyPoints** what the figure/table/equation/section demonstrates or states

**CRITICAL: You MUST Use the getResourceDetails Tool!**
- DO NOT invent or make up UUIDs
- DO NOT use placeholder UUIDs like "a1b2c3d4" or "abc123"
- ONLY use UUIDs that you get from calling getResourceDetails
- For EACH contentRef you add, you MUST have called getResourceDetails first
- The examples below show the FORMAT - you must use REAL UUIDs from the tool

**Example Workflow:**
1. Call: getResourceDetails({uuid: "f32cd1fa"})
2. Get back: {type: "figure", uuid: "f32cd1fa", caption: "Miss rates analysis", ...}
3. Add to contentRefs: {"type": "figure", "uuid": "f32cd1fa", "caption": "Miss rates analysis"}

### Example of GOOD vs BAD Slide Planning

**BAD (no contentRefs - too abstract):**
{
  "slideNumber": 5,
  "title": "Experimental Results",
  "contentType": "bullet",
  "keyPoints": ["Our method achieves better accuracy", "Our method is faster than baselines"]
}

**BAD (made-up UUIDs - WRONG!):**
{
  "slideNumber": 5,
  "title": "Experimental Results",
  "contentRefs": [
    {"type": "figure", "uuid": "a1b2c3d4", "caption": "Accuracy comparison"}  // WRONG: UUID is made up!
  ]
}

**GOOD (with REAL UUIDs from getResourceDetails tool):**
{
  "slideNumber": 5,
  "title": "Experimental Results: Accuracy Comparison",
  "contentType": "mixed",
  "keyPoints": [
    "Figure 3 shows our method (LRQK) outperforms all baselines by 15-23%",
    "Table 2 demonstrates consistent improvements across all benchmarks"
  ],
  "contentRefs": [
    {"type": "figure", "uuid": "f32cd1fa", "caption": "Accuracy comparison across methods"},  // REAL UUID from tool
    {"type": "table", "uuid": "b8e91c2d", "caption": "Detailed performance metrics"}  // REAL UUID from tool
  ]
}

**GOOD for Method Slide (with section text reference):**
{
  "slideNumber": 3,
  "title": "LRQK: Proposed Solution",
  "contentType": "mixed",
  "keyPoints": [
    "Section 3 introduces the two-stage framework with low-rank factorization",
    "The method jointly decomposes query and key matrices"
  ],
  "contentRefs": [
    {"type": "section", "uuid": "abc123", "label": "sec:method", "caption": "Method section with full LaTeX content"}
  ]
}

## Planning Guidelines
1. **Structure**: Follow standard academic presentation flow
  - Title slide
  - Introduction/Motivation
  - Background/Related Work
  - Method/Approach
  - Experiments/Results
  - Conclusion/Future Work

2. **Content Balance**:
  - Mix of bullet points, figures, and equations
  - Avoid text-heavy slides
  - Each slide should have a clear purpose and focus

3. **Resource Integration** (CRITICAL):
  - **ALWAYS check available resources** using getResourceDetails tool
  - **For each section**, ask: "What figures/tables/equations are available?"
  - **Include visual elements** for every results/methods slide
  - **Reference equations** when explaining mathematical methods
  - **Each resource has a unique UUID** for precise identification
  - **If a slide has NO contentRefs**, ask yourself: "Could I add a figure/table/equation here?"

4. **Math Formatting Rules** (CRITICAL):
  - Inline math equations MUST be surrounded by \\\\( and \\\\)
  - Display math equations MUST be surrounded by equation or equations environments
  - NEVER use $ or $$ for math delimiters (they conflict with Beamer)
  - Example inline: \\\\( E = mc^2 \\\\)
  - Example display: \\\\[ \\\\sum_{i=1}^{n} x_i = 1 \\\\]
  - In JSON, escape backslashes: use \\\\\\\\ or \\\\\\\\ instead of \\\\ or \\\\

## Output Format
Return JSON with slide skeleton:
{
  "slideCount": <number>,
  "slides": [
   {
    "slideNumber": 1,
    "title": "<slide title>",
    "purpose": "<why this slide exists>",
    "contentType": "title|bullet|figure|table|text|mixed",
    "keyPoints": ["<point1>", "<point2>"],
    "contentRefs": [
      {"type": "figure|table|algorithm|equation|section|subsection|paragraph|text", "uuid": "<uuid>", "caption": "<caption or description>", "label": "<latex label if available>"}
    ]
   }
  ]
}

## Final Checklist Before Returning
- [ ] Did I call getResourceDetails for EACH contentRef I'm adding?
- [ ] Are ALL UUIDs from actual getResourceDetails tool calls (NOT made up)?
- [ ] Does EVERY results slide have at least one figure or table contentRef?
- [ ] Does EVERY method slide have at least one equation, algorithm, OR section contentRef?
- [ ] Do introduction slides reference introduction section text or overview figures?
- [ ] Are contentRefs UUIDs REAL (matching what the tool returned)?
- [ ] Do keyPoints reference the contentRefs (e.g., "Figure X shows...", "Section Y describes...")?
- [ ] At least 80% of slides have contentRefs?
- [ ] For slides about specific concepts, did I include the relevant section/subsection text?
`;

const REVISION_SYSTEM_PROMPT = `You are a Beamer presentation slide planner expert. Your task is to REVISE an existing slide plan based on feedback from slide generation and validation.

## Your Role
- Review the previous slide plan and identify issues
- Incorporate feedback from vision validation and slide generation
- Update slide plans to fix overflow, content, and structure issues
- Split slides into multiple frames when needed (e.g., "Part 1", "Part 2")
- Ensure all slides have appropriate contentRefs

## Common Feedback Types and How to Address Them

### 1. Overflow Issues (Vision Validation)
**Feedback**: "Table overflow - content cut off at bottom", "Figure extends beyond slide"
**Action**: 
- Split the slide into two frames (Part 1, Part 2)
- Or reduce content (fewer rows, smaller figure)
- Update slide titles to indicate parts

### 2. Missing ContentRefs
**Feedback**: "Slide has no contentRefs - too abstract"
**Action**:
- Use getResourceDetails to find appropriate resources
- Add contentRefs with REAL UUIDs from the tool (NOT made up)
- For EACH contentRef, you MUST call getResourceDetails first

### 3. Content Mismatch
**Feedback**: "Content does not match original source", "Missing data"
**Action**:
- Verify contentRefs UUIDs are correct
- Ensure keyPoints accurately describe the referenced content

### 4. Too Much Content
**Feedback**: "8+ bullet points", "Severe overflow", "Split into two slides"
**Action**:
- Split into two slides with clear titles (Part 1, Part 2)
- Each slide should have 4-6 key points max

## Output Format
Return REVISED JSON with updated slide skeleton:
{
  "slideCount": <number>,
  "slides": [
   {
    "slideNumber": 1,
    "title": "<slide title>",
    "purpose": "<why this slide exists>",
    "contentType": "title|bullet|figure|table|text|mixed",
    "keyPoints": ["<point1>", "<point2>"],
    "contentRefs": [{"type": "figure|table|algorithm|equation|section", "uuid": "<REAL UUID from tool>", "caption": "<caption>", "label": "<label>"}]
   }
  ],
  "revisionNotes": "Summary of changes made based on feedback"
}

**IMPORTANT**: All UUIDs in contentRefs MUST come from getResourceDetails tool calls - DO NOT make up UUIDs!`;

export class GenerateSkeletonSlidesTask extends Task {

  constructor() {
    super();
    this.log = log.create(this.constructor.name);
    this.texResourcesTool = null;
  }

  static get name() {
    return 'GenerateSkeletonSlidesTask';
  }

  static get inputSchema() {
    return {
      analysisResult: { type: 'object', required: true },
      latexCopy: { type: 'object', required: false },
      outputDir: { type: 'string', required: false },
      memory: { type: 'object', required: false },
      // Revision mode inputs
      revisionMode: { type: 'boolean', required: false, default: false },
      previousPlan: { type: 'array', required: false, default: null },
      slideFeedback: { type: 'array', required: false, default: null }
    };
  }

  static get outputSchema() {
    return {
      presentationLatex: { type: 'string' },
      slidePlans: { type: 'array' },
      recommendedSlides: { type: 'number' },
      customPreamble: { type: 'string' },
      templateConfig: { type: 'object' },
      templateBuilder: { type: 'object' },
      success: { type: 'boolean' }
    };
  }

  /**
   * Get a summary of available resources for the prompt
   * @returns {string} Formatted resource summary
   * @private
   */
  _getResourceSummary() {
    const parts = [];
    
    for (const [type, items] of Object.entries(summary)) {
      if (items.length === 0) continue;
      
      parts.push(`\n${type.toUpperCase()}S (${items.length}):`);
      for (const item of items) {
        const uuid = item.uuid;
        const label = item.label ? ` [${item.label}]` : '';
        const caption = item.caption ? ` - ${item.caption}` : '';
        const location = item.location ? ` (in: ${item.location})` : '';
        parts.push(`  - uuid: ${uuid}${label}${caption}${location}`);
      }
    }
    
    return parts.join('\n');
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
    const { 
      analysisResult, 
      outputDir = '', 
      texResource = null,
      revisionMode = false,
      previousPlan = null,
      slideFeedback = null
    } = input;

    if (!analysisResult) {
      throw new Error('analysisResult is required');
    }

    // init tex Resource tool
    if (!texResource) {
      this.texResourcesTool = new TexResourcesTool({
        cacheDir: outputDir,
        analysisResult: analysisResult,
      });
    } else {
      this.texResourcesTool = texResource;
    }

    if (revisionMode) {
      this.log.info('Revising skeleton slide plan based on feedback...');
      return await this._executeRevision(previousPlan, slideFeedback);
    }

    this.log.info('Generating skeleton slide plan...');

    const paperInfo = analysisResult.meta || {};
    const abstract = analysisResult.abstract || '';

    const userPrompt = this._buildUserPrompt(paperInfo, analysisResult, abstract);

    const chat = new ChatSession(
      SYSTEM_PROMPT,
      this.texResourcesTool.getTools(),
      this.texResourcesTool.getHandlers(),
      {
        max_tokens: 4096,  // Reduced from 8192 to allow more input tokens
        temperature: 0.7,
      }
    );

    this.log.debug(chat._toolHandlers);

    let response = await chat.generate(userPrompt);
    const maxRetries = 16;

    for (let i = 0; i < maxRetries; i++) {
      try {
        const parsed = this._parseJsonResponse(response);
        
        // Validate UUIDs in contentRefs
        const validation = this._validateContentRefsUUIDs(parsed.slides);
        if (validation.valid) {
          this.log.success('All contentRefs UUIDs are valid');
          return parsed;
        } else {
          // Invalid UUIDs found - ask LLM to fix in next turn
          this.log.warn(`Invalid UUIDs found: ${validation.invalidUUIDs.join(', ')}`);
          response = await chat.generate(this._buildUUIDFixPrompt(validation.invalidUUIDs, validation.missingResources));
        }
      } catch (error) {
        this.log.error(`Parse error (attempt ${i + 1}/${maxRetries}):`, error.message);
        if (i === maxRetries - 1) {
          throw new Error(`Failed to generate skeleton plan after ${maxRetries} attempts: ${error.message}`);
        }
        response = await chat.generate(`JSON parsing error: ${error.message}. Please fix the JSON format and try again.`);
      }
    }
    throw new Error('Failed to generate skeleton plan');
  }

  /**
   * Validate that all contentRefs UUIDs exist in the TexResourcesTool
   * @param {Array} slides - Array of slide plans
   * @returns {{valid: boolean, invalidUUIDs: Array, missingResources: Array}}
   */
  _validateContentRefsUUIDs(slides) {
    const invalidUUIDs = [];
    const missingResources = [];

    for (const slide of slides || []) {
      for (const ref of slide.contentRefs || []) {
        if (ref.uuid) {
          const resource = this.texResourcesTool.uuidIndex?.get(ref.uuid);
          if (!resource) {
            invalidUUIDs.push(ref.uuid);
            missingResources.push({
              slideNumber: slide.slideNumber,
              slideTitle: slide.title,
              refType: ref.type,
              uuid: ref.uuid,
              caption: ref.caption
            });
          }
        }
      }
    }

    return {
      valid: invalidUUIDs.length === 0,
      invalidUUIDs,
      missingResources
    };
  }

  /**
   * Build prompt to fix invalid UUIDs
   * @param {Array} invalidUUIDs - List of invalid UUIDs
   * @param {Array} missingResources - List of resources with invalid UUIDs
   * @returns {string} Prompt string
   */
  _buildUUIDFixPrompt(invalidUUIDs, missingResources) {
    let prompt = `**CRITICAL ERROR: Invalid UUIDs in contentRefs**\n\n`;
    prompt += `The following UUIDs do NOT exist in the source tex:\n\n`;
    
    for (const missing of missingResources) {
      prompt += `- Slide ${missing.slideNumber} (${missing.slideTitle}): `;
      prompt += `UUID "${missing.uuid}" for ${missing.refType} - NOT FOUND\n`;
    }
    
    prompt += `\n**ACTION REQUIRED**:\n`;
    prompt += `1. Use getResourceDetails tool to fetch REAL UUIDs for the missing resources above\n`;
    prompt += `2. Replace invalid UUIDs with REAL ones from the tool\n`;
    prompt += `3. DO NOT make up UUIDs\n\n`;
    
    // Only show relevant resources (same type as missing)
    const relevantTypes = [...new Set(missingResources.map(m => m.refType))];
    prompt += `**Relevant Available Resources** (call getResourceDetails for these):\n`;
    for (const type of relevantTypes) {
      const nodes = this.texResourcesTool.typeIndex?.get(type) || [];
      if (nodes.length > 0) {
        prompt += `\n${type.toUpperCase()}S:\n`;
        for (const node of nodes.slice(0, 20)) {  // Limit to first 20 of each type
          prompt += `- uuid: ${node.uuid}, caption: ${(node.caption || node.title || 'N/A').substring(0, 50)}\n`;
        }
      }
    }
    
    return prompt;
  }

  /**
   * Execute revision mode - update plan based on feedback
   */
  async _executeRevision(previousPlan, slideFeedback) {
    const userPrompt = this._buildRevisionPrompt(previousPlan, slideFeedback);

    const chat = new ChatSession(
      REVISION_SYSTEM_PROMPT,
      this.texResourcesTool.getTools(),
      this.texResourcesTool.getHandlers(),
      {
        max_tokens: 4096,  // Reduced from 8192 to allow more input tokens
        temperature: 0.7,
      }
    );

    let response = await chat.generate(userPrompt);
    const maxRetries = 16;

    for (let i = 0; i < maxRetries; i++) {
      try {
        const parsed = this._parseJsonResponse(response);
        
        // Validate UUIDs in contentRefs (same as normal generation)
        const validation = this._validateContentRefsUUIDs(parsed.slides);
        if (validation.valid) {
          this.log.success('Plan revision completed with valid UUIDs');
          return parsed;
        } else {
          // Invalid UUIDs found - ask LLM to fix in next turn
          this.log.warn(`Invalid UUIDs found in revision: ${validation.invalidUUIDs.join(', ')}`);
          response = await chat.generate(this._buildUUIDFixPrompt(validation.invalidUUIDs, validation.missingResources));
        }
      } catch (error) {
        this.log.error(`Parse error (attempt ${i + 1}/${maxRetries}):`, error.message);
        if (i === maxRetries - 1) {
          throw new Error(`Failed to revise skeleton plan after ${maxRetries} attempts: ${error.message}`);
        }
        response = await chat.generate(`JSON parsing error: ${error.message}. Please fix the JSON format and try again.`);
      }
    }
    throw new Error('Failed to revise skeleton plan');
  }

  _buildUserPrompt(paperInfo, analysisResult, abstract) {
    const parts = [];

    parts.push('Create a slide skeleton for this paper:\n');

    if (paperInfo.title) {
      parts.push(`**Title**: ${paperInfo.title}`);
    }

    if (paperInfo.authors && paperInfo.authors.length > 0) {
      const authors = Array.isArray(paperInfo.authors)
        ? paperInfo.authors.map(a => a.name).join(', ')
        : paperInfo.authors;
      parts.push(`**Authors**: ${authors}`);
    }

    // Add abstract (truncate if too long)
    if (abstract) {
      const truncatedAbstract = abstract.length > 1000 ? abstract.substring(0, 1000) + '...' : abstract;
      parts.push(`\n**Abstract**:\n${truncatedAbstract}\n`);
    }

    // Add document structure summary (not full LaTeX)
    parts.push('\n**Document Structure** (use getResourceDetails to fetch full content):');
    parts.push(this.texResourcesTool.getResourceSummaryString());

    // Add available resources summary
    const resourcesSummary = this._getAvailableResourcesSummary();
    parts.push('\n\n**Available Resources for ContentRefs** (CRITICAL - Use These!):');
    parts.push(resourcesSummary);

    parts.push('\n\n**Instructions**:\n');
    parts.push('- For each slide, specify contentType: "title", "bullet", "figure", "table", "text", or "mixed"');
    parts.push('- When referencing figures/tables/equations/sections, use contentRefs with their UUID');
    parts.push('- Use getResourceDetails tool to fetch full resource details when planning content');
    parts.push('- IMPORTANT: Include contentRefs for EVERY slide that can use visual/mathematical/textual content');
    parts.push('- Results slides MUST have figure/table contentRefs');
    parts.push('- Method slides SHOULD have equation/algorithm/section contentRefs');
    parts.push('- Introduction slides SHOULD have introduction section text or overview figure contentRefs');
    parts.push('- For slides about specific concepts, include the relevant section/subsection text as contentRefs');

    return parts.join('\n');
  }

  /**
   * Build revision prompt with feedback from slide generation/validation
   */
  _buildRevisionPrompt(previousPlan, slideFeedback) {
    const parts = [];

    parts.push('**REVISE the slide plan based on feedback from slide generation and validation.**\n');

    // Show previous plan
    parts.push('## PREVIOUS SLIDE PLAN');
    parts.push(`Total slides: ${previousPlan?.length || 0}\n`);
    
    for (const slide of previousPlan || []) {
      parts.push(`### Slide ${slide.slideNumber}: ${slide.title}`);
      parts.push(`- **Purpose**: ${slide.purpose}`);
      parts.push(`- **Content Type**: ${slide.contentType}`);
      parts.push(`- **Key Points**: ${slide.keyPoints?.join('; ') || 'N/A'}`);
      if (slide.contentRefs && slide.contentRefs.length > 0) {
        parts.push(`- **ContentRefs**: ${slide.contentRefs.map(r => `${r.type}:${r.uuid}`).join(', ')}`);
      } else {
        parts.push(`- **ContentRefs**: NONE`);
      }
      parts.push('');
    }

    // Show feedback for each slide
    if (slideFeedback && slideFeedback.length > 0) {
      parts.push('\n## FEEDBACK FROM VALIDATION');
      parts.push('The following issues were detected during slide generation and validation:\n');

      for (const feedback of slideFeedback) {
        parts.push(`### Slide ${feedback.slideNumber}: ${feedback.slideTitle || 'Unknown'}`);
        parts.push(`**Feedback Source**: ${feedback.source || 'Vision Validation'}`);
        parts.push(`**Status**: ${feedback.status || 'FAILED'}`);
        
        if (feedback.visionResult) {
          parts.push(`**Vision Score**: ${feedback.visionResult.score}/100`);
          parts.push(`**Vision Reason**: ${feedback.visionResult.reason}`);
          
          if (feedback.visionResult.overflowDetails) {
            const overflow = feedback.visionResult.overflowDetails;
            parts.push(`**Overflow Details**:`);
            parts.push(`- Type: ${overflow.overflowType}`);
            parts.push(`- Affected Element: ${overflow.affectedElement}`);
            parts.push(`- Direction: ${overflow.overflowDirection}`);
            parts.push(`- Severity: ${overflow.severity}`);
          }
          
          if (feedback.visionResult.recommendations && feedback.visionResult.recommendations.length > 0) {
            parts.push(`**Recommendations**:`);
            for (const rec of feedback.visionResult.recommendations) {
              parts.push(`- ${rec}`);
            }
          }
        }

        if (feedback.alignmentResult) {
          parts.push(`**Alignment Score**: ${feedback.alignmentResult.score}/100`);
          parts.push(`**Is Aligned**: ${feedback.alignmentResult.isAligned}`);
          if (feedback.alignmentResult.sourceAlignment) {
            parts.push(`**Alignment Issue**: ${feedback.alignmentResult.sourceAlignment}`);
          }
        }

        if (feedback.error) {
          parts.push(`**Error**: ${feedback.error}`);
        }

        parts.push('');
      }

      // Instructions for revision
      parts.push('\n## REVISION INSTRUCTIONS');
      parts.push('Based on the feedback above, revise the slide plan:');
      parts.push('1. **For overflow issues**: Split slides into two frames (Part 1, Part 2) or reduce content');
      parts.push('2. **For missing contentRefs**: Add appropriate figures, tables, equations, or section text');
      parts.push('3. **For alignment issues**: Verify contentRefs UUIDs and update keyPoints');
      parts.push('4. **For severe overflow**: Split the slide and adjust titles accordingly');
      parts.push('5. Keep slide numbers sequential and update slideCount');
      parts.push('6. Include "revisionNotes" in your response explaining what changed');
    }

    return parts.join('\n');
  }

  /**
   * Get a summary of available resources with counts by type
   * @returns {string} Formatted resource summary with counts
   * @private
   */
  _getAvailableResourcesSummary() {
    const summary = {
      figures: [],
      tables: [],
      algorithms: [],
      equations: [],
      sections: [],
      subsections: [],
      paragraphs: [],
      text: []
    };

    // Collect resources by type
    for (const [type, nodes] of Object.entries(this.texResourcesTool.typeIndex || {})) {
      if (summary[type] !== undefined) {
        summary[type] = nodes;
      }
    }

    const parts = [];
    let totalCount = 0;

    // Visual elements first (figures, tables, algorithms)
    for (const type of ['figures', 'tables', 'algorithms']) {
      const items = summary[type];
      if (items.length === 0) continue;

      const typeLabel = type.charAt(0).toUpperCase() + type.slice(1);
      parts.push(`\n**${typeLabel}** (${items.length} available):`);
      for (const item of items) {
        const uuid = item.uuid;
        const label = item.label ? ` [${item.label}]` : '';
        const caption = item.caption ? ` - ${item.caption.substring(0, 80)}${item.caption.length > 80 ? '...' : ''}` : '';
        const location = item.location ? ` (in: ${item.location})` : '';
        parts.push(`  - uuid: ${uuid}${label}${caption}${location}`);
      }
      totalCount += items.length;
    }

    // Math elements (equations)
    for (const type of ['equations']) {
      const items = summary[type];
      if (items.length === 0) continue;

      const typeLabel = type.charAt(0).toUpperCase() + type.slice(1);
      parts.push(`\n**${typeLabel}** (${items.length} available):`);
      for (const item of items) {
        const uuid = item.uuid;
        const label = item.label ? ` [${item.label}]` : '';
        const caption = item.text ? ` - ${item.text.substring(0, 60)}${item.text.length > 60 ? '...' : ''}` : '';
        parts.push(`  - uuid: ${uuid}${label}${caption}`);
      }
      totalCount += items.length;
    }

    // Text/structure elements (sections, subsections, paragraphs)
    for (const type of ['sections', 'subsections', 'paragraphs']) {
      const items = summary[type];
      if (items.length === 0) continue;

      const typeLabel = type.charAt(0).toUpperCase() + type.slice(1);
      parts.push(`\n**${typeLabel}** (${items.length} available - use for method/introduction slides):`);
      for (const item of items) {
        const uuid = item.uuid;
        const label = item.label ? ` [${item.label}]` : '';
        const title = item.title ? ` - ${item.title}` : '';
        const location = item.location ? ` (in: ${item.location})` : '';
        parts.push(`  - uuid: ${uuid}${label}${title}${location}`);
      }
      totalCount += items.length;
    }

    if (totalCount > 0) {
      parts.unshift(`\n**Total: ${totalCount} resources available** - You should use MOST of them in your slides!`);
      parts.push(`\n**Remember**: Include contentRefs for EVERY slide! Use section/subsection text for method and introduction slides.`);
    } else {
      parts.push('\nNo specific resources found. Use bullet points and equations from the paper text.');
    }

    return parts.join('\n');
  }

  _parseJsonResponse(response) {

    // Escape backslashes for JSON parsing
    if (!response || typeof response !== 'string') {
      throw new Error('Response is not a string');
    }

    // Use the enhanced JSON parser with LaTeX escaping support
    const result = parseJSONResponse(response, {
      requiredKeys: ['slides'],
      logLevel: 'warn',
      handleLatexEscaping: true,  // Enable LaTeX math delimiter escaping
      replaceBlackSlash: false,   // handleLatexEscaping handles this
    });

    if (result.success && result.data && result.data.slides) {
      return {
        slideCount: result.data.slideCount || result.data.slides.length,
        slides: result.data.slides
      };
    }

    throw new Error('Failed to parse JSON response');
  }

}

export default GenerateSkeletonSlidesTask;

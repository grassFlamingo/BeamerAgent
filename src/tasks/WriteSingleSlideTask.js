import Task from './Task.js';
import apiClient, { ChatSession, MessageBuilder } from '../utils/apiClient.js';
import config from '../config.js';
import { LatexUtils, TeXCompilerError } from '../utils/latexUtils.js';
import { log } from '../utils/logger.js';
import { parseJSONResponse } from '../utils/jsonParser.js';
import BeamerBuilderWithTemplate from '../utils/BeamerBuilderWithTemplate.js';
import fs from 'fs';
import path from 'path';
import { TexResourcesTool } from '../llm_tools/TexResourcesTool.js';

const SYSTEM_PROMPT = `You are a Beamer LaTeX expert. Your task is to create a single slide (frame) for a Beamer presentation based on the provided slide plan.

## IMPORTANT: Think Before You Write
Before generating any LaTeX code, you MUST think through the following steps:

### Step 1: Analyze the Slide Plan
- What is the main message of this slide?
- What content type is required (title, bullet, figure, table, text, mixed)?
- What are the key points that must be included?
- Are there any content references (figures, tables, data) that need to be fetched?

### Step 2: Plan the Layout
- How much content needs to fit on this slide?
- Will the content fit comfortably or is it at risk of overflow?
- What environments are most appropriate (itemize, figure, table, equation)?
- Should you use columns, blocks, or a simple layout?

### Step 3: Fetch Required Resources
- Use getResourceDetails tool to fetch any referenced content (figures, tables, data)
- Review the fetched content and understand its structure
- Plan how to convert it to proper LaTeX

### Step 4: Consider Overflow Prevention
- **For figures**: What size constraint is needed? (typically 0.5-0.7\\linewidth for safety)
- **For tables**: How many rows/columns? Will it need \\resizebox, \\small font, or splitting?
- **For equations**: Are they long? Should you use split/multline environments?
- **For text**: How many bullet points? Should you use \\small or split across slides?
- **If content is too dense**: Should you split into TWO FRAMES (part 1, part 2)?

### Step 4.5: Evaluate if Splitting is Needed
**Split into two frames when:**
- Tables have 12+ rows that can't be compressed further
- Multiple large figures that don't fit on one slide
- Complex content with many bullet points (8+)
- Previous vision feedback indicates severe overflow
- Retry history shows repeated overflow failures

**How to split:**
- Create TWO separate frames with clear titles (e.g., "Method Overview (Part 1)" and "Method Overview (Part 2)")
- Split content logically (e.g., first half of rows, first 4 bullet points)
- Each frame should be self-contained and make sense independently
- Use consistent formatting across both frames

### Step 5: Generate the LaTeX Code
- Write the complete frame with proper syntax
- Include size constraints proactively (better to be smaller than overflow)
- Use % BEGIN_FRAME and % END_FRAME markers

## Your Role
- Convert slide plans into proper LaTeX Beamer frame code
- Use appropriate Beamer environments for content type
- Handle figures, tables, equations, and bullet points correctly
- Ensure proper LaTeX syntax and Beamer conventions
- **PROACTIVELY prevent overflow** by sizing content appropriately

## IMPORTANT: You MUST Generate LaTeX Code
- You should OUTPUT LaTeX code, NOT JSON data or tool results
- Use the getResourceDetails tool INTERNALLY to fetch content details
- After fetching content, CONVERT it to proper LaTeX in your response
- NEVER return raw JSON or tool output as the slide content

## Content Overflow Prevention (CRITICAL)
**Always assume content will overflow unless you proactively prevent it:**

### Figures - REAL EXAMPLE
**Problem**: TikZ diagrams often overflow when using absolute coordinates.

**Before (causes overflow)**:
  \\begin{tikzpicture}
    \\node at (0,0) {Start};
    \\node at (10,0) {End};  % May go off slide!
  \\end{tikzpicture}

**After (prevents overflow)**:
  \\begin{figure}[tbp]
  \\centering
  \\resizebox{0.7\\linewidth}{!}{
    \\begin{tikzpicture}[scale=0.8, every node/.style={font=\\small}]
      \\node at (0,0) {Start};
      \\node at (10,0) {End};
    \\end{tikzpicture}
  }
  \\caption{Your caption here}
  \\end{figure}

**Guidelines**:
- Default to \\includegraphics[width=0.6\\linewidth] or smaller
- For tall figures: add height=0.4\\textheight constraint
- For TikZ: ALWAYS wrap in \\resizebox{0.7\\linewidth}{!}{...}
- For TikZ: use [scale=0.8, every node/.style={font=\\small}]

### Tables - REAL EXAMPLE
**Problem**: Tables with many columns/rows often overflow.

**Before (causes overflow - 10 columns, many rows)**:
  \\begin{table}[htbp]
  \\begin{tabular}{r|rr|rr|rr|rr|rr}
    \\toprule
    & \\multicolumn{2}{c|}{4K} & \\multicolumn{2}{c|}{8K} & ...
    Method1 & 100 & 200 & 300 & 400 & ...
    Method2 & 110 & 210 & 310 & 410 & ...
    ... (12+ rows)
  \\end{tabular}
  \\end{table}

**After (prevents overflow)**:
  \\begin{table}[htbp]
  \\centering
  \\caption{Your table caption}
  \\small  % Reduce font size
  \\setlength{\\tabcolsep}{2pt}  % Reduce column spacing (default 6pt)
  \\renewcommand{\\arraystretch}{0.7}  % Reduce row spacing (default 1.0)
  \\begin{tabular}{r|rr|rr|rr|rr|rr}
    \\toprule
    ...
  \\end{tabular}
  \\end{table}

**For tables with 12+ rows - split into two tables**:
  % Table 1 (first half)
  \\begin{table}[tbp]
  \\centering
  \\caption{Results comparison (part 1: methods A-F)}
  \\small
  \\setlength{\\tabcolsep}{3pt}
  \\renewcommand{\\arraystretch}{0.8}
  \\begin{tabular}{...}
  % Rows 1-6 only
  \\end{tabular}
  \\end{table}

  % Table 2 (second half)
  \\begin{table}[tbp]
  \\centering
  \\caption{Results comparison (part 2: methods G-L)}
  \\small
  \\setlength{\\tabcolsep}{3pt}
  \\renewcommand{\\arraystretch}{0.8}
  \\begin{tabular}{...}
  % Rows 7-12
  \\end{tabular}
  \\end{table}

**Guidelines**:
- For 5+ columns: consider \\resizebox{\\linewidth}{!}{...}
- For 8+ rows: use \\setlength{\\tabcolsep}{3pt} and \\renewcommand{\\arraystretch}{0.7}
- For 12+ rows: split into two tables (part 1, part 2)
- Default to \\small or \\footnotesize for data-heavy tables
- Use \\toprule, \\midrule, \\bottomrule from booktabs

### Equations - REAL EXAMPLE
**Problem**: Long equations exceed line width.

**Before (causes overflow)**:
  \\begin{equation}
  \\mathcal{L}(\\theta) = \\sum_{i=1}^{N} \\left( y_i - f(x_i; \\theta) \\right)^2 + \\lambda \\|\\theta\\|^2 + \\text{additional terms}
  \\end{equation}

**After (prevents overflow)**:
  \\begin{equation}
  \\begin{split}
  \\mathcal{L}(\\theta) &= \\sum_{i=1}^{N} \\left( y_i - f(x_i; \\theta) \\right)^2 \\\\
  &\\quad + \\lambda \\|\\theta\\|^2 + \\text{regularization}
  \\end{split}
  \\end{equation}

**Guidelines**:
- Long equations: use \\begin{split} to break across lines
- Use & for alignment points
- Use \\\\ for line breaks
- Use \\quad or \\qquad for indentation
- Complex equations: consider \\small font size

### Text/Bullets - REAL EXAMPLE
**Problem**: Too many bullet points or long text.

**Before (causes overflow)**:
  \\begin{frame}{Method Overview}
  \\begin{itemize}
    \\item First point with very long explanation that goes over multiple lines...
    \\item Second point also very long...
    \\item Third point...
    \\item Fourth point...
    \\item Fifth point...
    \\item Sixth point...
    \\item Seventh point...
  \\end{itemize}
  \\end{frame}

**After (prevents overflow)**:
  \\begin{frame}{Method Overview}
  {\\small  % Reduce font size for dense content
  \\begin{itemize}
    \\item First point (concise, max 2 lines)
    \\item Second point (concise, max 2 lines)
    \\item Third point (concise, max 2 lines)
    \\item Fourth point (concise, max 2 lines)
  \\end{itemize}
  }
  % Move remaining points to next slide or use two columns
  \\end{frame}

**Guidelines**:
- 6+ bullet points: use {\\small ...} scope
- Long bullet points: keep to 2 lines max, split if needed
- Dense content: consider splitting across multiple slides
- Use two columns for side-by-side content:
  \\begin{columns}
    \\begin{column}{0.48\\linewidth}
      % Left column content
    \\end{column}
    \\begin{column}{0.48\\linewidth}
      % Right column content
    \\end{column}
  \\end{columns}

### Splitting Content Across Two Frames (When Necessary)
**When to split:**
- Vision feedback indicates "severe overflow" or recommends "split into two slides"
- Tables with 12+ rows that don't fit even with \\small and \\resizebox
- Multiple large figures or complex diagrams
- 8+ bullet points with detailed explanations
- Retry history shows repeated overflow failures

**How to split - Example:**

**Before (overflow):**
  \\begin{frame}{Experimental Results}
  % 15-row table that overflows
  \\end{frame}

**After (split into two frames):**
  \\begin{frame}{Experimental Results (Part 1: Methods A-F)}
  \\small
  \\setlength{\\tabcolsep}{3pt}
  \\renewcommand{\\arraystretch}{0.8}
  \\begin{tabular}{...}
  % First 7 rows only
  \\end{tabular}
  \\end{frame}

  \\begin{frame}{Experimental Results (Part 2: Methods G-L)}
  \\small
  \\setlength{\\tabcolsep}{3pt}
  \\renewcommand{\\arraystretch}{0.8}
  \\begin{tabular}{...}
  % Remaining rows
  \\end{tabular}
  \\end{frame}

**For bullet points:**
  \\begin{frame}{Background (Part 1: Key Concepts)}
  \\begin{itemize}
    \\item First 4 key points...
  \\end{itemize}
  \\end{frame}

  \\begin{frame}{Background (Part 2: Related Work)}
  \\begin{itemize}
    \\item Remaining points...
  \\end{itemize}
  \\end{frame}

**Important:**
- Each frame should have a clear, descriptive title indicating it's Part 1 or Part 2
- Split at logical breakpoints (e.g., halfway through rows, by topic)
- Each frame must be self-contained and understandable on its own
- Use consistent formatting (font size, spacing) across both frames
- Mark frames with % BEGIN_FRAME and % END_FRAME separately

## Content Type Guidelines
- **title**: Title slide with \\titleframe or similar
- **bullet**: Use itemize/enumerate environments with \\item
- **figure**: Use \\begin{figure} with \\includegraphics
- **table**: Use \\begin{table} with tabular environment
- **text**: Plain text content with proper formatting
- **mixed**: Combination of above elements

## Math Formatting Rules (CRITICAL)
- Inline math: Use \\( and \\) NOT $ and $
- Display math: Use \\begin{equation}...\\end{equation} or \\[...\\]
- NEVER use $$ for display math (conflicts with Beamer)

## Figure Handling
- Use \\includegraphics or tikz figure for figures
- Include \\caption{} and \\label{} when provided
- Reference figures from contentRefs with their UUID

## Table Handling
- Convert table data to proper \\begin{tabular} environment
- Use \\toprule, \\midrule, \\bottomrule from booktabs
- Include \\caption{} and \\label{} from the contentRefs

## Output Format
Return the COMPLETE frame with \\begin{frame}{frame title}...\\end{frame}:
- Follow with content (itemize, figure, table, text, etc.)
- Do NOT include preamble or document structure
- Wrap your frame content between % BEGIN_FRAME and % END_FRAME markers

## Notices
- don't use '\\n' for line break since it's not supported in Latex
- double backslashes '\\\\' or '\\newline' means the line break

### 1. Wrong Line Break Command
**Problem:** Using '\\n' instead of '\\\\' in LaTeX equations

% WRONG
\\begin{aligned}
  x &= 1 \\n
  y &= 2
\\end{aligned}


**Fix:** Use '\\\\ for line breaks

% CORRECT
\\begin{aligned}
  x &= 1 \\\\
  y &= 2
\\end{aligned}


## Example output:
% BEGIN_FRAME <- must be included
\\begin{frame}{Introduction}
\\begin{itemize}
  \\item First point here
  \\item Second point here
\\end{itemize}

\\begin{figure}[tbp]
  \\centering
  \\includegraphics[width=0.8\\linewidth]{placeholder.png}
  \\caption{Figure caption}
  \\label{fig:example}
\\end{figure}
\\end{frame}
% END_FRAME <- must be included`;

export class WriteSingleSlideTask extends Task {

  static log = log.create(WriteSingleSlideTask.name);

  constructor() {
    super();
    this.log = log.create(this.constructor.name);
  }

  static get name() {
    return 'WriteSingleSlideTask';
  }

  static get inputSchema() {
    return {
      slidePlan: { type: 'object', required: true },
      texResourcesTool: { type: 'object', required: true },
      beamerBuilder: { type: 'object', required: true },
      outputDir: { type: 'string', required: true },
      templatePath: { type: 'string', required: false },
      texFrameFromLastSuccess: { type: 'string', required: false, default: null },
      visionFeedback: { type: 'object', required: false, default: null },
      retryHistory: { type: 'array', required: false, default: null }
    };
  }

  static get outputSchema() {
    return {
      success: { type: 'boolean' },
      frameContent: { type: 'string' },
      fullLatex: { type: 'string' },
      pdfPath: { type: 'string' },
      error: { type: 'string' }
    };
  }

  /**
   * Task: create a single beamer frame with respect to the given slide plan
   *
   * @requires slidePlan - the plan from GenerateSkeletonSlidesTask
   * @requires texResourcesTool - TexResourcesTool instance to access original tex text
   * @requires beamerBuilder - BeamerBuilderWithTemplate instance
   * @requires outputDir - output directory for compiled PDF
   * @requires templatePath - path to the Beamer template file
   *
   * @pipeline
   *    1. Generate a complete beamer frame with \\begin{frame}{Title}...\\end{frame}
   *    2. Apply to beamerBuilder to get full LaTeX
   *    3. Write and compile using LatexUtils.compileTeXString
   *    4. If compile error:
   *       - Ask LLM to fix with feedback from compiler
   *       - Retry (up to maxRetries)
   *    5. Return the generated beamer tex and PDF path
   */
  async execute(input) {
    const {
      slidePlan,
      texResourcesTool,
      beamerBuilder,
      outputDir,
      templatePath,
      texFrameFromLastSuccess = null,
      visionFeedback = null,
      retryHistory = null
    } = input;

    if (!slidePlan) {
      throw new Error('slidePlan is required');
    }
    if (!texResourcesTool) {
      throw new Error('texResourcesTool is required');
    }
    if (!beamerBuilder) {
      throw new Error('beamerBuilder is required');
    }
    if (!outputDir) {
      throw new Error('outputDir is required');
    }

    this.log.info(`Writing slide ${slidePlan.slideNumber}: ${slidePlan.title || 'Untitled'}`);

    // Ensure output directory exists
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    // Build user prompt with slide plan and resource context
    const userPrompt = this._buildUserPrompt(slidePlan, texResourcesTool, texFrameFromLastSuccess, visionFeedback, retryHistory);

    // Create chat session
    const chat = new ChatSession(
      SYSTEM_PROMPT,
      texResourcesTool.getTools(),
      texResourcesTool.getHandlers(),
      {
        max_tokens: 8192,
        temperature: 0.7,
        maxTurns: 64  // Increased from 3 to allow more tool calls for fetching multiple contentRefs
      }
    );

    const maxRetries = 8;
    let frameContent = await chat.generate(userPrompt);
    let lastError = null;

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      // Generate frame content
      // Apply to template
      frameContent = this._extractFrameContent(frameContent);
      const fullLatex = await beamerBuilder.apply(frameContent);

      // Compile using compileTeXString
      const jobName = `slide-${slidePlan.slideNumber}`;
      this.log.info(`Compiling slide ${slidePlan.slideNumber}...`);
      try {
        const compileResult = await LatexUtils.compileTeXString(fullLatex, outputDir, jobName);
        if (compileResult.success) {
          this.log.success(`Slide ${slidePlan.slideNumber} compiled successfully!`);
          return {
            success: true,
            frameContent: frameContent,
            fullLatex: fullLatex,
            pdfPath: compileResult.pdfPath,
            texPath: compileResult.texPath
          };
        }
      } catch (error) {
        if (error instanceof TeXCompilerError) {
          const errorMsg = this._buildCompileErrorMessage(error, frameContent, slidePlan.slideNumber);
          this.log.error(errorMsg);

          frameContent = await chat.generate(errorMsg);
          continue;
        }
        throw error;
      }
    }
    return {
      success: false,
      error: 'Failed to generate slide after maximum retries',
      slideNumber: slidePlan.slideNumber
    };
  }

  /**
   * Build user prompt with slide plan and resource information
   * @param {Object} slidePlan - Slide plan object
   * @param {TexResourcesTool} texResourcesTool - Resource tool instance
   * @param {string|null} texFrameFromLastSuccess - Previous successful TeX frame for reference (optional)
   * @param {Object|null} visionFeedback - Vision validation feedback with improvement suggestions (optional)
   * @param {Array|null} retryHistory - Full history of previous attempts with tex frames and feedback (optional)
   * @returns {string} User prompt string
   */
  _buildUserPrompt(slidePlan, texResourcesTool, texFrameFromLastSuccess = null, visionFeedback = null, retryHistory = null) {
    const parts = [];

    parts.push(`Create a Beamer slide for the following plan:\n`);

    // Slide info
    parts.push(`**Slide ${slidePlan.slideNumber}: ${slidePlan.title || 'Untitled'}**`);
    parts.push(`**Purpose**: ${slidePlan.purpose || 'N/A'}`);
    parts.push(`**Content Type**: ${slidePlan.contentType || 'mixed'}`);

    // Key points
    if (slidePlan.keyPoints && slidePlan.keyPoints.length > 0) {
      parts.push(`\n**Key Points**:`);
      for (const point of slidePlan.keyPoints) {
        parts.push(`- ${point}`);
      }
    }

    // Content references
    if (slidePlan.contentRefs && slidePlan.contentRefs.length > 0) {
      parts.push(`\n**Content References** (use getResourceDetails tool to fetch full details):`);
      for (const ref of slidePlan.contentRefs) {
        const label = ref.label ? ` (label: ${ref.label})` : '';
        const caption = ref.caption ? ` - ${ref.caption}` : '';
        parts.push(`- ${ref.type}: uuid=${ref.uuid}${label}${caption}`);
      }

      // Add resource summary for context
      parts.push(`\n**Available Resources**:`);
      parts.push(texResourcesTool.getResourceSummaryString());
    }

    // Full retry history with all previous attempts
    if (retryHistory && retryHistory.length > 0) {
      parts.push(`\n**Full Retry History (ALL Previous Attempts)**:`);
      parts.push(`This slide has been attempted ${retryHistory.length} times before. Here is the complete history:`);
      
      for (const attempt of retryHistory) {
        parts.push(`\n--- Attempt ${attempt.retryCount + 1} ---`);
        parts.push(`**Status**: ${attempt.status}`);
        
        if (attempt.status === 'compile_failed') {
          parts.push(`**Compilation Error**: ${attempt.error || 'Unknown error'}`);
          if (attempt.texFrame) {
            parts.push(`**TeX Frame that caused error**:`);
            parts.push(`\`\`\`latex\n${attempt.texFrame.substring(0, 500)}${attempt.texFrame.length > 500 ? '...[truncated]' : ''}\n\`\`\``);
          }
        } else if (attempt.status === 'vision_failed') {
          parts.push(`**Vision Score**: ${attempt.visionResult?.score}/100`);
          parts.push(`**Vision Reason**: ${attempt.visionResult?.reason}`);
          if (attempt.visionResult?.overflowDetails) {
            const details = attempt.visionResult.overflowDetails;
            parts.push(`**Overflow Details**:`);
            parts.push(`- Type: ${details.overflowType}`);
            parts.push(`- Affected Element: ${details.affectedElement}`);
            parts.push(`- Direction: ${details.overflowDirection}`);
            parts.push(`- Severity: ${details.severity}`);
            if (details.suggestions && details.suggestions.length > 0) {
              parts.push(`- Suggestions: ${details.suggestions.join('; ')}`);
            }
          }
          if (attempt.visionResult?.recommendations && attempt.visionResult.recommendations.length > 0) {
            parts.push(`**Recommendations**: ${attempt.visionResult.recommendations.join('; ')}`);
          }
          if (attempt.texFrame) {
            parts.push(`**TeX Frame that was generated**:`);
            parts.push(`\`\`\`latex\n${attempt.texFrame.substring(0, 500)}${attempt.texFrame.length > 500 ? '...[truncated]' : ''}\n\`\`\``);
          }
        } else if (attempt.status === 'alignment_failed') {
          parts.push(`**Alignment Score**: ${attempt.alignmentResult?.alignmentScore}/100`);
          parts.push(`**Is Aligned**: ${attempt.alignmentResult?.isAligned}`);
          
          if (attempt.alignmentResult?.discrepancies && attempt.alignmentResult.discrepancies.length > 0) {
            parts.push(`**Discrepancies**:`);
            for (const disc of attempt.alignmentResult.discrepancies) {
              parts.push(`- [${disc.type}] ${disc.description}`);
              if (disc.sourceText) parts.push(`  Source: "${disc.sourceText}"`);
              if (disc.frameContent) parts.push(`  Frame: "${disc.frameContent}"`);
              if (disc.severity) parts.push(`  Severity: ${disc.severity}`);
            }
          }
          
          if (attempt.alignmentResult?.missingContent && attempt.alignmentResult.missingContent.length > 0) {
            parts.push(`**Missing Content**:`);
            for (const missing of attempt.alignmentResult.missingContent) {
              parts.push(`- [${missing.importance}] ${missing.description}`);
              if (missing.sourceText) parts.push(`  Source: "${missing.sourceText}"`);
            }
          }
          
          if (attempt.alignmentResult?.inaccuracies && attempt.alignmentResult.inaccuracies.length > 0) {
            parts.push(`**Inaccuracies**:`);
            for (const inacc of attempt.alignmentResult.inaccuracies) {
              parts.push(`- ${inacc.description}`);
              if (inacc.correction) parts.push(`  Correction: ${inacc.correction}`);
            }
          }
          
          if (attempt.alignmentResult?.recommendations && attempt.alignmentResult.recommendations.length > 0) {
            parts.push(`**Recommendations for Alignment**:`);
            for (const rec of attempt.alignmentResult.recommendations) {
              parts.push(`- ${rec}`);
            }
          }
          
          if (attempt.texFrame) {
            parts.push(`**TeX Frame that was generated**:`);
            parts.push(`\`\`\`latex\n${attempt.texFrame.substring(0, 500)}${attempt.texFrame.length > 500 ? '...[truncated]' : ''}\n\`\`\``);
          }
        }
      }
      
      parts.push(`\n**CRITICAL**: You have seen all previous attempts and their failures. Your task is to:`);
      parts.push(`1. Analyze what went wrong in each attempt`);
      parts.push(`2. Learn from the mistakes (compilation errors, vision feedback)`);
      parts.push(`3. Generate a NEW solution that addresses ALL identified issues`);
      parts.push(`4. DO NOT repeat the same mistakes - try a different approach if needed`);
      
      // Check if any attempt had severe overflow or split recommendation
      const hasSevereOverflow = retryHistory.some(attempt => 
        attempt.status === 'vision_failed' && 
        attempt.visionResult?.overflowDetails?.severity === 'severe'
      );
      const hasSplitRecommendation = retryHistory.some(attempt => 
        attempt.status === 'vision_failed' && 
        attempt.visionResult?.recommendations?.some(rec => 
          rec.toLowerCase().includes('split') || rec.toLowerCase().includes('two slide')
        )
      );
      
      if (hasSevereOverflow || hasSplitRecommendation) {
        parts.push(`\n\n**⚠️ CRITICAL: SPLIT INTO TWO FRAMES ⚠️**`);
        parts.push(`Previous attempts had SEVERE OVERFLOW. You MUST split this content into TWO separate frames:`);
        parts.push(`1. Create **Frame 1** with title "(Part 1: ...)" containing first half of content`);
        parts.push(`2. Create **Frame 2** with title "(Part 2: ...)" containing remaining content`);
        parts.push(`3. Each frame should be self-contained and fit without overflow`);
        parts.push(`\nExample:`);
        parts.push(`  \\begin{frame}{Results (Part 1: Methods A-F)} ... \\end{frame}`);
        parts.push(`  \\begin{frame}{Results (Part 2: Methods G-L)} ... \\end{frame}`);
      }
    }

    // Previous TeX frame from last successful compilation (kept for backward compatibility)
    if (texFrameFromLastSuccess && (!retryHistory || retryHistory.length === 0)) {
      parts.push(`\n**Previous TeX Frame (from last successful compilation)**:`);
      parts.push(`The following TeX frame was generated in a previous attempt. Use it as reference, but address the vision feedback below to improve the slide.`);
      parts.push(`\n\`\`\`latex\n${texFrameFromLastSuccess}\n\`\`\``);
    }

    // Vision feedback from validation (kept for backward compatibility)
    if (visionFeedback && (!retryHistory || retryHistory.length === 0)) {
      parts.push(`\n**Vision Validation Feedback**:`);
      parts.push(`The previous slide was reviewed by a vision validator. Here is the feedback:`);

      if (visionFeedback.reason) {
        parts.push(`\n- **Reason**: ${visionFeedback.reason}`);
      }
      if (visionFeedback.visibility) {
        parts.push(`- **Visibility**: ${visionFeedback.visibility}`);
      }
      if (visionFeedback.layout) {
        parts.push(`- **Layout**: ${visionFeedback.layout}`);
      }
      if (visionFeedback.clarity) {
        parts.push(`- **Clarity**: ${visionFeedback.clarity}`);
      }
      if (visionFeedback.contentMatch) {
        parts.push(`- **Content Match**: ${visionFeedback.contentMatch}`);
      }
      
      // Check if split is recommended
      let splitRecommended = false;
      if (visionFeedback.recommendations && visionFeedback.recommendations.length > 0) {
        parts.push(`\n**Recommendations for Improvement**:`);
        for (const rec of visionFeedback.recommendations) {
          parts.push(`- ${rec}`);
          if (rec.toLowerCase().includes('split') || rec.toLowerCase().includes('two slide')) {
            splitRecommended = true;
          }
        }
      }
      
      // Check overflow severity
      if (visionFeedback.overflowDetails) {
        const overflow = visionFeedback.overflowDetails;
        if (overflow.severity === 'severe') {
          splitRecommended = true;
          parts.push(`\n**⚠️ SEVERE OVERFLOW DETECTED**:`);
          parts.push(`- **Element**: ${overflow.affectedElement || 'Content'}`);
          parts.push(`- **Direction**: ${overflow.overflowDirection || 'multiple sides'}`);
          parts.push(`- **Recommendation**: SPLIT this slide into TWO frames (Part 1 and Part 2)`);
        }
      }

      if (splitRecommended) {
        parts.push(`\n\n**⚠️ CRITICAL: SPLIT INTO TWO FRAMES ⚠️**`);
        parts.push(`The vision validator recommends splitting this content into TWO separate frames:`);
        parts.push(`1. Create **Frame 1** with title "(Part 1: ...)" containing first half of content`);
        parts.push(`2. Create **Frame 2** with title "(Part 2: ...)" containing remaining content`);
        parts.push(`3. Each frame should be self-contained and fit without overflow`);
        parts.push(`4. Use consistent formatting across both frames`);
        parts.push(`\nExample:`);
        parts.push(`  \\begin{frame}{Results (Part 1: Methods A-F)} ... \\end{frame}`);
        parts.push(`  \\begin{frame}{Results (Part 2: Methods G-L)} ... \\end{frame}`);
      }

      parts.push(`\n**IMPORTANT**: You MUST address all the vision feedback points above when regenerating this slide.`);
    }

    // Instructions based on content type
    parts.push(`\n**Instructions**:`);
    const contentType = slidePlan.contentType || 'mixed';

    if (contentType === 'title') {
      parts.push('- Create a title slide with the paper title, authors, and affiliations');
    } else if (contentType === 'bullet') {
      parts.push('- Use itemize or enumerate environments for bullet points');
      parts.push('- Keep bullet points concise (1-2 lines each)');
    } else if (contentType === 'figure') {
      parts.push('- Use figure environment with \\includegraphics');
      parts.push('- Include caption and label from contentRefs');
    } else if (contentType === 'table') {
      parts.push('- Use getResourceDetails tool to fetch the table content by UUID');
      parts.push('- Convert the table data to proper \\begin{tabular} LaTeX environment');
      parts.push('- Use \\toprule, \\midrule, \\bottomrule from booktabs package');
      parts.push('- Include \\caption{} and \\label{} from the contentRefs');
    } else if (contentType === 'mixed') {
      parts.push('- Combine appropriate elements based on key points');
      parts.push('- Balance text and visual elements');
    }

    parts.push(`\n**Avaliable Resources**:`)
    parts.push(texResourcesTool.getAvailableResourcesList());

    return parts.join('\n');
  }

  /**
   * Extract frame content from LLM response using markers
   * Looks for content between % BEGIN_FRAME(S) and % END_FRAME(S) markers
   * If markers not found, returns the original content
   * @param {string} content - Raw LLM response
   * @returns {string} Extracted frame content or original content
   */
  _extractFrameContent(content) {
    if (!content) return content;

    // Separate regexes for begin and end markers
    const beginFrameRegex = /%\s*BEGIN_FRAMES?/;
    const endFrameRegex = /%\s*END_FRAMES?/;

    const beginMatch = content.match(beginFrameRegex);
    const endMatch = content.match(endFrameRegex);

    // If both markers found, extract content between them
    if (beginMatch && endMatch && endMatch.index > beginMatch.index) {
      const extracted = content.substring(
        beginMatch.index + beginMatch[0].length,
        endMatch.index
      ).trim();

      this.log.debug('Extracted frame content from markers');
      return extracted;
    }

    // If markers not found, return original content
    this.log.debug('No frame markers found, using full content');
    return content;
  }

  /**
   * Build error message for LLM based on TeX compilation error
   * @param {TeXCompilerError} error - The compilation error
   * @param {string} frameContent - The generated frame content
   * @param {number} slideNumber - The slide number for logging
   * @returns {string} Formatted error message for LLM
   */
  _buildCompileErrorMessage(error, frameContent, slideNumber) {
    this.log.error(`Slide ${slideNumber} compile error:
          cmd: ${error.cmd}
       message: ${error.message}
        stderr: ${error.stderr}
        stdout: ${error.stdout}
    `);

    // Build helpful error message for LLM based on error type
    let errorMsg = `There are errors when compiling the TeX. You should carefully analyze the current writing, compare it with the requirements, and identify what went wrong and where the error occurs.

    Compilation errors from TeX compiler:
    %cmd: ${error.cmd}
    %message: ${error.message || "N/A"}
    %stderr:
    ${error.stderr || "N/A"}

    %stdout:
    ${error.stdout}`;

    // Analyze error and provide specific guidance
    const stdout = error.stdout || '';

    // Figure/image not found
    if (stdout.includes('not found') || stdout.includes('Unable to load picture')) {
      errorMsg += `\n\nNOTE: For figures, use existing figure files from the paper or the original tikzpicture code. Some cases may use tikzpicture without an actual image file.`;
    }

    // Undefined control sequence (command not recognized)
    if (stdout.includes('Undefined control sequence')) {
      errorMsg += `\n\nERROR: You used a command that is not defined. Check for typos or use standard LaTeX commands.`;
    }

    // Missing environment
    if (stdout.includes('LaTeX Error: Environment') && stdout.includes('undefined')) {
      errorMsg += `\n\nERROR: You used an undefined environment. Use standard Beamer environments like: frame, itemize, enumerate, figure, table, equation.`;
    }

    // Math delimiter issues
    if (stdout.includes('Missing $ inserted') || stdout.includes('Display math should end with')) {
      errorMsg += `\n\nERROR: Math delimiter problem. Use \\( ... \\) for inline math, \\[ ... \\] or equation environment for display math. DO NOT use $ or $$.`;
    }

    // Missing \end{frame}
    if (stdout.includes('\\end{document} ended by') || stdout.includes('Missing \\end{frame}')) {
      errorMsg += `\n\nERROR: Missing \\end{frame}. Make sure every \\begin{frame} has a matching \\end{frame}.`;
    }

    // Response was JSON instead of LaTeX
    if (frameContent && (frameContent.trim().startsWith('{') || frameContent.includes('"uuid"') || frameContent.includes('"type":'))) {
      errorMsg += `\n\nCRITICAL ERROR: You returned JSON data instead of LaTeX code! You must generate proper LaTeX code, not return tool results. Convert the data to proper LaTeX.`;
    }

    return errorMsg;
  }
}

export default WriteSingleSlideTask;

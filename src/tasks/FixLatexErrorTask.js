import Task from './Task.js';
import apiClient, { ChatSession, MessageBuilder } from '../utils/apiClient.js';
import config from '../config.js';
import LatexUtils from '../utils/latexUtils.js';
import { log } from '../utils/logger.js';
import { parseJSONResponse } from '../utils/jsonParser.js';

export class FixLatexErrorTask extends Task {
  static get name() {
    return 'FixLatexErrorTask';
  }

  static get inputSchema() {
    return {
      latexContent: { type: 'string', required: true },
      error: { type: 'string', required: true },
      compileOutput: { type: 'string', required: false },
      retryCount: { type: 'number', required: false },
      outputDir: { type: 'string', required: false },
      jobName: { type: 'string', required: false }
    };
  }

  static get outputSchema() {
    return {
      fixedContent: { type: 'string' },
      fixed: { type: 'boolean' },
      fixAttempts: { type: 'number' },
      isTemplateError: { type: 'boolean' }
    };
  }

  /**
   * Parse XeLaTeX output to extract relevant error information
   * @param {string} compileOutput - Full XeLaTeX output
   * @param {number} contextLines - Number of context lines before/after error (default: 5)
   * @returns {string} Filtered error message with context
   */
  _parseLatexError(compileOutput, contextLines = 5) {
    if (!compileOutput) return '';
    
    const lines = compileOutput.split('\n');
    const errorLines = [];
    
    // Find lines starting with ! (LaTeX errors)
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (line.startsWith('!')) {
        // Capture context lines before the error
        const start = Math.max(0, i - contextLines);
        // Capture context lines after the error
        const end = Math.min(lines.length, i + contextLines + 1);
        
        for (let j = start; j < end; j++) {
          if (lines[j].trim() && !errorLines.includes(lines[j])) {
            errorLines.push(lines[j]);
          }
        }
      }
    }
    
    // If no ! errors found, return last few lines as fallback
    if (errorLines.length === 0) {
      return lines.slice(-10).join('\n');
    }
    
    return errorLines.join('\n');
  }

  async execute(input) {
    this.input = input;
    const { latexContent, error, compileOutput = '', retryCount = 0, outputDir = '', jobName = '' } = input;

    const errorPreview = error ? error.substring(0, 100) : 'unknown error';
    log.info(`Fixing LaTeX slide error (attempt ${retryCount + 1}): ${errorPreview}`);

    // First, determine if this is likely a template error or slide error
    const isTemplateError = this._isTemplateError(error, compileOutput);

    if (isTemplateError) {
      log.info('Detected template-level error - should use TemplateErrorRefinementTask');
      return {
        fixedContent: latexContent,
        fixed: false,
        fixAttempts: retryCount + 1,
        isTemplateError: true
      };
    }

    // Iterative fix loop for slide errors using multi-turn chat
    return await this._fixSlideErrorIterative(latexContent, error, compileOutput, retryCount, outputDir, jobName);
  }

  /**
   * Detect if error is template-related (missing packages, undefined macros, etc.)
   * vs slide-specific (missing \\end{frame}, unbalanced braces in content, etc.)
   */
  _isTemplateError(error, compileOutput) {
    const errorLower = (error + ' ' + compileOutput).toLowerCase();

    // Template-level errors
    const templateErrorPatterns = [
      'package', 'undefined control sequence', '\\\\usetheme', '\\\\usecolortheme',
      'file not found', '.sty', 'pdfTeX error', 'fontspec', 'xcolor'
    ];

    // Slide-level errors
    const slideErrorPatterns = [
      '\\\\end{frame}', 'missing \\\\item', 'extra alignment tab', 'overfull',
      'underfull', 'bad box', 'math mode', 'display math'
    ];

    const templateScore = templateErrorPatterns.filter(p => errorLower.includes(p)).length;
    const slideScore = slideErrorPatterns.filter(p => errorLower.includes(p)).length;

    // If template errors significantly outweigh slide errors, it's likely a template issue
    return templateScore > slideScore + 1;
  }

  /**
   * Multi-turn chat session to fix slide errors
   * Uses ChatSession for iterative refinement with compilation feedback
   */
  async _fixSlideErrorIterative(latexContent, error, compileOutput, retryCount, outputDir, jobName) {
    const maxAttempts = 3;
    const filteredError = this._parseLatexError(compileOutput || error);

    const systemPrompt = `You are a LaTeX expert specializing in fixing Beamer slide compilation errors.

## Your Task
Fix compilation errors in LaTeX Beamer slide content. Focus on the slide content only, not the template.

## Common Slide-Level Errors to Fix
- Missing or mismatched \\begin{frame}...\\end{frame}
- Unbalanced braces { } or parentheses ( )
- Missing \\\\item in itemize/enumerate environments
- Invalid math mode syntax
- Special characters not escaped (%, $, #, &, _, {, })
- Incorrect use of beamer environments (block, alertblock, etc.)
- Missing or extra line breaks

## What NOT to Change
- Do NOT modify template-level content (preamble, package imports, theme settings)
- Do NOT change the overall slide structure
- Make minimal changes to fix the specific error

## Output Format
Return ONLY a valid JSON object:
{"fixed": true, "content": "fixed latex content"}

If you cannot fix the error, return:
{"fixed": false, "error": "explanation"}`;

    const chat = new ChatSession(
      systemPrompt,
      this.getTools(),
      this.getToolHandlers(),
      {
        max_tokens: 2048,
        temperature: 0.3,
      }
    );

    const initialPrompt = `Fix this LaTeX Beamer SLIDE compilation error.

## COMPILATION ERROR FROM XELATEX:
\`\`\`
${filteredError}
\`\`\`

## COMPLETE SLIDE CODE BEING COMPILED:
\`\`\`
${latexContent}
\`\`\`

Fix ONLY the slide content - do not modify template-level elements.
Return the corrected slide code (just the frame environment).`;

    let response = await chat.generate(initialPrompt);

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const parsed = this._parseResponse(response);

      if (!parsed.fixed || !parsed.content) {
        log.warn(`Fix attempt ${attempt + 1} failed: ${parsed.error}`);
        if (attempt === maxAttempts - 1) {
          break;
        }
        response = await chat.generate(`Previous attempt failed: ${parsed.error}. Please try again and ensure the slide code is valid.`);
        continue;
      }

      // Try to compile the fixed version
      if (outputDir && jobName) {
        const compileResult = await LatexUtils.compileTeXString(parsed.content, outputDir, jobName);

        if (compileResult.success) {
          log.success(`LaTeX fixed after ${attempt + 1} attempts`);
          return {
            fixedContent: parsed.content,
            fixed: true,
            fixAttempts: retryCount + attempt + 1,
            isTemplateError: false
          };
        }

        // Compilation still fails - provide new error feedback
        const newError = this._parseLatexError(compileResult.output || compileResult.error);
        log.warn(`Fixed code still has errors:`, newError);

        if (attempt === maxAttempts - 1) {
          return {
            fixedContent: latexContent,
            fixed: false,
            fixAttempts: retryCount + maxAttempts,
            isTemplateError: false
          };
        }

        response = await chat.generate(`The fixed code still has compilation errors:

\`\`\`
${newError}
\`\`\`

Please analyze this new error and provide corrected slide code.`);
      } else {
        // No compilation available, return the fix
        return {
          fixedContent: parsed.content,
          fixed: true,
          fixAttempts: retryCount + attempt + 1,
          isTemplateError: false
        };
      }
    }

    log.warn(`Could not fix LaTeX after ${maxAttempts} attempts`);
    return {
      fixedContent: latexContent,
      fixed: false,
      fixAttempts: retryCount + maxAttempts,
      isTemplateError: false
    };
  }

  _parseResponse(response) {
    const fallbackValues = { fixed: false, content: '', error: 'Parse failed' };

    const result = parseJSONResponse(response, {
      requiredKeys: ['fixed'],
      fallbackValues,
      logLevel: 'warn'
    });

    return result.success ? result.data : fallbackValues;
  }

  getTools() {
    const { memory } = this.input;

    if (memory && typeof memory.getTools === 'function') {
      return memory.getTools();
    }

    return [];
  }

  getToolHandlers() {
    const { memory } = this.input;

    if (memory && typeof memory.getToolHandlers === 'function') {
      return memory.getToolHandlers();
    }

    return {};
  }
}

export default FixLatexErrorTask;

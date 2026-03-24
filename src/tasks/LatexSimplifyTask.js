import Task from './Task.js';
import fs from 'fs';
import path from 'path';
import { log } from '../../utils/logger.js';

/**
 * LatexSimplifyTask - Creates a simplified markdown version of LaTeX documents
 *
 * This task reads analysis results from LatexAnalyzerTask and creates a clean,
 * simplified markdown version suitable for planning tasks. It removes:
 * - Figures and tables (replaced with [caption](type) placeholders)
 * - Block equations (replaced with labels if available)
 * - Bibliographies and references
 * - Author information and affiliations
 * - Other detailed LaTeX formatting
 *
 * The output is a clean markdown-formatted text containing:
 * - Title
 * - Abstract
 * - Section hierarchy with paragraph content
 * - Placeholders for figures, tables, algorithms, and equations
 *
 * @extends Task
 * @example
 * const task = new LatexSimplifyTask();
 * const result = await task.execute({
 *   analysisResult: { meta: {...}, abstract: '...', content: [...] }
 * });
 * // Returns: { simplifiedContent: '...', length: 1234 }
 */
export class LatexSimplifyTask extends Task {
  constructor() {
    super();
    this.log = log.create(this.name);
  }

  static get name() {
    return 'LatexSimplifyTask';
  }

  static get inputSchema() {
    return {
      analysisResult: { type: 'object', required: true },
      outputDir: { type: 'string', required: false }
    };
  }

  static get outputSchema() {
    return {
      simplifiedContent: { type: 'string' },
      length: { type: 'number' }
    };
  }

  async execute(input) {
    const { analysisResult, outputDir = null } = input;

    this.log.info(`Simplifying LaTeX document: ${analysisResult.meta?.title || 'Untitled'}`);

    // Build simplified markdown content
    const simplifiedContent = this._buildSimplifiedContent(analysisResult);

    // Optionally write to output directory
    if (outputDir) {
      const outputPath = path.join(outputDir, 'simplified.md');
      fs.writeFileSync(outputPath, simplifiedContent, 'utf-8');
      log.info(`Simplified content written to: ${outputPath}`);
    }

    log.success(`Simplification complete: ${simplifiedContent.length} characters`);

    return {
      simplifiedContent,
      length: simplifiedContent.length
    };
  }

  /**
   * Build simplified markdown content from analysis result
   * @param {object} analysisResult - Result from LatexAnalyzerTask
   * @returns {string} Markdown-formatted simplified content
   */
  _buildSimplifiedContent(analysisResult) {
    const { meta, abstract, content } = analysisResult;
    const lines = [];

    // Title
    if (meta?.title) {
      lines.push(`# ${meta.title}`);
      lines.push('');
    }

    // Abstract
    if (abstract) {
      lines.push('## Abstract');
      lines.push('');
      lines.push(abstract);
      lines.push('');
    }

    // Process content hierarchy (root is article HierarchicalContent object)
    if (content) {
      // Process root article preamble if exists
      if (content.preamble && typeof content.preamble === 'object' && content.preamble.children) {
        for (const item of content.preamble.children) {
          this._processContentItem(item, lines);
        }
      }

      // Process sections
      if (content.children && content.children.length > 0) {
        for (const section of content.children) {
          this._processSection(section, lines);
        }
      }
    } else if (Array.isArray(content) && content.length > 0) {
      // Fallback for legacy array format
      for (const section of content) {
        this._processSection(section, lines);
      }
    }

    return lines.join('\n').trim();
  }

  /**
   * Extract caption from environment content (fallback for legacy data)
   * @param {string} envContent - Full environment content including begin/end tags
   * @returns {string|null} Caption text if found, null otherwise
   */
  _extractCaptionFromEnv(envContent) {
    const captionMatch = envContent.match(/\\caption\{([\s\S]*?)\}/);
    return captionMatch ? captionMatch[1].trim() : null;
  }

  /**
   * Process a section and its children recursively
   * @param {object} section - Section object from analysis
   * @param {array} lines - Output lines array
   */
  _processSection(section, lines) {
    // Determine heading level based on section type
    const headingLevel = section.type === 'section' ? '#' :
                         section.type === 'subsection' ? '##' :
                         section.type === 'subsubsection' ? '###' : '####';

    // Add section title
    lines.push(`${headingLevel} ${section.title}`);
    lines.push('');

    // Process preamble if exists
    if (section.preamble && typeof section.preamble === 'object' && section.preamble.children) {
      for (const item of section.preamble.children) {
        this._processContentItem(item, lines);
      }
    }

    // Process children (content items and nested sections)
    if (section.children && section.children.length > 0) {
      for (const child of section.children) {
        if (['section', 'subsection', 'subsubsection'].includes(child.type)) {
          this._processSection(child, lines);
        } else {
          this._processContentItem(child, lines);
        }
      }
    }
  }

  /**
   * Process a content item (paragraph, figure, table, equation)
   * @param {object} item - Content item from analysis
   * @param {array} lines - Output lines array
   */
  _processContentItem(item, lines) {
    switch (item.type) {
      case 'paragraph':
        // Add paragraph text
        if (item.text) {
          lines.push(item.text);
          lines.push('');
        }
        break;

      case 'figure':
        // Replace figure with placeholder: [caption](figure uuid=xxx)
        const figureCaption = item.caption || this._extractCaptionFromEnv(item.text) || item.label || 'Figure';
        const figureUuid = item.uuid || 'unknown';
        lines.push(`[${figureCaption}](figure uuid=${figureUuid})`);
        lines.push('');
        break;

      case 'table':
        // Replace table with placeholder: [caption](table uuid=xxx)
        const tableCaption = item.caption || this._extractCaptionFromEnv(item.text) || item.label || 'Table';
        const tableUuid = item.uuid || 'unknown';
        lines.push(`[${tableCaption}](table uuid=${tableUuid})`);
        lines.push('');
        break;

      case 'algorithm':
      case 'algorithm2e':
        // Replace algorithm with placeholder: [caption](algorithm uuid=xxx)
        const algoCaption = item.caption || this._extractCaptionFromEnv(item.text) || item.label || 'Algorithm';
        const algoUuid = item.uuid || 'unknown';
        lines.push(`[${algoCaption}](algorithm uuid=${algoUuid})`);
        lines.push('');
        break;

      case 'equation':
      case 'equation*':
      case 'align':
      case 'gather':
      case 'multline':
      case 'displaymath':
      case 'minipage':
        // Replace equation with label if available, otherwise ignore
        if (item.label) {
          lines.push(`[${item.type}: ${item.label} uuid=${item.uuid || 'unknown'}]`);
          lines.push('');
        } else{
          lines.push(`[${item.type} uuid=${item.uuid || 'unknown'}]`);
        }
        break;

      default:
        // For other types, try to extract text if available
        if (item.text && typeof item.text === 'string') {
          lines.push(item.text);
          lines.push('');
        }
        break;
    }
  }
}

export default LatexSimplifyTask;

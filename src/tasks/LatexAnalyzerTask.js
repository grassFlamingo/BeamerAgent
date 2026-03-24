import Task from './Task.js';
import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import { log } from '../utils/logger.js';

class StateEnumItem {
  constructor(level, name, can_expand = false) {
    this.level = level;
    this.name = name;
    this.can_expand = can_expand;
  }
}

export const STATE_ENUM = {
  ARTICLE: new StateEnumItem(0, 'article', true),
  SECTION: new StateEnumItem(1, 'section', true),
  SUBSECTION: new StateEnumItem(2, 'subsection', true),
  SUBSUBSECTION: new StateEnumItem(3, 'subsubsection', true),
  PARAGRAPH: new StateEnumItem(4, 'paragraph'),
  FIGURE: new StateEnumItem(4, 'figure'),
  TABLE: new StateEnumItem(4, 'table'),
  EQUATION: new StateEnumItem(4, 'equation'),
  DISPLAYMATH: new StateEnumItem(4, 'displaymath'),
};

export class HierarchicalContent {
  /**
   * @param {string} type - Content type (section, subsection, etc.)
   * @param {string} title - Section title text
   * @param {Array} children - Nested child content
   * @param {string|null} label - LaTeX label if present
   * @param {string} preamble - Content before first child (e.g., intro text before first section)
   * @param {string|null} text - Text content for leaf nodes (paragraph, figure, table, etc.)
   * @param {string|null} caption - Caption text for figure/table/algorithm elements
   * @param {Array} figures - List of figures (\includegraphics) in this content
   */
  constructor(type, title = '', children = [], label = null, preamble = '', text = null, caption = null, figures = []) {
    this.uuid = randomUUID().slice(0, 8);
    this.type = type;
    this.title = title;
    this.label = label;
    this.preamble = preamble;
    this.text = text;
    this.caption = caption;
    this.figures = figures;
    this.children = children;
  }

  push(content) {
    this.children.push(content);
  }

  /**
   * Convert to plain object
   * @returns {Object} Plain object representation
   */
  toObject() {
    return {
      uuid: this.uuid,
      type: this.type,
      title: this.title,
      label: this.label,
      preamble: this.preamble,
      text: this.text,
      caption: this.caption,
      children: this.children.map(child =>
        child instanceof HierarchicalContent ? child.toObject() : child
      )
    };
  }

}

/**
 * LatexAnalyzerTask - Extracts metadata and structure from LaTeX documents
 *
 * This task analyzes LaTeX content and extracts:
 * - Title, authors, affiliations
 * - Abstract, keywords
 * - Sections, subsections, subsubsections
 * - Figures, tables, equations
 * - References, citations
 *
 * @extends Task
 * @example
 * const task = new LatexAnalyzerTask();
 * const result = await task.execute({
 *   mainFile: 'paper.tex',
 *   texFiles: ['paper.tex', 'sections/intro.tex'],
 *   extractContent: true
 * });
 * // Returns: { meta: {...}, abstract: '...', content: [...] }
 */
export class LatexAnalyzerTask extends Task {
  constructor() {
    super();
    this.log = log.create('LatexAnalyzerTask');
    this.ignoreMacros = ['section*', 'subsection*', 'subsubsection*'];
  }

  static get name() {
    return 'LatexAnalyzerTask';
  }

  static get inputSchema() {
    return {
      expandedMainFile: { type: 'string', required: true }
    };
  }

  static get outputSchema() {
    return {
      meta: { type: 'object' },
      abstract: { type: 'string' },
      content: { type: 'array' }
    };
  }


  async execute(input) {
    const { expandedMainFile } = input;

    this.log.info(`Analyzing LaTeX document with expanded file: ${expandedMainFile}`);

    // Require expanded file - do not fall back to individual tex files
    if (!expandedMainFile || !fs.existsSync(expandedMainFile)) {
      log.error('Expanded tex file is required but not provided or not found');
      throw new Error('Expanded tex file is required. Please provide a valid expandedMainFile.');
    }

    // fullContent is string
    const fullContent = fs.readFileSync(expandedMainFile, 'utf-8');

    const doc_ctx = this._findEnvironment(fullContent, 'document');
    if (doc_ctx.start === -1 || doc_ctx.end === -1) {
      this.log.error('No document environment found');
      throw new Error('No document environment found');
    }

    const preamble = fullContent.substring(0, doc_ctx.start);
    const meta = this._extractMetadata(preamble);
    const abstract = this._findEnvironment(doc_ctx.ctx, 'abstract');

    const content = this._extractContent(
      doc_ctx.ctx.substring(abstract.end),
      STATE_ENUM.ARTICLE,
    );

    return {
      meta: meta,
      abstract: this._removeLineBreaks(abstract.ctx),
      content: content,
      preamble: preamble,
    };
  }

  /**
   * Extract hierarchical content with fallback
   * @param {string} src - Source string
   * @param {STATE_ENUM} state - Current level tag
   * @param {STATE_ENUM} nextState - Next state enum
   * @returns {Array|string} Hierarchical content
   */
  _extractSection(src, state, nextState) {
    if (!state.can_expand) {
      return this._extractContent(src, STATE_ENUM.PARAGRAPH);
    }

    const all_comm = this._findAllCommands(src, `${nextState.name}\\*{0,1}`);
    if (all_comm.length === 0) {
      return this._extractContent(src, STATE_ENUM.PARAGRAPH);
    }

    const result = new HierarchicalContent(
      state.name,
    );

    // Extract preamble (text before first item)
    result.preamble = this._extractContent(
      src.substring(0, all_comm[0].start).trim(),
      STATE_ENUM.PARAGRAPH
    );

    // Extract items
    for (var i = 0; i < all_comm.length; i++) {
      const item = all_comm[i];
      if (this.ignoreMacros.includes(item.tag)) {
        this.log.debug(`Ignore macro: ${item.tag}`);
        continue;
      }


      let idx_start = item.end;
      let idx_end = src.length;
      if (i < all_comm.length - 1) {
        idx_end = all_comm[i + 1].start;
      }
      let sub_src = src.substring(idx_start, idx_end).trim();
      let label = null;
      if (sub_src.startsWith('\\label')) {
        let _label = this._findCommand(sub_src, 'label');
        if (_label.start != -1 || _label.end != -1) {
          label = _label.ctx;
          sub_src = sub_src.substring(_label.end).trim();
        }
      }

      // find label
      const _sub = this._extractContent(
        sub_src,
        nextState,
      );
      if (_sub === null) {
        continue;
      }
      _sub.type = nextState.name;
      _sub.title = item.ctx;
      _sub.label = label;
      result.push(_sub);
    }
    return result;
  }

  /**
   * Clean LaTeX content by removing comments and unnecessary spacing commands
   * @param {string} src - Source LaTeX content
   * @returns {string} Cleaned LaTeX content
   */
  _cleanLatexContent(src) {
    // Step 1: Remove LaTeX comments (but preserve escaped \%)
    let result = this._removeComments(src);

    // Step 2: Remove vertical spacing commands
    // Remove \vspace{-1em}, \vspace{-0.5em}, \vspace{...}, etc.
    // Use negative lookbehind (?<!\\) to avoid matching \\\vspace (escaped backslash)
    result = result.replace(/(?<!\\)\\vspace\s*(?:\[[^\]]*\])?\s*\{[^}]*\}/g, '');

    // Remove \hspace commands
    result = result.replace(/(?<!\\)\\hspace\s*(?:\[[^\]]*\])?\s*\{[^}]*\}/g, '');

    // Remove \smallskip, \medskip, \bigskip
    result = result.replace(/(?<!\\)\\(smallskip|medskip|bigskip|newline|newpage|hfill)\s*/g, '');

    // Remove \vskip and \hskip with negative values (commonly used for manual adjustments)
    result = result.replace(/(?<!\\)\\vskip\s*-\d*\.?\d*(?:pt|em|ex|mm|cm|in)\s*/g, '');
    result = result.replace(/(?<!\\)\\hskip\s*-\d*\.?\d*(?:pt|em|ex|mm|cm|in)\s*/g, '');
    
    // Remove excessive whitespace (more than 2 consecutive newlines)
    result = result.replace(/\n{3,}/g, '\n\n');
    
    // Remove trailing whitespace from lines
    result = result.replace(/[ \t]+$/gm, '');

    return result;
  }

  /**
   * Remove LaTeX comments from source
   * @param {string} src - Source LaTeX content
   * @returns {string} Content with comments removed
   */
  _removeComments(src) {
    let result = '';
    let i = 0;
    while (i < src.length) {
      if (i < src.length - 1 && src[i] === '\\' && src[i + 1] === '%') {
        result += '%';
        i += 2;
      } else if (src[i] === '%' && (i === 0 || src[i - 1] !== '\\')) {
        while (i < src.length && src[i] !== '\n') {
          i++;
        }
      } else {
        result += src[i];
        i++;
      }
    }
    return result;
  }

  _extractParagraph(src) {
    const state = STATE_ENUM.PARAGRAPH;

    if (!src || src.length === 0) {
      return new HierarchicalContent(state.name, '', [], null, '', null);
    }

    src = this._cleanLatexContent(src);

    const envTypes = [
      'figure\\*{0,1}', 'table\\*{0,1}', 'equation\\*{0,1}', 'align', 'gather', 'multline',
      'algorithm', 'algorithm2e', 'verbatim', 'lstlisting', 'displaymath',
      'minipage'
    ];

    const allElements = [];

    for (const env of envTypes) {
      const envs = this._findAllEnvironment(src, env);
      for (const e of envs) {
        const fullEnvContent = src.substring(e.start, e.end);
        allElements.push({ type: e.tag, start: e.start, end: e.end, ctx: fullEnvContent });
      }
    }

    const displayMathRegex = /(?<!\\)\\\[(?:[\s\S]*?)(?<!\\)\\\]/g;
    let match;
    while ((match = displayMathRegex.exec(src)) !== null) {
      allElements.push({
        type: 'displaymath',
        start: match.index,
        end: match.index + match[0].length,
        ctx: match[0]
      });
    }

    allElements.sort((a, b) => a.start - b.start);

    const result = new HierarchicalContent(state.name);
    let cursor = 0;

    for (const elem of allElements) {
      if (elem.start > cursor) {
        const textBefore = src.substring(cursor, elem.start).trim();
        if (textBefore) {
          result.push(new HierarchicalContent('paragraph', '', [], null, '', textBefore));
        }
      }

      const elemSrc = src.substring(elem.start, elem.end);
      const label = this._getCommandContext(elemSrc, 'label').trim();
      const caption = this._removeLineBreaks(this._getCommandContext(elemSrc, 'caption')).trim();

      // if contain \includegraphics
      const figures = this._findAllCommands(elemSrc, 'includegraphics');

      result.push(new HierarchicalContent(elem.type, '', [], label, '', elem.ctx, caption, figures));

      cursor = elem.end;
    }

    if (cursor < src.length) {
      const remainingText = src.substring(cursor).trim();
      const figures = this._findAllCommands(remainingText, 'includegraphics');
      if (remainingText) {
        result.push(new HierarchicalContent('paragraph', '', [], null, '', remainingText, null, figures));
      }
    }

    return result;
  }

  /**
   * ignore section*, subsection*, subsubsection*
   * hierarchical content
   */
  _extractContent(src, state) {
    if (src.length === 0) return null;

    switch (state) {
      case STATE_ENUM.ARTICLE:
        return this._extractSection(src, state, STATE_ENUM.SECTION);
      case STATE_ENUM.SECTION:
        return this._extractSection(src, state, STATE_ENUM.SUBSECTION);
      case STATE_ENUM.SUBSECTION:
        return this._extractSection(src, state, STATE_ENUM.SUBSUBSECTION);
      case STATE_ENUM.SUBSUBSECTION:
        return this._extractSection(src, state, STATE_ENUM.PARAGRAPH);
      case STATE_ENUM.PARAGRAPH:
        return this._extractParagraph(src);
      default:
        return null;
    }
  }

  _extractMetadata(src) {
    return {
      title: this._getCommandContext(src, 'title'),
      date: this._getCommandContext(src, 'date'),
      authors: this._extractAuthorsAffiliations(this._getCommandContext(src, 'author')),
    };
  }

  /**
   *
   * @returns a list of authors
   *
   * author:
   * {
   *   name: "",
   *   email: "",
   *   affiliations: [],
   *   is_coorresponding_author: false,
   *   index: 1,
   * }
   */
  _extractAuthorsAffiliations(src) {
    const authors = [];

    // Split by \And to separate different authors
    const authorBlocks = src.split(/\\And/);

    for (let i = 0; i < authorBlocks.length; i++) {
      const block = authorBlocks[i];
      const lines = block.split(/\\\\/).map(line => line.trim());

      const author = {
        name: '',
        email: '',
        affiliations: [],
        is_corresponding_author: false,
        index: i + 1
      };

      let nameFound = false;

      for (const line of lines) {
        if (!line) continue;

        // Check for corresponding author marker
        if (line.includes('\\thanks{') || line.includes('corresponding')) {
          author.is_corresponding_author = true;
          // Extract name before \thanks
          const thanksMatch = line.match(/^(.+?)\\thanks\{/);
          if (thanksMatch) {
            author.name = thanksMatch[1].trim();
            nameFound = true;
          }
          continue;
        }

        // Check for email (inside \texttt{})
        const emailMatch = line.match(/\\texttt\{([^}]+)\}/);
        if (emailMatch) {
          author.email = emailMatch[1];
          continue;
        }

        // First non-empty line without special markers is the name
        if (!nameFound && line) {
          author.name = line;
          nameFound = true;
          continue;
        }

        // Remaining lines are affiliations
        if (line && !author.affiliations.includes(line)) {
          author.affiliations.push(line);
        }
      }

      authors.push(author);
    }

    return authors;
  }

  /**
   * {......}
   */
  _findEndBraceWithStack(src, brace_left = '{', brace_right = '}') {
    let depth = 1;
    if (src[0] != brace_left) {
      return -1;
    }
    for (let i = 1; i < src.length; i++) {
      let c = src[i];
      if (c === '\\') {
        // For \{ \} or other escaped chars, skip next char
        i++;
        continue;
      } else if (c === brace_left) {
        depth++;
      } else if (c === brace_right) {
        if (--depth === 0) {
          return i;
        }
      }
    }
    return -1;
  }

  /**
   * find \macro{xxxx} using regex, skip \\macro{ (double backslash)
   *      ^start     ^end
   * 
   * return { ctx: xxxx, start: start, end: end }
   */
  _findCommand(src, macro) {

    const default_ret = {
      ctx: "",
      tag: macro,
      start: -1,
      end: -1,
    };

    const regex = new RegExp(`(?<!\\\\)\\\\(${macro})(\\{|\\[)`);
    const mth = regex.exec(src);
    if (!mth) {
      return default_ret;
    }

    default_ret.tag = mth[1];
    const start = mth.index;
    let contentStart = start + mth[0].length - 1;

    if (mth[2] === '[') {
      let _shift = this._findEndBraceWithStack(src.substring(contentStart), '[', ']');
      if (_shift === -1) {
        return default_ret;
      }
      contentStart += _shift + 1;
    }


    if (src[contentStart] != '{') {
      return default_ret;
    }

    // Pass substring starting from the opening brace
    let end = this._findEndBraceWithStack(
      src.substring(contentStart),
      '{', '}'
    );

    if (end === -1) {
      return default_ret;
    }

    default_ret.ctx = src.substring(
      contentStart + 1, contentStart + end
    ).trim();
    default_ret.start = start;
    default_ret.end = contentStart + end + 1;

    return default_ret;
  }

  _getCommandContext(src, macro) {
    const res = this._findCommand(src, macro);
    return (res.start !== -1 && res.end !== -1) ? res.ctx : "";
  }

  _findEnvironment(src, env) {

    // find \begin{env} ... \end{env} using regex, skip \\begin{env} (double backslash)
    // return content between \begin{env} and \end{env}

    const default_ret = {
      ctx: "",
      tag: env,
      start: -1,
      end: -1,
    };

    const regex_ll = new RegExp(`(?<!\\\\)\\\\begin\\{(${env})\\}`);
    const regex_be = new RegExp(`(?<!\\\\)\\\\(begin|end)\\{(${env})\\}`);

    let mth = regex_ll.exec(src);

    if (!mth) {
      return default_ret;
    }

    default_ret.tag = mth[1];
    default_ret.start = mth.index;
    const ctx_start = mth.index + mth[0].length;

    let depth = 1;
    let start = ctx_start;


    while (start < src.length) {
      mth = regex_be.exec(src.substring(start));
      if (!mth) {
        break;
      } else if (mth[1] === 'begin') {
        depth++;
      } else if (mth[1] === 'end') {
        depth--;
        if (depth === 0) {
          default_ret.end = start + mth.index + mth[0].length;
          default_ret.ctx = src.substring(
            ctx_start, start + mth.index
          ).trim();
          break;
        }
      }
      start = start + mth.index + mth[0].length;
    }


    return default_ret;
  }

  _removeLineBreaks(src) {
    return src.replace(/\s*\n\s*/g, ' ');
  }

  /**
   * Find all matches for a regex pattern
   * @param {RegExp} pattern - Regex pattern with global flag
   * @param {string} src - Source string to search
   * @returns {Array} Array of match objects with start, end, title, ctx
   */
  _findAllMatches(pattern, src) {
    const matches = [];
    let match;

    // Reset regex lastIndex
    pattern.lastIndex = 0;

    while ((match = pattern.exec(src)) !== null) {
      matches.push({
        start: match.index,
        end: match.index + match[0].length,
        title: match[1],
        ctx: match[0]
      });
    }

    return matches;
  }

  _findAllCommands(src, macro) {
    const results = [];
    let shift = 0;
    while (true) {
      const res = this._findCommand(src, macro);
      if (res.start === -1 || res.end === -1) {
        break;
      }
      const res_end = res.end;

      // substring must before + shift
      src = src.substring(res.end);

      res.start += shift;
      res.end += shift;
      results.push(res);
      shift += res_end;
    }
    return results;
  }

  /**
   * Find all occurrences of an environment
   * @param {string} src - Source string
   * @param {string} env - Environment name
   * @returns {Array} Array of environment objects
   */
  _findAllEnvironment(src, env) {
    const environments = [];
    let searchStart = 0;

    while (searchStart < src.length) {
      const result = this._findEnvironment(src.substring(searchStart), env);

      if (result.start === -1 || result.end === -1) {
        break;
      }

      const res_end = result.end;

      result.start = searchStart + result.start;
      result.end = searchStart + result.end;
      environments.push(result);

      searchStart += res_end;
    }

    return environments;
  }

}

export default LatexAnalyzerTask;

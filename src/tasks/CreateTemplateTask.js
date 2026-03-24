import apiClient, { ChatSession, MessageBuilder } from '../utils/apiClient.js';
import { LatexUtils, TeXCompilerError } from '../utils/latexUtils.js';
import { log } from '../utils/logger.js';
import config from '../config.js';
import Task from './Task.js';
import BeamerBuilderWithTemplate, { MARKERS } from '../utils/BeamerBuilderWithTemplate.js';

const DEFAULT_PREAMBLE = `\\documentclass[aspectratio=169]{beamer}
\\usetheme{default}
\\usecolortheme{default}
\\title{Beamer Presentation}
\\author{Generated}


\\title[short title]{Long title}
\\author[short author family name split by ',']{
    author1 \\inst{1,2} \\and
    author2 \\inst{1}
}
\\institute[short notation of institute; split by ',']{
    \\inst{1} inst1 %
    \\inst{2} inst2  %
}

\\date{\\today}

\\begin{document}

% create the title frame here

% BEGIN_DEMO_FRAME
% create demo frames here

% END_DEMO_FRAME

% BEGIN_FRAMES

% END_FRAMES

\\end{document}
`;

const SYSTEM_PROMPT = `You are a LaTeX Beamer template configuration expert specializing in converting article preambles to presentation templates.

Task: Create a compilable LaTeX Beamer template by merging article preamble with a reference Beamer template.

Input Components:
  - % ARTICLE_PREAMBLE: LaTeX preamble from an article document containing packages, definitions, and settings
  - % REFERENCE_TEMPLATE: A complete Beamer template serving as the structural foundation

Technical Requirements:
  1. Preamble Integration:
     - Merge all essential packages from ARTICLE_PREAMBLE into REFERENCE_TEMPLATE
     - Preserve custom commands, environments, and definitions
     - Resolve package conflicts between article and Beamer class
     - Remove article-specific packages incompatible with Beamer (e.g., geometry, fancyhdr)

  2. Beamer Compatibility:
     - Ensure all packages are compatible with Beamer class
     - Use beamer-specific alternatives for article features when necessary
     - Handle font and encoding packages appropriately (e.g., fontspec for XeLaTeX)

  3. Structure Preservation:
     - Maintain documentclass declaration with appropriate Beamer options
     - Preserve \\begin{document} and \\end{document} structure
     - Keep theme and colortheme declarations

  4. Special Markers (Must in this order):
     - \\begin{document}:
     - % BEGIN_DEMO_FRAME: Demo frame section start
     - % END_DEMO_FRAME: Demo frame section end
     - % BEGIN_FRAMES: All future frames will be inserted after this marker
     - % END_FRAMES: All future frames will be inserted before this marker
     - \\end{document}

  5. Demo Frame Requirements:
     - Create a simple, compilable demo frame between BEGIN_DEMO_FRAME and END_DEMO_FRAME
     - Include basic elements: title, bullet points, and a simple equation
     - Ensure the demo frame validates the template's functionality

  6. Output Format:
     - Wrap the complete LaTeX template between % BEGIN_OUTPUT_TEX and % END_OUTPUT_TEX markers
     - Example:
% BEGIN_OUTPUT_TEX
\\documentclass{beamer}
...
\\end{document}
% END_OUTPUT_TEX

Quality Checklist:
  - All packages are Beamer-compatible
  - No duplicate package declarations
  - All custom commands are properly defined
  - Special markers remain intact and properly positioned
  - Output tex shoule be wrapped with % BEGIN_OUTPUT_TEX and % END_OUTPUT_TEX markers
  - Avoid duplicate package imports. Keep only one import per package.

**Fix:** Keep only one import per package

Notice:

In Beamer class:
\\and is the correct separator between authors
\\And is not defined in Beamer and caused the titlepage to malfunction, leading to the math mode error
The fix was changing all instances of \\And to \\and in the author block

`;

export class CreateTemplateTask extends Task {

  constructor() {
    super();
    this.log = log.create(CreateTemplateTask.name);
  }

  static get name() {
    return 'CreateTemplateTask';
  }

  static get inputSchema() {
    return {
      articlePreamble: { type: 'string', required: true },
      templatePreamble: { type: 'string', required: false, default: null },
      outputDir: { type: 'string', required: false },
    };
  }

  static get outputSchema() {
    return {
      presentationLatex: { type: 'string' },
      customPreamble: { type: 'string' },
      templateConfig: { type: 'object' },
      success: { type: 'boolean' }
    };
  }

  async execute(input) {
    const { articlePreamble, templatePreamble = null, outputDir } = input;

    this.outputDir = outputDir || config.outputDir;

    let temp = DEFAULT_PREAMBLE;

    if (templatePreamble != null) {
      temp = templatePreamble;
    }

    const result = await this._loop(articlePreamble, temp);

    return {
      text: result,
    };
  }


  async _loop(articlePreamble, templatePreamble) {
    const chat = new ChatSession(
      SYSTEM_PROMPT,
      {
        max_tokens: 2048,
        temperature: 0.3,
      }
    )

    let rep = await chat.generate(`
% ARTICLE_PREAMBEL

${articlePreamble}
\\begin{document}
....
\\end{document}

% REFERENCE_TEMPLATE

${templatePreamble}

`);
    let _crt;

    for (var _i = 0; _i < 8; _i++) {
      _crt = this._cleanRespTex(rep);
      if (!_crt.success) {
        rep = await chat.generate(_crt.error);
        continue;
      }
      _crt.success = false;
      this.log.info(_crt.tex);
      let error = this._checkMarkers(_crt.tex);
      if (error != null) {
        this.log.error(error);
        // feedback and loop again
        rep = await chat.generate(`Markers error ${error} detected. Please fix the markers and try again.`);
        continue;
      }
      try {
        // try compile
        error = await LatexUtils.compileTeXString(_crt.tex, this.outputDir, CreateTemplateTask.name);
        if (!error.success) {
          this.log.error(error);
          // feedback and loop again
          rep = await chat.generate(`Compilation error ${error.error} detected. Please fix the template and try again.`);
          continue;
        }
      } catch (error) {
        this.log.error(error);
        if (error instanceof TeXCompilerError) {
          // feedback and loop again
          rep = await chat.generate(`Compilation error ${error.message} detected.\ncmd: ${error.cmd}\nstderr:${error.stderr}\nstdout:${error.stdout}`);
        }else{
          throw error;
        }
        continue;
      }
      _crt.success = true;
      break;
    }

    if (!_crt.success){
      throw new Error('Could not compile template after maximum attempts');
    }
    return _crt.tex;
  }

  _cleanRespTex(tex) {

    // Extract tex between % BEGIN_OUTPUT_TEX and % END_OUTPUT_TEX markers
    const beginMarker = /%\s*BEGIN_OUTPUT_TEX\s*/i;
    const endMarker = /%\s*END_OUTPUT_TEX\s*/i;

    const beginMatch = tex.match(beginMarker);
    const endMatch = tex.match(endMarker);

    if (beginMatch && endMatch) {
      const startIndex = beginMatch.index + beginMatch[0].length;
      const endIndex = endMatch.index;
      tex = tex.substring(startIndex, endIndex);
    } else {
      return {
        success: false,
        error: 'Response tex shoule be surround by % BEGIN_OUTPUT_TEX and % END_OUTPUT_TEX markers',
      };
    }

    tex = tex.trim();

    // Remove markdown code block markers
    if(tex.startsWith('```')){
      // remove the first line
      tex = tex.substring(tex.indexOf('\n') + 1);
    }

    if(tex.endsWith('```')){
      // remove the last line
      tex = tex.substring(0, tex.lastIndexOf('\n'));
    }

    return {
      success: true,
      tex: tex.trim(),
    };
  }

  _checkMarkers(tex) {
    // check the markers exists and are in the right order
    const indices = MARKERS.findIndexFrom(tex);

    // Check if all markers exist and are in the correct order
    let lastIndex = -1;
    for (let i = 0; i < indices.length; i++) {
      const currentIndex = indices[i];

      // Check if marker exists
      if (currentIndex === -1) {
        return `Marker ${MARKERS.markers[i]} not found in the template.`;
      }

      // Check if marker is in correct order
      if (currentIndex <= lastIndex) {
        return `Markers are not in the correct order. ${MARKERS.markers[i]} should appear after ${MARKERS.markers[i - 1]}.`;
      }
      lastIndex = currentIndex;
    }

    // if contains \begin{frame}; make sure it is placed behind \begin{document}
    const beginFrameMatch = tex.match(/\\begin\{frame\}/i);


    if (beginFrameMatch) {
      // 0: \begin{document}
      if (beginFrameMatch.index < indices[0]) {
        return '\\begin{frame} must appear after \\begin{document}';
      }
    }

    return null;
  }

}

export default CreateTemplateTask;

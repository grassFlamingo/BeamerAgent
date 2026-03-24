import Task from './Task.js';
import { log } from '../../utils/logger.js';

const FULL_BEAMER_TEMPLATE = `\\documentclass[aspectratio=169]{beamer}

\\usepackage[utf8]{inputenc}
\\usepackage[T1]{fontenc}
\\usepackage{graphicx}
\\usepackage{amsmath}
\\usepackage{amssymb}
\\usepackage{url}
\\usepackage{hyperref}
\\usepackage{color}

\\usetheme{Berlin}
\\usecolortheme{default}

\\newcommand{\\emphitem}[1]{\\item \\textbf{#1}}
\\newcommand{\\highlight}[1]{\\textcolor{blue}{#1}}

\\title{%s}
\\author{%s}
\\date{\\today}

\\begin{document}

%s

\\end{document}
`;

export class WriteFullPresentationTask extends Task {
  static get name() {
    return 'WriteFullPresentationTask';
  }

  static get inputSchema() {
    return {
      plan: { type: 'object', required: true },
      slideLatexes: { type: 'array', required: false }
    };
  }

  static get outputSchema() {
    return {
      beamerContent: { type: 'string' }
    };
  }

  async execute(input) {
    const { plan, slideLatexes = [] } = input;
    
    log.info('Writing full Beamer presentation');

    const title = plan.paperInfo?.title || 'Presentation';
    const authors = plan.paperInfo?.authors?.join(' and ') || 'Author';
    
    const titleSlide = `\\begin{frame}
\\maketitle
\\end{frame}`;

    const allSlides = slideLatexes.length > 0 
      ? slideLatexes.join('\n\n')
      : this._generateDefaultSlides(plan);

    const beamerContent = FULL_BEAMER_TEMPLATE.trim()
      .replace('%s', title)
      .replace('%s', authors)
      .replace('%s', titleSlide + '\n\n' + allSlides);

    log.success(`Full Beamer created: ${beamerContent.length} characters`);

    return {
      beamerContent
    };
  }

  _generateDefaultSlides(plan) {
    const slides = plan.slides || [];
    return slides.map((slide, index) => {
      const title = slide.title || `Slide ${index + 1}`;
      const points = slide.keyPoints || ['Content'];
      const bulletItems = points.map(p => `  \\item ${p}`).join('\n');
      
      return `\\begin{frame}{${title}}
\\begin{itemize}
${bulletItems}
\\end{itemize}
\\end{frame}`;
    }).join('\n\n');
  }
}

export default WriteFullPresentationTask;

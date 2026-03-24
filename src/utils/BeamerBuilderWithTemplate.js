export const MARKERS = {
  markers: [
    '\\begin{document}',
    '% BEGIN_DEMO_FRAME',
    '% END_DEMO_FRAME',
    '% BEGIN_FRAMES',
    '% END_FRAMES',
    '\\end{document}'
  ],

  findIndexFrom: function (str) {
    return this.markers.map(marker => str.indexOf(marker));
  }
};

export class BeamerBuilderWithTemplate {
  constructor(template) {
    this.template = template;

    const idxes = MARKERS.findIndexFrom(template);

    // Store marker positions with lengths for efficient slicing
    this._markers = {
      beginDocument: { index: idxes[0], length: MARKERS.markers[0].length },
      beginDemoFrame: { index: idxes[1], length: MARKERS.markers[1].length },
      endDemoFrame: { index: idxes[2], length: MARKERS.markers[2].length },
      beginFrameInsert: { index: idxes[3], length: MARKERS.markers[3].length },
      endFrameInsert: { index: idxes[4], length: MARKERS.markers[4].length },
      endDocument: { index: idxes[5], length: MARKERS.markers[5].length }
    };

    // Pre-extract and cache all template segments
    this._segments = {
      // Preamble: everything before \begin{document}
      preamble: template.substring(0, idxes[0]),

      // Title page: content between \begin{document} and BEGIN_DEMO_FRAME
      titlePage: template.substring(
        idxes[0] + MARKERS.markers[0].length,
        idxes[1]
      ),

      // Demo frame markers (kept, content removed)
      beginDemoFrameMarker: MARKERS.markers[1],
      endDemoFrameMarker: MARKERS.markers[2],

      // Demo frame content (between markers)
      demoFrameContent: template.substring(
        idxes[1] + MARKERS.markers[1].length,
        idxes[2]
      ).trim(),

      // Insertion region markers and content
      beginFrameInsertMarker: MARKERS.markers[3],
      endFrameInsertMarker: MARKERS.markers[4],
      insertionRegion: template.substring(
        idxes[3] + MARKERS.markers[3].length,
        idxes[4]
      ).trim(),

      // Postamble: everything after \end{document}
      postamble: template.substring(idxes[5] + MARKERS.markers[5].length)
    };

    // Cache template config extraction
    this._configCache = null;
  }

  get latex() {
    return this.template;
  }

  get templateConfig() {
    if (!this._configCache) {
      this._configCache = this._extractTemplateConfig();
    }
    return this._configCache;
  }

  _extractTemplateConfig() {
    const latex = this.template;

    // Extract theme
    const themeMatch = latex.match(/\\usetheme\{([^}]+)\}/);
    const theme = themeMatch ? themeMatch[1] : 'default';

    // Extract color theme
    const colorThemeMatch = latex.match(/\\usecolortheme\{([^}]+)\}/);
    const colorTheme = colorThemeMatch ? colorThemeMatch[1] : 'default';

    // Extract font theme
    const fontThemeMatch = latex.match(/\\usefonttheme\{([^}]+)\}/);
    const fontTheme = fontThemeMatch ? fontThemeMatch[1] : null;

    // Extract aspect ratio
    const aspectRatioMatch = latex.match(/\\documentclass\[.*?aspectratio=(\d+).*?\]\{beamer\}/);
    const aspectRatio = aspectRatioMatch ? aspectRatioMatch[1] : '169';

    // Extract custom commands and definitions (single pass)
    const customCommands = [];
    const packages = [];
    const commandRegex = /\\(newcommand|renewcommand|newenvironment|renewenvironment)\{\\[^}]+\}/g;
    const packageRegex = /\\usepackage(?:\[[^\]]*\])?\{([^}]+)\}/g;
    let match;

    while ((match = commandRegex.exec(latex)) !== null) {
      customCommands.push(match[0]);
    }

    while ((match = packageRegex.exec(latex)) !== null) {
      packages.push(match[1]);
    }

    return {
      theme,
      colorTheme,
      fontTheme,
      aspectRatio,
      customCommands,
      packages
    };
  }

  /**
   * Apply slide content to the template
   * @param {string} mainSrc - The slide content to insert
   * @param {boolean} includeTitlePage - Whether to include the title page (default: false)
   * @returns {Promise<string>} The complete LaTeX template with slide content
   */
  async apply(mainSrc, includeTitlePage = false) {
    const s = this._segments;

    // Build template from cached segments
    const parts = [];

    // 1. Preamble (always included)
    parts.push(s.preamble);

    // 2. \begin{document}
    parts.push('\\begin{document}');

    // 3. Title page (optional)
    if (includeTitlePage && s.titlePage.trim()) {
      parts.push(s.titlePage);
    }

    // 4. Demo frame markers (without content)
    parts.push(s.beginDemoFrameMarker);
    parts.push(s.endDemoFrameMarker);

    // 5. Frame insert markers with content
    parts.push(s.beginFrameInsertMarker);
    parts.push(mainSrc);
    parts.push(s.endFrameInsertMarker);

    // 6. \end{document} and postamble
    parts.push('\\end{document}');
    if (s.postamble.trim()) {
      parts.push(s.postamble);
    }

    return parts.join('\n');
  }
}

export default BeamerBuilderWithTemplate;

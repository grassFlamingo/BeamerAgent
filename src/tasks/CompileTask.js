import Task from './Task.js';
import LatexUtils from '../utils/latexUtils.js';
import FileUtils from '../utils/fileUtils.js';
import path from 'path';
import fs from 'fs';
import { log } from '../utils/logger.js';
import config from '../config.js';

export class CompileTask extends Task {
  static get name() {
    return 'CompileTask';
  }

  static get inputSchema() {
    return {
      latexContent: { type: 'string', required: false },
      type: { type: 'string', required: false, default: 'full' },
      slideIndex: { type: 'number', required: false },
      mainFile: { type: 'string', required: false },
      outputDir: { type: 'string', required: false },
      withBibliography: { type: 'boolean', required: false, default: true }
    };
  }

  static get outputSchema() {
    return {
      pdfPath: { type: 'string' },
      success: { type: 'boolean' },
      error: { type: 'string' },
      type: { type: 'string' }
    };
  }

  async execute(input) {
    const {
      latexContent,
      type = 'full',
      slideIndex,
      mainFile,
      outputDir,
      withBibliography = true
    } = input;

    if (mainFile && fs.existsSync(mainFile)) {
      return await this._compile(mainFile, withBibliography, 'document');
    }

    if (latexContent) {
      const outDir = outputDir || (type === 'full' ? (config.paths?.output || 'output') : (config.paths?.temp || 'temp'));
      const jobName = type === 'full'
        ? 'presentation-full'
        : (slideIndex ? `page_slide_${String(slideIndex).padStart(3, '0')}` : `slide-${Date.now()}`);

      await FileUtils.ensureDirectory(outDir);
      log.info(`Compiling Beamer (${type}): ${jobName}`);

      const result = await LatexUtils.compileTeXString(latexContent, outDir, jobName);
      if (result.success) {
        log.success(`Compiled: ${result.pdfPath}`);
        return { pdfPath: result.pdfPath, success: true, error: null, type };
      }
      return { pdfPath: null, success: false, error: result.error, type };
    }

    return { pdfPath: null, success: false, error: 'No latexContent or mainFile provided', type };
  }

  async _compile(inputPath, withBibliography, type) {
    const mainDir = path.dirname(inputPath);
    const mainName = path.basename(inputPath, '.tex');

    log.info(`Compiling: ${inputPath}`);

    await LatexUtils.runCompiler('xelatex', [mainName + '.tex'], mainDir);

    if (withBibliography) {
      const auxPath = path.join(mainDir, mainName + '.aux');
      const bibPath = path.join(mainDir, mainName + '.bib');
      const hasBibliography = fs.existsSync(auxPath) &&
        (fs.existsSync(bibPath) || this._hasBibData(auxPath));

      if (hasBibliography) {
        log.info('Running BibTeX...');
        await LatexUtils.runCompiler('bibtex', [mainName], mainDir);
      }
    }

    await LatexUtils.runCompiler('xelatex', [mainName + '.tex'], mainDir);
    await LatexUtils.runCompiler('xelatex', [mainName + '.tex'], mainDir);

    const pdfPath = path.join(mainDir, mainName + '.pdf');
    if (fs.existsSync(pdfPath)) {
      log.success(`Compiled: ${pdfPath}`);
      return { pdfPath, success: true, error: null, type };
    }

    return { pdfPath: null, success: false, error: 'PDF not generated', type };
  }

  _hasBibData(auxPath) {
    try {
      return /\\bibdata|\\citation/.test(fs.readFileSync(auxPath, 'utf-8'));
    } catch {
      return false;
    }
  }
}

export default CompileTask;

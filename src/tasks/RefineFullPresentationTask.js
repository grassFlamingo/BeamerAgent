import Task from './Task.js';
import LatexUtils from '../utils/latexUtils.js';
import FileUtils from '../utils/fileUtils.js';
import { log } from '../utils/logger.js';
import config from '../config.js';

export class RefineFullPresentationTask extends Task {
  static get name() {
    return 'RefineFullPresentationTask';
  }

  static get inputSchema() {
    return {
      fullLatex: { type: 'string', required: true },
      validatedSlides: { type: 'array', required: true },
      texTemplate: { type: 'object', required: true },
      outputDir: { type: 'string', required: true },
      maxRetries: { type: 'number', required: false, default: 3 }
    };
  }

  static get outputSchema() {
    return {
      success: { type: 'boolean' },
      pdfPath: { type: 'string' },
      error: { type: 'string' },
      refinedSlides: { type: 'array' },
      attempts: { type: 'number' }
    };
  }

  async execute(input) {
    const {
      fullLatex,
      validatedSlides,
      texTemplate,
      outputDir,
      maxRetries = 3
    } = input;

    let currentLatex = fullLatex;
    let currentSlides = [...validatedSlides];
    let attempts = 0;
    let lastError = null;

    for (attempts = 1; attempts <= maxRetries; attempts++) {
      log.info(`=== Full presentation compilation attempt ${attempts}/${maxRetries} ===`);

      const outDir = outputDir || (config.paths?.output || 'output');
      await FileUtils.ensureDirectory(outDir);

      const jobName = `presentation-full-${Date.now()}`;
      const compileResult = await LatexUtils.compileTeXString(currentLatex, outDir, jobName);

      if (compileResult.success) {
        log.success(`Full presentation compiled successfully!`);
        return {
          success: true,
          pdfPath: compileResult.pdfPath,
          refinedSlides: currentSlides,
          attempts
        };
      }

      lastError = compileResult.error;
      log.warn(`Compilation failed: ${lastError}`);

      const errorInfo = this._parseCompileError(lastError, compileResult.output || '');
      
      if (errorInfo.slideIndex !== null) {
        log.info(`Error detected in slide ${errorInfo.slideIndex}, attempting to fix...`);
        
        const refinedSlide = await this._refineSlide(
          currentSlides[errorInfo.slideIndex],
          errorInfo.error,
          errorInfo.lineNumber,
          texTemplate,
          outputDir
        );

        if (refinedSlide) {
          currentSlides[errorInfo.slideIndex] = refinedSlide;
          
          const slidesContent = currentSlides.map(s => s.frameContent || '').join('\n\n');
          currentLatex = await texTemplate.apply(slidesContent, true);
          
          log.info(`Slide ${errorInfo.slideIndex} refined, re-merging for retry...`);
          continue;
        }
      }

      log.warn(`Could not identify problematic slide, attempting global fixes...`);
      
      const globalFixResult = await this._applyGlobalFixes(currentLatex, errorInfo.error);
      if (globalFixResult) {
        currentLatex = globalFixResult;
        continue;
      }

      if (attempts < maxRetries) {
        log.info(`Retrying with simplified version...`);
        currentLatex = await this._createSimplifiedVersion(currentSlides, texTemplate);
      }
    }

    log.error(`Failed to compile full presentation after ${maxRetries} attempts`);
    return {
      success: false,
      pdfPath: null,
      error: lastError,
      refinedSlides: currentSlides,
      attempts
    };
  }

  _parseCompileError(error, output) {
    const slideIndex = this._extractSlideIndexFromError(output);
    const lineNumber = this._extractLineNumber(output);
    
    return {
      slideIndex,
      lineNumber,
      error,
      output
    };
  }

  _extractSlideIndexFromError(output) {
    const slideMatch = output.match(/slide[-_]?(\d+)/i);
    if (slideMatch) {
      return parseInt(slideMatch[1]) - 1;
    }

    const frameMatch = output.match(/frame.*?(\d+)/i);
    if (frameMatch) {
      return parseInt(frameMatch[1]) - 1;
    }

    const pageMatch = output.match(/Page\s*(\d+)/i);
    if (pageMatch) {
      return parseInt(pageMatch[1]) - 1;
    }

    return null;
  }

  _extractLineNumber(output) {
    const lineMatch = output.match(/line\s*(\d+)/i);
    return lineMatch ? parseInt(lineMatch[1]) : null;
  }

  async _refineSlide(slide, error, lineNumber, texTemplate, outputDir) {
    log.info(`Refining slide with frameContent: ${(slide.frameContent || '').substring(0, 100)}...`);

    const simplified = this._simplifySlideContent(slide.frameContent, error);
    
    if (simplified !== slide.frameContent) {
      log.info(`Slide content simplified`);
      return {
        ...slide,
        frameContent: simplified
      };
    }

    return null;
  }

  _simplifySlideContent(frameContent, error) {
    let content = frameContent || '';

    if (error.includes('Missing') || error.includes('$}') || error.includes('$')) {
      content = content.replace(/\$/g, '\\$');
    }

    if (error.includes('begin') && error.includes('undefined')) {
      const envMatch = error.match(/begin\{(\w+)\}/);
      if (envMatch) {
        const env = envMatch[1];
        content = content.replace(new RegExp(`\\\\begin\\{${env}\\}`, 'g'), '');
        content = content.replace(new RegExp(`\\\\end\\{${env}\\}`, 'g'), '');
      }
    }

    if (error.includes('overflow') || error.includes('Too many')) {
      content = content.replace(/\[.*?width.*?\]/g, '[width=0.8\\linewidth]');
      content = content.replace(/\[.*?height.*?\]/g, '[height=0.8\\textheight]');
    }

    content = content.replace(/\\\\$/gm, '');

    return content;
  }

  async _applyGlobalFixes(latex, error) {
    let fixed = latex;

    if (error.includes('Missing') && error.includes('}')) {
      const openBraces = (fixed.match(/\{/g) || []).length;
      const closeBraces = (fixed.match(/\}/g) || []).length;
      const diff = openBraces - closeBraces;
      
      if (diff > 0) {
        fixed += '}'.repeat(diff);
        log.info(`Added ${diff} closing braces`);
      }
    }

    if (error.includes('float') && error.includes('undefined')) {
      fixed = fixed.replace(/\\centering\s*$/gm, '');
    }

    return fixed;
  }

  async _createSimplifiedVersion(slides, texTemplate) {
    const simplifiedSlides = slides.map(slide => {
      let content = slide.frameContent || '';
      
      content = content.replace(/\[.*?width.*?\]/g, '[width=0.9\\linewidth]');
      content = content.replace(/\[.*?height.*?\]/g, '[height=0.9\\textheight]');
      
      content = content.replace(/\\begin\{figure\}.*?\\end\{figure\}/gs, 
        '\\begin{frame}\n\\centering\n[Figure removed due to compilation error]\n\\end{frame}');
      
      return {
        ...slide,
        frameContent: content
      };
    });

    const slidesContent = simplifiedSlides.map(s => s.frameContent || '').join('\n\n');
    return await texTemplate.apply(slidesContent, true);
  }
}

export default RefineFullPresentationTask;

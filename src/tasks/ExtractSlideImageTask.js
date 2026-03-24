import Task from './Task.js';
import LatexUtils from '../utils/latexUtils.js';
import FileUtils from '../utils/fileUtils.js';
import path from 'path';
import fs from 'fs';
import { log } from '../utils/logger.js';

export class ExtractSlideImageTask extends Task {
  static get name() {
    return 'ExtractSlideImageTask';
  }

  static get inputSchema() {
    return {
      slideFilePath: { type: 'string', required: false },
      fullPdfPath: { type: 'string', required: false },
      outputDir: { type: 'string', required: false },
      slideIndex: { type: 'number', required: true }
    };
  }

  static get outputSchema() {
    return {
      imagePath: { type: 'string' },
      success: { type: 'boolean' }
    };
  }

  async execute(input) {
    const { slideFilePath, fullPdfPath, outputDir, slideIndex = 1 } = input;
    
    log.info(`Extracting slide ${slideIndex} from PDF`);

    try {
      let pdfPath = null;

      if (fullPdfPath && fs.existsSync(fullPdfPath)) {
        pdfPath = fullPdfPath;
      } else if (outputDir) {
        pdfPath = this._findLatestPdf(outputDir);
      } else if (slideFilePath) {
        pdfPath = this._getPdfPath(slideFilePath);
        if (!pdfPath || !fs.existsSync(pdfPath)) {
          pdfPath = this._findPdfBySlideIndex(slideFilePath, slideIndex);
        }
      }

      if (!pdfPath || !fs.existsSync(pdfPath)) {
        throw new Error(`PDF not found for slide ${slideIndex}`);
      }

      return await this._extractImage(pdfPath, slideIndex);
    } catch (error) {
      log.error(`Failed to extract image: ${error.message}`);
      return {
        imagePath: null,
        success: false,
        error: error.message
      };
    }
  }

  _findLatestPdf(outputDir) {
    if (!outputDir || !fs.existsSync(outputDir)) {
      return null;
    }

    const files = fs.readdirSync(outputDir);
    const pdfFiles = files
      .filter(f => f.endsWith('.pdf'))
      .map(f => ({
        name: f,
        path: path.join(outputDir, f),
        mtime: fs.statSync(path.join(outputDir, f)).mtime.getTime()
      }))
      .sort((a, b) => b.mtime - a.mtime);

    if (pdfFiles.length > 0) {
      return pdfFiles[0].path;
    }
    return null;
  }

  _getPdfPath(texFilePath) {
    if (!texFilePath) return null;
    return texFilePath.replace(/\.tex$/, '.pdf');
  }

  _findPdfBySlideIndex(texFilePath, slideIndex) {
    const dir = path.dirname(texFilePath);
    const baseName = path.basename(texFilePath, '.tex');

    // Try page_slide_XXX.pdf pattern (e.g., page_slide_001.pdf)
    const slidePdf = path.join(dir, `page_slide_${String(slideIndex).padStart(3, '0')}.pdf`);
    if (fs.existsSync(slidePdf)) {
      return slidePdf;
    }

    // Try timestamp-based pattern
    const files = fs.readdirSync(dir);
    const pdfFiles = files.filter(f => f.endsWith('.pdf') && f.includes('slide'));

    if (pdfFiles.length >= slideIndex) {
      return path.join(dir, pdfFiles[slideIndex - 1]);
    }

    return null;
  }

  async _extractImage(pdfPath, slideIndex) {
    const outputDir = path.dirname(pdfPath);
    const imagesDir = path.join(outputDir, 'slide_images');
    await FileUtils.ensureDirectory(imagesDir);

    const imagePath = path.join(imagesDir, `slide-${slideIndex}.png`);
    
    await LatexUtils.convertPdfToImage(pdfPath, imagePath);
    
    log.success(`Extracted slide image: ${imagePath}`);
    
    return {
      imagePath,
      success: true
    };
  }
}

export default ExtractSlideImageTask;

import Task from './Task.js';
import LatexUtils from '../../utils/latexUtils.js';
import FileUtils from '../../utils/fileUtils.js';
import path from 'path';
import { log } from '../../utils/logger.js';
import config from '../config.js';

export class ProcessSlidesTask extends Task {
  static get name() {
    return 'ProcessSlidesTask';
  }

  static get inputSchema() {
    return {
      pdfPath: { type: 'string', required: true },
      type: { type: 'string', required: false }
    };
  }

  static get outputSchema() {
    return {
      pageImage: { type: 'string' },
      pages: { type: 'array' },
      type: { type: 'string' }
    };
  }

  async execute(input) {
    const { pdfPath, type = 'single' } = input;
    
    log.info(`Processing slides from PDF (${type})`);

    try {
      if (type === 'single') {
        return await this._processSingleSlide(pdfPath);
      } else {
        return await this._processAllSlides(pdfPath);
      }
    } catch (error) {
      log.error(`Failed to process slides: ${error.message}`);
      throw error;
    }
  }

  async _processSingleSlide(pdfPath) {
    const outputDir = path.dirname(pdfPath);
    const imagesDir = path.join(outputDir, 'images');
    await FileUtils.ensureDirectory(imagesDir);

    const imagePath = path.join(imagesDir, 'page-1.png');
    
    await LatexUtils.convertPdfToImage(pdfPath, imagePath);
    
    log.success(`Created image: ${imagePath}`);
    
    return {
      pageImage: imagePath,
      pages: null,
      type: 'single'
    };
  }

  async _processAllSlides(pdfPath) {
    const outputDir = path.dirname(pdfPath);
    const imagesDir = path.join(outputDir, 'images');
    await FileUtils.ensureDirectory(imagesDir);

    const { pagePaths } = await LatexUtils.splitPdfIntoPages(pdfPath, outputDir);
    
    const pages = [];
    
    for (let i = 0; i < pagePaths.length; i++) {
      const pageImagePath = path.join(imagesDir, `page-${i + 1}.png`);
      await LatexUtils.convertPdfToImage(pagePaths[i], pageImagePath);
      
      pages.push({
        pdfPath: pagePaths[i],
        imagePath: pageImagePath,
        index: i + 1
      });
    }
    
    log.success(`Created ${pages.length} page images`);
    
    return {
      pageImage: null,
      pages,
      type: 'full'
    };
  }
}

export default ProcessSlidesTask;

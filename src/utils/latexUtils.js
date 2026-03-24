import { execFile } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';
import path from 'path';
import { PDFDocument } from 'pdf-lib';
import config from '../config.js';
import { PlaceholderImageGenerator } from './placeholderImage.js';
import { log } from './logger.js';
import { stdout } from 'process';

const execFileAsync = promisify(execFile);

export class TeXCompilerError extends Error {
  constructor(message, cmd, stderr, stdout) {
    super(message);
    this.name = 'CompilerError';
    this.cmd = cmd;
    this.stderr = stderr;
    this.stdout = stdout;
  }
};

/**
  * Parse XeLaTeX output to extract relevant error information
  * @param {string} compileOutput - Full XeLaTeX output
  * @param {number} contextLines - Number of context lines before/after error (default: 5)
  * @returns {string} Filtered error message with context
  */
function _parseLatexError(compileOutput, contextLines = 8) {
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
    return lines.slice(-16).join('\n');
  }

  return errorLines.join('\n');
}

export class LatexUtils {
  static log = log.create('LatexUtils');

  static async runCompiler(command, args, cwd) {
    this.log.debug(`Running ${command} ${args.join(' ')} in ${cwd}`);

    let exec_out;

    try {
      exec_out = await execFileAsync(command, args, {
        cwd,
        timeout: config.latex.timeout,
      });
    } catch (error) {
      throw new TeXCompilerError(
        error.message,
        error.cmd,
        error.stderr,
        _parseLatexError(error.stdout)
      );
    }
  }


  static async _compileTeX(texPath, workSpace) {
    const fileName = path.basename(texPath);
    await this.runCompiler(
      config.latex.engine,
      [...config.latex.texargs, fileName],
      workSpace,
    );
  }

  static async _compileBiB(texPath, workSpace) {
    const fileName = path.basename(texPath);
    this.log.debug(fileName);
    await this.runCompiler(
      config.latex.bibengine,
      [fileName],
      workSpace,
    );
  }

  static async compileTexFile(texPath, workSpace = null, with_bib = true) {
    // with_bib: xelatex -> bibtex -> xelatex -> xelatex
    // no with_bib: xelatex -> xelatex
    if (workSpace == null) {
      workSpace = path.dirname(texPath);
    }

    if (with_bib) {
      await this._compileTeX(texPath, workSpace);
      await this._compileBiB(texPath, workSpace);
      await this._compileTeX(texPath, workSpace);
      await this._compileTeX(texPath, workSpace);
    } else {
      await this._compileTeX(texPath, workSpace);
      await this._compileTeX(texPath, workSpace);
    }

    // Check if PDF was generated
    const pdfPath = texPath.replace(/\.tex$/, '.pdf');
    if (fs.existsSync(pdfPath)) {
      return {
        success: true,
        pdfPath,
        texPath
      };
    }

    return {
      success: false,
      error: 'PDF file was not generated',
      texPath
    };
  }

  static async compileTeXString(latexContent, outputDir, jobName = 'presentation') {
    const texPath = path.join(outputDir, `${jobName}.tex`);

    await fs.promises.writeFile(texPath, latexContent, 'utf-8');

    // Check if bibliography is needed (look for \bibliography or \cite commands)
    const hasBibliography = /\\bibliography\{|\\cite\{/.test(latexContent);
    return await this.compileTexFile(texPath, outputDir, hasBibliography);
  }

  static async splitPdfIntoPages(pdfPath, outputDir) {
    const pdfBytes = await fs.promises.readFile(pdfPath);
    const pdfDoc = await PDFDocument.load(pdfBytes);
    const pageCount = pdfDoc.getPageCount();
    const pagePaths = [];

    for (let i = 0; i < pageCount; i++) {
      const pagePdf = await PDFDocument.create();
      const [copiedPage] = await pagePdf.copyPages(pdfDoc, [i]);
      pagePdf.addPage(copiedPage);

      const pageBytes = await pagePdf.save();
      const pagePath = path.join(outputDir, `page-${i + 1}.pdf`);
      await fs.promises.writeFile(pagePath, pageBytes);
      pagePaths.push(pagePath);
    }

    return {
      pageCount,
      pagePaths,
    };
  }

  static async convertPdfToImage(pdfPath, imagePath, dpi = 150) {
    try {
      return await this.convertWithPoppler(pdfPath, imagePath, dpi);
    } catch (error) {
      this.log.warn('Poppler not available, trying ImageMagick...');
      try {
        return await this.convertWithImageMagick(pdfPath, imagePath, dpi);
      } catch (error2) {
        this.log.warn('ImageMagick not available, using LaTeX fallback...');
        return this.fallbackPdfToImage(pdfPath, imagePath);
      }
    }
  }

  static async convertWithPoppler(pdfPath, imagePath, dpi = 150) {
    const outputPrefix = path.join(path.dirname(imagePath), path.basename(imagePath, '.png'));

    await execFileAsync('pdftoppm', [
      '-png',
      '-f', '1',
      '-l', '1',
      '-r', dpi.toString(),
      pdfPath,
      outputPrefix
    ], {
      timeout: config.latex.timeout,
    });

    const generatedPath = `${outputPrefix}-1.png`;
    if (fs.existsSync(generatedPath)) {
      if (generatedPath !== imagePath) {
        await fs.promises.rename(generatedPath, imagePath);
      }
      return imagePath;
    }
    throw new Error('Poppler conversion failed');
  }

  static async convertWithImageMagick(pdfPath, imagePath, dpi = 150) {
    await execFileAsync('convert', [
      '-density', dpi.toString(),
      `${pdfPath}[0]`,
      '-quality', '90',
      imagePath
    ], {
      timeout: config.latex.timeout,
    });

    if (fs.existsSync(imagePath)) {
      return imagePath;
    }
    throw new Error('ImageMagick conversion failed');
  }

  static async fallbackPdfToImage(pdfPath, imagePath) {
    const template = `
\\documentclass[convert={density=150,size=1080x800,outext=.png}]{standalone}
\\usepackage{graphicx}
\\begin{document}
\\includegraphics[width=\\textwidth]{${pdfPath}}
\\end{document}
`;

    const tempDir = path.dirname(imagePath);
    const tempTex = path.join(tempDir, 'convert.tex');
    await fs.promises.writeFile(tempTex, template, 'utf-8');

    try {
      await execFileAsync('pdflatex', ['-shell-escape', 'convert.tex'], {
        cwd: tempDir,
        timeout: config.latex.timeout,
      });

      const generatedPng = path.join(tempDir, 'convert.png');
      if (fs.existsSync(generatedPng)) {
        await fs.promises.rename(generatedPng, imagePath);
        return imagePath;
      }
    } catch (error) {
      this.log.warn('Fallback conversion also failed');
    }

    throw new Error('PDF to image conversion failed');
  }

}

export default LatexUtils;

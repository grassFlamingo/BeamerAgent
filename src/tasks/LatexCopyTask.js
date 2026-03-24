import Task from './Task.js';
import FileUtils from '../utils/fileUtils.js';
import path from 'path';
import fs from 'fs';
import { log } from '../utils/logger.js';

/**
 * LatexCopyTask - Copies LaTeX projects to a cache/output directory
 *
 * This task:
 * 1. Finds the main .tex file (containing \documentclass)
 * 2. Recursively discovers all included .tex files
 * 3. Extracts bibliography files (.bib)
 * 4. Finds all graphics files referenced via \includegraphics
 * 5. Copies all discovered files to a cache directory preserving structure
 */
export class LatexCopyTask extends Task {
  static get name() {
    return 'LatexCopyTask';
  }

  static get inputSchema() {
    return {
      projectDir: { type: 'string', required: true },
      mainFile: { type: 'string', required: false },
      cacheDir: { type: 'string', required: false },
      cleanCompiled: { type: 'boolean', required: false, default: true },
      cleanTex: { type: 'boolean', required: false, default: false },
      createExpanded: { type: 'boolean', required: false, default: false }
    };
  }

  static get outputSchema() {
    return {
      cacheDir: { type: 'string' },
      mainFile: { type: 'string' },
      texFiles: { type: 'array' },
      bibFiles: { type: 'array' },
      graphicsFiles: { type: 'array' },
      packageFiles: { type: 'array' },
      expandedMainFile: { type: 'string' }
    };
  }

  // Regex patterns for parsing LaTeX
  PATTERNS = {
    documentclass: /\\documentclass(?:\[([^\]]*)\])?\{([^}]+)\}/,
    input: /\\input\s*\{([^}]+)\}/g,
    include: /\\include\s*\{([^}]+)\}/g,
    import: /\\import\s*\{([^}]*)\}\s*\{([^}]+)\}/g,
    subimport: /\\subimport\s*\{([^}]*)\}\s*\{([^}]+)\}/g,
    bibliography: /\\bibliography\s*\{([^}]+)\}/g,
    addbibresource: /\\addbibresource\s*\{([^}]+)\}/g,
    includegraphics: /\\includegraphics(?:\[[^\]]*\])?\s*\{([^}]+)\}/g,
    graphicspath: /\\graphicspath\s*(?:\{([^}]+)\}|\(([^)]+)\))/g,
    usepackage: /\\usepackage(?:\[[^\]]*\])?\s*\{([^}]+)\}/g
  };

  GRAPHICS_EXTENSIONS = ['.pdf', '.png', '.jpg', '.jpeg', '.eps', '.ps', '.svg'];
  IMAGE_DIRS = ['imgs', 'images', 'figures', 'figs', 'graphics', 'assets', 'img', 'figure'];
  COMPILED_EXTENSIONS = ['.aux', '.bbl', '.blg', '.log', '.out', '.pdf'];
  COMPILED_PATTERNS = [/\.synctex\.gz$/i];

  async execute(input) {
    const { projectDir, mainFile, cacheDir, cleanCompiled = true, cleanTex = false, createExpanded = false } = input;

    log.info(`Copying LaTeX project: ${projectDir}`);

    this.projectDir = path.resolve(projectDir);
    this.cacheDir = cacheDir || path.join(this.projectDir, '.beamer_cache');
    this.cleanTex = cleanTex;  // Store for use in _copyFile
    this.expandedMainFile = null;

    // Discover all files
    const mainFilePath = mainFile ? path.resolve(mainFile) : this._findMainFile();

    if (!mainFilePath) {
      throw new Error('Could not find main .tex file with \\documentclass');
    }

    log.info(`Main file: ${mainFilePath}`);

    // Initialize file tracking
    this.texFiles = new Set();
    this.bibFiles = new Set();
    this.graphicsRefs = new Set();
    this.graphicsFiles = new Set();
    this.graphicsPaths = [''];
    this.packageFiles = new Set();

    // Parse main file and all includes recursively
    await this._parseRecursive(mainFilePath);

    // Resolve graphics files from references
    await this._resolveGraphicsFiles();

    // Clean compiled files from cache directory
    if (cleanCompiled) {
      await this._cleanCompiledFiles();
    }

    // Copy all files to cache directory
    await this._copyFilesToCache(mainFilePath);

    // Create expanded single-file version if requested
    // Use the copied main file in cache directory so all included files are available
    if (createExpanded) {
      const copiedMainFile = path.join(this.cacheDir, path.relative(this.projectDir, mainFilePath));
      this.expandedMainFile = await this._createExpandedFile(copiedMainFile);
      log.success(`Created expanded file: ${path.relative(this.projectDir, this.expandedMainFile)}`);
    }

    log.success(`Copy complete. Cached ${this.texFiles.size} tex files, ` +
                `${this.bibFiles.size} bib files, ${this.graphicsFiles.size} graphics files, ` +
                `${this.packageFiles.size} package files`);

    // Calculate relative paths for output
    const relativeCacheDir = this.cacheDir;
    const relativeMainFile = path.relative(this.projectDir, mainFilePath);

    return {
      cacheDir: relativeCacheDir,
      mainFile: relativeMainFile,
      texFiles: Array.from(this.texFiles).map(f => path.relative(this.projectDir, f)),
      bibFiles: Array.from(this.bibFiles).map(f => path.relative(this.projectDir, f)),
      graphicsFiles: Array.from(this.graphicsFiles).map(f => path.relative(this.projectDir, f)),
      packageFiles: Array.from(this.packageFiles).map(f => path.relative(this.projectDir, f)),
      expandedMainFile: this.expandedMainFile ? path.relative(this.projectDir, this.expandedMainFile) : null
    };
  }

  /**
   * Find the main .tex file containing \documentclass
   */
  _findMainFile() {
    const commonNames = ['main.tex', 'document.tex', 'paper.tex', 'thesis.tex',
                         'dissertation.tex', 'report.tex', 'article.tex', 'book.tex'];

    // Check common names first
    for (const name of commonNames) {
      const filePath = path.join(this.projectDir, name);
      if (fs.existsSync(filePath)) {
        const content = fs.readFileSync(filePath, 'utf-8');
        if (this.PATTERNS.documentclass.test(content)) {
          return filePath;
        }
      }
    }

    // Search all .tex files
    const texFiles = this._findAllTexFiles(this.projectDir);
    for (const texFile of texFiles) {
      const content = fs.readFileSync(texFile, 'utf-8');
      if (this.PATTERNS.documentclass.test(content)) {
        return texFile;
      }
    }

    return null;
  }

  /**
   * Recursively parse a .tex file and all its includes
   */
  async _parseRecursive(filepath, visited = new Set()) {
    const resolvedPath = path.resolve(filepath);

    if (visited.has(resolvedPath)) {
      return;
    }
    visited.add(resolvedPath);

    if (!fs.existsSync(resolvedPath)) {
      log.warn(`File not found: ${resolvedPath}`);
      return;
    }

    this.texFiles.add(resolvedPath);
    const content = fs.readFileSync(resolvedPath, 'utf-8');
    const baseDir = path.dirname(resolvedPath);

    // Find \input{...} commands
    this._findPatternMatches(this.PATTERNS.input, content, (match) => {
      const inputPath = this._resolveInputPath(match[1], baseDir, false);
      if (inputPath) {
        this._parseRecursive(inputPath, visited);
      }
    });

    // Find \include{...} commands
    this._findPatternMatches(this.PATTERNS.include, content, (match) => {
      const inputPath = this._resolveInputPath(match[1], baseDir, true);
      if (inputPath) {
        this._parseRecursive(inputPath, visited);
      }
    });

    // Find \import{path}{file} commands
    this._findPatternMatches(this.PATTERNS.import, content, (match) => {
      const inputPath = this._resolveImportPath(match[1], match[2]);
      if (inputPath) {
        this._parseRecursive(inputPath, visited);
      }
    });

    // Find \bibliography{...} commands
    this._findPatternMatches(this.PATTERNS.bibliography, content, (match) => {
      const bibNames = match[1].split(',').map(b => b.trim());
      for (const bibName of bibNames) {
        const bibPath = this._findBibFile(bibName, baseDir);
        if (bibPath) {
          this.bibFiles.add(bibPath);
          log.debug(`Found bibliography: ${bibPath}`);
        }
      }
    });

    // Find \addbibresource{...} commands
    this._findPatternMatches(this.PATTERNS.addbibresource, content, (match) => {
      const bibPath = this._findBibFile(match[1], baseDir);
      if (bibPath) {
        this.bibFiles.add(bibPath);
        log.debug(`Found bib resource: ${bibPath}`);
      }
    });

    // Find \includegraphics{...} commands
    this._findPatternMatches(this.PATTERNS.includegraphics, content, (match) => {
      this.graphicsRefs.add(match[1]);
    });

    // Find \graphicspath{...} commands
    this._findPatternMatches(this.PATTERNS.graphicspath, content, (match) => {
      const graphicsPath = match[1] || match[2];
      if (graphicsPath) {
        this.graphicsPaths.push(graphicsPath);
      }
    });

    // Find \usepackage{...} commands
    this._findPatternMatches(this.PATTERNS.usepackage, content, (match) => {
      const packageNames = match[1].split(',').map(p => p.trim());
      for (const pkgName of packageNames) {
        const pkgPath = this._findPackageFile(pkgName, baseDir);
        if (pkgPath) {
          this.packageFiles.add(pkgPath);
          log.debug(`Found package: ${pkgPath}`);
        }
      }
    });
  }

  /**
   * Resolve graphics files from references
   */
  async _resolveGraphicsFiles() {
    if (this.graphicsRefs.size === 0) {
      return;
    }

    // Search directories: project root + graphics paths + common image dirs
    const searchDirs = new Set([this.projectDir]);

    // Add graphics paths from document
    for (const gpath of this.graphicsPaths) {
      const fullPath = path.join(this.projectDir, gpath);
      if (fs.existsSync(fullPath)) {
        searchDirs.add(fullPath);
      }
    }

    // Add common image directories
    for (const imgDir of this.IMAGE_DIRS) {
      const fullPath = path.join(this.projectDir, imgDir);
      if (fs.existsSync(fullPath)) {
        searchDirs.add(fullPath);
      }
    }

    // For each graphics reference, try to find the actual file
    for (const graphicRef of this.graphicsRefs) {
      const found = await this._findGraphicsFile(graphicRef, searchDirs);
      if (found) {
        this.graphicsFiles.add(found);
        log.debug(`Found graphics file: ${found}`);
      }
    }
  }

  /**
   * Find a graphics file by reference name
   */
  async _findGraphicsFile(graphicRef, searchDirs) {
    const refWithExt = graphicRef;
    const refWithoutExt = graphicRef.includes('.')
      ? graphicRef.substring(0, graphicRef.lastIndexOf('.'))
      : graphicRef;
    const refBasename = path.basename(graphicRef);
    const refBasenameNoExt = path.basename(graphicRef, path.extname(graphicRef));

    for (const searchDir of searchDirs) {
      for (const ext of this.GRAPHICS_EXTENSIONS) {
        // Try with explicit extension
        const filePath = path.join(searchDir, refWithExt + ext);
        if (fs.existsSync(filePath)) {
          return filePath;
        }

        // Try without extension (add our extension)
        const filePath2 = path.join(searchDir, refWithoutExt + ext);
        if (fs.existsSync(filePath2)) {
          return filePath2;
        }

        // Try basename variations
        const filePath3 = path.join(searchDir, refBasename + ext);
        if (fs.existsSync(filePath3)) {
          return filePath3;
        }

        const filePath4 = path.join(searchDir, refBasenameNoExt + ext);
        if (fs.existsSync(filePath4)) {
          return filePath4;
        }
      }

      // Try the reference as-is (might already have extension)
      const filePathAsIs = path.join(searchDir, graphicRef);
      if (fs.existsSync(filePathAsIs)) {
        const stat = fs.statSync(filePathAsIs);
        if (stat.isFile()) {
          const ext = path.extname(filePathAsIs).toLowerCase();
          if (this.GRAPHICS_EXTENSIONS.includes(ext)) {
            return filePathAsIs;
          }
        }
      }
    }

    return null;
  }

  /**
   * Clean compiled LaTeX files from cache directory
   */
  async _cleanCompiledFiles() {
    if (!fs.existsSync(this.cacheDir)) {
      return;
    }

    const entries = fs.readdirSync(this.cacheDir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isFile()) {
        const name = entry.name.toLowerCase();
        const ext = path.extname(name);
        
        // Check standard extensions
        if (this.COMPILED_EXTENSIONS.includes(ext)) {
          await fs.promises.unlink(path.join(this.cacheDir, entry.name));
          log.debug(`Removed compiled file: ${entry.name}`);
          continue;
        }
        
        // Check special patterns (e.g., .synctex.gz)
        for (const pattern of this.COMPILED_PATTERNS) {
          if (pattern.test(name)) {
            await fs.promises.unlink(path.join(this.cacheDir, entry.name));
            log.debug(`Removed compiled file: ${entry.name}`);
            break;
          }
        }
      }
    }
  }

  /**
   * Copy all discovered files to cache directory
   */
  async _copyFilesToCache(mainFilePath) {
    await FileUtils.ensureDirectory(this.cacheDir);

    const copiedFiles = new Set();

    // Copy .tex files (clean if option is enabled)
    for (const texFile of this.texFiles) {
      const relativePath = path.relative(this.projectDir, texFile);
      const destPath = path.join(this.cacheDir, relativePath);
      await this._copyFile(texFile, destPath, this.cleanTex);
      copiedFiles.add(destPath);
    }

    // Copy .bib files
    for (const bibFile of this.bibFiles) {
      const relativePath = path.relative(this.projectDir, bibFile);
      const destPath = path.join(this.cacheDir, relativePath);
      await this._copyFile(bibFile, destPath);
      copiedFiles.add(destPath);
    }

    // Copy graphics files
    for (const graphicsFile of this.graphicsFiles) {
      const relativePath = path.relative(this.projectDir, graphicsFile);
      const destPath = path.join(this.cacheDir, relativePath);
      await this._copyFile(graphicsFile, destPath);
      copiedFiles.add(destPath);
    }

    // Copy package files
    for (const packageFile of this.packageFiles) {
      const relativePath = path.relative(this.projectDir, packageFile);
      const destPath = path.join(this.cacheDir, relativePath);
      await this._copyFile(packageFile, destPath);
      copiedFiles.add(destPath);
    }

    log.info(`Copied ${copiedFiles.size} files to cache: ${this.cacheDir}`);
  }

  /**
   * Copy a single file, creating parent directories as needed
   * For .tex files, optionally clean comments and empty lines
   */
  async _copyFile(srcPath, destPath, cleanTex = false) {
    const destDir = path.dirname(destPath);
    await FileUtils.ensureDirectory(destDir);
    
    const ext = path.extname(srcPath).toLowerCase();
    
    if (cleanTex && ext === '.tex') {
      // Read, clean, and write .tex file
      const content = await fs.promises.readFile(srcPath, 'utf-8');
      const cleaned = this._cleanLatexContent(content);
      await fs.promises.writeFile(destPath, cleaned, 'utf-8');
    } else {
      // Copy other files as-is
      await fs.promises.copyFile(srcPath, destPath);
    }
    
    log.debug(`Copied: ${srcPath} -> ${destPath}`);
  }

  /**
   * Clean LaTeX content by removing comments, unnecessary spacing commands, and excessive whitespace
   * @param {string} content - LaTeX content to clean
   * @returns {string} Cleaned LaTeX content
   */
  _cleanLatexContent(content) {
    // Step 1: Remove comments (but not escaped \%)
    content = content.replace(/(?<!\\)%.*$/gm, '');

    // Step 2: Remove vertical spacing commands
    // Remove \vspace{-1em}, \vspace{-0.5em}, \vspace{...}, etc.
    content = content.replace(/\\vspace\s*(?:\[[^\]]*\])?\s*\{[^}]*\}/g, '');
    
    // Remove \hspace commands
    content = content.replace(/\\hspace\s*(?:\[[^\]]*\])?\s*\{[^}]*\}/g, '');
    
    // Remove \smallskip, \medskip, \bigskip
    content = content.replace(/\\(smallskip|medskip|bigskip)\s*/g, '');
    
    // Remove \vskip and \hskip with negative values (commonly used for manual adjustments)
    content = content.replace(/\\vskip\s*-\d*\.?\d*(?:pt|em|ex|mm|cm|in)\s*/g, '');
    content = content.replace(/\\hskip\s*-\d*\.?\d*(?:pt|em|ex|mm|cm|in)\s*/g, '');

    // Step 3: Remove excessive whitespace (more than 2 consecutive newlines)
    content = content.replace(/\n{3,}/g, '\n\n');

    // Step 4: Remove trailing whitespace from lines
    content = content.replace(/[ \t]+$/gm, '');

    // Step 5: Remove leading whitespace from empty lines
    content = content.replace(/^\s+$/gm, '');

    return content.trim() + '\n';
  }

  /**
   * Recursively expand \input and \include commands in a .tex file
   * @param {string} filepath - Path to the .tex file to expand
   * @param {Set} visited - Set of already visited files (to prevent circular includes)
   * @returns {string} Expanded content with all inputs/includes inlined
   */
  _expandInputs(filepath, visited = new Set()) {
    const resolvedPath = path.resolve(filepath);

    if (visited.has(resolvedPath)) {
      log.warn(`Circular include detected: ${resolvedPath}`);
      return '';
    }
    visited.add(resolvedPath);

    if (!fs.existsSync(resolvedPath)) {
      log.warn(`File not found: ${resolvedPath}`);
      return '';
    }

    let content = fs.readFileSync(resolvedPath, 'utf-8');
    const baseDir = path.dirname(resolvedPath);

    // Add a comment to mark the source file
    const relativePath = path.relative(this.projectDir, resolvedPath);
    content = `% --- Start of file: ${relativePath} ---\n${content}\n% --- End of file: ${relativePath} ---\n`;

    // Expand \input{...} commands
    content = this._expandInputCommands(content, baseDir, this.PATTERNS.input, false, visited);

    // Expand \include{...} commands
    content = this._expandInputCommands(content, baseDir, this.PATTERNS.include, true, visited);

    // Expand \import{path}{file} commands
    content = this._expandImportCommands(content, this.PATTERNS.import, visited);

    return content;
  }

  /**
   * Expand \input or \include commands in content
   * @param {string} content - LaTeX content to process
   * @param {string} baseDir - Base directory for resolving relative paths
   * @param {RegExp} pattern - Regex pattern to match commands
   * @param {boolean} isInclude - Whether this is \include (vs \input)
   * @param {Set} visited - Set of visited files
   * @returns {string} Content with commands expanded
   */
  _expandInputCommands(content, baseDir, pattern, isInclude, visited) {
    pattern.lastIndex = 0;

    // Collect all matches first to avoid issues with modifying content during iteration
    const matches = [];
    let match;
    while ((match = pattern.exec(content)) !== null) {
      matches.push({
        fullMatch: match[0],
        includePath: match[1],
        index: match.index
      });
    }

    // Process matches in reverse order to preserve indices
    for (let i = matches.length - 1; i >= 0; i--) {
      const m = matches[i];
      const inputPath = this._resolveInputPath(m.includePath, baseDir, isInclude);

      if (inputPath) {
        const expandedContent = this._expandInputs(inputPath, visited);
        content = content.substring(0, m.index) + expandedContent + content.substring(m.index + m.fullMatch.length);
      } else {
        log.warn(`Could not resolve ${isInclude ? '\\include' : '\\input'}: ${m.includePath}`);
      }
    }

    return content;
  }

  /**
   * Expand \import{path}{file} commands in content
   * @param {string} content - LaTeX content to process
   * @param {RegExp} pattern - Regex pattern to match \import commands
   * @param {Set} visited - Set of visited files
   * @returns {string} Content with commands expanded
   */
  _expandImportCommands(content, pattern, visited) {
    pattern.lastIndex = 0;

    // Collect all matches first
    const matches = [];
    let match;
    while ((match = pattern.exec(content)) !== null) {
      matches.push({
        fullMatch: match[0],
        importPath: match[1],
        filename: match[2],
        index: match.index
      });
    }

    // Process matches in reverse order
    for (let i = matches.length - 1; i >= 0; i--) {
      const m = matches[i];
      const inputPath = this._resolveImportPath(m.importPath, m.filename);

      if (inputPath) {
        const expandedContent = this._expandInputs(inputPath, visited);
        content = content.substring(0, m.index) + expandedContent + content.substring(m.index + m.fullMatch.length);
      } else {
        log.warn(`Could not resolve \\import: ${m.importPath}/${m.filename}`);
      }
    }

    return content;
  }

  /**
   * Create an expanded single-file version of the main .tex file
   * @param {string} mainFilePath - Path to the main .tex file
   * @param {string} outputPath - Path to write the expanded file
   * @returns {Promise<string>} Path to the expanded file
   */
  async _createExpandedFile(mainFilePath, outputPath = null) {
    if (!outputPath) {
      const baseName = path.basename(mainFilePath, '.tex');
      outputPath = path.join(this.cacheDir, `${baseName}_expanded.tex`);
    }

    const outputDir = path.dirname(outputPath);
    await FileUtils.ensureDirectory(outputDir);

    const expandedContent = this._expandInputs(mainFilePath);

    await fs.promises.writeFile(outputPath, expandedContent, 'utf-8');
    log.success(`Created expanded file: ${outputPath}`);

    return outputPath;
  }

  // ==================== Utility Methods ====================

  /**
   * Find all .tex files in a directory recursively
   */
  _findAllTexFiles(dir) {
    const texFiles = [];

    const findFiles = (currentDir) => {
      const entries = fs.readdirSync(currentDir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(currentDir, entry.name);
        if (entry.isDirectory() && !entry.name.startsWith('.')) {
          findFiles(fullPath);
        } else if (entry.isFile() && entry.name.endsWith('.tex')) {
          texFiles.push(fullPath);
        }
      }
    };

    findFiles(dir);
    return texFiles;
  }

  /**
   * Resolve an \input or \include path
   */
  _resolveInputPath(includePath, baseDir, isInclude = false) {
    const mainDir = path.dirname(this._findMainFile());

    // For \include, always relative to main file and adds .tex
    if (isInclude) {
      const candidate = path.join(mainDir, includePath + '.tex');
      if (fs.existsSync(candidate)) {
        return candidate;
      }
      return null;
    }

    // For \input, try multiple locations
    // Also try cache directory if it exists
    const pathsToTry = [
      path.join(baseDir, includePath),
      path.join(baseDir, includePath + '.tex'),
      path.join(this.projectDir, includePath),
      path.join(this.projectDir, includePath + '.tex')
    ];

    // Add cache directory paths if available
    if (this.cacheDir && fs.existsSync(this.cacheDir)) {
      pathsToTry.push(
        path.join(this.cacheDir, includePath),
        path.join(this.cacheDir, includePath + '.tex')
      );
    }

    for (const p of pathsToTry) {
      if (fs.existsSync(p)) {
        return p;
      }
    }

    // Try with .tex extension as last resort
    const withExt = path.join(baseDir, includePath + '.tex');
    if (fs.existsSync(withExt)) {
      return withExt;
    }

    return null;
  }

  /**
   * Resolve an \import{path}{file} command
   */
  _resolveImportPath(importPath, filename) {
    const mainDir = path.dirname(this._findMainFile());

    const pathsToTry = [
      path.join(mainDir, importPath, filename),
      path.join(mainDir, importPath, filename + '.tex'),
      path.join(this.projectDir, importPath, filename),
      path.join(this.projectDir, importPath, filename + '.tex')
    ];

    for (const p of pathsToTry) {
      if (fs.existsSync(p)) {
        return p;
      }
    }

    // Try with .tex extension
    const withExt = path.join(mainDir, importPath, filename + '.tex');
    if (fs.existsSync(withExt)) {
      return withExt;
    }

    return null;
  }

  /**
   * Find a .bib file by name
   */
  _findBibFile(bibName, baseDir) {
    // Ensure .bib extension
    const bibNameWithExt = bibName.endsWith('.bib') ? bibName : bibName + '.bib';

    const pathsToTry = [
      path.join(baseDir, bibNameWithExt),
      path.join(this.projectDir, bibNameWithExt),
      path.join(this.projectDir, 'bib', bibNameWithExt),
      path.join(this.projectDir, 'bibliography', bibNameWithExt)
    ];

    for (const p of pathsToTry) {
      if (fs.existsSync(p)) {
        return p;
      }
    }

    return null;
  }

  /**
   * Find a package file (.sty, .cls, .clo) by name
   */
  _findPackageFile(pkgName, baseDir) {
    const packageExtensions = ['.sty', '.cls', '.clo'];
    const pathsToTry = [];

    // First, try in the same directory as the current .tex file
    for (const ext of packageExtensions) {
      pathsToTry.push(path.join(baseDir, pkgName + ext));
    }

    // Then try in the project root
    for (const ext of packageExtensions) {
      pathsToTry.push(path.join(this.projectDir, pkgName + ext));
    }

    // Try in common style directories
    const styleDirs = ['styles', 'style', 'sty', 'packages', 'pkg', 'texmf/tex/latex'];
    for (const styleDir of styleDirs) {
      for (const ext of packageExtensions) {
        pathsToTry.push(path.join(this.projectDir, styleDir, pkgName + ext));
      }
    }

    for (const p of pathsToTry) {
      if (fs.existsSync(p)) {
        return p;
      }
    }

    return null;
  }

  /**
   * Find all pattern matches in content
   */
  _findPatternMatches(pattern, content, callback) {
    pattern.lastIndex = 0;
    let match;
    while ((match = pattern.exec(content)) !== null) {
      callback(match);
    }
  }
}

export default LatexCopyTask;

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { log } from '../../utils/logger.js';

export class CacheWrapper {
  constructor(outputDir) {
    this.outputDir = outputDir;
    this.cacheFile = 'task-cache.json';
    this.memoryCache = new Map();
    this._saveLock = false;
    this._pendingSave = false;
    this._loaded = false;
  }

  _hash(input) {
    const str = JSON.stringify(input);
    return crypto.createHash('sha256').update(str).digest('hex');
  }

  async _ensureLoaded() {
    if (this._loaded) return;
    
    const cachePath = path.join(this.outputDir, this.cacheFile);
    try {
      const data = await fs.promises.readFile(cachePath, 'utf-8');
      const parsed = JSON.parse(data);
      
      for (const [key, value] of Object.entries(parsed)) {
        this.memoryCache.set(key, value);
      }
      log.debug(`Cache loaded: ${this.memoryCache.size} entries`);
    } catch (error) {
      if (error.code !== 'ENOENT') {
        log.warn(`Failed to load cache: ${error.message}`);
      }
    }
    this._loaded = true;
  }

  async _atomicWrite(filePath, data) {
    const tempPath = filePath + '.tmp';
    await fs.promises.writeFile(tempPath, data, 'utf-8');
    await fs.promises.rename(tempPath, filePath);
  }

  async _persistToDisk() {
    if (!this.outputDir) return;
    
    if (this._saveLock) {
      this._pendingSave = true;
      return;
    }
    
    this._saveLock = true;
    try {
      const cachePath = path.join(this.outputDir, this.cacheFile);
      const data = JSON.stringify(Object.fromEntries(this.memoryCache), null, 2);
      await this._atomicWrite(cachePath, data);
    } catch (error) {
      log.warn(`Failed to persist cache: ${error.message}`);
    } finally {
      this._saveLock = false;
      if (this._pendingSave) {
        this._pendingSave = false;
        setImmediate(() => this._persistToDisk());
      }
    }
  }

  async init() {
    await this._ensureLoaded();
  }

  has(taskName, input) {
    const key = this._hash({ taskName, input });
    return this.memoryCache.has(key);
  }

  get(taskName, input) {
    const key = this._hash({ taskName, input });
    const entry = this.memoryCache.get(key);
    return entry?.output || null;
  }

  getEntry(taskName, input) {
    const key = this._hash({ taskName, input });
    return this.memoryCache.get(key) || null;
  }

  async save(taskName, input, output) {
    const key = this._hash({ taskName, input });
    this.memoryCache.set(key, {
      taskName,
      input: this._sanitizeInput(input),
      output,
      timestamp: Date.now()
    });
    await this._persistToDisk();
  }

  async replay(taskName, input) {
    const key = this._hash({ taskName, input });
    this.memoryCache.delete(key);
    await this._persistToDisk();
  }

  async clear() {
    this.memoryCache.clear();
    await this._persistToDisk();
  }

  _sanitizeInput(input) {
    const sanitized = { ...input };
    
    if (sanitized.latexContent && typeof sanitized.latexContent === 'string') {
      sanitized.latexContent = sanitized.latexContent.substring(0, 500) + 
        (sanitized.latexContent.length > 500 ? '...[truncated]' : '');
    }
    
    if (sanitized.beamerContent) {
      sanitized.beamerContent = '[beamer content]';
    }
    
    if (sanitized.imagePath) {
      sanitized.imagePath = '[image path]';
    }
    
    if (sanitized.pdfPath) {
      sanitized.pdfPath = '[pdf path]';
    }
    
    if (sanitized.pageImage) {
      sanitized.pageImage = '[image path]';
    }
    
    return sanitized;
  }

  getStats() {
    return {
      entries: this.memoryCache.size,
      tasks: new Set([...this.memoryCache.values()].map(v => v.taskName)).size
    };
  }
}

export default CacheWrapper;

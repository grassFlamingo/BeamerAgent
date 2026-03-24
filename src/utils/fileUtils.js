import fs from 'fs';
import path from 'path';
import config from '../config.js';

export class FileUtils {
  static async ensureDirectory(dirPath) {
    if (!fs.existsSync(dirPath)) {
      await fs.promises.mkdir(dirPath, { recursive: true });
    }
    return dirPath;
  }

  static async cleanDirectory(dirPath) {
    if (fs.existsSync(dirPath)) {
      const files = await fs.promises.readdir(dirPath);
      for (const file of files) {
        const filePath = path.join(dirPath, file);
        const stat = await fs.promises.stat(filePath);
        if (stat.isDirectory()) {
          await this.cleanDirectory(filePath);
          await fs.promises.rmdir(filePath);
        } else {
          await fs.promises.unlink(filePath);
        }
      }
    }
  }

  static async readLatexFile(filePath) {
    const content = await fs.promises.readFile(filePath, 'utf-8');
    return this.stripComments(content);
  }

  static stripComments(latexContent) {
    return latexContent
      .split('\n')
      .filter(line => !line.trim().startsWith('%'))
      .map(line => line.replace(/(?<!\\)%.*$/, ''))
      .join('\n');
  }

  static async writeJson(filePath, data) {
    await this.ensureDirectory(path.dirname(filePath));
    await fs.promises.writeFile(filePath, JSON.stringify(data, null, 2), 'utf-8');
  }

  static async readJson(filePath) {
    const content = await fs.promises.readFile(filePath, 'utf-8');
    return JSON.parse(content);
  }

  static async createTimestampedDir(baseDir) {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const dirPath = path.join(baseDir, timestamp);
    await this.ensureDirectory(dirPath);
    return dirPath;
  }

  static getSafeFileName(name) {
    return name.replace(/[^a-zA-Z0-9-_]/g, '_');
  }

  getMimeType(filePath) {
    const ext = path.extname(filePath).toLowerCase();
    const mimeTypes = {
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.gif': 'image/gif',
      '.pdf': 'application/pdf',
      '.svg': 'image/svg+xml'
    };
    return mimeTypes[ext] || 'application/octet-stream';
  }

}

export default FileUtils;

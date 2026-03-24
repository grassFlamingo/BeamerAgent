import fs from 'fs';
import path from 'path';
import { log } from '../utils/logger.js';

export class AgentRecorder {
  constructor(outputDir = null, agentName = 'BeamerAgent') {
    this.agentName = agentName;
    this.filename = outputDir ? path.join(outputDir, `${agentName}.record.json`) : null;
    this.data = {
      agentName: this.agentName,
      startTime: Date.now(),
      lastUpdated: Date.now(),
      task_queue: [],
    };
  }

  async _atomicWrite(filePath, data) {
    const tempPath = filePath + '.tmp';
    await fs.promises.writeFile(tempPath, data, 'utf-8');
    await fs.promises.rename(tempPath, filePath);
  }

  getTaskQueue() {
    return this.data.task_queue;
  }

  pushTaskQueue(task) {
    this.data.task_queue.push(task);
    this.data.lastUpdated = Date.now();
    return this
  }

  async save() {
    try {
      const dir = path.dirname(this.filename);
      await fs.promises.mkdir(dir, { recursive: true });

      const data = JSON.stringify(this.data, null, 2);
      await this._atomicWrite(this.filename, data);

      log.debug(`AgentRecorder: saved ${this.filename}`);
      return { success: true };
    } catch (error) {
      log.error('AgentRecorder: save failed:', error.message);
      throw error;
    }
  }

  async load() {
    try {
      if (!this.filename) {
        return;
      }

      const data = await fs.promises.readFile(this.filename, 'utf-8');
      this.data = JSON.parse(data);
      log.debug(`AgentRecorder: loaded ${this.filename}`);
      // read data
      this.data.task_queue = this.data.task_queue || [];
    } catch (error) {
      log.error('AgentRecorder: load failed:', error.message);
    }
    return this;
  }

}


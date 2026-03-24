import crypto from 'crypto';

export class Task {
  constructor(input = {}) {
    this.id = crypto.randomUUID();
    this.input = input;
    this.output = null;
    this.status = 'pending';
    this.error = null;
    this.timing = {
      start: null,
      end: null,
      duration: null
    };
  }

  static get name() {
    return this.constructor.name;
  }

  static get inputSchema() {
    return {};
  }

  static get outputSchema() {
    return {};
  }

  async execute(input) {
    throw new Error(`Task ${this.name} must implement execute()`);
  }

  getBranches(output, context) {
    return [];
  }

  _validateInput(input) {
    const schema = this.constructor.inputSchema;
    const missing = [];
    
    for (const [key, spec] of Object.entries(schema)) {
      if (spec.required && !(key in input)) {
        missing.push(key);
      }
    }
    
    if (missing.length > 0) {
      throw new Error(
        `${this.name} missing required input: ${missing.join(', ')}`
      );
    }
    
    return true;
  }

  _sanitizeForCache(input) {
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
    
    return sanitized;
  }
}

export default Task;

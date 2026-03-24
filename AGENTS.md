# AGENTS.md - BeamerAgent Development Guide

Guidelines for agentic coding agents working in this repository.

## Build, Lint, and Test Commands

### Running the Application

```bash
node src/index.js <path/to/paper.tex> [output-directory]
# Example: node src/index.js examples/sample-paper.tex output/my-presentation
```

### Running Tests

```bash
npm test                           # Run all tests
node --test --test-name-pattern "API client initialization" tests/
npx node --test --test-name-pattern "API client initialization" tests/
node --test tests/apiclient.test.js
node --test --list tests/         # List test names without running
```

### Environment Setup

```bash
npm install
cp .env.example .env
# Then edit .env with your API keys
```

## Code Style Guidelines

### General

- Pure JavaScript project with ES Modules (`"type": "module"` in package.json)
- Node.js >= 18.0.0
- No TypeScript, no automatic linter/formatter configured

### Imports

- **Always include `.js` extension** in relative imports
- Import order: Node.js built-ins → external packages → internal agents → internal utils → config/logger

```javascript
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import PaperReader from '../agents/PaperReader.js';
import FileUtils from '../utils/fileUtils.js';
import config from './config.js';
import { log } from '../utils/logger.js';
```

### Naming Conventions

- **Classes**: PascalCase (`BeamerWriter`, `FileUtils`)
- **Files**: camelCase (`fileUtils.js`)
- **Functions/methods**: camelCase (`ensureDirectory()`)
- **Constants**: UPPER_SNAKE_CASE (`MAX_RETRIES`)
- **Booleans**: Prefix with `is`, `has`, `can`, `should`

### Class and Module Patterns

- **Named exports for classes**: `export class BeamerAgent { }`
- **Default exports for singletons**: `export default new APIClient()`
- **Utility classes**: static methods (`FileUtils.ensureDirectory()`)
- **Get `__dirname` in ES modules**:

```javascript
import { fileURLToPath } from 'url';
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
```

### JSDoc Comments

Use for all public methods and complex functions:

```javascript
/**
 * Compile LaTeX Beamer presentation to PDF
 * @param {string} content - LaTeX Beamer source code
 * @param {string} outputDir - Output directory path
 * @returns {Promise<{success: boolean, pdfPath?: string, error?: string}>}
 */
```

### Formatting

- Indentation: 2 spaces
- Quotes: single quotes
- Semicolons: use at statement end
- Braces: K&R style (opening brace on same line)

### Error Handling

- Use `try/catch` for all async operations
- Return error objects for recoverable errors:

```javascript
return { success: false, error: 'Descriptive message', details: ... };
// For fatal errors: throw new Error('Fatal: cannot continue');
```

### Logging

Use custom logger from `utils/logger.js`:
- `log.info()`, `log.success()`, `log.warn()`, `log.error()`, `log.debug()`

```javascript
log.info(`Processing file: ${inputPath}`);
log.error('Failed to compile:', error.message);
```

### Testing

- Test files in `tests/` with `*.test.js` suffix
- Use Node.js built-in test runner (`node:test`)
- Use `assert/strict` for assertions

```javascript
import test from 'node:test';
import assert from 'node:assert/strict';

test('test name', async () => {
  assert.strictEqual(actual, expected);
});
```

### File Organization

```
src/           - Main entry (index.js, config.js)
agents/        - AI agents (PaperReader, BeamerWriter, VisionValidator, TextValidator)
utils/         - Utilities (apiClient, fileUtils, latexUtils, logger)
tests/         - Test files (*.test.js)
examples/      - Example LaTeX papers
output/        - Generated presentations (gitignored)
```

### Configuration

- Centralized in `src/config.js`
- Environment variables via `dotenv`
- Never hardcode API keys - use environment variables
- Follow `.env.example` pattern

### Working with State

- Agent saves state to `state.json` in output directory
- State includes iteration number and presentation data
- Check `FORCE_RESTART` env var to ignore saved state

### LaTeX-Specific Patterns

- Beamer frames: `\begin{frame}...\end{frame}`
- Use `xelatex` as default engine
- Extract slide LaTeX: `/\\begin\{frame\}([\s\S]*?)\\end\{frame\}/g`

### Adding New Features

1. Create new agents in `agents/` following existing patterns
2. Add config options to `src/config.js`
3. Add tests in `tests/`
4. Update README.md if applicable

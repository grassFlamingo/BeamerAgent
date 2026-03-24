import { log } from './logger.js';

export class JSONParseError extends Error {
  constructor(message, rawResponse = '') {
    super(message);
    this.name = 'JSONParseError';
    this.rawResponse = rawResponse;
  }
}

export function parseJSONResponse(response, options = {}) {
  const {
    requiredKeys = [],
    fallbackValues = {},
    logLevel = 'warn',
    validateKeyTypes = {},
    replaceBlackSlash = true,
    handleLatexEscaping = true,  // Enable LaTeX math delimiter escaping
  } = options;

  if (!response || typeof response !== 'string') {
    log[logLevel]('parseJSONResponse: Invalid response type');
    return { success: false, data: fallbackValues, error: 'Invalid response type' };
  }

  // Pre-process response to handle LaTeX escaping FIRST (before JSON extraction)
  let processedResponse = response;
  if (handleLatexEscaping) {
    // log.debug('parseJSONResponse: Applying LaTeX escaping pre-processing');
    processedResponse = _escapeLatexDelimiters(processedResponse);
    // log.debug(`parseJSONResponse: After escaping (first 200 chars): ${processedResponse.substring(0, 200)}...`);
  }

  // Handle backslash replacement if enabled (and not using handleLatexEscaping)
  if (replaceBlackSlash && !handleLatexEscaping) {
    processedResponse = _escapeBackslashes(processedResponse);
  }

  let jsonStr = extractJSONWithBraceCounting(processedResponse);

  if (!jsonStr) {
    log[logLevel]('parseJSONResponse: No valid JSON found');
    return {
      success: false,
      data: fallbackValues,
      error: 'No valid JSON found',
      rawResponse: response
    };
  }

  let parsed = null;
  try {
    parsed = JSON.parse(jsonStr);
  } catch (e) {
    log[logLevel](`parseJSONResponse: Failed to parse JSON: ${e.message}`);
    log[logLevel](`parseJSONResponse: JSON string that failed: ${jsonStr}`);
    log[logLevel](`parseJSONResponse: Raw response (first 300 chars): ${response}`);
    return {
      success: false,
      data: fallbackValues,
      error: `JSON parse failed: ${e.message}`,
      rawResponse: response
    };
  }

  // Validate required keys exist
  if (requiredKeys.length > 0) {
    const missingKeys = requiredKeys.filter(key => !(key in parsed));
    if (missingKeys.length > 0) {
      log[logLevel](`parseJSONResponse: Missing required keys: ${missingKeys.join(', ')}`);
      return {
        success: false,
        data: fallbackValues,
        error: `Missing required keys: ${missingKeys.join(', ')}`,
        rawResponse: response,
        missingKeys
      };
    }
  }

  // Validate key types if specified
  if (Object.keys(validateKeyTypes).length > 0) {
    const typeErrors = [];
    for (const [key, expectedType] of Object.entries(validateKeyTypes)) {
      if (key in parsed) {
        const actualType = Array.isArray(parsed[key]) ? 'array' : typeof parsed[key];
        if (actualType !== expectedType) {
          typeErrors.push(`Key '${key}' expected ${expectedType} but got ${actualType}`);
        }
      }
    }
    if (typeErrors.length > 0) {
      log[logLevel](`parseJSONResponse: Type validation failed: ${typeErrors.join('; ')}`);
      return {
        success: false,
        data: fallbackValues,
        error: `Type validation failed: ${typeErrors.join('; ')}`,
        rawResponse: response,
        typeErrors
      };
    }
  }

  log.debug('parseJSONResponse: JSON parsed successfully');
  return { success: true, data: parsed };
}

/**
 * Escape LaTeX math delimiters and commands in JSON response
 * Handles \( \) \[ \] and LaTeX commands like \includegraphics
 * Also normalizes excessive backslashes (\\\ → \\)
 * @param {string} response - Raw response string
 * @returns {string} Processed response with escaped backslashes
 * @private
 */
function _escapeLatexDelimiters(response) {
  let processedResponse = response;

  // Step 0: Normalize excessive backslashes (4 or more \ → 2 \)
  // This handles cases where LLM over-escapes: \\\\ (4 backslashes) → \\ (2 backslashes)
  // Also handles 3+ backslashes → 2
  processedResponse = processedResponse.replace(/\\{4,}/g, '\\\\');
  processedResponse = processedResponse.replace(/\\{3}/g, '\\\\');

  // Step 1: Protect already escaped backslashes (\\\\)
  const protectedPatterns = [];
  let protectIndex = 0;

  processedResponse = processedResponse.replace(/\\\\/g, () => {
    const placeholder = `__PROTECTED_ESCAPE_${protectIndex++}__`;
    protectedPatterns.push('\\\\');
    return placeholder;
  });

  // Step 2: Escape remaining single backslashes (LaTeX commands)
  // Simple approach: replace all remaining \ with \\
  processedResponse = processedResponse.replace(/\\/g, '\\\\');

  // Step 3: Restore protected patterns (convert \\\\ back to \\)
  protectIndex = 0;
  for (const pattern of protectedPatterns) {
    processedResponse = processedResponse.replace(new RegExp(`__PROTECTED_ESCAPE_${protectIndex++}__`, 'g'), pattern);
  }

  return processedResponse;
}

/**
 * Escape backslashes in response
 * @param {string} response - Raw response string
 * @returns {string} Processed response with escaped backslashes
 * @private
 */
function _escapeBackslashes(response) {
  // Use negative lookbehind to only match backslashes not preceded by another backslash
  return response.replace(/(?<!\\)\\/g, '\\\\');
}

export function extractJSONWithBraceCounting(content) {
  let braceCount = 0;
  let inString = false;
  let escape = false;
  let startIndex = -1;
  let startChar = null;

  for (let i = 0; i < content.length; i++) {
    const char = content[i];

    if (escape) {
      escape = false;
      continue;
    }

    if (char === '\\') {
      escape = true;
      continue;
    }

    if (char === '"' && !escape) {
      inString = !inString;
      continue;
    }

    if (!inString) {
      if (char === '{' || char === '[') {
        if (braceCount === 0) {
          startIndex = i;
          startChar = char;
        }
        braceCount++;
      } else if (char === '}' || char === ']') {
        braceCount--;
        if (braceCount === 0 && startIndex !== -1) {
          const extracted = content.substring(startIndex, i + 1);
          if (startChar === '[') {
            try {
              const parsed = JSON.parse(extracted);
              if (Array.isArray(parsed) && parsed.length > 0) {
                return JSON.stringify(parsed[0]);
              }
            } catch (e) {
            }
          }
          return extracted;
        }
      }
    }
  }

  return null;
}

export default {
  parseJSONResponse,
  extractJSONWithBraceCounting,
  JSONParseError
};

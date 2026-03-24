import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config();

export const config = {
  // API Provider: 'anthropic' or 'openai'
  apiProvider: process.env.API_PROVIDER || 'openai',

  // Anthropic Configuration
  anthropic: {
    apiKey: process.env.ANTHROPIC_API_KEY,
    model: process.env.ANTHROPIC_MODEL,
    visionModel: process.env.ANTHROPIC_VISION_MODEL,
    baseUrl: process.env.ANTHROPIC_BASE_URL,
    maxTokens: parseInt(process.env.ANTHROPIC_MAX_TOKENS) || 8192,
    temperature: parseFloat(process.env.ANTHROPIC_TEMPERATURE) || 0.7,
    timeout: parseInt(process.env.ANTHROPIC_TIMEOUT) || 60000, // 60 seconds
  },

  // OpenAI-style Configuration (supports OpenAI, Azure OpenAI, etc.)
  openai: {
    textModel: {
      baseUrl: process.env.TEXT_MODEL_BASE_URL || process.env.OPENAI_BASE_URL,
      apiKey: process.env.TEXT_MODEL_API_KEY || process.env.OPENAI_API_KEY,
      modelName: process.env.TEXT_MODEL_NAME,
      enableThinking: process.env.TEXT_MODEL_ENABLE_THINKING === 'true' || false,
      timeout: parseInt(process.env.TEXT_MODEL_TIMEOUT) || parseInt(process.env.OPENAI_TIMEOUT) || 60000, // 60 seconds
    },
    visionModel: {
      baseUrl: process.env.VISION_MODEL_BASE_URL || process.env.OPENAI_BASE_URL,
      apiKey: process.env.VISION_MODEL_API_KEY || process.env.OPENAI_API_KEY,
      modelName: process.env.VISION_MODEL_NAME,
      enableThinking: process.env.VISION_MODEL_ENABLE_THINKING === 'true' || false,
      timeout: parseInt(process.env.VISION_MODEL_TIMEOUT) || parseInt(process.env.OPENAI_TIMEOUT) || 60000, // 60 seconds
    },
    maxTokens: parseInt(process.env.OPENAI_MAX_TOKENS) || 4096,
    temperature: parseFloat(process.env.OPENAI_TEMPERATURE) || 0.7,
    timeout: parseInt(process.env.OPENAI_TIMEOUT) || 60000, // 60 seconds
  },

  // LaTeX Configuration
  latex: {
    engine: process.env.LATEX_ENGINE || 'xelatex',
    bibengine: process.env.BIB_ENGINE || 'bibtex',
    texargs: [
      '-file-line-error',
      '-halt-on-error',
      '-interaction=nonstopmode',
    ],
    timeout: parseInt(process.env.LATEX_TIMEOUT) || 120000,
    maxCompilationAttempts: 3,
  },

  // Paths
  paths: {
    root: path.resolve(__dirname, '..'),
    output: path.resolve(__dirname, '..', process.env.OUTPUT_DIR || 'output'),
    temp: path.resolve(__dirname, '..', process.env.TEMP_DIR || 'temp'),
    src: path.resolve(__dirname, '..', 'src'),
    agents: path.resolve(__dirname, '..', 'agents'),
  },

  // Agent Configuration
  agents: {
    maxIterations: 5,
    confidenceThreshold: 0.8,
  },

  // Slide Configuration
  slides: {
    maxContentPerSlide: 500,
    minFontSize: 18,
    defaultAspectRatio: '16:9',
  },
};

export default config;

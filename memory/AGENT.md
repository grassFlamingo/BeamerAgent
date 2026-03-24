# BeamerAgent - Memory

## Overview

BeamerAgent is an AI-powered system that converts LaTeX academic papers into Beamer presentations with automatic validation and refinement. It uses multiple agents working together to ensure high-quality output.

## Architecture

```
BeamerAgent
├── PaperReader
│   └── Reads LaTeX paper, creates slide plan
├── BeamerWriter
│   └── Writes Beamer slides from plan
├── VisionValidator
│   └── Analyzes slide screenshots (vision model)
└── TextValidator
    └── Compares plan vs actual content
```

## API Providers

The system supports both Anthropic and OpenAI-style APIs.

### Configuration Options

#### API Provider Selection

```env
API_PROVIDER=anthropic  # 'anthropic' or 'openai'
```

#### Anthropic Configuration

```env
ANTHROPIC_API_KEY=your_anthropic_api_key_here
ANTHROPIC_MODEL=claude-3-5-sonnet-20241022
ANTHROPIC_VISION_MODEL=claude-3-5-sonnet-20241022
ANTHROPIC_BASE_URL=
ANTHROPIC_MAX_TOKENS=8192
ANTHROPIC_TEMPERATURE=0.7
ANTHROPIC_TIMEOUT=60000  # 60 seconds
```

#### OpenAI-style Configuration (OpenAI, Azure OpenAI, etc.)

```env
OPENAI_API_KEY=your_openai_api_key_here
OPENAI_TIMEOUT=60000  # 60 seconds

TEXT_MODEL_BASE_URL=https://api.openai.com/v1
TEXT_MODEL_API_KEY=your_openai_api_key_here
TEXT_MODEL_NAME=gpt-4-turbo
TEXT_MODEL_TIMEOUT=60000

VISION_MODEL_BASE_URL=https://api.openai.com/v1
VISION_MODEL_API_KEY=your_openai_api_key_here
VISION_MODEL_NAME=gpt-4-turbo
VISION_MODEL_TIMEOUT=60000
```

## Project Structure

```
BeamerAgent/
├── src/
│   ├── config.js          # Configuration settings
│   └── index.js           # Main agent orchestrator
├── agents/
│   ├── PaperReader.js     # Analyzes papers & creates slide plans
│   ├── BeamerWriter.js    # Generates Beamer slides
│   ├── VisionValidator.js # Analyzes slide screenshots
│   └── TextValidator.js   # Validates content alignment
├── utils/
│   ├── apiClient.js       # Universal API client (supports both providers)
│   ├── anthropicClient.js # Anthropic API wrapper (deprecated, kept for compatibility)
│   ├── latexUtils.js      # LaTeX compilation & PDF processing
│   └── fileUtils.js       # File handling utilities
├── examples/
│   └── sample-paper.tex   # Example LaTeX paper
├── package.json
├── README.md
├── quick-start.md
└── tests/
    └── apiclient.test.js  # API client tests
```

## Dependencies

```json
{
  "@anthropic-ai/sdk": "^0.20.0",
  "dotenv": "^16.4.0",
  "openai": "^6.27.0",
  "pdf-lib": "^1.17.1"
}
```

## Usage

```bash
# Basic usage
node src/index.js examples/sample-paper.tex output/my-presentation

# Programmatic usage
import BeamerAgent from './src/index.js';

const agent = new BeamerAgent();
const result = await agent.processPaper('path/to/paper.tex');

if (result.success) {
  console.log('Presentation generated:', result.outputDir);
  console.log('PDF:', result.presentation.compiledPath);
}
```

## Process Flow

1. Read and analyze LaTeX paper
2. Create detailed slide-by-slide plan
3. Generate initial Beamer slides
4. Compile to PDF and split into individual pages
5. Analyze each slide with VisionValidator
6. Validate content with TextValidator
7. Refine slides based on feedback (loop until satisfaction)
8. Export final presentation and validation reports

## Latest Changes

- Added support for OpenAI-style APIs alongside Anthropic
- Enhanced API client with timeout configuration
- Updated all agents to use the new API client
- Added comprehensive timeout settings for both providers
- Improved configuration with per-model settings for text and vision

## Configuration Details

The system now supports:
- Per-provider API keys and endpoints
- Per-model base URLs, API keys, and model names
- Configurable timeouts for all API operations
- Environment variable interpolation for easier configuration

## Test Status

All existing tests pass:
- API client initialization
- Configuration validation
- File utilities (MIME type detection)
- System integration tests

## Troubleshooting

Key error points:
1. API authentication failures
2. LaTeX compilation errors
3. Image conversion failures
4. Network timeouts (now configurable)

## Future Enhancements

- Add support for more API providers
- Improve slide layout generation
- Add support for custom templates
- Enhance validation and feedback mechanisms

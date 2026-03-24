# BeamerAgent

An AI-powered agent that automatically converts LaTeX academic papers into Beamer presentations (PDF) with multi-stage validation and iterative refinement.

> This project leverages Large Language Models (LLMs) for intelligent code generation and development assistance.

> We test with LLM backend `Qwen/Qwen3-VL-8B-Instruct`.


## Quick Usage

```bash
# Install dependencies
npm install

# Configure API key (edit .env)
cp .env.example .env

# Generate presentation
node main.js -i examples/sample-paper.tex
```

That's it! The agent will:
1. Analyze your LaTeX paper
2. Generate a slide-by-slide plan
3. Create and compile Beamer slides
4. Validate each slide (visual + text alignment)
5. Iteratively refine until quality threshold met
6. Merge all slides into final presentation


Hints(llm backend, Vision capability is required.):
1. use cloud service.
2. use local backend if you have powerful GPUs. For example, 

```bash
#! /bin/bash

# enable this if you want to use modelscope source
# export VLLM_USE_MODELSCOPE=True 
# set path to cuda
# export CUDA_HOME="/usr/local/cuda-12.9"
export LD_LIBRARY_PATH="$CUDA_HOME/targets/x86_64-linux/lib":$LD_LIBRARY_PATH
export PYTORCH_CUDA_ALLOC_CONF=expandable_segments:True

vllm serve "Qwen/Qwen3-VL-8B-Instruct" \
        --disable-uvicorn-access-log \
        --tensor-parallel-size 2 \
        --dtype "bfloat16" \
        --max_model_len 64000 \
        --enable-auto-tool-choice \
        --tool-call-parser hermes
```

## Features

- **Multi-stage validation**: Vision analysis (overflow, readability) + Text alignment validation
- **Iterative refinement**: Automatically fixes compilation errors and visual issues
- **Flexible API support**: Works with OpenAI, Anthropic, Azure OpenAI, or any OpenAI-compatible API
- **Progress tracking**: Task execution recorder with interactive CLI
- **Error recovery**: Refines full presentation if merge causes compilation issues

## Task-Based Architecture

BeamerAgent uses a pipeline of specialized tasks orchestrated by the main `BeamerAgent` class to generate high-quality presentations:

```
┌─────────────────┐
│  LatexCopyTask  │  Copies and expands LaTeX source with all dependencies
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  CompileTask    │  Initial compilation to verify LaTeX validity
│  (Init Phase)   │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│LatexAnalyzerTask│  Extracts structure, preamble, figures, tables
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│CreateTemplate   │  Builds Beamer template from article preamble
│    Task         │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│GenerateSkeleton │  Creates slide-by-slide plan with content refs
│  SlidesTask     │
└────────┬────────┘
         │
         ▼
┌────────────────────────────────────────┐
│     Slide Processing Loop (per slide)  │
│  ┌─────────────────────────────┐       │
│  │ WriteSingleSlideTask        │       │
│  └──────────────┬──────────────┘       │
│                 │                      │
│          ┌──────┴──────┐               │
│          ▼             ▼               │
│   ┌──────────┐  ┌──────────────┐       │
│   │Compile   │  │ExtractSlide  │       │
│   │Task      │  │ImageTask     │       │
│   └────┬─────┘  └──────┬───────┘       │
│        │               │               │
│        ▼               ▼               │
│   ┌──────────┐  ┌──────────────┐       │
│   │Validate  │  │ValidateText  │       │
│   │Vision    │  │AlignmentTask │       │
│   │SlideTask │  │              │       │
│   └──────────┘  └──────────────┘       │
│                                        │
│  ◄─── Retry loop (max 8 retries) ──────┤
│  ◄─── Plan revision on failure ────────┤
└────────────────────────────────────────┘
         │
         ▼
┌─────────────────┐
│RefineFull       │  Merges all slides, fixes merge issues
│PresentationTask │
└─────────────────┘
```

### Task Responsibilities

| Task | Role |
|------|------|
| **LatexCopyTask** | Copies main `.tex` file and dependencies to output directory, creates expanded version |
| **CompileTask** | Compiles LaTeX to PDF using `xelatex`, supports single-slide and full compilation |
| **LatexAnalyzerTask** | Parses LaTeX structure, extracts preamble, sections, figures, tables, labels |
| **CreateTemplateTask** | Generates Beamer template from article preamble, can refine template on errors |
| **GenerateSkeletonSlidesTask** | Creates slide plan with titles, purposes, key points, content references (supports revision mode) |
| **WriteSingleSlideTask** | Generates LaTeX Beamer frame for a single slide using LLM, handles resource fetching |
| **FixLatexErrorTask** | Analyzes compilation errors and suggests LaTeX fixes |
| **ValidateVisionSlideTask** | Validates slide appearance (overflow, readability, layout) using vision model |
| **ValidateTextAlignmentTask** | Validates slide content accuracy against original source text |
| **ValidateFrameAlignmentTask** | Verifies figures/tables match original source positions |
| **ExtractSlideImageTask** | Converts compiled slide PDF to PNG for validation |
| **RefineFullPresentationTask** | Merges all validated slides, auto-fixes merge compilation errors |

### Validation Loop

Each slide goes through a retry loop until it passes:
1. **Compilation** (`CompileTask`) → LaTeX syntax valid, compiles to PDF
2. **Vision check** (`ValidateVisionSlideTask`) → No overflow, readable, proper layout
3. **Text alignment check** (`ValidateTextAlignmentTask`) → Content matches original source

If any check fails, the slide is regenerated with feedback and retried (up to 8 retries by default). If a slide still fails after all retries, the system requests **plan revision** from `GenerateSkeletonSlidesTask` to fix the slide plan before re-processing.

### Plan Revision

When slides consistently fail validation:
- The system sends failure feedback to `GenerateSkeletonSlidesTask` in revision mode
- The task revises the slide plan (titles, content, key points, content references)
- Processing resumes with the revised plan
- Maximum 2 revision passes attempted before proceeding with available slides

## Requirements

- Node.js >= 18.0.0; (recommend manage via [nvm](https://github.com/nvm-sh/nvm.git))
- LaTeX distribution with Beamer (TeX Live, MiKTeX)
- Poppler utilities (optional, for PDF preview): `sudo apt install poppler-utils`
- API key (OpenAI)

## Configuration

Create `.env` file:

```env
# Choose provider: 'openai' or 'anthropic'
API_PROVIDER=openai

# OpenAI (or OpenAI-compatible)
OPENAI_API_KEY=sk-...

# OR Anthropic
# ANTHROPIC_API_KEY=sk-ant-...
```

## Output

After running, you'll find in your output directory:
- `presentation.pdf` - Final compiled presentation
- `presentation.tex` - Full LaTeX source
- `plan.json` - Slide plan (slide titles, purposes, key points, content references)
- `slide-*.png` - Individual slide preview images
- `slide-*.tex` - Individual slide LaTeX frames
- `slide-*.pdf` - Individual slide compiled PDFs
- `slide-*-validated.json` - Cached validation results for each slide
- `BeamerAgent.record.json` - Execution log with task history
- `cache/` - Task execution cache (optional, for faster re-runs)

## Troubleshooting

**LaTeX not found**: Install TeX Live or MiKTeX with Beamer package

**API errors**: Check your `.env` configuration and API key validity

**Compilation fails**: The system automatically retries slides with fixes (up to 8 times). If a slide consistently fails:
- Check the logs for specific error messages
- The system will attempt plan revision automatically
- Review `BeamerAgent.record.json` for detailed task execution history

**Vision validation fails**: Slide has overflow, clipping, or readability issues
- The system retries with refined LaTeX
- If persistent, the slide plan will be revised

**Text alignment fails**: Slide content doesn't match original source
- The system retries with corrected content
- If persistent, the slide plan will be revised

**PDF to PNG conversion fails**: Install Poppler utilities
```bash
# Ubuntu/Debian
sudo apt install poppler-utils

# macOS
brew install poppler
```

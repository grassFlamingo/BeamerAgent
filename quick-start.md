# BeamerAgent - Quick Start Guide

## Step 1: Install Dependencies

```bash
cd BeamerAgent
npm install
```

## Step 2: Configure API Key

```bash
cp .env.example .env
# Edit .env and add your ANTHROPIC_API_KEY
```

## Step 3: Test with Sample Paper

```bash
# Run on the sample paper (requires LaTeX installed)
node src/index.js examples/sample-paper.tex output/test
```

## Requirements

- Node.js >= 18
- LaTeX with Beamer (e.g., TeX Live)
- Anthropic API key

## Architecture Overview

```
Input: LaTeX paper → PaperReader (analyzes & creates plan)
                        ↓
                    BeamerWriter (generates slides)
                        ↓
                    Compile to PDF
                        ↓
                    VisionValidator (analyzes visuals) + TextValidator (validates content)
                        ↓
                    Refine loop (if needed)
                        ↓
Output: Final PDF presentation
```

## Agents

1. **PaperReader**: Reads paper, creates slide plan
2. **BeamerWriter**: Writes Beamer slides from plan
3. **VisionValidator**: Analyzes slide screenshots
4. **TextValidator**: Compares plan vs actual content

## Troubleshooting

See `README.md` for detailed documentation and troubleshooting.

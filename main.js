import { Command } from 'commander';
import BeamerAgent from './src/BeamerAgent.js';
import { log } from './src/utils/logger.js';
import config from './src/config.js';

const program = new Command();

program
  .name('beamer-agent')
  .description('AI agent that converts LaTeX academic papers to Beamer presentations')
  .version('1.0.0')
  .requiredOption('-i, --input <file>', 'Input LaTeX paper file (.tex)')
  .option('-o, --output <dir>', 'Output directory for generated presentation')
  .option('-f, --force', 'Force restart, ignoring saved state')
  .option('-v, --verbose', 'Enable verbose output')
  .action(async (options) => {
    if (options.verbose) {
      log.info('Input file:', options.input);
      log.info('Output directory:', options.output);
    }

    config.paths.output = options.output;

    const result = await new BeamerAgent(options.input, options.output, { forceRestart: options.force }).start();

    if (result.success) {
      log.success('\n=== Success ===');
      log.info('Output directory:', result.outputDir);
      log.info('Slides:', result.slideCount);
      log.info('Duration:', result.duration + 'ms');
    } else {
      log.error('\n=== Error ===');
      log.error(result.error);
      process.exit(1);
    }
  });

program.parse();

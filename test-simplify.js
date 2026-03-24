import BeamerAgent from './src/BeamerAgent.js';
import dotenv from 'dotenv';

dotenv.config();

async function test() {
  try {
    const agent = new BeamerAgent('./examples/sample-paper.tex', './output/test-simplify', { forceRestart: true });
    const result = await agent.start();
    console.log('Result:', result.success ? 'Success' : 'Failed');
  } catch (error) {
    console.error('Error:', error);
  }
}

test();

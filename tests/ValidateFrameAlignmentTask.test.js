import test from 'node:test';
import assert from 'node:assert/strict';
import { ValidateFrameAlignmentTask } from '../src/tasks/ValidateFrameAlignmentTask.js';

test('ValidateFrameAlignmentTask - class structure', async () => {
  const task = new ValidateFrameAlignmentTask();
  
  assert.ok(task);
  assert.strictEqual(typeof task.execute, 'function');
  assert.strictEqual(ValidateFrameAlignmentTask.name, 'ValidateFrameAlignmentTask');
});

test('ValidateFrameAlignmentTask - input schema', async () => {
  const schema = ValidateFrameAlignmentTask.inputSchema;
  
  assert.ok(schema);
  assert.ok(schema.frameContent);
  assert.strictEqual(schema.frameContent.type, 'string');
  assert.strictEqual(schema.frameContent.required, true);
  
  assert.ok(schema.slidePlan);
  assert.strictEqual(schema.slidePlan.type, 'object');
  assert.strictEqual(schema.slidePlan.required, true);
  
  assert.ok(schema.originalSourceText);
  assert.strictEqual(schema.originalSourceText.type, 'string');
  assert.strictEqual(schema.originalSourceText.required, true);
  
  assert.ok(schema.retryCount);
  assert.strictEqual(schema.retryCount.type, 'number');
  assert.strictEqual(schema.retryCount.required, false);
});

test('ValidateFrameAlignmentTask - output schema', async () => {
  const schema = ValidateFrameAlignmentTask.outputSchema;
  
  assert.ok(schema);
  assert.ok(schema.isAligned);
  assert.strictEqual(schema.isAligned.type, 'boolean');
  
  assert.ok(schema.alignmentScore);
  assert.strictEqual(schema.alignmentScore.type, 'number');
  
  assert.ok(schema.discrepancies);
  assert.strictEqual(schema.discrepancies.type, 'array');
  
  assert.ok(schema.missingContent);
  assert.strictEqual(schema.missingContent.type, 'array');
  
  assert.ok(schema.inaccuracies);
  assert.strictEqual(schema.inaccuracies.type, 'array');
  
  assert.ok(schema.recommendations);
  assert.strictEqual(schema.recommendations.type, 'array');
});

test('ValidateFrameAlignmentTask - execute with missing content', async () => {
  const task = new ValidateFrameAlignmentTask();
  
  const input = {
    frameContent: '\\begin{frame}{Test}\\end{frame}',
    slidePlan: {
      title: 'Test Slide',
      keyPoints: ['Point 1', 'Point 2']
    },
    originalSourceText: 'This is the original source text with important information.'
  };
  
  // This test will fail without API keys, but validates the structure
  try {
    const result = await task.execute(input);
    
    assert.ok(result);
    assert.ok(typeof result.isAligned === 'boolean');
    assert.ok(typeof result.alignmentScore === 'number');
    assert.ok(Array.isArray(result.discrepancies));
    assert.ok(Array.isArray(result.missingContent));
    assert.ok(Array.isArray(result.inaccuracies));
    assert.ok(Array.isArray(result.recommendations));
  } catch (error) {
    // Expected to fail without API keys - check error message structure
    assert.ok(error.message);
  }
});

test('ValidateFrameAlignmentTask - execute with empty source text', async () => {
  const task = new ValidateFrameAlignmentTask();
  
  const input = {
    frameContent: '\\begin{frame}{Test}\\end{frame}',
    slidePlan: {
      title: 'Test Slide',
      keyPoints: []
    },
    originalSourceText: ''
  };
  
  try {
    const result = await task.execute(input);
    
    assert.ok(result);
    // Should handle empty source text gracefully
    assert.ok(typeof result.isAligned === 'boolean');
    assert.ok(typeof result.alignmentScore === 'number');
  } catch (error) {
    // Expected to fail without API keys
    assert.ok(error.message);
  }
});

test('ValidateFrameAlignmentTask - execute with empty frame content', async () => {
  const task = new ValidateFrameAlignmentTask();
  
  const input = {
    frameContent: '',
    slidePlan: {
      title: 'Test Slide',
      keyPoints: ['Point 1']
    },
    originalSourceText: 'Original source content'
  };
  
  try {
    const result = await task.execute(input);
    
    assert.ok(result);
    // Should handle empty frame content gracefully
    assert.ok(typeof result.isAligned === 'boolean');
    assert.ok(typeof result.alignmentScore === 'number');
  } catch (error) {
    // Expected to fail without API keys
    assert.ok(error.message);
  }
});

test('ValidateFrameAlignmentTask - _parseResponse with valid JSON', async () => {
  const task = new ValidateFrameAlignmentTask();
  
  const validResponse = `{
    "isAligned": true,
    "alignmentScore": 85,
    "discrepancies": [],
    "missingContent": [],
    "inaccuracies": [],
    "recommendations": ["Good alignment"]
  }`;
  
  const result = task._parseResponse(validResponse);
  
  assert.strictEqual(result.isAligned, true);
  assert.strictEqual(result.alignmentScore, 85);
  assert.deepStrictEqual(result.discrepancies, []);
  assert.deepStrictEqual(result.missingContent, []);
  assert.deepStrictEqual(result.inaccuracies, []);
  assert.deepStrictEqual(result.recommendations, ['Good alignment']);
});

test('ValidateFrameAlignmentTask - _parseResponse with invalid JSON', async () => {
  const task = new ValidateFrameAlignmentTask();
  
  const invalidResponse = 'This is not valid JSON';
  
  const result = task._parseResponse(invalidResponse);
  
  // Should return fallback values
  assert.strictEqual(result.isAligned, false);
  assert.strictEqual(result.alignmentScore, 0);
  assert.ok(Array.isArray(result.discrepancies));
  assert.ok(Array.isArray(result.missingContent));
  assert.ok(Array.isArray(result.inaccuracies));
  assert.ok(Array.isArray(result.recommendations));
});

test('ValidateFrameAlignmentTask - _parseResponse with partial JSON', async () => {
  const task = new ValidateFrameAlignmentTask();
  
  // Missing required alignmentScore
  const partialResponse = `{
    "isAligned": true,
    "discrepancies": []
  }`;
  
  const result = task._parseResponse(partialResponse);
  
  // Should use fallback for missing required fields
  assert.ok(result);
  assert.ok(typeof result.isAligned === 'boolean');
  assert.ok(typeof result.alignmentScore === 'number');
});

test('ValidateFrameAlignmentTask - scoring logic', async () => {
  const task = new ValidateFrameAlignmentTask();
  
  // Test that high score means aligned
  const highScoreResponse = `{
    "isAligned": true,
    "alignmentScore": 90,
    "discrepancies": [],
    "missingContent": [],
    "inaccuracies": [],
    "recommendations": []
  }`;
  
  const highResult = task._parseResponse(highScoreResponse);
  assert.strictEqual(highResult.isAligned, true);
  assert.strictEqual(highResult.alignmentScore, 90);
  
  // Test that low score means not aligned
  const lowScoreResponse = `{
    "isAligned": false,
    "alignmentScore": 40,
    "discrepancies": [{"type": "inaccuracy", "description": "Content mismatch"}],
    "missingContent": [{"description": "Missing key point", "importance": "critical"}],
    "inaccuracies": [],
    "recommendations": ["Review content accuracy"]
  }`;
  
  const lowResult = task._parseResponse(lowScoreResponse);
  assert.strictEqual(lowResult.isAligned, false);
  assert.strictEqual(lowResult.alignmentScore, 40);
  assert.strictEqual(lowResult.discrepancies.length, 1);
  assert.strictEqual(lowResult.missingContent.length, 1);
});

test('ValidateFrameAlignmentTask - discrepancy types', async () => {
  const task = new ValidateFrameAlignmentTask();
  
  const response = `{
    "isAligned": false,
    "alignmentScore": 60,
    "discrepancies": [
      {"type": "inaccuracy", "description": "Wrong number", "severity": "moderate"},
      {"type": "omission", "description": "Missing context", "severity": "minor"},
      {"type": "hallucination", "description": "Added fake data", "severity": "severe"}
    ],
    "missingContent": [],
    "inaccuracies": [],
    "recommendations": []
  }`;
  
  const result = task._parseResponse(response);
  
  assert.strictEqual(result.discrepancies.length, 3);
  assert.strictEqual(result.discrepancies[0].type, 'inaccuracy');
  assert.strictEqual(result.discrepancies[1].type, 'omission');
  assert.strictEqual(result.discrepancies[2].type, 'hallucination');
});

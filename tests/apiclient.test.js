import test from 'node:test';
import assert from 'node:assert/strict';
import config from '../src/config.js';
import apiClient from '../utils/apiClient.js';
import fs from 'fs';
import path from 'path';

test('API client initialization', async () => {
  // Verify API client instance exists
  assert.ok(apiClient);

  // Verify methods are available
  assert.strictEqual(typeof apiClient.generateText, 'function');
  assert.strictEqual(typeof apiClient.analyzeImage, 'function');
  assert.strictEqual(typeof apiClient.getMimeType, 'function');

  console.log(`API Provider configured as: ${config.apiProvider}`);
});

test('API configuration validation', async () => {
  if (config.apiProvider === 'anthropic') {
    console.log('Testing Anthropic configuration');
    assert.ok(config.anthropic);
    assert.strictEqual(typeof config.anthropic.apiKey, 'string');
    assert.strictEqual(typeof config.anthropic.model, 'string');
    assert.strictEqual(typeof config.anthropic.visionModel, 'string');
    assert.ok(config.anthropic.maxTokens > 0);
    assert.ok(config.anthropic.temperature >= 0 && config.anthropic.temperature <= 1);
  } else if (config.apiProvider === 'openai') {
    console.log('Testing OpenAI configuration');
    assert.ok(config.openai);

    console.log('Text model configuration');
    assert.ok(config.openai.textModel);
    assert.strictEqual(typeof config.openai.textModel.baseUrl, 'string');
    assert.strictEqual(typeof config.openai.textModel.apiKey, 'string');
    assert.strictEqual(typeof config.openai.textModel.modelName, 'string');

    console.log('Vision model configuration');
    assert.ok(config.openai.visionModel);
    assert.strictEqual(typeof config.openai.visionModel.baseUrl, 'string');
    assert.strictEqual(typeof config.openai.visionModel.apiKey, 'string');
    assert.strictEqual(typeof config.openai.visionModel.modelName, 'string');

    assert.ok(config.openai.maxTokens > 0);
    assert.ok(config.openai.temperature >= 0 && config.openai.temperature <= 1);
  }
});

test('File utilities', async () => {
  const testImagePath = path.join('examples', 'sample.png');

  if (fs.existsSync(testImagePath)) {
    const mimeType = apiClient.getMimeType(testImagePath);
    console.log(`MIME type for ${testImagePath}: ${mimeType}`);
    assert.ok(mimeType.startsWith('image/'));
  } else {
    console.log('Test image not found, skipping MIME type test');
  }
});

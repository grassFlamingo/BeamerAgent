import test from 'node:test';
import assert from 'node:assert/strict';
import { PlanMakeTask } from '../src/tasks/PlanMakeTask.js';
import fs from 'fs';
import path from 'path';

test('PlanMakeTask._parseJsonResponse - valid JSON object', () => {
  const task = new PlanMakeTask();
  const validJson = JSON.stringify({
    slides: [{ title: 'Introduction', purpose: 'Intro slide' }],
    recommendedSlides: 5,
    summary: 'Test summary'
  });

  const result = task._parseJsonResponse(validJson);

  assert.strictEqual(result.recommendedSlides, 5);
  assert.strictEqual(result.slides.length, 1);
  assert.strictEqual(result.slides[0].title, 'Introduction');
  assert.strictEqual(result.summary, 'Test summary');
});

test('PlanMakeTask._parseJsonResponse - JSON with surrounding text', () => {
  const task = new PlanMakeTask();
  const responseWithText = `Here's the plan:
${JSON.stringify({
    slides: [{ title: 'Methods', purpose: 'Methods slide' }],
    recommendedSlides: 8
  })}
This looks good.`;

  const result = task._parseJsonResponse(responseWithText);

  assert.strictEqual(result.recommendedSlides, 8);
  assert.strictEqual(result.slides.length, 1);
  assert.strictEqual(result.slides[0].title, 'Methods');
});

test('PlanMakeTask._parseJsonResponse - JSON with markdown code blocks', () => {
  const task = new PlanMakeTask();
  const markdownJson = `\`\`\`json
{
  "slides": [{"title": "Results", "purpose": "Results slide"}],
  "recommendedSlides": 12
}
\`\`\``;

  const result = task._parseJsonResponse(markdownJson);

  assert.strictEqual(result.recommendedSlides, 12);
  assert.strictEqual(result.slides.length, 1);
  assert.strictEqual(result.slides[0].title, 'Results');
});

test('PlanMakeTask._parseJsonResponse - nested JSON object', () => {
  const task = new PlanMakeTask();
  const nestedJson = JSON.stringify({
    slides: [
      {
        title: 'Complex Slide',
        purpose: 'Complex slide',
        contentRefs: [
          { type: 'figure', uuid: 'abc-123', caption: 'Test figure' }
        ]
      }
    ],
    recommendedSlides: 3,
    paperInfo: {
      title: 'Test Paper',
      authors: ['Author 1', 'Author 2'],
      abstract: 'Test abstract'
    }
  });

  const result = task._parseJsonResponse(nestedJson);

  assert.strictEqual(result.recommendedSlides, 3);
  assert.strictEqual(result.slides.length, 1);
  assert.strictEqual(result.slides[0].contentRefs[0].uuid, 'abc-123');
  assert.strictEqual(result.paperInfo.title, 'Test Paper');
  assert.strictEqual(result.paperInfo.authors.length, 2);
});

test('PlanMakeTask._parseJsonResponse - invalid JSON triggers fallback', () => {
  const task = new PlanMakeTask();
  const invalidJson = 'This is not JSON at all';

  const result = task._parseJsonResponse(invalidJson);

  // Fallback should provide default values
  assert.ok(result.recommendedSlides >= 1);
  assert.ok(Array.isArray(result.slides));
  assert.ok(result.slides.length > 0);
});

test('PlanMakeTask._parseJsonResponse - malformed JSON triggers fallback', () => {
  const task = new PlanMakeTask();
  const malformedJson = `{
    "slides": [{"title": "Test", "purpose": "Test slide"}],
    "recommendedSlides": 5,
    "summary": "Missing closing brace"`;

  const result = task._parseJsonResponse(malformedJson);

  // Fallback should provide default values
  assert.ok(result.recommendedSlides >= 1);
  assert.ok(Array.isArray(result.slides));
});

test('PlanMakeTask._parseJsonResponse - JSON with recommendedSlides in text', () => {
  const task = new PlanMakeTask();
  const partialJson = `Some text with "recommendedSlides": 7 and more text`;

  const result = task._parseJsonResponse(partialJson);

  // Fallback should extract the number
  assert.strictEqual(result.recommendedSlides, 7);
  assert.ok(Array.isArray(result.slides));
});

test('PlanMakeTask._parseJsonResponse - empty object', () => {
  const task = new PlanMakeTask();
  const emptyJson = '{}';

  // Empty object is valid JSON but has no quotes, so it triggers fallback
  const result = task._parseJsonResponse(emptyJson);

  // Fallback provides default structure
  assert.strictEqual(result.recommendedSlides, 10);
  assert.ok(Array.isArray(result.slides));
  assert.strictEqual(result.slides.length, 10);
});

test('PlanMakeTask._parseJsonResponse - array at root extracts first object', () => {
  const task = new PlanMakeTask();
  const arrayJson = '[{"title": "Slide 1"}]';

  // The regex matches the first object inside the array
  const result = task._parseJsonResponse(arrayJson);

  // Should extract the first object from the array
  assert.strictEqual(result.title, 'Slide 1');
});

test('PlanMakeTask._parseJsonResponse - real-world response with extensive reasoning', () => {
  const task = new PlanMakeTask();
  
  // Real response from output/test-test/test_resp.txt (lines 679-tail)
  // Contains ~570 lines of reasoning before the JSON
  const respPath = path.join('output', 'test-test', 'test_resp.txt');
  
  if (fs.existsSync(respPath)) {
    const response = fs.readFileSync(respPath, 'utf8');
    const result = task._parseJsonResponse(response);

    // manual json
    const real_json_loc = [];
    const all_lines = response.split('\n');
    for (var line = 0; line < all_lines.length; line++) {
      if (line >= 678) {
        real_json_loc.push(all_lines[line]);
      }
    }

    // console.log(real_json_loc.join('\n'));
    const real_json = JSON.parse(real_json_loc.join('\n').trim());

    // test they are equal
    for(var key of real_json) {
      assert.strictEqual(result[key], real_json[key]);
    }

  } else {
    console.log('Real-world test file not found, skipping');
  }
});

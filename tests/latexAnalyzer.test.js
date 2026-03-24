import test from 'node:test';
import assert from 'node:assert/strict';
import { LatexAnalyzerTask } from '../src/tasks/LatexAnalyzerTask.js';

test('LatexAnalyzerTask._findCommend - basic macro extraction', async () => {
  const analyzer = new LatexAnalyzerTask();
  
  const src = '\\title{My Paper}';
  const result = analyzer._findCommand(src, 'title');
  
  assert.strictEqual(result.ctx, 'My Paper');
  assert.strictEqual(result.start, 0);
  assert.strictEqual(result.end, 16);
});

test('LatexAnalyzerTask._findCommend - macro with nested braces', async () => {
  const analyzer = new LatexAnalyzerTask();
  
  const src = '\\author{John {\\textbf{Doe}}}';
  const result = analyzer._findCommand(src, 'author');
  
  assert.strictEqual(result.ctx, 'John {\\textbf{Doe}}');
  assert.strictEqual(result.start, 0);
  assert.strictEqual(result.end, src.length);
});

test('LatexAnalyzerTask._findCommend - skip double backslash', async () => {
  const analyzer = new LatexAnalyzerTask();
  
  // \\\\title should be skipped, only \\title should match
  const src = '\\\\title{skip this}\\title{real title}';
  const result = analyzer._findCommand(src, 'title');
  
  assert.strictEqual(result.ctx, 'real title');
  assert.notStrictEqual(result.start, 0); // should not be at position 0
});

test('LatexAnalyzerTask._findCommend - escaped braces should not affect depth', async () => {
  const analyzer = new LatexAnalyzerTask();

  // \\{ and \\} should not affect brace counting
  const src = '\\cmd{hello \\{world\\}}';
  const result = analyzer._findCommand(src, 'cmd');

  assert.strictEqual(result.ctx, 'hello \\{world\\}');
  assert.strictEqual(result.start, 0);
  assert.strictEqual(result.end, 21);
});

test('LatexAnalyzerTask._findCommend - double backslash before brace', async () => {
  const analyzer = new LatexAnalyzerTask();
  
  let src = '\\cmd{test \\\\{ nested \\}}';
  let result = analyzer._findCommand(src, 'cmd');
  
  assert.strictEqual(result.ctx, '');
  assert.strictEqual(result.start, -1);
  assert.strictEqual(result.end, -1);

  src = '\\cmd{test \\\\{ nested \\}}}';
  result = analyzer._findCommand(src, 'cmd');
  
  assert.strictEqual(result.ctx, 'test \\\\{ nested \\}}');
  assert.strictEqual(result.start, 0, "start position should be correct");
  assert.strictEqual(result.end, src.length, "end position should be correct");
});

test('LatexAnalyzerTask._findCommend - macro not found', async () => {
  const analyzer = new LatexAnalyzerTask();
  
  const src = '\\section{Hello}';
  const result = analyzer._findCommand(src, 'title');
  
  assert.strictEqual(result.ctx, '');
  assert.strictEqual(result.start, -1);
  assert.strictEqual(result.end, -1);
});

test('LatexAnalyzerTask._findCommend - macro in middle of text', async () => {
  const analyzer = new LatexAnalyzerTask();

  const src = 'Some text \\macro{content} more text';
  const result = analyzer._findCommand(src, 'macro');

  assert.strictEqual(result.ctx, 'content');
  assert.strictEqual(result.start, 10);
  assert.strictEqual(result.end, 25);
});

test('LatexAnalyzerTask._findCommend - empty macro content', async () => {
  const analyzer = new LatexAnalyzerTask();

  const src = '\\cmd{}';
  const result = analyzer._findCommand(src, 'cmd');

  assert.strictEqual(result.ctx, '');
  assert.strictEqual(result.start, 0);
  assert.strictEqual(result.end, 6);
});

test('LatexAnalyzerTask._findCommend - macro with optional argument', async () => {
  const analyzer = new LatexAnalyzerTask();

  const src = '\\section[Short Title]{Full Section Title}';
  const result = analyzer._findCommand(src, 'section');

  assert.strictEqual(result.ctx, 'Full Section Title');
  assert.strictEqual(result.start, 0);
  assert.strictEqual(result.end, src.length);
});

test('LatexAnalyzerTask._findCommend - macro with optional argument and nested braces', async () => {
  const analyzer = new LatexAnalyzerTask();

  const src = '\\caption[Short]{\\textbf{Bold {nested}} caption}';
  const result = analyzer._findCommand(src, 'caption');

  assert.strictEqual(result.ctx, '\\textbf{Bold {nested}} caption');
  assert.strictEqual(result.start, 0);
  assert.strictEqual(result.end, src.length);
});

test('LatexAnalyzerTask._findCommend - complex nested structure', async () => {
  const analyzer = new LatexAnalyzerTask();

  const src = '\\begin{figure}\\caption{\\textbf{Bold {nested}}}\\end{figure}';
  const result = analyzer._findCommand(src, 'caption');

  assert.strictEqual(result.ctx, '\\textbf{Bold {nested}}');
  assert.strictEqual(result.start, "\\begin{figure}".length);
  assert.strictEqual(result.end, src.length - "\\end{figure}".length);
});

// Tests for _findEnvironment

test('LatexAnalyzerTask._findEnvironment - basic environment', async () => {
  const analyzer = new LatexAnalyzerTask();

  const src = '\\begin{abstract}This is the abstract.\\end{abstract}';
  const result = analyzer._findEnvironment(src, 'abstract');

  assert.strictEqual(result.ctx, 'This is the abstract.');
  assert.strictEqual(result.start, 0);
  assert.strictEqual(result.end, src.length);
});

test('LatexAnalyzerTask._findEnvironment - environment with nested braces', async () => {
  const analyzer = new LatexAnalyzerTask();

  const src = '\\begin{abstract}{\\textbf{Bold}} content\\end{abstract}';
  const result = analyzer._findEnvironment(src, 'abstract');

  assert.strictEqual(result.ctx, '{\\textbf{Bold}} content');
  assert.strictEqual(result.start, 0);
  assert.strictEqual(result.end, src.length);
});

test('LatexAnalyzerTask._findEnvironment - skip double backslash begin', async () => {
  const analyzer = new LatexAnalyzerTask();

  // \\\\begin should be skipped, only \\begin should match
  const src = '\\\\begin{abstract}skip this\\end{abstract}\\begin{abstract}real abstract\\end{abstract}';
  const result = analyzer._findEnvironment(src, 'abstract');

  assert.strictEqual(result.ctx, 'real abstract');
  assert.notStrictEqual(result.start, 0); // should not start at position 0
});

test('LatexAnalyzerTask._findEnvironment - nested environments', async () => {
  const analyzer = new LatexAnalyzerTask();

  const src = '\\begin{outer}outer start\\begin{inner}inner content\\end{inner}outer end\\end{outer}';
  const result = analyzer._findEnvironment(src, 'outer');

  assert.strictEqual(result.ctx, 'outer start\\begin{inner}inner content\\end{inner}outer end');
  assert.strictEqual(result.start, 0);
  assert.strictEqual(result.end, src.length);
});

test('LatexAnalyzerTask._findEnvironment - nested same environments', async () => {
  const analyzer = new LatexAnalyzerTask();

  const src = `\\begin{outer}
      outer start
      \\begin{outer}
        inner content
      \\end{outer}
      outer end
  \\end{outer}`;
  const result = analyzer._findEnvironment(src, 'outer');

  assert.strictEqual(result.ctx, `outer start
      \\begin{outer}
        inner content
      \\end{outer}
      outer end`);
  assert.strictEqual(result.start, 0);
  assert.strictEqual(result.end, src.length);
});

test('LatexAnalyzerTask._findEnvironment - environment not found', async () => {
  const analyzer = new LatexAnalyzerTask();

  const src = '\\begin{abstract}Some content\\end{abstract}';
  const result = analyzer._findEnvironment(src, 'figure');

  assert.strictEqual(result.ctx, '');
  assert.strictEqual(result.start, -1);
  assert.strictEqual(result.end, -1);
});

test('LatexAnalyzerTask._findEnvironment - empty environment', async () => {
  const analyzer = new LatexAnalyzerTask();

  const src = '\\begin{abstract}\\end{abstract}';
  const result = analyzer._findEnvironment(src, 'abstract');

  assert.strictEqual(result.ctx, '');
  assert.strictEqual(result.start, 0);
  assert.strictEqual(result.end, src.length);
});

test('LatexAnalyzerTask._findEnvironment - environment in middle of text', async () => {
  const analyzer = new LatexAnalyzerTask();

  const _before = 'Some text before';
  const _end = 'more text';
  const src = _before + '\\begin{abstract}abstract content\\end{abstract}' + _end;
  const result = analyzer._findEnvironment(src, 'abstract');

  assert.strictEqual(result.ctx, 'abstract content');
  assert.strictEqual(result.start, _before.length);
  assert.strictEqual(result.end, src.length - _end.length);
});

test('LatexAnalyzerTask._findEnvironment - environment with escaped characters', async () => {
  const analyzer = new LatexAnalyzerTask();

  const src = '\\begin{abstract}Text with \\{escaped brace\\}\\end{abstract}';
  const result = analyzer._findEnvironment(src, 'abstract');

  assert.strictEqual(result.ctx, 'Text with \\{escaped brace\\}');
  assert.strictEqual(result.start, 0);
  assert.strictEqual(result.end, src.length);
});

test('LatexAnalyzerTask._findEnvironment - multiple same environments', async () => {
  const analyzer = new LatexAnalyzerTask();

  const _tail = '\\begin{frame}Frame 2\\end{frame}';
  const src = '\\begin{frame}Frame 1\\end{frame}' + _tail;
  const result = analyzer._findEnvironment(src, 'frame');

  // Should find the first one
  assert.strictEqual(result.ctx, 'Frame 1');
  assert.strictEqual(result.start, 0);
  assert.strictEqual(result.end, src.length - _tail.length);
});

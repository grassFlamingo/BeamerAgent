import test from 'node:test';
import assert from 'node:assert/strict';
import { TexResourcesTool, ResourceNode } from '../src/llm_tools/TexResourcesTool.js';

test('TexResourcesTool.handleCall - basic resource lookup by UUID', async () => {
  const analysisResult = {
    meta: { title: 'Test Paper', date: '2024', authors: [] },
    abstract: 'Test abstract',
    content: {
      type: 'article',
      uuid: 'article-uuid',
      children: [
        {
          type: 'section',
          uuid: 'sec1',
          title: 'Introduction',
          label: 'sec:intro',
          children: [
            {
              type: 'paragraph',
              uuid: 'para1',
              text: 'This is a test paragraph.',
              children: []
            }
          ]
        }
      ]
    }
  };

  const tool = new TexResourcesTool({ analysisResult });
  const result = await tool.handleCall({ uuid: 'para1' });

  assert.strictEqual(result.uuid, 'para1');
  assert.strictEqual(result.type, 'paragraph');
  assert.strictEqual(result.text, 'This is a test paragraph.');
  assert.strictEqual(result.latex, 'This is a test paragraph.');
  // Note: getSectionPath skips 'article' type
  assert.strictEqual(result.location, 'Test Paper > Introduction');
});

test('TexResourcesTool.handleCall - figure resource with caption and label', async () => {
  const analysisResult = {
    meta: { title: 'Test Paper', date: '2024', authors: [] },
    abstract: 'Test abstract',
    content: {
      type: 'article',
      uuid: 'article-uuid',
      children: [
        {
          type: 'section',
          uuid: 'sec1',
          title: 'Results',
          children: [
            {
              type: 'figure',
              uuid: 'fig1',
              label: 'fig:main',
              caption: 'This is the main figure showing results.',
              text: '\\begin{figure}...\\end{figure}',
              children: []
            }
          ]
        }
      ]
    }
  };

  const tool = new TexResourcesTool({ analysisResult });
  const result = await tool.handleCall({ uuid: 'fig1' });

  assert.strictEqual(result.uuid, 'fig1');
  assert.strictEqual(result.type, 'figure');
  assert.strictEqual(result.label, 'fig:main');
  assert.strictEqual(result.caption, 'This is the main figure showing results.');
  assert.ok(result.latex.includes('\\begin{figure}'));
  assert.strictEqual(result.location, 'Test Paper > Results');
});

test('TexResourcesTool.handleCall - equation resource', async () => {
  const analysisResult = {
    meta: { title: 'Test Paper', date: '2024', authors: [] },
    abstract: 'Test abstract',
    content: {
      type: 'article',
      uuid: 'article-uuid',
      children: [
        {
          type: 'section',
          uuid: 'sec1',
          title: 'Method',
          children: [
            {
              type: 'equation',
              uuid: 'eq1',
              label: 'eq:main',
              text: '\\begin{equation}E = mc^2\\end{equation}',
              children: []
            }
          ]
        }
      ]
    }
  };

  const tool = new TexResourcesTool({ analysisResult });
  const result = await tool.handleCall({ uuid: 'eq1' });

  assert.strictEqual(result.uuid, 'eq1');
  assert.strictEqual(result.type, 'equation');
  assert.strictEqual(result.label, 'eq:main');
  assert.ok(result.latex.includes('\\begin{equation}'));
});

test('TexResourcesTool.handleCall - abstract resource', async () => {
  const analysisResult = {
    meta: { title: 'Test Paper', date: '2024', authors: [] },
    abstract: 'This is the abstract of the paper.',
    content: {
      type: 'article',
      uuid: 'article-uuid',
      children: []
    }
  };

  const tool = new TexResourcesTool({ analysisResult });
  const result = await tool.handleCall({ uuid: 'abstract' });

  assert.strictEqual(result.uuid, 'abstract');
  assert.strictEqual(result.type, 'abstract');
  assert.strictEqual(result.text, 'This is the abstract of the paper.');
});

test('TexResourcesTool.handleCall - UUID not found', async () => {
  const analysisResult = {
    meta: { title: 'Test Paper', date: '2024', authors: [] },
    abstract: 'Test abstract',
    content: {
      type: 'article',
      uuid: 'article-uuid',
      children: []
    }
  };

  const tool = new TexResourcesTool({ analysisResult });
  const result = await tool.handleCall({ uuid: 'nonexistent-uuid' });

  assert.ok(result.error);
  assert.ok(result.error.includes('nonexistent-uuid'));
  assert.ok(result.availableUuids);
  assert.ok(Array.isArray(result.availableUuids));
});

test('TexResourcesTool.handleCall - nested subsection structure', async () => {
  const analysisResult = {
    meta: { title: 'Test Paper', date: '2024', authors: [] },
    abstract: 'Test abstract',
    content: {
      type: 'article',
      uuid: 'article-uuid',
      children: [
        {
          type: 'section',
          uuid: 'sec1',
          title: 'Experiments',
          children: [
            {
              type: 'subsection',
              uuid: 'subsec1',
              title: 'Setup',
              children: [
                {
                  type: 'paragraph',
                  uuid: 'para-setup',
                  text: 'Experimental setup details.',
                  children: []
                }
              ]
            }
          ]
        }
      ]
    }
  };

  const tool = new TexResourcesTool({ analysisResult });
  const result = await tool.handleCall({ uuid: 'para-setup' });

  assert.strictEqual(result.uuid, 'para-setup');
  assert.strictEqual(result.type, 'paragraph');
  // Note: getSectionPath skips 'article' type
  assert.strictEqual(result.location, 'Test Paper > Experiments > Setup');
  // Ancestors track the hierarchy path
  assert.ok(result.ancestors.length > 0, 'Should have ancestors');
});

test('TexResourcesTool.handleCall - table resource with caption', async () => {
  const analysisResult = {
    meta: { title: 'Test Paper', date: '2024', authors: [] },
    abstract: 'Test abstract',
    content: {
      type: 'article',
      uuid: 'article-uuid',
      children: [
        {
          type: 'table',
          uuid: 'tab1',
          label: 'tab:results',
          caption: 'Comparison of different methods on benchmark datasets.',
          text: '\\begin{table}...\\end{table}',
          children: []
        }
      ]
    }
  };

  const tool = new TexResourcesTool({ analysisResult });
  const result = await tool.handleCall({ uuid: 'tab1' });

  assert.strictEqual(result.uuid, 'tab1');
  assert.strictEqual(result.type, 'table');
  assert.strictEqual(result.label, 'tab:results');
  assert.strictEqual(result.caption, 'Comparison of different methods on benchmark datasets.');
});

test('TexResourcesTool.handleCall - algorithm resource', async () => {
  const analysisResult = {
    meta: { title: 'Test Paper', date: '2024', authors: [] },
    abstract: 'Test abstract',
    content: {
      type: 'article',
      uuid: 'article-uuid',
      children: [
        {
          type: 'algorithm',
          uuid: 'alg1',
          label: 'alg:proposed',
          caption: 'The proposed algorithm for efficient computation.',
          text: '\\begin{algorithm}...\\end{algorithm}',
          children: []
        }
      ]
    }
  };

  const tool = new TexResourcesTool({ analysisResult });
  const result = await tool.handleCall({ uuid: 'alg1' });

  assert.strictEqual(result.uuid, 'alg1');
  assert.strictEqual(result.type, 'algorithm');
  assert.strictEqual(result.label, 'alg:proposed');
  assert.strictEqual(result.caption, 'The proposed algorithm for efficient computation.');
});

test('TexResourcesTool.handleCall - resource with preamble content', async () => {
  const analysisResult = {
    meta: { title: 'Test Paper', date: '2024', authors: [] },
    abstract: 'Test abstract',
    content: {
      type: 'article',
      uuid: 'article-uuid',
      children: [
        {
          type: 'section',
          uuid: 'sec1',
          title: 'Introduction',
          preamble: 'This is introductory text before the first subsection.',
          children: []
        }
      ]
    }
  };

  const tool = new TexResourcesTool({ analysisResult });
  const result = await tool.handleCall({ uuid: 'sec1' });

  assert.strictEqual(result.uuid, 'sec1');
  assert.strictEqual(result.type, 'section');
  assert.strictEqual(result.title, 'Introduction');
  assert.strictEqual(result.preamble, 'This is introductory text before the first subsection.');
});

test('TexResourcesTool.handleCall - article root resource', async () => {
  const analysisResult = {
    meta: { title: 'Test Paper Title', date: '2024', authors: [] },
    abstract: 'Test abstract',
    content: {
      type: 'article',
      uuid: 'article-uuid',
      children: []
    }
  };

  const tool = new TexResourcesTool({ analysisResult });
  const result = await tool.handleCall({ uuid: 'article-root' });

  assert.strictEqual(result.uuid, 'article-root');
  assert.strictEqual(result.type, 'article');
  assert.strictEqual(result.title, 'Test Paper Title');
  // Article root has no parent, so location is empty
  assert.strictEqual(result.location, '');
});

test('TexResourcesTool.getResourceSummaryString - basic tree structure', async () => {
  const analysisResult = {
    meta: { title: 'Test Paper', date: '2024', authors: [] },
    abstract: 'Test abstract',
    content: {
      type: 'article',
      uuid: 'article-uuid',
      children: [
        {
          type: 'section',
          uuid: 'sec1',
          title: 'Introduction',
          label: 'sec:intro',
          children: [
            {
              type: 'paragraph',
              uuid: 'para1',
              children: []
            },
            {
              type: 'figure',
              uuid: 'fig1',
              label: 'fig:main',
              caption: 'Main figure caption',
              children: []
            }
          ]
        },
        {
          type: 'section',
          uuid: 'sec2',
          title: 'Results',
          children: []
        }
      ]
    }
  };

  const tool = new TexResourcesTool({ analysisResult });
  const summary = tool.getResourceSummaryString();

  // Article children are merged directly, so sections are at root level
  assert.ok(summary.includes('section(uuid: sec1, title: Introduction, label: sec:intro)'));
  assert.ok(summary.includes('paragraph(uuid: para1)'));
  assert.ok(summary.includes('figure(uuid: fig1, label: fig:main, caption: Main figure caption)'));
  assert.ok(summary.includes('section(uuid: sec2, title: Results)'));

  // Check indentation - sections at root, children indented
  const lines = summary.split('\n');
  assert.ok(lines.find(l => l.trim().startsWith('- section')), 'Should have sections at root level');
  assert.ok(lines.find(l => l.includes('  - paragraph')), 'Should have indented paragraphs');
});

test('TexResourcesTool.getResourceSummaryString - empty content', async () => {
  const analysisResult = {
    meta: { title: 'Test Paper', date: '2024', authors: [] },
    abstract: 'Test abstract',
    content: {
      type: 'article',
      uuid: 'article-uuid',
      children: []
    }
  };

  const tool = new TexResourcesTool({ analysisResult });
  const summary = tool.getResourceSummaryString();

  // Should have abstract (article has no children)
  assert.ok(summary.includes('abstract(uuid: abstract)'));
});

test('TexResourcesTool.getFlattexLatex - section with multiple children', async () => {
  const analysisResult = {
    meta: { title: 'Test Paper', date: '2024', authors: [] },
    abstract: 'Test abstract',
    content: {
      type: 'article',
      uuid: 'article-uuid',
      children: [
        {
          type: 'section',
          uuid: 'sec1',
          title: 'Introduction',
          preamble: 'Intro preamble text.',
          children: [
            {
              type: 'paragraph',
              uuid: 'para1',
              text: 'First paragraph content.',
              children: []
            },
            {
              type: 'equation',
              uuid: 'eq1',
              text: '\\begin{equation}E = mc^2\\end{equation}',
              children: []
            },
            {
              type: 'paragraph',
              uuid: 'para2',
              text: 'Second paragraph content.',
              children: []
            }
          ]
        }
      ]
    }
  };

  const tool = new TexResourcesTool({ analysisResult });
  const sectionNode = tool.findNodeByUuid('sec1');
  const latex = sectionNode.getFlattexLatex();

  assert.ok(latex.includes('Intro preamble text.'), 'Should include preamble');
  assert.ok(latex.includes('First paragraph content.'), 'Should include first paragraph');
  assert.ok(latex.includes('E = mc^2'), 'Should include equation');
  assert.ok(latex.includes('Second paragraph content.'), 'Should include second paragraph');
});

test('TexResourcesTool.getFlattexLatex - nested subsections', async () => {
  const analysisResult = {
    meta: { title: 'Test Paper', date: '2024', authors: [] },
    abstract: 'Test abstract',
    content: {
      type: 'article',
      uuid: 'article-uuid',
      children: [
        {
          type: 'section',
          uuid: 'sec1',
          title: 'Experiments',
          children: [
            {
              type: 'subsection',
              uuid: 'subsec1',
              title: 'Setup',
              preamble: 'Setup section intro.',
              children: [
                {
                  type: 'paragraph',
                  uuid: 'para1',
                  text: 'Setup details.',
                  children: []
                }
              ]
            },
            {
              type: 'subsection',
              uuid: 'subsec2',
              title: 'Results',
              children: [
                {
                  type: 'figure',
                  uuid: 'fig1',
                  text: '\\begin{figure}...\\end{figure}',
                  children: []
                }
              ]
            }
          ]
        }
      ]
    }
  };

  const tool = new TexResourcesTool({ analysisResult });
  const sectionNode = tool.findNodeByUuid('sec1');
  const latex = sectionNode.getFlattexLatex();

  assert.ok(latex.includes('Setup section intro.'), 'Should include subsection preamble');
  assert.ok(latex.includes('Setup details.'), 'Should include nested paragraph');
  assert.ok(latex.includes('\\begin{figure}'), 'Should include figure from second subsection');
});

test('TexResourcesTool.handleCall - section returns flattened LaTeX', async () => {
  const analysisResult = {
    meta: { title: 'Test Paper', date: '2024', authors: [] },
    abstract: 'Test abstract',
    content: {
      type: 'article',
      uuid: 'article-uuid',
      children: [
        {
          type: 'section',
          uuid: 'sec1',
          title: 'Method',
          preamble: 'Method overview.',
          children: [
            {
              type: 'paragraph',
              uuid: 'para1',
              text: 'Method paragraph 1.',
              children: []
            },
            {
              type: 'equation',
              uuid: 'eq1',
              text: '\\[E=mc^2\\]',
              children: []
            }
          ]
        }
      ]
    }
  };

  const tool = new TexResourcesTool({ analysisResult });
  const result = await tool.handleCall({ uuid: 'sec1' });

  assert.strictEqual(result.type, 'section');
  assert.ok(result.latex.includes('Method overview.'), 'Should include preamble');
  assert.ok(result.latex.includes('Method paragraph 1.'), 'Should include child paragraph');
  assert.ok(result.latex.includes('E=mc^2'), 'Should include child equation');
});

test('TexResourcesTool.findNodeByTypeTitle - find section by title', async () => {
  const analysisResult = {
    meta: { title: 'Test Paper', date: '2024', authors: [] },
    abstract: 'Test abstract',
    content: {
      type: 'article',
      uuid: 'article-uuid',
      children: [
        {
          type: 'section',
          uuid: 'sec1',
          title: 'Introduction',
          children: []
        },
        {
          type: 'section',
          uuid: 'sec2',
          title: 'Related Work',
          children: []
        },
        {
          type: 'section',
          uuid: 'sec3',
          title: 'Experiments',
          children: []
        }
      ]
    }
  };

  const tool = new TexResourcesTool({ analysisResult });
  
  // Test exact match
  const introNode = tool.findNodeByTypeTitle('section', 'Introduction');
  assert.strictEqual(introNode.uuid, 'sec1');
  assert.strictEqual(introNode.title, 'Introduction');

  // Test partial match (case-insensitive)
  const relatedNode = tool.findNodeByTypeTitle('section', 'related');
  assert.strictEqual(relatedNode.uuid, 'sec2');
  assert.strictEqual(relatedNode.title, 'Related Work');

  // Test partial match with different case
  const expNode = tool.findNodeByTypeTitle('section', 'EXPERI');
  assert.strictEqual(expNode.uuid, 'sec3');
});

test('TexResourcesTool.findNodeByTypeTitle - not found', async () => {
  const analysisResult = {
    meta: { title: 'Test Paper', date: '2024', authors: [] },
    abstract: 'Test abstract',
    content: {
      type: 'article',
      uuid: 'article-uuid',
      children: [
        {
          type: 'section',
          uuid: 'sec1',
          title: 'Introduction',
          children: []
        }
      ]
    }
  };

  const tool = new TexResourcesTool({ analysisResult });
  
  // Test non-existent title
  const notFound = tool.findNodeByTypeTitle('section', 'NonExistent');
  assert.strictEqual(notFound, null);

  // Test non-existent type
  const notFoundType = tool.findNodeByTypeTitle('nonexistent', 'Title');
  assert.strictEqual(notFoundType, null);
});

test('TexResourcesTool.findNodeByTypeTitle - find subsection', async () => {
  const analysisResult = {
    meta: { title: 'Test Paper', date: '2024', authors: [] },
    abstract: 'Test abstract',
    content: {
      type: 'article',
      uuid: 'article-uuid',
      children: [
        {
          type: 'section',
          uuid: 'sec1',
          title: 'Experiments',
          children: [
            {
              type: 'subsection',
              uuid: 'subsec1',
              title: 'Dataset Description',
              children: []
            },
            {
              type: 'subsection',
              uuid: 'subsec2',
              title: 'Implementation Details',
              children: []
            }
          ]
        }
      ]
    }
  };

  const tool = new TexResourcesTool({ analysisResult });
  
  const datasetNode = tool.findNodeByTypeTitle('subsection', 'dataset');
  assert.strictEqual(datasetNode.uuid, 'subsec1');
  assert.strictEqual(datasetNode.title, 'Dataset Description');

  const implNode = tool.findNodeByTypeTitle('subsection', 'Implementation');
  assert.strictEqual(implNode.uuid, 'subsec2');
  assert.strictEqual(implNode.title, 'Implementation Details');
});

test('TexResourcesTool.getAvailableResourcesList - figures and tables', async () => {
  const analysisResult = {
    meta: { title: 'Test Paper', date: '2024', authors: [] },
    abstract: 'Test abstract',
    content: {
      type: 'article',
      uuid: 'article-uuid',
      children: [
        {
          type: 'section',
          uuid: 'sec1',
          title: 'Results',
          children: [
            {
              type: 'figure',
              uuid: 'fig1',
              label: 'fig:main',
              caption: 'This is the main figure showing important results',
              children: []
            },
            {
              type: 'table',
              uuid: 'tab1',
              label: 'tab:results',
              caption: 'Comparison of different methods on benchmark datasets',
              children: []
            },
            {
              type: 'figure',
              uuid: 'fig2',
              caption: 'Secondary figure without label',
              children: []
            }
          ]
        }
      ]
    }
  };

  const tool = new TexResourcesTool({ analysisResult });
  const list = tool.getAvailableResourcesList();

  assert.ok(list.includes('**Available Figures**'), 'Should have figures section');
  assert.ok(list.includes('**Available Tables**'), 'Should have tables section');
  assert.ok(list.includes('uuid: fig1'), 'Should include fig1 UUID');
  assert.ok(list.includes('uuid: tab1'), 'Should include tab1 UUID');
  assert.ok(list.includes('uuid: fig2'), 'Should include fig2 UUID');
  assert.ok(list.includes('label: fig:main'), 'Should include figure label');
  assert.ok(list.includes('label: tab:results'), 'Should include table label');
  assert.ok(list.includes('This is the main figure showing important results'), 'Should include full caption');
});

test('TexResourcesTool.getAvailableResourcesList - empty resources', async () => {
  const analysisResult = {
    meta: { title: 'Test Paper', date: '2024', authors: [] },
    abstract: 'Test abstract',
    content: {
      type: 'article',
      uuid: 'article-uuid',
      children: [
        {
          type: 'section',
          uuid: 'sec1',
          title: 'Introduction',
          children: []
        }
      ]
    }
  };

  const tool = new TexResourcesTool({ analysisResult });
  const list = tool.getAvailableResourcesList();

  assert.strictEqual(list, 'No figures, tables, or algorithms found.');
});

test('TexResourcesTool.extractAllImageFiles - extracts image paths from figures', async () => {
  const analysisResult = {
    meta: { title: 'Test Paper', date: '2024', authors: [] },
    abstract: 'Test abstract',
    content: {
      type: 'article',
      uuid: 'article-uuid',
      children: [
        {
          type: 'figure',
          uuid: 'fig1',
          label: 'fig:test1',
          caption: 'Test figure 1',
          text: '\\begin{figure}\n  \\includegraphics[width=0.5\\linewidth]{figs/image1.png}\n\\end{figure}',
          children: []
        },
        {
          type: 'figure',
          uuid: 'fig2',
          label: 'fig:test2',
          caption: 'Test figure 2',
          text: '\\begin{figure}\n  \\includegraphics{figs/image2.pdf}\n  \\includegraphics[width=0.3\\textwidth]{figs/image3.jpg}\n\\end{figure}',
          children: []
        },
        {
          type: 'figure',
          uuid: 'fig3',
          caption: 'TikZ figure without images',
          text: '\\begin{figure}\n  \\begin{tikzpicture}\n    \\node {Hello};\n  \\end{tikzpicture}\n\\end{figure}',
          children: []
        }
      ]
    }
  };

  const tool = new TexResourcesTool({ analysisResult });
  const images = tool.extractAllImageFiles();

  assert.strictEqual(images.length, 3);
  assert.ok(images.includes('figs/image1.png'));
  assert.ok(images.includes('figs/image2.pdf'));
  assert.ok(images.includes('figs/image3.jpg'));
});

test('TexResourcesTool.extractAllImageFiles - skips placeholder images', async () => {
  const analysisResult = {
    meta: { title: 'Test Paper', date: '2024', authors: [] },
    abstract: 'Test abstract',
    content: {
      type: 'article',
      uuid: 'article-uuid',
      children: [
        {
          type: 'figure',
          uuid: 'fig1',
          text: '\\begin{figure}\n  \\includegraphics[width=\\linewidth]{placeholder.png}\n\\end{figure}',
          children: []
        },
        {
          type: 'figure',
          uuid: 'fig2',
          text: '\\begin{figure}\n  \\includegraphics{figs/real_image.png}\n\\end{figure}',
          children: []
        }
      ]
    }
  };

  const tool = new TexResourcesTool({ analysisResult });
  const images = tool.extractAllImageFiles();

  assert.strictEqual(images.length, 1);
  assert.ok(images.includes('figs/real_image.png'));
  assert.ok(!images.includes('placeholder.png'));
});

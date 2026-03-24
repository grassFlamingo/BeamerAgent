import path from 'path';
import fs from 'fs';

import { log } from '../utils/logger.js'

/**
 * ResourceNode - A DOM-like node representing a LaTeX resource element
 * 
 * Each node represents a figure, table, algorithm, equation, or text block
 * in the LaTeX document hierarchy.
 */
export class ResourceNode {
  /**
   * @param {Object} data - Node data from HierarchicalContent
   */
  constructor(data) {
    this.uuid = data.uuid;
    this.type = data.type || 'unknown';
    this.title = data.title || '';
    this.label = data.label || null;
    this.caption = data.caption || null;
    this.text = data.text || null;
    this.latex = data.text || null; // Full LaTeX content for environments
    this.preamble = data.preamble || '';
    this.imagePath = data.imagePath || null;
    this.figures = data.figures || []; // Array of \includegraphics commands

    // DOM-like parent/children relationships
    this.parent = null;
    this.children = [];
    this.nextSibling = null;
    this.previousSibling = null;

    // Section hierarchy path (e.g., ['article', 'section', 'subsection'])
    this.ancestors = [];

    // Build children if provided
    if (data.children && Array.isArray(data.children)) {
      for (const childData of data.children) {
        if (childData instanceof ResourceNode || (typeof childData === 'object' && childData !== null)) {
          this.appendChild(new ResourceNode(childData));
        }
      }
    }
  }

  /**
   * Add a child node
   * @param {ResourceNode} child - Child node to add
   * @returns {ResourceNode} The added child
   */
  appendChild(child) {
    if (!(child instanceof ResourceNode)) {
      throw new Error('Child must be a ResourceNode instance');
    }
    child.parent = this;
    
    // Set sibling links
    if (this.children.length > 0) {
      const lastChild = this.children[this.children.length - 1];
      lastChild.nextSibling = child;
      child.previousSibling = lastChild;
    }
    
    this.children.push(child);
    
    // Update ancestors for the child
    child.ancestors = [...this.ancestors, this.type];
    
    return child;
  }

  /**
   * Find a descendant node by UUID
   * @param {string} uuid - UUID to search for
   * @returns {ResourceNode|null} Found node or null
   */
  findByUuid(uuid) {
    if (this.uuid === uuid) {
      return this;
    }
    for (const child of this.children) {
      const found = child.findByUuid(uuid);
      if (found) return found;
    }
    return null;
  }

  /**
   * Find all nodes of a specific type
   * @param {string} type - Node type to search for (e.g., 'figure', 'table')
   * @returns {ResourceNode[]} Array of matching nodes
   */
  findAllByType(type) {
    const results = [];
    if (this.type === type) {
      results.push(this);
    }
    for (const child of this.children) {
      results.push(...child.findAllByType(type));
    }
    return results;
  }

  /**
   * Get the section path (e.g., "Introduction > Background > Related Work")
   * @returns {string} Human-readable section path
   */
  getSectionPath() {
    const pathParts = [];
    let current = this.parent;
    while (current) {
      if (current.type === 'section' || current.type === 'subsection' || 
          current.type === 'subsubsection' || current.type === 'article') {
        pathParts.unshift(current.title || current.type);
      }
      current = current.parent;
    }
    return pathParts.join(' > ');
  }

  /**
   * Convert to plain object
   * @returns {Object} Plain object representation
   */
  toObject() {
    return {
      uuid: this.uuid,
      type: this.type,
      title: this.title,
      label: this.label,
      caption: this.caption,
      text: this.text,
      latex: this.latex,
      preamble: this.preamble,
      imagePath: this.imagePath,
      figures: this.figures,
      ancestors: this.ancestors,
      sectionPath: this.getSectionPath(),
      children: this.children.map(child => child.toObject())
    };
  }

  /**
   * Get a concise summary for LLM context
   * @returns {string} Summary string
   */
  toSummary() {
    const parts = [];
    parts.push(`[${this.type}] uuid: ${this.uuid}`);
    if (this.title) parts.push(`title: ${this.title}`);
    if (this.label) parts.push(`label: ${this.label}`);
    if (this.caption) parts.push(`caption: ${this.caption}`);
    if (this.sectionPath) parts.push(`location: ${this.sectionPath}`);
    return parts.join(', ');
  }

  /**
   * Get flattened LaTeX content including all children
   * For leaf nodes (paragraph, figure, table, equation), returns their text/latex content.
   * For container nodes (section, subsection, article), recursively collects all child content.
   * @returns {string} Flattened LaTeX content
   */
  getFlattexLatex() {
    const parts = [];

    // Add preamble if exists (for container nodes)
    if (this.preamble) {
      parts.push(this.preamble);
    }

    // For leaf nodes, return their text/latex content
    if (this.children.length === 0) {
      if (this.text) {
        parts.push(this.text);
      }
      return parts.join('\n\n');
    }

    // For container nodes, recursively collect all child content
    for (const child of this.children) {
      const childLatex = child.getFlattexLatex();
      if (childLatex) {
        parts.push(childLatex);
      }
    }

    return parts.join('\n\n');
  }
}

/**
 * TexResourcesTool - LLM tool for retrieving LaTeX resource details by UUID
 * 
 * This class provides:
 * 1. DOM-like resource tree from LatexAnalyzerTask results
 * 2. Fast UUID-based indexing for resource lookup
 * 3. Tool definitions and handlers for LLM tool calling
 * 
 * @example
 * const tool = new TexResourcesTool({
 *   analysisResult: latexAnalysisOutput,
 *   cacheDir: '/path/to/images',
 *   logger: log.create('TexResourcesTool')
 * });
 * 
 * // Get tool definition for LLM
 * const tools = tool.getTools();
 * 
 * // Get handlers for tool execution
 * const handlers = tool.getHandlers();
 */
export class TexResourcesTool {
  /**
   * @param {Object} options - Tool configuration options
   * @param {Object} [options.analysisResult] - Output from LatexAnalyzerTask
   * @param {Object} [options.resources] - Legacy flat resource map (for backward compatibility)
   * @param {string} [options.cacheDir] - Directory path for resolving relative image paths
   */
  constructor(options = {}) {
    this.cacheDir = options.cacheDir || '';
    this.log = log.create('TexResourcesTool');
    
    // Root nodes of the document tree
    this.roots = [];
    
    // Fast UUID -> ResourceNode index
    this.uuidIndex = new Map();
    
    // Type-based indexes (e.g., 'figure' -> [ResourceNode, ...])
    this.typeIndex = new Map();
    
    // Label-based index (e.g., 'fig:main' -> ResourceNode)
    this.labelIndex = new Map();
    
    // Initialize from analysis result or legacy resources
    if (options.analysisResult) {
      this._buildTreeFromAnalysis(options.analysisResult);
    } else if (options.resources) {
      this._buildFromLegacyResources(options.resources);
    }
  }

  /**
   * Build DOM-like tree from LatexAnalyzerTask output
   * @private
   * @param {Object} analysisResult - Output from LatexAnalyzerTask.execute()
   */
  _buildTreeFromAnalysis(analysisResult) {
    const { meta, abstract, content, preamble } = analysisResult;
    
    // Create article root
    const articleRoot = new ResourceNode({
      type: 'article',
      title: meta?.title || '',
      uuid: 'article-root',
      children: []
    });
    
    this.roots.push(articleRoot);
    this._indexNode(articleRoot);
    
    // Add abstract as a special node
    if (abstract) {
      const abstractNode = new ResourceNode({
        type: 'abstract',
        title: 'Abstract',
        text: abstract,
        uuid: 'abstract'
      });
      articleRoot.appendChild(abstractNode);
      this._indexNode(abstractNode);
    }
    
    // Build tree from content hierarchy
    if (content) {
      // If content is an article node, merge its children directly into articleRoot
      if (content.type === 'article' && content.children) {
        for (const child of content.children) {
          const childNode = new ResourceNode(child);
          articleRoot.appendChild(childNode);
        }
        // Index all children recursively
        this._indexNode(articleRoot);
      } else {
        // Otherwise, build content tree normally
        const contentRoot = this._buildContentTree(content, articleRoot);
        if (contentRoot) {
          articleRoot.appendChild(contentRoot);
        }
      }
    }

    this.log.info(`Built resource tree: ${this.uuidIndex.size} nodes indexed`);
  }

  /**
   * Recursively build content tree
   * @private
   * @param {Object|Array} content - Content from LatexAnalyzerTask
   * @param {ResourceNode} parent - Parent node
   * @returns {ResourceNode|null} Built node or null
   */
  _buildContentTree(content, parent) {
    if (!content) return null;

    // Handle array of children
    if (Array.isArray(content)) {
      for (const item of content) {
        this._buildContentTree(item, parent);
      }
      return null;
    }

    // Handle single node - constructor already processes children recursively
    const node = new ResourceNode(content);
    this._indexNode(node);

    // Append to parent if provided
    if (parent) {
      parent.appendChild(node);
    }

    return node;
  }

  /**
   * Build from legacy flat resources format
   * @private
   * @param {Object} resources - Flat map of UUID to resource data
   */
  _buildFromLegacyResources(resources) {
    const root = new ResourceNode({
      type: 'root',
      title: 'Resources',
      uuid: 'legacy-root'
    });
    
    this.roots.push(root);
    this._indexNode(root);
    
    for (const [uuid, data] of Object.entries(resources)) {
      const node = new ResourceNode({ ...data, uuid });
      root.appendChild(node);
      this._indexNode(node);
    }
  }

  /**
   * Index a node for fast lookup
   * @private
   * @param {ResourceNode} node - Node to index
   */
  _indexNode(node) {
    // UUID index
    if (node.uuid) {
      this.uuidIndex.set(node.uuid, node);
    }

    // Type index
    if (node.type) {
      if (!this.typeIndex.has(node.type)) {
        this.typeIndex.set(node.type, []);
      }
      this.typeIndex.get(node.type).push(node);
    }

    // Label index
    if (node.label) {
      this.labelIndex.set(node.label, node);
    }

    // Recursively index all children
    for (const child of node.children) {
      this._indexNode(child);
    }
  }

  /**
   * Get the tool definition for LLM tool calling
   * @returns {Object} Tool definition compatible with LLM APIs
   */
  getDefinition() {
    return {
      type: 'function',
      function: {
        name: 'getResourceDetails',
        description: `Get full details of any content element by UUID.
UUIDs are used to locate specific materials (figures, tables, algorithms, equations, paragraphs, sections, ...) in the paper.
Each content item has a unique UUID in format: (uuid: xxxxxx).

Available resources can be found in the content summary with their UUIDs.
When you need more details about a specific figure, table, algorithm, or equation, call this tool with its UUID.`,
        parameters: {
          type: 'object',
          properties: {
            uuid: {
              type: 'string',
              description: 'UUID of the resource to look up (e.g., "9eac602b")'
            }
          },
          required: ['uuid']
        }
      }
    };
  }

  /**
   * Get tool definitions array for LLM API
   * @returns {Object[]} Array of tool definitions
   */
  getTools() {
    return [this.getDefinition()];
  }

  /**
   * Find a resource node by UUID
   * @param {string} uuid - UUID to search for
   * @returns {ResourceNode|null} Found node or null
   */
  findNodeByUuid(uuid) {
    return this.uuidIndex.get(uuid) || null;
  }

  /**
   * Find a resource node by label (e.g., "fig:main")
   * @param {string} label - LaTeX label to search for
   * @returns {ResourceNode|null} Found node or null
   */
  findNodeByLabel(label) {
    return this.labelIndex.get(label) || null;
  }

  /**
   * Find all resources of a specific type
   * @param {string} type - Resource type (e.g., 'figure', 'table', 'equation')
   * @returns {ResourceNode[]} Array of matching nodes
   */
  findAllByType(type) {
    return this.typeIndex.get(type) || [];
  }

  /**
   * Find a resource node by type and title
   * @param {string} type - Resource type (e.g., 'section', 'subsection')
   * @param {string} title - Title text to match (case-insensitive partial match)
   * @returns {ResourceNode|null} First matching node or null
   */
  findNodeByTypeTitle(type, title) {
    const nodes = this.typeIndex.get(type);
    if (!nodes) return null;

    const searchTitle = title.toLowerCase();
    for (const node of nodes) {
      if (node.title && node.title.toLowerCase().includes(searchTitle)) {
        return node;
      }
    }
    return null;
  }

  /**
   * Get a summary of all resources by type
   * @returns {Object} Summary object with counts and UUIDs by type
   */
  getResourceSummary() {
    const summary = {};
    for (const [type, nodes] of this.typeIndex.entries()) {
      if (type === 'article' || type === 'root' || type === 'abstract') continue;
      summary[type] = nodes.map(node => ({
        uuid: node.uuid,
        label: node.label,
        title: node.title,
        caption: node.caption,
        location: node.getSectionPath()
      }));
    }
    return summary;
  }

  /**
   * Get a list of all available figures, tables, and algorithms with their UUIDs
   * Useful for helping LLM understand available visual resources
   * Automatically extracts actual image files from analyzed LaTeX content
   * @returns {string} Formatted list of available resources
   */
  getAvailableResourcesList() {
    const parts = [];

    // Get figures
    const figures = this.findAllByType('figure');
    if (figures.length > 0) {
      parts.push('**Available Figures**:\n');
      for (const fig of figures) {
        const label = fig.label ? ` (label: ${fig.label})` : '';
        const caption = fig.caption ? ` - ${fig.caption}` : '';
        let figureLine = `- uuid: ${fig.uuid}${label}${caption}`;

        // Add image files if available
        const imageFiles = this._extractImageFilesFromFigure(fig);
        if (imageFiles.length > 0) {
          figureLine += `\n    Images: ${imageFiles.join(', ')}`;
        }
        parts.push(figureLine);
      }
      parts.push('');
    }

    // Get tables
    const tables = this.findAllByType('table');
    if (tables.length > 0) {
      parts.push('**Available Tables**:\n');
      for (const tab of tables) {
        const label = tab.label ? ` (label: ${tab.label})` : '';
        const caption = tab.caption ? ` - ${tab.caption}` : '';
        parts.push(`- uuid: ${tab.uuid}${label}${caption}`);
      }
      parts.push('');
    }

    // Get algorithms
    const algorithms = this.findAllByType('algorithm');
    if (algorithms.length > 0) {
      parts.push('**Available Algorithms**:\n');
      for (const alg of algorithms) {
        const label = alg.label ? ` (label: ${alg.label})` : '';
        const caption = alg.caption ? ` - ${alg.caption}` : '';
        parts.push(`- uuid: ${alg.uuid}${label}${caption}`);
      }
      parts.push('');
    }

    // // Get equations
    // const equations = this.findAllByType('equation');
    // if (equations.length > 0) {
    //   parts.push('**Available Equations**:\n');
    //   for (const eq of equations) {
    //     const label = eq.label ? ` (label: ${eq.label})` : '';
    //     parts.push(`- uuid: ${eq.uuid}${label}`);
    //   }
    //   parts.push('');
    // }

    return parts.join('\n') || 'No figures, tables, or algorithms found.';
  }

  /**
   * Extract image files from a single figure node
   * @private
   * @param {ResourceNode} fig - Figure node
   * @returns {string[]} Array of image file paths
   */
  _extractImageFilesFromFigure(fig) {
    const imageFiles = [];

    // Use the pre-parsed figures array if available
    if (fig.figures && fig.figures.length > 0) {
      for (const figureObj of fig.figures) {
        const imagePath = figureObj.ctx?.trim();
        if (imagePath && !imagePath.includes('placeholder')) {
          imageFiles.push(imagePath);
        }
      }
    } else {
      // Fallback: parse from text/latex for backward compatibility
      const content = fig.text || fig.latex || '';
      const includeGraphicsRegex = /\\includegraphics(?:\[[^\]]*\])?\{([^}]+)\}/g;
      let match;

      while ((match = includeGraphicsRegex.exec(content)) !== null) {
        const imagePath = match[1].trim();
        if (!imagePath.includes('placeholder')) {
          imageFiles.push(imagePath);
        }
      }
    }

    return imageFiles;
  }

  /**
   * Extract all image files from the analyzed LaTeX content
   * Scans through all figure nodes and extracts \includegraphics paths
   * @returns {string[]} Array of unique image file paths
   */
  extractAllImageFiles() {
    const imageFiles = new Set();
    const figures = this.findAllByType('figure');

    for (const fig of figures) {
      // Use the pre-parsed figures array if available
      if (fig.figures && fig.figures.length > 0) {
        for (const figureObj of fig.figures) {
          const imagePath = figureObj.ctx?.trim();
          if (imagePath && !imagePath.includes('placeholder')) {
            imageFiles.add(imagePath);
          }
        }
      } else {
        // Fallback: parse from text/latex for backward compatibility
        const content = fig.text || fig.latex || '';
        const includeGraphicsRegex = /\\includegraphics(?:\[[^\]]*\])?\{([^}]+)\}/g;
        let match;

        while ((match = includeGraphicsRegex.exec(content)) !== null) {
          const imagePath = match[1].trim();
          if (!imagePath.includes('placeholder')) {
            imageFiles.add(imagePath);
          }
        }
      }
    }

    return Array.from(imageFiles);
  }

  /**
   * Generate a tree-like resource display string
   * Example:
   *
   * - section(uuid: 9eac602b, title: Introduction, label: introduction)
   *   - paragraph (uuid: 9eac602b)
   *   - figure (uuid: 9eac602b, caption: xxxx, label: xxxx)
   *   - equation (uuid: 9eac602b, label: xxxx)
   *   - algorithm (uuid: 9eac602b, caption: xxxx, label: xxxx)
   *   - table (uuid: 9eac602b, caption: xxxx, label: xxxx)
   * - section (uuid: 9eac602b, title: Results, label: results)
   *   - subsection (uuid: xxx, title: xxx, label: xxx)
   *     - paragraph (uuid: 9eac602b)
   *   - ...
   *
   * @returns {string} Tree-formatted string representation of resources
   */
  getResourceSummaryString() {
    /**
     * Recursively build tree string for a node
     * @param {ResourceNode} node - Current node
     * @param {number} depth - Current depth level
     * @returns {string} Tree string for this node and its children
     */
    const buildNodeString = (node, depth) => {
      const indent = '  '.repeat(depth);
      const parts = [];

      // Basic info
      parts.push(`${node.type}(uuid: ${node.uuid}`);

      // Add type-specific info
      if (node.title && node.type !== 'abstract') {
        parts.push(`, title: ${node.title}`);
      }
      if (node.label) {
        parts.push(`, label: ${node.label}`);
      }
      if (node.caption && (node.type === 'figure' || node.type === 'table' || node.type === 'algorithm')) {
        parts.push(`, caption: ${node.caption}`);
      }

      parts.push(')');
      let result = `${indent}- ${parts.join('')}`;

      // Recursively process children
      for (const child of node.children) {
        result += '\n' + buildNodeString(child, depth + 1);
      }

      return result;
    };

    // Process all root nodes
    const results = [];
    for (const root of this.roots) {
      results.push(buildNodeString(root, 0));
    }

    return results.join('\n');
  }

  /**
   * Handle tool call to retrieve resource details by UUID
   * @param {Object} params - Tool call parameters
   * @param {string} params.uuid - UUID of the resource to retrieve
   * @returns {Promise<Object>} Resource details or error object
   */
  async handleCall({ uuid }) {
    this.log.info(`Tool call: getResourceDetails for uuid=${uuid}`);

    const node = this.uuidIndex.get(uuid);
    if (!node) {
      return { 
        error: `Resource with UUID ${uuid} not found`,
        availableUuids: Array.from(this.uuidIndex.keys()).slice(0, 20)
      };
    }

    const result = {
      uuid: node.uuid,
      type: node.type,
      title: node.title || null,
      label: node.label || null,
      caption: node.caption || null,
      text: node.text || null,
      latex: node.getFlattexLatex() || null,
      preamble: node.preamble || null,
      figures: node.figures && node.figures.length > 0 ? node.figures : null,
      location: node.getSectionPath(),
      ancestors: node.ancestors
    };

    // Handle figure images
    if (node.type === 'figure' && node.imagePath) {
      let imagePath = node.imagePath;
      if (!path.isAbsolute(imagePath) && this.cacheDir) {
        imagePath = path.join(this.cacheDir, node.imagePath);
      }
      if (fs.existsSync(imagePath)) {
        result.imagePath = imagePath;
        const imageData = fs.readFileSync(imagePath);
        result.imageBase64 = imageData.toString('base64');
        result.imageMimeType = this._getMimeType(imagePath);
      }
    }

    return result;
  }

  /**
   * Create tool handlers object for task integration
   * @returns {Object} Object mapping tool names to handler functions
   */
  getHandlers() {
    return {
      getResourceDetails: async (params) => {
        return this.handleCall(params);
      }
    };
  }

  /**
   * Update tool configuration with new analysis result
   * @param {Object} options - New configuration options
   * @param {Object} [options.analysisResult] - New analysis result from LatexAnalyzerTask
   * @param {Object} [options.resources] - New legacy resources map
   * @param {string} [options.cacheDir] - New cache directory path
   */
  configure(options = {}) {
    // Clear existing indexes
    this.uuidIndex.clear();
    this.typeIndex.clear();
    this.labelIndex.clear();
    this.roots = [];
    
    if (options.analysisResult !== undefined) {
      this._buildTreeFromAnalysis(options.analysisResult);
    } else if (options.resources !== undefined) {
      this._buildFromLegacyResources(options.resources);
    }
    
    if (options.cacheDir !== undefined) {
      this.cacheDir = options.cacheDir;
    }
  }

  /**
   * Get MIME type for image files
   * @private
   * @param {string} filePath - Path to image file
   * @returns {string} MIME type
   */
  _getMimeType(filePath) {
    const ext = path.extname(filePath).toLowerCase();
    const mimeTypes = {
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.gif': 'image/gif',
      '.pdf': 'application/pdf',
      '.svg': 'image/svg+xml'
    };
    return mimeTypes[ext] || 'application/octet-stream';
  }
}

export default TexResourcesTool;

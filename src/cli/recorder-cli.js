import { Command } from 'commander';
import fs from 'fs';
import path from 'path';
import readline from 'readline';
import { AgentRecorder } from '../../utils/agentRecorder.js';
import { log } from '../../utils/logger.js';

const program = new Command();

// ANSI color codes
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  white: '\x1b[37m',
  bgBlue: '\x1b[44m',
  bgGreen: '\x1b[42m',
  bgRed: '\x1b[41m'
};

/**
 * Format timestamp to readable string
 */
function formatTimestamp(timestamp) {
  if (!timestamp) return 'N/A';
  return new Date(timestamp).toLocaleString();
}

/**
 * Format status with color coding
 */
function formatStatus(status, useColor = true) {
  const statusInfo = {
    'succeed': { symbol: '✓', color: colors.green },
    'completed': { symbol: '✓', color: colors.green },
    'failed': { symbol: '✗', color: colors.red },
    'error': { symbol: '✗', color: colors.red },
    'running': { symbol: '⟳', color: colors.yellow },
    'pending': { symbol: '○', color: colors.dim }
  };
  
  const info = statusInfo[status] || { symbol: '○', color: colors.dim };
  return useColor ? `${info.color}${info.symbol} ${status}${colors.reset}` : `${info.symbol} ${status}`;
}

/**
 * Colorize text
 */
function colorize(text, color) {
  return `${color}${text}${colors.reset}`;
}

/**
 * Truncate long strings for display
 */
function truncate(str, maxLength = 100) {
  if (!str) return '';
  if (typeof str !== 'string') return JSON.stringify(str);
  if (str.length <= maxLength) return str;
  return str.substring(0, maxLength) + '...[truncated]';
}

/**
 * Clear screen
 */
function clearScreen() {
  process.stdout.write('\x1b[2J\x1b[0f');
}

/**
 * Draw a box around text
 */
function drawBox(title, width = 80) {
  const horizontal = '─'.repeat(width);
  console.log(colorize('╔' + horizontal + '╗', colors.cyan));
  
  const centeredTitle = ` ${title} `;
  const padding = Math.floor((width - centeredTitle.length) / 2);
  const titleLine = ' '.repeat(padding) + centeredTitle + ' '.repeat(width - padding - centeredTitle.length);
  console.log(colorize('║' + titleLine + '║', colors.cyan));
  
  console.log(colorize('╚' + horizontal + '╝', colors.cyan));
}

/**
 * Sleep helper function
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Find recorder file in output directory
 */
function findRecorderFile(outputDir) {
  if (!outputDir) {
    throw new Error('Output directory not specified. Use -o or --output option.');
  }

  const recorderFile = path.join(outputDir, 'BeamerAgent.record.json');
  
  if (!fs.existsSync(recorderFile)) {
    throw new Error(`Recorder file not found: ${recorderFile}`);
  }

  return recorderFile;
}

/**
 * Load recorder from file
 */
async function loadRecorder(outputDir) {
  const recorderFile = findRecorderFile(outputDir);
  const recorder = new AgentRecorder(outputDir, 'BeamerAgent');
  await recorder.load();
  return recorder;
}

// ============================================================================
// Interactive Mode
// ============================================================================

class InteractiveMode {
  constructor(outputDir) {
    this.outputDir = outputDir;
    this.recorder = null;
    this.taskQueue = [];
    this.selectedIndex = 0;
    this.filterStatus = null;
    this.filterText = '';
    this.running = true;
    this.rl = null;
    this.lastReloaded = null;
  }

  async init() {
    try {
      this.recorder = await loadRecorder(this.outputDir);
      this.taskQueue = this.recorder.getTaskQueue();
      this.lastReloaded = new Date();
      return true;
    } catch (error) {
      log.error(error.message);
      return false;
    }
  }

  async reloadData() {
    try {
      const oldTaskCount = this.taskQueue.length;
      this.recorder = await loadRecorder(this.outputDir);
      this.taskQueue = this.recorder.getTaskQueue();
      this.lastReloaded = new Date();
      
      const newTaskCount = this.taskQueue.length;
      const diff = newTaskCount - oldTaskCount;
      
      if (diff > 0) {
        log.success(`Reloaded: +${diff} new task(s)`);
      } else if (diff < 0) {
        log.warn(`Reloaded: ${diff} task(s) removed`);
      } else {
        log.info('Reloaded: no changes');
      }
      
      return true;
    } catch (error) {
      log.error('Reload failed:', error.message);
      return false;
    }
  }

  getFilteredTasks() {
    return this.taskQueue.filter((task, index) => {
      // Apply status filter
      if (this.filterStatus && task.status !== this.filterStatus) {
        return false;
      }
      // Apply text filter
      if (this.filterText) {
        const searchText = this.filterText.toLowerCase();
        const taskName = (task.task || '').toLowerCase();
        const hasText = taskName.includes(searchText);
        if (!hasText) return false;
      }
      return true;
    });
  }

  drawHeader() {
    clearScreen();
    drawBox('📊 BeamerAgent Recorder - Interactive Mode');
    console.log();
    console.log(colorize(`  Output: ${this.outputDir}`, colors.dim));
    console.log(colorize(`  Total Tasks: ${this.taskQueue.length}`, colors.dim));
    if (this.lastReloaded) {
      console.log(colorize(`  Last Reloaded: ${this.lastReloaded.toLocaleTimeString()}`, colors.dim));
    }

    const statusCounts = this.taskQueue.reduce((acc, task) => {
      acc[task.status] = (acc[task.status] || 0) + 1;
      return acc;
    }, {});

    console.log(colorize(`  Status: `, colors.dim) +
      Object.entries(statusCounts)
        .map(([s, c]) => formatStatus(s) + colorize(` ${c}`, colors.dim))
        .join('  ')
    );
    console.log();
  }

  drawHelp() {
    console.log(colorize('  Navigation:', colors.cyan));
    console.log(colorize('    ↑/↓ or k/j  - Move selection', colors.dim));
    console.log(colorize('    Enter       - View task details (press any key to return)', colors.dim));
    console.log(colorize('    f           - Filter by status', colors.dim));
    console.log(colorize('    /           - Search by task name', colors.dim));
    console.log(colorize('    r           - Reset filters', colors.dim));
    console.log(colorize('    R           - Reload recorder data', colors.dim));
    console.log(colorize('    x           - Delete selected task', colors.dim));
    console.log(colorize('    s           - Show statistics', colors.dim));
    console.log(colorize('    e           - Export menu (JSON/CSV/Markdown)', colors.dim));
    console.log(colorize('    h           - Toggle this help', colors.dim));
    console.log(colorize('    q           - Quit', colors.dim));
    console.log();
  }

  drawTaskList() {
    const filtered = this.getFilteredTasks();
    const maxVisible = 15;

    // Calculate visible range
    let start = Math.max(0, this.selectedIndex - Math.floor(maxVisible / 2));
    let end = Math.min(filtered.length, start + maxVisible);

    if (end - start < maxVisible) {
      start = Math.max(0, end - maxVisible);
    }

    // Draw header
    console.log(colorize('  ' + '─'.repeat(78), colors.cyan));
    console.log(colorize('  ', colors.cyan) + colorize('Idx'.padEnd(5), colors.bright) +
                colorize('Task Name'.padEnd(35), colors.bright) +
                colorize('Status'.padEnd(18), colors.bright) +
                colorize('Timestamp', colors.bright));
    console.log(colorize('  ' + '─'.repeat(78), colors.cyan));

    // Draw tasks
    for (let i = start; i < end; i++) {
      const { task, originalIndex } = this.getFilteredTaskWithIndex(i);
      const isSelected = i === this.selectedIndex;

      if (!task) continue;

      const taskName = (task.task || 'Unknown').padEnd(35);
      const status = formatStatus(task.status).padEnd(18);
      const timestamp = formatTimestamp(task.timestamp).substring(0, 17);

      let line = `  ${String(originalIndex).padEnd(5)}${taskName}${status}${timestamp}`;

      if (isSelected) {
        line = colorize('  ▶ ' + '─'.repeat(75), colors.yellow);
        console.log(line);
        line = colorize('    ', colors.yellow) +
               colorize(String(originalIndex).padEnd(5), colors.bright) +
               colorize(taskName, colors.bright) +
               status + timestamp;
        console.log(line);
        line = colorize('  ◀ ' + '─'.repeat(75), colors.yellow);
        console.log(line);
      } else {
        console.log(line);
      }
    }

    if (filtered.length === 0) {
      console.log(colorize('  No tasks match the current filters.', colors.yellow));
    }

    console.log(colorize('  ' + '─'.repeat(78), colors.cyan));
    console.log();
  }

  drawFilterInfo() {
    if (this.filterStatus || this.filterText) {
      console.log(colorize('  Active Filters:', colors.yellow));
      if (this.filterStatus) {
        console.log(colorize(`    Status: ${this.filterStatus}`, colors.dim));
      }
      if (this.filterText) {
        console.log(colorize(`    Search: "${this.filterText}"`, colors.dim));
      }
      console.log();
    }
  }

  async showTaskDetail(index) {
    const { task, originalIndex } = this.getFilteredTaskWithIndex(index);

    if (!task) return;

    clearScreen();
    drawBox('Task Details');
    console.log();

    console.log(colorize(`  Task:`, colors.bright) + ` ${task.task || 'Unknown'}`);
    console.log(colorize(`  Index:`, colors.bright) + ` ${originalIndex}`);
    console.log(colorize(`  Status:`, colors.bright) + ` ${formatStatus(task.status)}`);
    console.log(colorize(`  Timestamp:`, colors.bright) + ` ${formatTimestamp(task.timestamp)}`);
    if (task.duration) {
      console.log(colorize(`  Duration:`, colors.bright) + ` ${task.duration}ms`);
    }

    if (task.error_message) {
      console.log();
      console.log(colorize('  Error:', colors.bgRed + colors.bright));
      console.log(colorize(`    ${task.error_message}`, colors.red));
    }

    // Show inputs
    if (task.inputs && Object.keys(task.inputs).length > 0) {
      console.log();
      console.log(colorize('  Inputs:', colors.bright));
      for (const [key, value] of Object.entries(task.inputs)) {
        console.log(colorize(`    ${key}:`, colors.dim) + ` ${truncate(value, 150)}`);
      }
    }

    // Show outputs
    if (task.outputs && Object.keys(task.outputs).length > 0) {
      console.log();
      console.log(colorize('  Outputs:', colors.bright));
      for (const [key, value] of Object.entries(task.outputs)) {
        if (typeof value === 'object') {
          console.log(colorize(`    ${key}:`, colors.dim) + ` ${JSON.stringify(value).substring(0, 200)}`);
        } else {
          console.log(colorize(`    ${key}:`, colors.dim) + ` ${truncate(value, 150)}`);
        }
      }
    }

    console.log();
    console.log(colorize('  Press any key to return...', colors.dim));

    await this.waitForKeypress();
  }

  async showStatistics() {
    clearScreen();
    drawBox('Recorder Statistics');
    console.log();

    const data = this.recorder.data;
    const totalDuration = data.lastUpdated - data.startTime;

    console.log(colorize(`  Agent:`, colors.bright) + ` ${data.agentName}`);
    console.log(colorize(`  Duration:`, colors.bright) + ` ${(totalDuration / 1000).toFixed(2)}s`);
    console.log(colorize(`  Total Tasks:`, colors.bright) + ` ${this.taskQueue.length}`);

    const statusCounts = this.taskQueue.reduce((acc, task) => {
      acc[task.status] = (acc[task.status] || 0) + 1;
      return acc;
    }, {});

    console.log();
    console.log(colorize('  Status Breakdown:', colors.bright));
    for (const [status, count] of Object.entries(statusCounts)) {
      const percentage = ((count / this.taskQueue.length) * 100).toFixed(1);
      console.log(`    ${formatStatus(status)}: ${count} (${percentage}%)`);
    }

    // Duration stats
    const tasksWithDuration = this.taskQueue.filter(t => t.duration);
    if (tasksWithDuration.length > 0) {
      const durations = tasksWithDuration.map(t => t.duration);
      const avg = durations.reduce((a, b) => a + b, 0) / durations.length;
      const min = Math.min(...durations);
      const max = Math.max(...durations);

      console.log();
      console.log(colorize('  Duration Stats:', colors.bright));
      console.log(`    Total: ${durations.reduce((a, b) => a + b, 0)}ms`);
      console.log(`    Average: ${avg.toFixed(0)}ms`);
      console.log(`    Min: ${min}ms | Max: ${max}ms`);
    }

    console.log();
    console.log(colorize('  [Auto-returning...]', colors.dim));
    await sleep(1500);
  }

  async showExportMenu() {
    clearScreen();
    drawBox('Export Options');
    console.log();
    console.log(colorize('  Select export format:', colors.bright));
    console.log();
    console.log(colorize('    1', colors.cyan) + ' - JSON');
    console.log(colorize('    2', colors.cyan) + ' - CSV');
    console.log(colorize('    3', colors.cyan) + ' - Markdown');
    console.log(colorize('    q', colors.cyan) + ' - Cancel');
    console.log();

    const choice = await this.prompt('  Choice: ');

    const formats = { '1': 'json', '2': 'csv', '3': 'markdown' };
    if (formats[choice]) {
      const format = formats[choice];
      const outputPath = `${this.outputDir}/recorder-export.${format}`;

      try {
        await this.exportData(format, outputPath);
        console.log(colorize(`\n  ✓ Exported to: ${outputPath}`, colors.green));
      } catch (error) {
        console.log(colorize(`\n  ✗ Export failed: ${error.message}`, colors.red));
      }

      console.log(colorize('\n  [Auto-returning...]', colors.dim));
      await sleep(1000);
    }
  }

  async exportData(format, outputPath) {
    const data = this.recorder.data;
    let content;
    
    switch (format) {
      case 'json':
        content = JSON.stringify(data, null, 2);
        break;
      case 'csv':
        const headers = ['index', 'task', 'status', 'timestamp', 'duration', 'error_message'];
        const rows = this.taskQueue.map((task, index) => ({
          index,
          task: task.task || '',
          status: task.status || '',
          timestamp: new Date(task.timestamp || 0).toISOString(),
          duration: task.duration || '',
          error_message: (task.error_message || '').replace(/[\n\r,]/g, ' ')
        }));
        content = [headers.join(','), ...rows.map(row => 
          headers.map(h => `"${row[h] || ''}"`).join(',')
        )].join('\n');
        break;
      case 'markdown':
        content = `# BeamerAgent Recorder Export\n\n`;
        content += `## Overview\n`;
        content += `- **Agent**: ${data.agentName}\n`;
        content += `- **Total Tasks**: ${this.taskQueue.length}\n\n`;
        content += `## Task Summary\n\n`;
        content += '| # | Task | Status | Timestamp |\n';
        content += '|---|------|--------|-----------|\n';
        this.taskQueue.forEach((task, index) => {
          content += `| ${index} | ${task.task || 'Unknown'} | ${task.status || 'N/A'} | ${formatTimestamp(task.timestamp)} |\n`;
        });
        break;
    }
    
    fs.writeFileSync(outputPath, content, 'utf-8');
  }

  async filterByStatus() {
    clearScreen();
    drawBox('Filter by Status');
    console.log();
    console.log(colorize('  Select status filter:', colors.bright));
    console.log();
    console.log(colorize('    a', colors.cyan) + ' - All (no filter)');
    console.log(colorize('    s', colors.cyan) + ' - Succeed');
    console.log(colorize('    f', colors.cyan) + ' - Failed');
    console.log(colorize('    e', colors.cyan) + ' - Error');
    console.log(colorize('    r', colors.cyan) + ' - Running');
    console.log(colorize('    p', colors.cyan) + ' - Pending');
    console.log(colorize('    q', colors.cyan) + ' - Cancel');
    console.log();
    
    const choice = await this.prompt('  Choice: ');
    
    const statusMap = {
      'a': null,
      's': 'succeed',
      'f': 'failed',
      'e': 'error',
      'r': 'running',
      'p': 'pending'
    };
    
    if (choice in statusMap) {
      this.filterStatus = statusMap[choice];
      this.selectedIndex = 0;
    }
  }

  async searchByName() {
    const search = await this.prompt(colorize('  Search: ', colors.cyan));
    this.filterText = search.trim();
    this.selectedIndex = 0;
  }

  async resetFilters() {
    this.filterStatus = null;
    this.filterText = '';
    this.selectedIndex = 0;
  }

  async deleteTask(index) {
    const filtered = this.getFilteredTasks();
    
    if (index < 0 || index >= filtered.length) {
      log.warn('No task selected');
      return;
    }

    // Get both the task and its original index
    const { task: taskToDelete, originalIndex } = this.getFilteredTaskWithIndex(index);
    
    if (!taskToDelete) {
      log.warn('No task selected');
      return;
    }

    const taskName = taskToDelete.task || 'Unknown';

    // Show confirmation dialog
    clearScreen();
    drawBox('Delete Task');
    console.log();
    console.log(colorize('  Are you sure you want to delete this task?', colors.yellow));
    console.log();
    console.log(colorize(`  Task:`, colors.bright) + ` ${taskName}`);
    console.log(colorize(`  Index:`, colors.bright) + ` ${originalIndex}`);
    console.log(colorize(`  Status:`, colors.bright) + ` ${formatStatus(taskToDelete.status)}`);
    console.log();
    console.log(colorize('  This will modify the recorder file.', colors.dim));
    console.log();
    console.log(colorize('  Press Y to confirm, any other key to cancel: ', colors.yellow));

    const confirm = await this.waitForKeypress();

    if (confirm.toString().toLowerCase() === 'y') {
      // Remove from task queue
      this.taskQueue.splice(originalIndex, 1);

      // Update recorder data
      this.recorder.data.task_queue = this.taskQueue;
      this.recorder.data.lastUpdated = Date.now();

      // Save to file
      try {
        await this.recorder.save();
        log.success('Task deleted');

        // Adjust selection index
        if (this.selectedIndex >= this.taskQueue.length) {
          this.selectedIndex = Math.max(0, this.taskQueue.length - 1);
        }
      } catch (error) {
        log.error('Failed to save:', error.message);
      }
    } else {
      log.info('Delete cancelled');
    }

    // Brief pause to show result message
    await sleep(500);
  }

  /**
   * Get a task from filtered list with its original index
   */
  getFilteredTaskWithIndex(filteredIndex) {
    let count = 0;
    
    for (let i = 0; i < this.taskQueue.length; i++) {
      const task = this.taskQueue[i];
      
      // Apply status filter
      if (this.filterStatus && task.status !== this.filterStatus) {
        continue;
      }
      
      // Apply text filter
      if (this.filterText) {
        const searchText = this.filterText.toLowerCase();
        const taskName = (task.task || '').toLowerCase();
        if (!taskName.includes(searchText)) {
          continue;
        }
      }
      
      // Found the nth matching task
      if (count === filteredIndex) {
        return { task, originalIndex: i };
      }
      count++;
    }
    
    return { task: null, originalIndex: -1 };
  }

  async prompt(text) {
    return new Promise((resolve) => {
      this.rl.question(text, (answer) => {
        resolve(answer);
      });
    });
  }

  async waitForKeypress() {
    return new Promise((resolve) => {
      const stdin = process.stdin;
      // Keep raw mode enabled, just wait for a single key
      stdin.once('data', (key) => {
        resolve(key);
      });
    });
  }

  async handleInput(key) {
    const filtered = this.getFilteredTasks();
    
    switch (key.toString()) {
      case '\u0003': // Ctrl+C
      case 'q':
        this.running = false;
        break;
        
      case '\u001b[A': // Up arrow
      case 'k':
        if (this.selectedIndex > 0) this.selectedIndex--;
        break;
        
      case '\u001b[B': // Down arrow
      case 'j':
        if (this.selectedIndex < filtered.length - 1) this.selectedIndex++;
        break;
        
      case '\r': // Enter
        if (filtered.length > 0) {
          await this.showTaskDetail(this.selectedIndex);
        }
        break;
        
      case 'f':
        await this.filterByStatus();
        break;
        
      case '/':
        await this.searchByName();
        break;

      case 'r':
        await this.resetFilters();
        break;

      case 'R':
        await this.reloadData();
        break;

      case 'x':
        if (filtered.length > 0) {
          await this.deleteTask(this.selectedIndex);
        }
        break;

      case 's':
        await this.showStatistics();
        break;
        
      case 'e':
        await this.showExportMenu();
        break;
        
      case 'h':
        this.showHelp = !this.showHelp;
        break;
    }
  }

  async run() {
    if (!await this.init()) {
      return;
    }

    this.rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });

    // Set up raw mode for keyboard input
    process.stdin.setRawMode(true);
    process.stdin.resume();

    process.stdin.on('data', async (key) => {
      try {
        await this.handleInput(key);

        if (!this.running) {
          process.stdin.setRawMode(false);
          process.stdin.pause();
          this.rl.close();
          clearScreen();
          console.log(colorize('Goodbye!', colors.cyan));
          process.exit(0);
        } else {
          this.drawHeader();
          this.drawFilterInfo();
          if (this.showHelp !== false) {
            this.drawHelp();
          }
          this.drawTaskList();
        }
      } catch (error) {
        // Handle errors gracefully without exiting
        log.error('Error:', error.message);
        console.log(colorize('\nPress any key to continue...', colors.yellow));
        
        // Wait for a key press then redraw
        process.stdin.once('data', () => {
          this.drawHeader();
          this.drawFilterInfo();
          if (this.showHelp !== false) {
            this.drawHelp();
          }
          this.drawTaskList();
        });
      }
    });

    // Initial draw
    this.drawHeader();
    this.drawFilterInfo();
    this.drawHelp();
    this.drawTaskList();
  }
}

// ============================================================================
// CLI Commands
// ============================================================================

program
  .name('recorder-cli')
  .description('Interactive CLI for viewing and managing BeamerAgent recorder files')
  .version('1.0.0');

// ----------------------------------------------------------------------------
// Default interactive command - Launch interactive TUI mode
// ----------------------------------------------------------------------------
program
  .argument('[output]', 'Output directory containing the recorder file')
  .option('-o, --output <dir>', 'Output directory containing the recorder file')
  .description('Launch interactive terminal user interface (default command)')
  .action(async (output, options) => {
    const outputDir = output || options.output;
    
    if (!outputDir) {
      console.error('Error: Output directory is required.');
      console.error('');
      console.error('Usage:');
      console.error('  recorder-cli <output-directory>');
      console.error('  recorder-cli -o <output-directory>');
      console.error('');
      console.error('Examples:');
      console.error('  recorder-cli output/my-presentation');
      console.error('  recorder-cli -o output/main.tex');
      console.error('');
      process.exit(1);
    }
    
    const interactive = new InteractiveMode(outputDir);
    await interactive.run();
  });

// Parse and execute
program.parse(process.argv);

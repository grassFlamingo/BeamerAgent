import { log } from '../../utils/logger.js';

export const RoutingType = {
  LINEAR: 'linear',
  LOOP: 'loop',
  BRANCH: 'branch',
  EXIT: 'exit'
};

export class TaskRouter {
  constructor() {
    this.graph = new Map();
    this.context = {};
  }

  resetContext() {
    this.context = {
      iteration: 0,
      slideIndex: 1,
      slideLatexes: [],
      validatedSlides: [],
      retryCount: 0,
      fixRetryCount: 0,
      templateBuilder: null
    };
  }

  setContext(updates) {
    this.context = { ...this.context, ...updates };
  }

  addLinear(taskName, nextTaskName) {
    this.graph.set(taskName, {
      type: RoutingType.LINEAR,
      next: nextTaskName
    });
  }

  addLoop(taskName, nextTaskName, checkEnd, exitTaskName) {
    this.graph.set(taskName, {
      type: RoutingType.LOOP,
      next: nextTaskName,
      until: checkEnd,
      exit: exitTaskName
    });
  }

  addBranch(taskName, branchFn) {
    this.graph.set(taskName, {
      type: RoutingType.BRANCH,
      branch: branchFn
    });
  }

  addExit(taskName) {
    this.graph.set(taskName, {
      type: RoutingType.EXIT
    });
  }

  buildDefaultGraph() {
    this.resetContext();

    this.addLinear('LatexSimplifyTask', 'PlanMakeTask');
    this.addLinear('PlanMakeTask', 'WriteSingleSlideTask');

    this.addLoop(
      'WriteSingleSlideTask',
      'CompileSlideTask',
      () => false,
      null
    );

    this.addLinear('CompileSlideTask', 'FixLatexErrorTask');
    this.addLinear('FixLatexErrorTask', 'ExtractSlideImageTask');
    this.addLinear('ExtractSlideImageTask', 'ValidateVisionTask');

    this.addBranch('ValidateVisionTask', (output, ctx) => {
      if (!output.isApproved && ctx.retryCount < 3) {
        ctx.retryCount++;
        return [{ taskName: 'WriteSingleSlideTask', input: { ...ctx.currentInput, feedback: output.feedback, retryCount: ctx.retryCount, templateBuilder: ctx.templateBuilder } }];
      }
      return [{ taskName: 'ValidateTextTask', input: { ...ctx.currentInput, visionResult: output.visionResult } }];
    });

    this.addBranch('ValidateTextTask', (output, ctx) => {
      if (!output.isApproved && ctx.retryCount < 3) {
        ctx.retryCount++;
        return [{ taskName: 'WriteSingleSlideTask', input: { ...ctx.currentInput, feedback: output.feedback, retryCount: ctx.retryCount, templateBuilder: ctx.templateBuilder } }];
      }
      return [{ taskName: 'UpdatePlanTask', input: { ...ctx.currentInput, textApproval: output } }];
    });

    this.addBranch('UpdatePlanTask', (output, ctx) => {
      ctx.slideIndex++;
      ctx.retryCount = 0;
      ctx.validatedSlides.push(output.validatedSlide);

      if (!output.isLastSlide) {
        return [{ taskName: 'WriteSingleSlideTask', input: { ...ctx.currentInput, slideIndex: ctx.slideIndex, templateBuilder: ctx.templateBuilder } }];
      }

      ctx.slideLatexes = output.allSlideLatexes;
      return [{ taskName: 'WriteFullPresentationTask', input: { plan: output.plan } }];
    });
    
    this.addLinear('WriteFullPresentationTask', 'CompileFullTask');
    
    this.addBranch('CompileFullTask', (output, ctx) => {
      if (!output.success) {
        if (ctx.fixRetryCount < 3) {
          ctx.fixRetryCount++;
          return [{ taskName: 'FixLatexErrorTask', input: { latexContent: ctx.fullBeamerContent, error: output.error, retryCount: ctx.fixRetryCount } }];
        }
        return [{ taskName: null, input: null, error: 'Failed to fix LaTeX after 3 attempts' }];
      }
      return [{ taskName: '__COMPLETE__', input: { pdfPath: output.pdfPath, plan: ctx.plan } }];
    });
    
    this.addBranch('FixLatexErrorTask', (output, ctx) => {
      if (output.fixed && ctx.fixRetryCount < 3) {
        ctx.fixRetryCount++;
        return [{ taskName: ctx.lastCompileTask, input: { ...ctx.lastCompileInput, latexContent: output.fixedContent } }];
      }
      return [{ taskName: null, input: null, error: 'Failed to fix LaTeX after 3 attempts' }];
    });
  }

  getNext(taskName, output, context = {}) {
    const node = this.graph.get(taskName);
    if (!node) {
      log.warn(`No routing found for task: ${taskName}`);
      return [];
    }

    this.setContext(context);

    switch (node.type) {
      case RoutingType.LINEAR:
        return [{ taskName: node.next, input: this._buildInput(node.next, output, this.context) }];

      case RoutingType.LOOP:
        if (node.until && node.until(output, this.context)) {
          return node.exit 
            ? [{ taskName: node.exit, input: this._buildInput(node.exit, output, this.context) }]
            : [];
        }
        return [{ taskName: node.next, input: this._buildInput(node.next, output, this.context) }];

      case RoutingType.BRANCH:
        return node.branch(output, this.context);

      case RoutingType.EXIT:
        return [];

      default:
        return [];
    }
  }

  _buildInput(taskName, output, context) {
    const baseInput = { ...context.currentInput };

    switch (taskName) {
      case 'WriteSingleSlideTask':
        return {
          plan: context.plan || output.plan,
          slideIndex: context.slideIndex || 1,
          feedback: output.feedback,
          retryCount: context.retryCount || 0,
          templateBuilder: context.templateBuilder || null
        };
      
      case 'CompileTask':
        context.lastCompileTask = 'CompileTask';
        context.lastCompileInput = { latexContent: output.slideLatex, type: 'single' };
        return { latexContent: output.slideLatex, type: 'single' };
      
      case 'CompileFullTask':
        context.lastCompileTask = 'CompileFullTask';
        context.lastCompileInput = { latexContent: output.beamerContent, type: 'full' };
        context.fullBeamerContent = output.beamerContent;
        return { latexContent: output.beamerContent, type: 'full' };
      
      case 'ProcessSlidesTask':
        return { pdfPath: output.pdfPath, type: output.type || 'single' };
      
      case 'ValidateVisionTask':
        return { 
          pageImage: output.pageImage, 
          slidePlan: context.plan?.slides?.[context.slideIndex - 1],
          retryCount: context.retryCount || 0
        };
      
      case 'ValidateTextTask':
        return {
          slideLatex: context.currentSlideLatex || output.slideLatex,
          slidePlan: context.plan?.slides?.[context.slideIndex - 1],
          visionResult: output.visionResult
        };
      
      case 'UpdatePlanTask':
        return {
          plan: context.plan,
          slideIndex: context.slideIndex,
          validatedContent: output,
          retryCount: context.retryCount
        };
      
      case 'FixLatexErrorTask':
        return {
          latexContent: context.lastCompileInput?.latexContent || output.latexContent,
          error: output.error,
          retryCount: context.fixRetryCount || 0
        };
      
      default:
        return { ...output, ...context };
    }
  }

  getGraph() {
    return this.graph;
  }

  printGraph() {
    log.info('=== Task Flow Graph ===');
    for (const [taskName, node] of this.graph) {
      switch (node.type) {
        case RoutingType.LINEAR:
          log.info(`${taskName} -> ${node.next}`);
          break;
        case RoutingType.LOOP:
          log.info(`${taskName} -> ${node.next} (loop until ${node.until?.toString()}) -> ${node.exit || 'exit'}`);
          break;
        case RoutingType.BRANCH:
          log.info(`${taskName} -> [branch]`);
          break;
        case RoutingType.EXIT:
          log.info(`${taskName} -> [exit]`);
          break;
      }
    }
  }
}

export default TaskRouter;

import Task from './Task.js';
import { log } from '../../utils/logger.js';

export class UpdatePlanTask extends Task {
  static get name() {
    return 'UpdatePlanTask';
  }

  static get inputSchema() {
    return {
      plan: { type: 'object', required: true },
      slideIndex: { type: 'number', required: true },
      validatedContent: { type: 'object', required: true },
      retryCount: { type: 'number', required: false }
    };
  }

  static get outputSchema() {
    return {
      plan: { type: 'object' },
      validatedSlide: { type: 'object' },
      isLastSlide: { type: 'boolean' },
      nextSlideIndex: { type: 'number' },
      allSlideLatexes: { type: 'array' }
    };
  }

  async execute(input) {
    const { plan, slideIndex, validatedContent, retryCount = 0, slideLatexes = [] } = input;
    const slides = plan.slides || [];
    
    log.info(`Updating plan for slide ${slideIndex}/${slides.length}`);

    const validatedSlide = {
      slideNumber: slideIndex,
      title: slides[slideIndex - 1]?.title || `Slide ${slideIndex}`,
      content: validatedContent,
      validatedAt: new Date().toISOString()
    };

    let updatedPlan = plan;
    
    if (retryCount >= 2) {
      log.info(`Slide ${slideIndex} required ${retryCount} retries - updating plan`);
      updatedPlan = this._updateSlideInPlan(plan, slideIndex, validatedContent);
    }

    const isLastSlide = slideIndex >= slides.length;
    const nextSlideIndex = isLastSlide ? slideIndex : slideIndex + 1;

    const currentSlideLatex = validatedContent.slideLatex || '';
    const allSlideLatexes = [...slideLatexes, currentSlideLatex];

    log.success(`Plan updated. Slide ${slideIndex}/${slides.length} ${isLastSlide ? 'COMPLETE' : '→ next'}`);

    return {
      plan: updatedPlan,
      validatedSlide,
      isLastSlide,
      nextSlideIndex,
      allSlideLatexes
    };
  }

  _updateSlideInPlan(plan, slideIndex, validatedContent) {
    const updatedPlan = { ...plan };
    updatedPlan.slides = [...(plan.slides || [])];
    
    if (updatedPlan.slides[slideIndex - 1]) {
      updatedPlan.slides[slideIndex - 1] = {
        ...updatedPlan.slides[slideIndex - 1],
        validated: true,
        validationCount: (updatedPlan.slides[slideIndex - 1].validationCount || 0) + 1,
        finalContent: validatedContent
      };
    }
    
    return updatedPlan;
  }
}

export default UpdatePlanTask;

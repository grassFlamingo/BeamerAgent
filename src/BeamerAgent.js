import fs from 'fs';
import path from 'path';
import { AgentRecorder } from './utils/agentRecorder.js';
import { log } from './utils/logger.js';

import CompileTask from './tasks/CompileTask.js';
import { CreateTemplateTask } from './tasks/CreateTemplateTask.js';
import ExtractSlideImageTask from './tasks/ExtractSlideImageTask.js';
import FixLatexErrorTask from './tasks/FixLatexErrorTask.js';
import GenerateSkeletonSlidesTask from './tasks/GenerateSkeletonSlidesTask.js';
import LatexAnalyzerTask from './tasks/LatexAnalyzerTask.js';
import LatexCopyTask from './tasks/LatexCopyTask.js';
import ValidateVisionSlideTask from './tasks/ValidateVisionSlideTask.js';
import ValidateTextAlignmentTask from './tasks/ValidateTextAlignmentTask.js';
import ValidateFrameAlignmentTask from './tasks/ValidateFrameAlignmentTask.js';
import { WriteSingleSlideTask } from './tasks/WriteSingleSlideTask.js';
import RefineFullPresentationTask from './tasks/RefineFullPresentationTask.js';
import BeamerTemplateBuilder from './utils/BeamerBuilderWithTemplate.js';
import LatexUtils from './utils/latexUtils.js';
import TexResourcesTool from './llm_tools/TexResourcesTool.js';


// A helper to auto-cache task outputs, reads from cache if exists
async function _cachedExecute(task, cacheDir, cacheKey, input) {
  const cacheFile = path.join(cacheDir, `${cacheKey}.json`);
  
  // Try to read from cache
  if (fs.existsSync(cacheFile)) {
    try {
      const cached = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
      log.info(`Cache hit for ${cacheKey}`);
      return cached;
    } catch (error) {
      log.warn(`Failed to read cache for ${cacheKey}: ${error.message}`);
    }
  }
  
  // Execute task and cache result
  log.info(`Executing task: ${cacheKey}`);
  const result = await task.execute(input);
  
  // Cache the result
  try {
    fs.writeFileSync(cacheFile, JSON.stringify(result, null, 2));
    log.success(`Cached result for ${cacheKey}`);
  } catch (error) {
    log.warn(`Failed to cache result for ${cacheKey}: ${error.message}`);
  }
  
  return result;
}

export default class BeamerAgent {
  constructor(inputPath, outputDir = null, options = {}) {
    this.log = log.create('BeamerAgent');
    this.validateDependencies();

    if (!fs.existsSync(inputPath)) {
      throw new Error(`Input path ${inputPath} does not exist`);
    }

    if (!outputDir) {
      outputDir = path.join('./output', path.basename(inputPath));
    }

    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    this.recorder = new AgentRecorder(outputDir, 'BeamerAgent');
    this.inputPath = inputPath;
    this.outputDir = outputDir;
    this.previousPlanForComparison = null; // For tracking plan changes during revision
    
    // Configuration
    this.config = {
      maxSlideRetries: options.maxSlideRetries ?? 8  // Default 8 retries per slide
    };

  }


  async start() {
    const startTime = Date.now();

    try {
      // this.log.info('=== Step 1: Copy LaTeX ===');
      this.latex_copy = await this.runLatexCopy();

      // this.log.info('=== Step 2: Compile Init ===');
      await this.runCompileInit(this.latex_copy);

      this.log.info('=== Step 3: Analyze LaTeX ===');
      this.analyzer_results = await this.runLatexAnalyzer(this.latex_copy);
      this.tex_resources = new TexResourcesTool({
        cacheDir: this.outputDir,
        analysisResult: this.analyzer_results,
      });

      this.log.info('=== Step 4: Create Compile Template ===');
      this.tex_template = await this.runCreateCompileTemplate(
        this.analyzer_results.preamble);

      this.log.info('=== Step 5: Generate Skeleton Slides ===');
      this.slide_plans = await this.runGenerateSkeletonSlides(
        this.analyzer_results,
        this.tex_resources,
      );

      this.log.info(`=== Step 6: Process ${this.slide_plans.length} Slides ===`);
      
      // Process slides with automatic plan revision on failure (max 2 revision passes)
      const MAX_REVISION_PASSES = 2;
      let revisionCount = 0;
      let result = await this.processSlidesOnebyOneWithRevision(
        this.analyzer_results, 
        this.slide_plans, 
        this.tex_resources
      );
      
      // If plan was revised, the method already re-processed internally
      // If still revised after internal re-processing, try up to MAX_REVISION_PASSES
      while (result.revised && revisionCount < MAX_REVISION_PASSES) {
        revisionCount++;
        this.log.info(`=== External revision pass ${revisionCount}/${MAX_REVISION_PASSES} ===`);
        this.slide_plans = result.slides;
        result = await this.processSlidesOnebyOneWithRevision(
          this.analyzer_results,
          this.slide_plans,
          this.tex_resources,
          true  // isRevisionPass = true
        );
      }
      
      // If still revised after max passes, log warning but continue with what we have
      if (result.revised) {
        this.log.warn(`Plan still has issues after ${MAX_REVISION_PASSES} revisions. Proceeding with available slides...`);
        this.log.warn('Consider manually reviewing the slide plan and fixing issues.');
      }
      
      const validatedSlides = result.validatedSlides || [];
      
      // Ensure we have valid slides to write
      if (!validatedSlides || validatedSlides.length === 0) {
        this.log.error('No valid slides generated. Cannot write presentation.');
        throw new Error('No valid slides generated');
      }

      this.log.info(`=== Writing ${validatedSlides.length} validated slides ===`);
      this.log.info('=== Step 7: Write Full Presentation ===');
      await this.writeFullPresentation(validatedSlides);

      const duration = Date.now() - startTime;
      this.log.success(`=== Completed in ${duration}ms ===`);

      return {
        success: true,
        outputDir: this.outputDir,
        duration,
        slideCount: validatedSlides.length
      };
    } catch (error) {
      this.log.error('=== Error ===', error.message);
      throw error;
      return {
        success: false,
        error: error.message,
        outputDir: this.outputDir
      };
    }
  }

  async runLatexCopy() {
    const task = new LatexCopyTask();
    const input = {
      projectDir: path.dirname(this.inputPath),
      mainFile: this.inputPath,
      cacheDir: this.outputDir,
      cleanCompiled: true,
      cleanTex: true,
      createExpanded: true
    };
    // const result = await task.execute(input);
    const result = await _cachedExecute(task, this.outputDir, 'LatexCopyTask', input);
    return result;
  }

  async runCompileInit(latex_copy) {
    const mainFile = latex_copy.mainFile;
    const mainFilePath = path.join(this.outputDir, path.basename(mainFile));

    const task = new CompileTask();
    // const result = await task.execute({
    //   mainFile: mainFilePath,
    //   withBibliography: true
    // });
    const result = await _cachedExecute(task, this.outputDir, 'CompileTask', {
      mainFile: mainFilePath,
      withBibliography: true,
    })
    return result;
  }

  async runLatexAnalyzer(latex_copy) {
    let expandedFilePath;
    if (latex_copy.expandedMainFile) {
      expandedFilePath = path.join(this.outputDir, path.basename(latex_copy.expandedMainFile));
    } else {
      expandedFilePath = path.join(this.outputDir, path.basename(latex_copy.mainFile));
    }

    const input = {
      mainFile: expandedFilePath,
      expandedMainFile: expandedFilePath,
      extractContent: true
    };

    const task = new LatexAnalyzerTask();
    const result = await _cachedExecute(task, this.outputDir, 'LatexAnalyzerTask', input);
    
    return result;
  }

  async runCreateCompileTemplate(articlePreamble) {
    const task = new CreateTemplateTask();

    const result = await _cachedExecute(task, this.outputDir, 'CreateCompileTemplateTask', {
      articlePreamble,
      outputDir: this.outputDir
    });
    
    this.tex_template = new BeamerTemplateBuilder(result.text);
    return this.tex_template;
  }

  async runGenerateSkeletonSlides(analysisResult, texResource) {

    const task = new GenerateSkeletonSlidesTask();
    // const result = await task.execute({
    //   analysisResult,
    //   outputDir: this.outputDir,
    // });

    const result = await _cachedExecute(task, this.outputDir, GenerateSkeletonSlidesTask.name, {
      analysisResult,
      outputDir: this.outputDir,
      texResource,
    });

    return result.slides;
  }

  /**
   * Process slides one by one with automatic plan revision on failures
   * @returns {Promise<{revised: boolean, slides?: Array, validatedSlides: Array}>}
   */
  async processSlidesOnebyOneWithRevision(analysis_results, slidePlans, texResource, isRevisionPass = false, validatedBeforeRevision = []) {
    const result = await this.processSlidesOnebyOne(analysis_results, slidePlans, texResource, isRevisionPass, validatedBeforeRevision);

    // If result is already an array (no failures), wrap it
    if (Array.isArray(result)) {
      return { revised: false, validatedSlides: result };
    }

    // Result contains revision info - re-process with new plan
    if (result.revised && result.slides) {
      this.log.info('Re-processing slides with revised plan...');
      
      // Re-process only slides that changed or come after the failed slide
      const reProcessResult = await this.processSlidesOnebyOne(
        analysis_results,
        result.slides,
        texResource,
        true,  // isRevisionPass = true, skip cache
        result.validatedSlidesBeforeFailure || []  // Keep validated slides before failure
      );
      
      // If re-processing succeeded (no more failures)
      if (Array.isArray(reProcessResult)) {
        return { revised: false, validatedSlides: reProcessResult };
      }
      
      // If still revised after re-processing, return for another iteration
      return reProcessResult;
    }

    // Result contains revision info
    return result;
  }

  /**
   * Process slides one by one
   * @param {boolean} isRevisionPass - True if this is a revision pass (skip cache)
   * @param {Array} validatedBeforeRevision - Slides validated before a failure occurred
   */
  async processSlidesOnebyOne(analysis_results, slidePlans, texResource, isRevisionPass = false, validatedBeforeRevision = []) {
    const validatedSlides = [...validatedBeforeRevision]; // Start with previously validated slides
    const failedSlides = []; // Track slides that failed for plan revision

    const single_slide_task = new WriteSingleSlideTask();
    // Store current plan for reference during slide processing
    this.currentPlan = { slides: slidePlans };

    // Start from the first unvalidated slide
    const startIndex = validatedSlides.length;

    for (let i = startIndex; i < slidePlans.length; i++) {
      const slideIndex = i + 1;
      const cacheFile = path.join(this.outputDir, `slide-${slideIndex}-validated.json`);

      // Skip cache on revision pass - regenerate slides that changed
      if (!isRevisionPass && fs.existsSync(cacheFile)) {
        try {
          const cached = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
          this.log.success(`Slide ${slideIndex} already validated, skipping (cached)`);
          validatedSlides.push(cached);
          continue;
        } catch (error) {
          this.log.warn(`Failed to read cache for slide ${slideIndex}: ${error.message}`);
        }
      } else if (isRevisionPass) {
        // Check if this slide's plan changed from the previous plan
        const previousPlan = this.previousPlanForComparison?.[i];
        const currentPlan = slidePlans[i];
        
        if (previousPlan && this._areSlidePlansIdentical(previousPlan, currentPlan)) {
          // Plan didn't change, try to use cached result if available
          if (fs.existsSync(cacheFile)) {
            try {
              const cached = JSON.parse(fs.readFileSync(cacheFile, 'utf8'));
              this.log.info(`Slide ${slideIndex}: Plan unchanged, using cached result`);
              validatedSlides.push(cached);
              continue;
            } catch (error) {
              this.log.warn(`Failed to read cache for slide ${slideIndex}: ${error.message}`);
            }
          }
        }
        
        this.log.info(`Slide ${slideIndex}: Processing with revised plan...`);
      }

      let validatedSlide;
      let lastSuccessfulTexFrame = null;
      let lastVisionFeedback = null;
      // Full history of attempts for comprehensive context
      let retryHistory = [];
      let slideFailed = false;

      for (let retryCount = 0; retryCount < this.config.maxSlideRetries; retryCount++) {
        this.log.info(`--- Processing slide ${slideIndex}/${slidePlans.length} retry ${retryCount} ---`);

        validatedSlide = await single_slide_task.execute({
          slidePlan: slidePlans[i],
          texResourcesTool: texResource,
          beamerBuilder: this.tex_template,
          outputDir: this.outputDir,
          texFrameFromLastSuccess: lastSuccessfulTexFrame,
          visionFeedback: lastVisionFeedback,
          // retryHistory: retryHistory.length > 0 ? retryHistory : null
        });

        // Track slide failure - if all retries exhausted
        if (!validatedSlide.success && retryCount >= 15) {
          slideFailed = true;
          failedSlides.push({
            slideNumber: slideIndex,
            slideTitle: slidePlans[i].title,
            error: validatedSlide.error || 'Unknown error',
            source: 'Compilation Failed'
          });
          break;
        }

        // After exec succeeds, convert the slide from PDF to PNG
        if (validatedSlide.success && validatedSlide.pdfPath) {
          const pngPath = path.join(this.outputDir, `slide-${slideIndex}.png`);
          try {
            await LatexUtils.convertPdfToImage(validatedSlide.pdfPath, pngPath, 300);
            validatedSlide.pngPath = pngPath;
            this.log.success(`Slide ${slideIndex} converted to PNG: ${pngPath}`);
          } catch (error) {
            this.log.warn(`Failed to convert slide ${slideIndex} to PNG: ${error.message}`);
          }

          // Step 1: Vision validation - validate slide appearance (overflow, visibility, layout)
          if (validatedSlide.pngPath && validatedSlide.frameContent) {
            this.log.info(`Running vision validation on slide ${slideIndex}...`);

            const visionTask = new ValidateVisionSlideTask();
            const visionResult = await visionTask.execute({
              pageImage: validatedSlide.pngPath,
              slidePlan: slidePlans[i],
              texFrame: validatedSlide.frameContent,
              retryCount
            });

            validatedSlide.visionResult = visionResult;

            this.log.info(`Vision validation result: score=${visionResult.score}, operation=${visionResult.operation}`);

            // If vision validation fails (score < 70), continue retry loop
            if (visionResult.operation === 'refine') {
              this.log.warn(`Slide ${slideIndex} needs refinement: ${visionResult.reason}`);
              this.log.debug(`Vision feedback: ${JSON.stringify(visionResult.feedback)}`);

              // Save feedback for next retry
              lastVisionFeedback = visionResult.feedback;

              // Add to history: successful compilation but failed vision
              retryHistory.push({
                retryCount,
                status: 'vision_failed',
                texFrame: validatedSlide.frameContent,
                visionResult: {
                  score: visionResult.score,
                  operation: visionResult.operation,
                  reason: visionResult.reason,
                  overflowDetails: visionResult.feedback?.overflowDetails,
                  recommendations: visionResult.feedback?.recommendations
                }
              });

              this.log.info(`Retry history: ${retryHistory.length} attempts recorded`);
              continue; // Retry with feedback
            } else {
              this.log.success(`Slide ${slideIndex} passed vision validation (score: ${visionResult.score})`);
            }

            // Step 2: Text alignment validation - check if rendered content matches original source tex
            const contentRefs = slidePlans[i]?.contentRefs || [];
            if (contentRefs.length > 0) {
              this.log.info(`Running text alignment validation on slide ${slideIndex}...`);

              // Fetch original source tex for contentRefs
              let contentRefsRawTex = [];
              const missingResources = [];
              
              for (const ref of contentRefs) {
                if (ref.uuid) {
                  const resourceDetails = texResource.handleCall({ uuid: ref.uuid });
                  if (resourceDetails && !resourceDetails.error) {
                    contentRefsRawTex.push({
                      type: resourceDetails.type,
                      uuid: resourceDetails.uuid,
                      caption: resourceDetails.caption,
                      label: resourceDetails.label,
                      latex: resourceDetails.latex,
                      text: resourceDetails.text
                    });
                  } else {
                    // Resource not found - log warning and include placeholder
                    missingResources.push(ref);
                    this.log.warn(`Resource not found for UUID ${ref.uuid} (type: ${ref.type})`);
                    // Include placeholder so vision model knows what was expected
                    contentRefsRawTex.push({
                      type: ref.type || 'unknown',
                      uuid: ref.uuid || 'unknown',
                      caption: ref.caption || 'N/A',
                      label: ref.label || 'N/A',
                      latex: 'RESOURCE NOT FOUND - UUID not available in source tex',
                      text: `Expected ${ref.type || 'resource'} with UUID ${ref.uuid || 'unknown'}`
                    });
                  }
                }
              }
              
              if (missingResources.length > 0) {
                this.log.warn(`${missingResources.length} resource(s) not found: ${missingResources.map(r => r.uuid).join(', ')}`);
              }

              if (contentRefsRawTex.length > 0) {
                const alignmentTask = new ValidateTextAlignmentTask();
                const alignmentResult = await alignmentTask.execute({
                  pageImage: validatedSlide.pngPath,
                  slidePlan: slidePlans[i],
                  texFrame: validatedSlide.frameContent,
                  contentRefsRawTex
                });

                validatedSlide.alignmentResult = alignmentResult;

                this.log.info(`Text alignment: ${alignmentResult.isAligned ? 'ALIGNED' : 'MISALIGNED'} (score: ${alignmentResult.score}/100)`);

                // If alignment validation fails (score < 70), continue retry loop
                if (!alignmentResult.isAligned) {
                  this.log.warn(`Slide ${slideIndex} needs alignment refinement: ${alignmentResult.sourceAlignment}`);
                  this.log.debug(`Alignment feedback: ${JSON.stringify(alignmentResult.sourceAlignmentDetails)}`);

                  // Add to history: successful compilation and vision but failed alignment
                  retryHistory.push({
                    retryCount,
                    status: 'alignment_failed',
                    texFrame: validatedSlide.frameContent,
                    alignmentResult: {
                      isAligned: alignmentResult.isAligned,
                      score: alignmentResult.score,
                      sourceAlignment: alignmentResult.sourceAlignment,
                      sourceAlignmentDetails: alignmentResult.sourceAlignmentDetails
                    }
                  });

                  continue; // Retry with alignment feedback
                } else {
                  this.log.success(`Slide ${slideIndex} passed text alignment validation (score: ${alignmentResult.score})`);
                }
              }
            }

            // Both validations passed - cache and break
            this.log.success(`Slide ${slideIndex} passed all validations`);

            // Cache the validated slide
            try {
              fs.writeFileSync(cacheFile, JSON.stringify(validatedSlide, null, 2));
              this.log.success(`Cached validated slide ${slideIndex}`);
            } catch (error) {
              this.log.warn(`Failed to cache validated slide ${slideIndex}: ${error.message}`);
            }

            break;
          } else {
            // Vision validation not available, but compilation succeeded
            this.log.info(`Skipping vision validation for slide ${slideIndex}`);
            break;
          }
        } else {
          // Compilation failed, save the last successful tex frame for reference
          if (validatedSlide.frameContent) {
            lastSuccessfulTexFrame = validatedSlide.frameContent;
          }
          
          // Add to history: compilation failed
          retryHistory.push({
            retryCount,
            status: 'compile_failed',
            texFrame: validatedSlide.frameContent || null,
            error: validatedSlide.error
          });
        }

      }

      // Track slide failure after all retries exhausted - FAIL FAST
      if (slideFailed || (retryHistory.length > 0 && !validatedSlide.success)) {
        // Compilation failed after all retries - stop immediately and request revision
        failedSlides.push({
          slideNumber: slideIndex,
          slideTitle: slidePlans[i].title,
          error: validatedSlide.error || 'Unknown error',
          source: 'Compilation Failed',
          retryHistory
        });
        this.log.warn(`Slide ${slideIndex} failed after ${retryHistory.length}/${this.config.maxSlideRetries} retries. Stopping to request plan revision...`);
        break; // Stop processing remaining slides
      } else if (validatedSlide.visionResult && validatedSlide.visionResult.operation === 'refine') {
        // Vision validation failed after all retries - stop immediately and request revision
        failedSlides.push({
          slideNumber: slideIndex,
          slideTitle: slidePlans[i].title,
          visionResult: validatedSlide.visionResult,
          source: 'Vision Validation Failed',
          retryHistory
        });
        this.log.warn(`Slide ${slideIndex} vision validation failed after ${retryHistory.length}/${this.config.maxSlideRetries} retries. Stopping to request plan revision...`);
        break; // Stop processing remaining slides
      } else if (validatedSlide.alignmentResult && !validatedSlide.alignmentResult.isAligned) {
        // Alignment validation failed after all retries - stop immediately and request revision
        failedSlides.push({
          slideNumber: slideIndex,
          slideTitle: slidePlans[i].title,
          alignmentResult: validatedSlide.alignmentResult,
          source: 'Text Alignment Failed',
          retryHistory
        });
        this.log.warn(`Slide ${slideIndex} alignment validation failed after ${retryHistory.length}/${this.config.maxSlideRetries} retries. Stopping to request plan revision...`);
        break; // Stop processing remaining slides
      }

      validatedSlides.push(validatedSlide);
    }

    // If any slides failed, request plan revision immediately
    if (failedSlides.length > 0) {
      this.log.warn(`${failedSlides.length} slide(s) failed validation. Requesting plan revision...`);
      
      // Save the current plan for comparison after revision
      this.previousPlanForComparison = [...slidePlans];

      const revisionTask = new GenerateSkeletonSlidesTask();
      const revisionResult = await revisionTask.execute({
        analysisResult: this.analyzer_results,  // Use analyzer_results, not analysisResult
        outputDir: this.outputDir,
        texResource: texResource,
        revisionMode: true,
        previousPlan: slidePlans,
        slideFeedback: failedSlides
      });

      this.log.success('Plan revision completed. Updated slide plan:');
      this.log.info(`Original: ${slidePlans.length} slides, Revised: ${revisionResult.slides?.length || 0} slides`);

      // Return revision result for re-processing (include validated slides before failure)
      return { 
        revised: true, 
        slides: revisionResult.slides, 
        validatedSlides: [],  // Don't include partially validated - will be re-processed
        validatedSlidesBeforeFailure: validatedSlides  // Save for re-processing
      };
    }

    return validatedSlides;
  }

  /**
   * Compare two slide plans to check if they're identical
   * @param {Object} plan1 - First slide plan
   * @param {Object} plan2 - Second slide plan
   * @returns {boolean} True if plans are identical
   */
  _areSlidePlansIdentical(plan1, plan2) {
    if (!plan1 || !plan2) return false;
    
    // Compare key properties
    return plan1.title === plan2.title &&
           plan1.purpose === plan2.purpose &&
           plan1.contentType === plan2.contentType &&
           JSON.stringify(plan1.keyPoints?.sort()) === JSON.stringify(plan2.keyPoints?.sort()) &&
           JSON.stringify(plan1.contentRefs?.map(r => r.uuid)?.sort()) === JSON.stringify(plan2.contentRefs?.map(r => r.uuid)?.sort());
  }



  async compileSlide(slideLatex, slideIndex) {
    const task = new CompileTask();
    const result = await task.execute({
      latexContent: slideLatex,
      type: 'single',
      slideIndex,
      outputDir: this.outputDir
    });

    return result;
  }

  async fixLatexError(error, latexContent, compileOutput = '') {
    const task = new FixLatexErrorTask();
    const result = await task.execute({
      latexContent,
      error,
      compileOutput,
      retryCount: 0,
      outputDir: this.outputDir,
      jobName: `page_slide_${String(this.currentSlideIndex || 1).padStart(3, '0')}`
    });

    return result;
  }

  async refineTemplateForSlideError(slideLatex, compileError, compileOutput = '') {
    const task = new CreateTemplateTask();

    // Get the current template latex
    const templateLatex = this.tex_template ? this.tex_template.latex : '';

    const result = await task.refineTemplate({
      articlePreamble: this.analyzer_results.preamble,
      templateLatex,
      slideLatex,
      compileError,
      compileOutput
    });

    return result;
  }

  async extractSlideImage(slideIndex) {
    const task = new ExtractSlideImageTask();
    const result = await task.execute({
      outputDir: this.outputDir,
      slideIndex
    });

    return result;
  }

  async validateVisionSlide(imagePath, slidePlan, slideIndex) {
    const task = new ValidateVisionSlideTask();
    const result = await task.execute({
      pageImage: imagePath,
      slidePlan,
      slideIndex,
      retryCount: 0
    });

    return result;
  }

  /**
   * Extract original source text from content references for frame alignment validation
   * @param {Object} slidePlan - The slide plan with contentRefs
   * @param {TexResourcesTool} texResource - The TexResourcesTool instance to fetch content
   * @returns {string} Concatenated original source text from all referenced content
   */
  _extractOriginalSourceText(slidePlan, texResource) {
    const contentRefs = slidePlan?.contentRefs || [];
    const sourceTexts = [];

    if (contentRefs.length === 0) {
      // If no content references, use key points from slide plan
      if (slidePlan?.keyPoints && slidePlan.keyPoints.length > 0) {
        sourceTexts.push('Key points from slide plan:');
        sourceTexts.push(...slidePlan.keyPoints);
      }
      return sourceTexts.join('\n') || 'No source text available';
    }

    for (const ref of contentRefs) {
      if (ref.uuid) {
        try {
          const node = texResource.findNodeByUuid(ref.uuid);
          if (node) {
            const parts = [];
            if (node.title) parts.push(`Title: ${node.title}`);
            if (node.caption) parts.push(`Caption: ${node.caption}`);
            if (node.text || node.latex) parts.push(`Content: ${node.text || node.latex}`);
            if (node.preamble) parts.push(`Preamble: ${node.preamble}`);
            
            sourceTexts.push(`--- ${ref.type} (uuid: ${ref.uuid}) ---`);
            sourceTexts.push(parts.join('\n'));
          } else {
            sourceTexts.push(`--- ${ref.type} (uuid: ${ref.uuid}) ---`);
            sourceTexts.push('Node not found in resource index');
          }
        } catch (error) {
          this.log.warn(`Failed to fetch resource ${ref.uuid}: ${error.message}`);
          sourceTexts.push(`--- ${ref.type} (uuid: ${ref.uuid}) ---`);
          sourceTexts.push(`Error fetching content: ${error.message}`);
        }
      }
    }

    return sourceTexts.join('\n\n');
  }

  async writeFullPresentation(validatedSlides) {
    const slidesContent = validatedSlides.map(s => {
      return s.frameContent || '';
    }).join('\n\n');

    let fullLatex = await this.tex_template.apply(slidesContent, true);

    const refineTask = new RefineFullPresentationTask();
    const result = await refineTask.execute({
      fullLatex,
      validatedSlides,
      texTemplate: this.tex_template,
      outputDir: this.outputDir,
      maxRetries: 3
    });

    const outputPath = path.join(this.outputDir, 'presentation.pdf');
    if (result.success && result.pdfPath) {
      fs.copyFileSync(result.pdfPath, outputPath);
      this.log.success(`Full presentation written to: ${outputPath}`);
    } else {
      this.log.error(`Failed to compile full presentation: ${result.error}`);
    }

    return {
      success: result.success,
      pdfPath: result.success ? outputPath : null,
      error: result.error,
      attempts: result.attempts
    };
  }

  validateDependencies() {}
}

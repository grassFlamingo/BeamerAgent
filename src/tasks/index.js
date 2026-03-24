export { Task } from './Task.js';
export { default as TaskRouter, RoutingType } from './TaskRouter.js';
export { default as CacheWrapper } from './CacheWrapper.js';

export { default as GenerateFullSlidesTask } from './GenerateFullSlidesTask.js';
export { default as RegenerateSlideTask } from './RegenerateSlideTask.js';
export { default as CompileTask } from './CompileTask.js';
export { default as FixLatexErrorTask } from './FixLatexErrorTask.js';
export { default as ExtractSlideImageTask } from './ExtractSlideImageTask.js';
export { default as ValidateVisionSlideTask } from './ValidateVisionSlideTask.js';
export { default as WriteFullPresentationTask } from './WriteFullPresentationTask.js';
export { default as LatexCopyTask } from './LatexCopyTask.js';
export { default as LatexAnalyzerTask } from './LatexAnalyzerTask.js';
export { default as CreateCompileTemplateTask } from './CreateCompileTemplateTask.js';

import GenerateFullSlidesTask from './GenerateFullSlidesTask.js';
import RegenerateSlideTask from './RegenerateSlideTask.js';
import CompileTask from './CompileTask.js';
import FixLatexErrorTask from './FixLatexErrorTask.js';
import ExtractSlideImageTask from './ExtractSlideImageTask.js';
import ValidateVisionSlideTask from './ValidateVisionSlideTask.js';
import WriteFullPresentationTask from './WriteFullPresentationTask.js';
import LatexCopyTask from './LatexCopyTask.js';
import LatexAnalyzerTask from './LatexAnalyzerTask.js';
import CreateCompileTemplateTask from './CreateCompileTemplateTask.js';

export const taskMap = {
  GenerateFullSlidesTask,
  RegenerateSlideTask,
  CompileTask,
  CompileInitTask: CompileTask,
  CompileSlideTask: CompileTask,
  FixLatexErrorTask,
  ExtractSlideImageTask,
  ValidateVisionSlideTask,
  WriteFullPresentationTask,
  LatexCopyTask,
  LatexAnalyzerTask,
  CreateCompileTemplateTask
};

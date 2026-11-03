// content_scripts/quiz_result_loader.js

/**
 * @module QuizResultLoader
 * @description This script acts as a loader for quiz_result_parser.js,
 * ensuring it's loaded as an ES Module within the page context.
 */

// Set a global flag so the background script can check if the parser is already injected.
window.courseraResultParserInjectedViaLoader = true;

// Dynamically import the main quiz result parser script.
import('./quiz_result_parser.js')
  .then(module => { // CORRECTED: Added 'module' to capture the imported module object
    if (module && module.parseQuizResults) { // Check if the module and the function exist
      console.log('Quiz Result Loader: quiz_result_parser.js module loaded successfully. Executing parseQuizResults().');
      module.parseQuizResults(); // CORRECTED: Call the exported function from the module
    } else {
      console.error('Quiz Result Loader: Failed to find parseQuizResults in the loaded module.');
    }
  })
  .catch(error => {
    console.error('Quiz Result Loader: Failed to load quiz_result_parser.js module:', error);
  });
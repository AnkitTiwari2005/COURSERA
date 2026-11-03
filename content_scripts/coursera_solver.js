// content_scripts/coursera_solver.js
/**
 * @module CourseraSolver
 * @description Main content script for Coursera.
 * Detects quiz questions,
 * communicates with the background script to solve them using Gemini,
 * and renders the answers on the page.
 */
import { DOMDetector } from './modules/dom_detector.js';
import { MutationObserverManager } from './modules/mutation_observer.js';
import { UIFeedback } from './modules/ui_feedback.js';
import { AnswerRenderer } from './modules/answer_renderer.js';
import { CONSTANTS } from '../utils/constants.js';
import { ErrorHandler } from '../utils/error_handler.js';
import { CacheManager } from '../utils/cache_manager.js';
import { SmartBlocker } from '../utils/smart_blocker.js';
import { extractCourseraIdentifiers } from '../utils/url_parser.js'; // UPDATED: Removed extractCourseAndQuizIdsFromResultUrl

// Removed: import { parseQuizResults } from './quiz_result_parser.js'; // No longer needed here

let currentSettings = {};
let isSolverActive = false; // Prevents re-triggering while solving
let isInitialized = false; // Guard against double initialization

// Fallback for ErrorHandler in case of module loading issues
const SafeErrorHandler = typeof ErrorHandler !== 'undefined' ?
    ErrorHandler : {
        logError: (message, error, ...context) => {
            console.error(`[Coursera AI Solver Error - Fallback] ${message}`, error, ...context);
        },
        handleError: (userMessage, error, uiFeedbackFunc = null) => {
            console.error(`[Coursera AI Solver Error - Fallback] ${userMessage}`, error);
            if (uiFeedbackFunc && typeof uiFeedbackFunc === 'function') {
                uiFeedbackFunc(userMessage, 'error');
            }
        }
    };

async function initializeSolver() {
    // Guard: prevent double initialization if loader.js is injected twice
    if (isInitialized) {
        console.warn('CourseraSolver: Already initialized, skipping duplicate initialization.');
        return;
    }
    isInitialized = true;

    console.log('Coursera AI Solver: Initializing...');
    try {
        currentSettings = await fetchSettingsFromBackground();
        console.log('Solver settings loaded:', currentSettings);

        detectAndSolveQuizzes();
        MutationObserverManager.observeBody(handleDOMChanges);
        chrome.runtime.onMessage.addListener(handleRuntimeMessages);
        window.addEventListener('keydown', handleKeyboardShortcuts, true);
        UIFeedback.showToast('NVIDIA AI Solver Ready! (Press Alt+Q to solve)', 'info', 3500);
    } catch (error) {
        SafeErrorHandler.logError('Failed to initialize Coursera Solver', error);
        UIFeedback.showToast('Solver initialization failed. Check console.', 'error', 5000);
    }
}

async function fetchSettingsFromBackground() {
    try {
        const response = await chrome.runtime.sendMessage({
            type: CONSTANTS.MESSAGES.FETCH_SETTINGS_REQUEST
        });
        if (response && response.status === 'success') {
            return response.payload;
        } else {
            throw new Error(response?.message || 'Failed to fetch settings from background.');
        }
    } catch (error) {
        SafeErrorHandler.logError('Failed to fetch settings from background:', error);
        return {
            autoSolve: true,
            showExplanations: false,
            minConfidence: 70,
            delayBeforeSolveMs: 500,
            autoSubmit: false
        };
    }
}

function handleRuntimeMessages(message, sender, sendResponse) {
    if (message.type === CONSTANTS.MESSAGES.TRIGGER_SOLVER) {
        console.log('Content Script: Manual solver trigger received.');
        if (!isSolverActive) {
            // Call the async function and ensure sendResponse is called after its completion
            detectAndSolveQuizzes(true).then(() => {
                // This will be called after detectAndSolveQuizzes completes all its promises
                sendResponse({ status: 'success', message: 'Solver finished running.' });
            }).catch(error => {
                SafeErrorHandler.logError('Error during manual solver trigger:', error);
                sendResponse({ status: 'error', message: 'Solver encountered an error during manual trigger.' });
            });
            return true; // Indicate that sendResponse will be called asynchronously
        } else {
            sendResponse({ status: 'info', message: 'Solver already active.' });
            return true; // Still need to return true as sendResponse is called within this path
        }
    }
    return false; // For messages not handled asynchronously
}

/**
 * Handles keyboard shortcuts directly within the page (e.g. Alt+Q).
 * Captures key events early to bypass Coursera's event blocking.
 */
function handleKeyboardShortcuts(event) {
    if (event.altKey && (event.key === 'q' || event.key === 'Q' || event.code === 'KeyQ')) {
        const target = event.target;
        if (target) {
            const tagName = target.tagName ? target.tagName.toUpperCase() : '';
            if (tagName === 'INPUT' || tagName === 'TEXTAREA' || target.isContentEditable) {
                return; // Do not trigger when typing text
            }
        }

        event.preventDefault();
        event.stopPropagation();
        console.log('Content Script: Alt+Q shortcut detected. Triggering solver...');

        if (!isSolverActive) {
            detectAndSolveQuizzes(true);
        } else {
            UIFeedback.showToast('Solver is already running...', 'info', 2000);
        }
    }
}

async function detectAndSolveQuizzes(forceSolve = false) {
    if (isSolverActive && !forceSolve) {
        console.log('Solver already active, skipping.');
        return;
    }
    if (!currentSettings.autoSolve && !forceSolve) {
        console.log('Auto-solve is off. Waiting for manual trigger.');
        return;
    }
    isSolverActive = true;
    UIFeedback.showToast('Scanning for quizzes...', 'info');
    let solvedCount = 0;

    try {
        // Removed: Logic to re-run quiz_result_parser on re-scan.
        // This is handled by quiz_result_loader.js being injected by background.js

        const detector = new DOMDetector();
        detector.detect();
        const quizQuestions = detector.getQuestions();

        if (quizQuestions.length === 0) {
            UIFeedback.showToast('No quiz questions found on this page.', 'info', 3000);
            return; // isSolverActive is reset in finally block
        }

        // Use extractCourseraIdentifiers for the *quiz attempt* page to get correct IDs for SmartBlocker
        const urlIdentifiers = extractCourseraIdentifiers(window.location.href);
        const quizIds = urlIdentifiers ? { courseId: urlIdentifiers.courseId, quizId: urlIdentifiers.quizId } : null;

        if (!quizIds || !quizIds.courseId || !quizIds.quizId) {
            SafeErrorHandler.logError("CourseraSolver: Could not extract courseId or quizId from URL for Smart Blocker. Smart Blocker will be bypassed.", window.location.href);
            UIFeedback.showToast('Warning: Quiz/Course IDs not detected. Smart Blocker disabled.', 'warning', 5000);
        }

        const questionsToSolve = [];
        const originalQuestionsData = []; // To keep a reference to the DOM elements and hashes

        for (const questionData of quizQuestions) {
            try {
                if (!questionData || !questionData.container || !questionData.question || typeof questionData.question !== 'string' || !Array.isArray(questionData.options) || questionData.options.length === 0) {
                    SafeErrorHandler.logError('Skipping malformed or incomplete questionData in detectAndSolveQuizzes loop:', questionData);
                    if (questionData && questionData.container) {
                        UIFeedback.showTooltip(questionData.container, 'Error: Incomplete question data detected.', 'error');
                        UIFeedback.markQuestionAsSolved(questionData.container, 'error');
                    } else {
                        UIFeedback.showToast('Error: Detected incomplete question data for an element.', 'error', 5000);
                    }
                    continue;
                }

                const questionHash = CacheManager.generateQuestionHash(
                    questionData.question,
                    questionData.options,
                    quizIds?.quizId || ''
                );
                let cachedAnswer = await CacheManager.get(questionHash);
                
                let filteredOptions = questionData.options;
                let blockedAnswerSignatures = [];
                // Hoist questionSignature so both SmartBlocker lookups can use it
                const questionSignature = SmartBlocker.generateSignature(questionData.question);

                if (quizIds && quizIds.courseId && quizIds.quizId) {
                    blockedAnswerSignatures = await SmartBlocker.getWrongAnswers(
                        quizIds.courseId,
                        quizIds.quizId,
                        questionSignature
                    );

                    if (blockedAnswerSignatures.length > 0) {
                        console.log(`SmartBlocker: Found ${blockedAnswerSignatures.length} previously wrong answers for this question.`);
                        filteredOptions = questionData.options.filter(option => {
                            const optionSignature = SmartBlocker.generateSignature(option.text);
                            const isBlocked = blockedAnswerSignatures.includes(optionSignature);
                            if (isBlocked) {
                                console.warn(`SmartBlocker: Blocking previously wrong option: "${option.text}"`);
                            }
                            return !isBlocked;
                        });
                        if (filteredOptions.length === 0 && questionData.options.length > 0) {
                            SafeErrorHandler.logError("SmartBlocker: All options previously marked wrong. Using original options as fallback.", questionData);
                            UIFeedback.showToast("Warning: All options previously incorrect. AI will pick best guess.", 'warning');
                            filteredOptions = questionData.options;
                        } else if (filteredOptions.length === 0) {
                            SafeErrorHandler.logError("SmartBlocker: No options detected after filtering. Skipping question.", questionData);
                            UIFeedback.markQuestionAsSolved(questionData.container, 'error');
                            continue;
                        }
                    }
                }

                if (cachedAnswer) {
                    // For multi-select: if the cached entry has only 1 answer and wasn't confirmed complete, skip it
                    const isPartialMultiCache = questionData.questionType === 'multiple' &&
                        cachedAnswer.answers.length < 2 &&
                        !cachedAnswer.allAnswersMatched;

                    const isCachedAnswerStillValidOption = cachedAnswer.answers.every(ans => {
                        return filteredOptions.some(opt => opt.text === ans);
                    });

                    if (!isCachedAnswerStillValidOption) {
                        console.warn(`SmartBlocker: Cached answer for "${questionData.question}" is no longer valid after filtering. Re-solving.`);
                        cachedAnswer = null; // Force re-query
                    } else if (isPartialMultiCache) {
                        console.warn(`Cache: Skipping partial cached answer for multi-select "${questionData.question.substring(0, 50)}...". Re-querying AI.`);
                        cachedAnswer = null; // Force re-query
                    } else {
                        console.log('Found valid cached answer for question:', questionData.question);
                        UIFeedback.showTooltip(questionData.container, 'Using cached answer!', 'info');
                        AnswerRenderer.renderAnswer(questionData, cachedAnswer.answers, currentSettings.autoSolve);
                        if (currentSettings.showExplanations && cachedAnswer.explanation) {
                            UIFeedback.showExplanation(questionData.container, cachedAnswer.explanation);
                        }
                        solvedCount++;
                        await CacheManager.set(questionHash, cachedAnswer);
                        UIFeedback.markQuestionAsSolved(questionData.container, 'success');
                        continue;
                    }
                }

                UIFeedback.markQuestionAsProcessing(questionData.container);
                UIFeedback.showTooltip(questionData.container, 'Queued for AI...', 'info');

                // Fetch confirmed-correct answers from previous attempts (for partial-credit retries)
                let confirmedCorrectAnswers = [];
                if (quizIds && quizIds.courseId && quizIds.quizId) {
                    confirmedCorrectAnswers = await SmartBlocker.getCorrectAnswers(
                        quizIds.courseId,
                        quizIds.quizId,
                        questionSignature
                    );
                    if (confirmedCorrectAnswers.length > 0) {
                        console.log(`SmartBlocker: Found ${confirmedCorrectAnswers.length} confirmed-correct answer(s) for retry context:`, confirmedCorrectAnswers);
                    }
                }

                const serializableQuestionData = {
                    question: questionData.question,
                    options: filteredOptions.map(opt => ({ text: opt.text, value: opt.value })),
                    questionType: questionData.questionType,
                    confirmedCorrectAnswers  // Pass to AI as context
                };

                questionsToSolve.push(serializableQuestionData);
                originalQuestionsData.push({ questionData, questionHash });

            } catch (innerError) {
                SafeErrorHandler.logError('Error preprocessing individual question:', innerError, questionData);
                if (questionData && questionData.container) {
                     UIFeedback.showTooltip(questionData.container, 'Error processing question.', 'error');
                     UIFeedback.markQuestionAsSolved(questionData.container, 'error');
                }
            }
        }

        if (questionsToSolve.length > 0) {
            UIFeedback.showToast(`Solving ${questionsToSolve.length} question(s) in one AI request...`, 'info');

            if (currentSettings.delayBeforeSolveMs > 0) {
                await new Promise(resolve => setTimeout(resolve, currentSettings.delayBeforeSolveMs));
            }

            const response = await chrome.runtime.sendMessage({
                type: CONSTANTS.MESSAGES.SOLVE_BATCH_REQUEST,
                payload: { questionsArray: questionsToSolve }
            });

            if (response && response.status === 'success' && response.results) {
                // Re-detect DOM to get fresh element references after API call
                // (React may have re-rendered during the API wait time)
                const freshDetector = new DOMDetector();
                freshDetector.detect();
                const freshQuestions = freshDetector.getQuestions();

                for (let i = 0; i < response.results.length; i++) {
                    const result = response.results[i];
                    const { questionData: staleQuestionData, questionHash } = originalQuestionsData[i];

                    // Try to find fresh version of this question in the current DOM
                    const freshQuestionData = freshQuestions.find(fq =>
                        CacheManager.generateQuestionHash(fq.question, fq.options, quizIds?.quizId || '') === questionHash
                    ) || staleQuestionData; // Fall back to stale if not found (best effort)

                    if (result.status === 'success') {
                        const { answers, explanation, confidence } = result;

                        if (confidence < currentSettings.minConfidence && !forceSolve) {
                            UIFeedback.showTooltip(freshQuestionData.container, `Confidence too low (${confidence}%). Not auto-solving.`, 'warning');
                            UIFeedback.markQuestionAsSolved(freshQuestionData.container, 'warning');
                        } else {
                            UIFeedback.showTooltip(freshQuestionData.container, 'Answer found!', 'success');
                            const matchCount = AnswerRenderer.renderAnswer(freshQuestionData, answers, currentSettings.autoSolve);
                            if (currentSettings.showExplanations && explanation) {
                                UIFeedback.showExplanation(freshQuestionData.container, explanation);
                            }
                            solvedCount++;

                            // Only cache if ALL answers from AI were matched in DOM.
                            // Partial matches (text mismatch) must NOT be cached — re-query on next run.
                            const allAnswersMatched = matchCount === answers.length;
                            if (!allAnswersMatched && freshQuestionData.questionType === 'multiple') {
                                console.warn(`Cache: NOT caching partial multi-select for "${freshQuestionData.question.substring(0, 50)}". ${matchCount}/${answers.length} matched.`);
                                UIFeedback.showTooltip(freshQuestionData.container, `⚠ ${matchCount}/${answers.length} answers matched. Will re-try on next solve.`, 'warning');
                                UIFeedback.markQuestionAsSolved(freshQuestionData.container, 'warning');
                            } else {
                                await CacheManager.set(questionHash, { answers, explanation, confidence, allAnswersMatched });
                                UIFeedback.markQuestionAsSolved(freshQuestionData.container, 'success');
                            }
                        }
                    } else {
                        const errorMsg = result.message || 'Failed to get answer for this question.';
                        SafeErrorHandler.logError('Error in batch result for question:', errorMsg, staleQuestionData);
                        UIFeedback.showTooltip(staleQuestionData.container, `Error: ${errorMsg}`, 'error');
                        UIFeedback.markQuestionAsSolved(staleQuestionData.container, 'error');
                    }
                }
            } else {
                const errorMsg = response?.message || 'Batch request failed.';
                const isAuthError = response?.statusCode === 401 || response?.statusCode === 403;
                SafeErrorHandler.logError('Error solving batch:', errorMsg, questionsToSolve, response?.details);
                // Mark all pending as error
                originalQuestionsData.forEach(({ questionData }) => {
                    const tip = isAuthError
                        ? 'Invalid API Key. Please update it in the extension popup.'
                        : `Error: ${errorMsg}`;
                    UIFeedback.showTooltip(questionData.container, tip, 'error');
                    UIFeedback.markQuestionAsSolved(questionData.container, 'error');
                });
            }
        }
    } catch (error) {
        SafeErrorHandler.logError('General error in detectAndSolveQuizzes:', error);
        UIFeedback.showToast('An error occurred during solving.', 'error', 5000);
    } finally {
        isSolverActive = false;
        UIFeedback.hideToast();

        if (solvedCount > 0 && currentSettings.autoSubmit) {
            UIFeedback.showToast(`Solved ${solvedCount} question(s). Auto-submitting in 2s...`, 'success', 2000);
            setTimeout(() => autoSubmitQuiz(), 2000);
        } else {
            UIFeedback.showToast(`Solver finished. Solved ${solvedCount} question(s).`, 'success', 3000);
        }

        chrome.runtime.sendMessage({
            type: CONSTANTS.MESSAGES.SOLVER_STATUS_UPDATE,
            payload: {
                message: `Solved ${solvedCount} questions.`,
                type: 'success'
            }
        });
        
        if (window._pendingScan) {
            console.log('Running pending DOM scan after solver finished.');
            window._pendingScan = false;
            detectAndSolveQuizzes();
        }
    }
}

function handleDOMChanges(mutations) {
    let quizContentChanged = false;
    for (const mutation of mutations) {
        if (mutation.type === 'childList' && mutation.addedNodes.length > 0) {
            const relevantNodes = Array.from(mutation.addedNodes).some(node =>
                node.nodeType === Node.ELEMENT_NODE &&
                (node.matches('.rc-FormParts') || node.matches('.rc-QuizQuestion') ||
                 node.matches('[data-testid*="part-Submission_MultipleChoiceQuestion"]') ||
                 node.matches('.rc-FormPartsQuestion') ||
                 node.matches('[data-testid*="part-Submission_MultipleChoiceReflectQuestion"]') ||
                 node.matches('div[role="group"][aria-labelledby*="-legend"]') ||
                 node.matches('.c-quiz-question')
                )
            );
            if (relevantNodes) {
                quizContentChanged = true;
                break;
            }
        }
    }
    if (quizContentChanged) {
        console.log('DOM change detected, re-scanning for quizzes.');
        clearTimeout(window._quizScanDebounce);
        window._quizScanDebounce = setTimeout(() => {
            if (!isSolverActive) {
                detectAndSolveQuizzes();
            } else {
                console.log('Solver is active. Queuing scan for later.');
                window._pendingScan = true;
            }
        }, 1000);
    }
}

/**
 * Automatically checks the honor code agreement checkbox and clicks Submit.
 * Selectors derived from actual Coursera HTML structure.
 */
async function autoSubmitQuiz() {
    console.log('AutoSubmit: Attempting to submit quiz...');
    UIFeedback.showToast('Auto-submitting quiz...', 'info', 8000);

    try {
        // --- Step 1: Find and check the Honor Code checkbox ---
        // From actual HTML: id="agreement-checkbox-base" (no numeric suffix)
        // Contained inside [data-testid="agreement-standalone-checkbox"]
        const CHECKBOX_SELECTORS = [
            '#agreement-checkbox-base',                                          // Exact ID from HTML
            '[data-testid="agreement-standalone-checkbox"] input[type="checkbox"]', // Container
            'input[id^="agreement-checkbox"]',                                   // ID prefix
            '[data-testid="HonorCodeAgreement"] input[type="checkbox"]',         // Parent container
            'input[aria-labelledby*="agreement-checkbox"]',                      // Aria fallback
        ];

        let agreementCheckbox = null;
        for (const sel of CHECKBOX_SELECTORS) {
            const el = document.querySelector(sel);
            if (el) {
                agreementCheckbox = el;
                console.log('AutoSubmit: Found checkbox with selector:', sel);
                break;
            }
        }

        // Text-based fallback
        if (!agreementCheckbox) {
            for (const cb of document.querySelectorAll('input[type="checkbox"]')) {
                const surroundingText = (cb.closest('label, div')?.innerText || '').toLowerCase();
                if (surroundingText.includes('understand and agree') ||
                    surroundingText.includes('honor code') ||
                    surroundingText.includes('my own work')) {
                    agreementCheckbox = cb;
                    console.log('AutoSubmit: Found checkbox via text fallback.');
                    break;
                }
            }
        }

        if (agreementCheckbox) {
            if (!agreementCheckbox.checked) {
                console.log('AutoSubmit: Checking the agreement checkbox...');

                // Always try clicking the label first — React tracks label clicks
                const label = agreementCheckbox.closest('label') ||
                    document.querySelector(`label[for="${agreementCheckbox.id}"]`);

                if (label) {
                    label.click();
                    console.log('AutoSubmit: Clicked label element.');
                } else {
                    // Native React setter to bypass React's onChange interception
                    const nativeSetter = Object.getOwnPropertyDescriptor(
                        window.HTMLInputElement.prototype, 'checked'
                    );
                    if (nativeSetter?.set) {
                        nativeSetter.set.call(agreementCheckbox, true);
                    }
                    ['mousedown', 'mouseup', 'click', 'input', 'change'].forEach(evt => {
                        agreementCheckbox.dispatchEvent(new Event(evt, { bubbles: true }));
                    });
                    console.log('AutoSubmit: Triggered native events on checkbox.');
                }

                // Wait for React to process the checkbox state change and enable the Submit button
                await new Promise(resolve => setTimeout(resolve, 800));
            } else {
                console.log('AutoSubmit: Checkbox already checked.');
            }
        } else {
            console.warn('AutoSubmit: Could not find agreement checkbox.');
            UIFeedback.showToast('⚠ Could not find agreement checkbox. Please check and submit manually.', 'warning', 8000);
            return;
        }

        // --- Step 2: Find and click Submit (after checkbox enables it) ---
        // From actual HTML: data-testid="submit-button"
        // NOTE: It starts with disabled="", becomes enabled AFTER checkbox is checked.
        // We must wait for React to remove the disabled attribute.
        let submitButton = null;
        const MAX_WAIT_MS = 3000;
        const POLL_INTERVAL_MS = 200;
        let waited = 0;

        while (waited < MAX_WAIT_MS) {
            // Look for submit button that is NOT disabled
            submitButton = document.querySelector('[data-testid="submit-button"]:not([disabled]):not([aria-disabled="true"])');
            if (!submitButton) {
                // Fallback: any button with text "Submit" that is not disabled
                for (const btn of document.querySelectorAll('button:not([disabled])')) {
                    const txt = btn.innerText?.trim();
                    if (txt === 'Submit' || txt === 'Submit Quiz') {
                        submitButton = btn;
                        break;
                    }
                }
            }
            if (submitButton) break;
            await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL_MS));
            waited += POLL_INTERVAL_MS;
        }

        if (submitButton) {
            console.log('AutoSubmit: Clicking Submit button.');
            submitButton.click();

            // --- Step 3: Handle "Ready to submit?" confirmation modal ---
            // After clicking Submit, Coursera shows a confirmation dialog.
            // We poll for it and click the Submit button inside the modal.
            console.log('AutoSubmit: Waiting for confirmation dialog...');
            UIFeedback.showToast('Confirming submission...', 'info', 5000);

            const DIALOG_MAX_WAIT = 5000;
            const DIALOG_POLL = 200;
            let dialogWaited = 0;
            let dialogSubmitBtn = null;

            while (dialogWaited < DIALOG_MAX_WAIT) {
                // From DevTools: data-testid="dialog-submit-button" inside the modal
                dialogSubmitBtn =
                    document.querySelector('[data-testid="dialog-submit-button"]') ||
                    document.querySelector('[data-testid="SubmitDialog"] button[type="button"]:not([data-testid="dialog-cancel-button"])') ||
                    // Fallback: any button inside a modal/dialog with text "Submit"
                    (() => {
                        const modal = document.querySelector('[role="dialog"], [aria-modal="true"]');
                        if (!modal) return null;
                        return Array.from(modal.querySelectorAll('button')).find(b =>
                            b.innerText?.trim() === 'Submit' && !b.disabled
                        );
                    })();

                if (dialogSubmitBtn) break;
                await new Promise(resolve => setTimeout(resolve, DIALOG_POLL));
                dialogWaited += DIALOG_POLL;
            }

            if (dialogSubmitBtn) {
                console.log('AutoSubmit: Found confirmation dialog Submit. Clicking it.');
                dialogSubmitBtn.click();
                UIFeedback.showToast('✅ Quiz submitted!', 'success', 6000);
            } else {
                // No dialog appeared — direct submit likely succeeded
                console.log('AutoSubmit: No confirmation dialog appeared. Direct submit likely succeeded.');
                UIFeedback.showToast('✅ Quiz submitted!', 'success', 5000);
            }

        } else {
            // Last resort: try clicking the disabled button directly
            const disabledSubmit = document.querySelector('[data-testid="submit-button"]');
            if (disabledSubmit) {
                console.warn('AutoSubmit: Submit button still disabled after checkbox. Attempting forced click.');
                disabledSubmit.removeAttribute('disabled');
                disabledSubmit.setAttribute('aria-disabled', 'false');
                disabledSubmit.click();

                // Still need to handle confirmation dialog after forced click
                await new Promise(resolve => setTimeout(resolve, 1000));
                const forcedDialogBtn =
                    document.querySelector('[data-testid="dialog-submit-button"]') ||
                    (() => {
                        const modal = document.querySelector('[role="dialog"], [aria-modal="true"]');
                        return modal ? Array.from(modal.querySelectorAll('button')).find(b =>
                            b.innerText?.trim() === 'Submit'
                        ) : null;
                    })();
                if (forcedDialogBtn) forcedDialogBtn.click();
                UIFeedback.showToast('✅ Quiz submitted!', 'success', 5000);
            } else {
                console.warn('AutoSubmit: Submit button not found at all.');
                UIFeedback.showToast('⚠ Could not find Submit button. Please click Submit manually.', 'warning', 8000);
            }
        }

    } catch (error) {
        SafeErrorHandler.logError('AutoSubmit: Error during auto-submit', error);
        UIFeedback.showToast('Auto-submit failed. Please submit manually.', 'error', 5000);
    }
}

// Start the solver
initializeSolver();
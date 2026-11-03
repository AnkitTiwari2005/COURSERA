// content_scripts/quiz_result_parser.js

import { SmartBlocker } from '../utils/smart_blocker.js';
import { ErrorHandler } from '../utils/error_handler.js';
import { CONSTANTS } from '../utils/constants.js';
import * as UrlParser from '../utils/url_parser.js';

/**
 * Parses the Coursera quiz/assignment feedback page (view-feedback / result).
 *
 * RADIO (single-select) feedback page DOM — from real HTML (22.html):
 *   - All inputs have disabled=""
 *   - Selected input has: checked="" + cds-choiceInput-checked on parent span
 *   - Wrong question: selected input's aria-describedby points to a "-grade-feedback" div
 *     containing [data-testid="icon-incorrect"] and "Try again" text
 *   - Score: [data-testid="part-points"] shows "0 / 1"
 *
 * CHECKBOX (multi-select) feedback page DOM — from real HTML (Assignment-2):
 *   - Selected options have cds-checkboxAndRadio-checked on .rc-Option div
 *   - Wrong option: its aria-describedby feedback div has [data-testid="icon-incorrect"]
 *   - Correct option: its aria-describedby feedback div has [data-testid="icon-correct"] / "Nice work"
 */
export async function parseQuizResults() {
    console.log('QuizResultParser: Starting result page analysis.');
    const currentUrl = window.location.href;

    const ids = UrlParser.extractCourseAndQuizIdsFromResultUrl(currentUrl);
    if (!ids) {
        ErrorHandler.logError('QuizResultParser: Could not extract IDs from URL', currentUrl);
        return;
    }
    console.log('QuizResultParser: IDs:', ids);

    // Wait for React to fully render
    await new Promise(resolve => setTimeout(resolve, 2500));

    // ── Find all question containers ─────────────────────────────────────────
    const questionContainerSelectors = [
        '[data-testid*="part-Submission_GradedMultipleChoiceQuestion"]',
        '[data-testid*="part-Submission_MultipleChoiceQuestion"]',
        '[data-testid*="part-Submission_CheckboxQuestion"]',
        '[data-testid*="part-Submission_MultipleChoiceReflectQuestion"]',
        '[data-testid*="part-Submission_"]',
        '.rc-FormPartsQuestion',
        '.rc-QuizQuestion',
    ];

    const seen = new Set();
    const allContainers = [];
    questionContainerSelectors.forEach(sel => {
        document.querySelectorAll(sel).forEach(el => {
            if (!seen.has(el)) { seen.add(el); allContainers.push(el); }
        });
    });

    console.log(`QuizResultParser: Found ${allContainers.length} question containers.`);

    let wrongAnswersReported = 0;
    let correctAnswersStored = 0;

    for (const container of allContainers) {
        try {
            const questionText = _extractQuestionText(container);
            if (!questionText) continue;

            const questionSignature = SmartBlocker.generateSignature(questionText);
            if (!questionSignature) continue;

            console.log(`QuizResultParser: Processing: "${questionText.substring(0, 60)}..."`);

            const wrongOptionTexts   = [];
            const correctOptionTexts = [];

            // ── Scan every input (radio or checkbox) inside this container ───
            const inputs = container.querySelectorAll('input[type="radio"], input[type="checkbox"]');

            for (const input of inputs) {
                // On the feedback page, all inputs are disabled.
                // Selected state is indicated by checked="" attribute (static HTML attribute, not JS property).
                const isSelected = input.hasAttribute('checked') ||
                    input.closest('span')?.classList.contains('cds-choiceInput-checked');

                if (!isSelected) continue;

                const optionEl = input.closest('.rc-Option');
                if (!optionEl) continue;

                const optionText = _extractOptionText(optionEl);
                if (!optionText) continue;

                // ── Find the feedback div for this specific option ────────────
                // Priority 1: aria-describedby attribute on the input itself
                const describedById = input.getAttribute('aria-describedby');
                const feedbackEl = describedById
                    ? document.getElementById(describedById)
                    : null;

                // Priority 2: id ending in "-feedback" or "-grade-feedback" as sibling/nearby
                const altFeedback = !feedbackEl
                    ? (optionEl.parentElement?.querySelector('[id$="-feedback"], [id$="-grade-feedback"]') ||
                       optionEl.parentElement?.nextElementSibling)
                    : null;

                const resolvedFeedback = feedbackEl || altFeedback;
                const feedbackText = (resolvedFeedback?.innerText || '').toLowerCase();
                const hasWrongIcon = resolvedFeedback?.querySelector('[data-testid="icon-incorrect"]') !== null;

                const isWrong = hasWrongIcon ||
                    feedbackText.includes('try again') ||
                    feedbackText.includes('should not be selected') ||
                    feedbackText.includes('incorrect');

                const isCorrect = resolvedFeedback?.querySelector('[data-testid="icon-correct"]') !== null ||
                    feedbackText.includes('nice work') ||
                    feedbackText.includes('correct');

                if (isWrong) {
                    wrongOptionTexts.push(optionText);
                    console.log(`QuizResultParser: ❌ Wrong: "${optionText}" (feedback: "${feedbackText.substring(0,40)}")`);
                } else if (isCorrect) {
                    correctOptionTexts.push(optionText);
                    console.log(`QuizResultParser: ✅ Correct: "${optionText}"`);
                } else {
                    // Selected but no explicit feedback — for radio, if question scored 0 it's wrong
                    const scoreEl = container.querySelector('[data-testid="part-points"]');
                    const scoreText = scoreEl?.innerText || '';
                    const scoreNum  = parseFloat(scoreText.match(/^(\d+(?:\.\d+)?)/)?.[1] ?? '-1');
                    if (scoreNum === 0) {
                        wrongOptionTexts.push(optionText);
                        console.log(`QuizResultParser: ❌ Wrong (0 score): "${optionText}"`);
                    } else if (scoreNum > 0) {
                        correctOptionTexts.push(optionText);
                        console.log(`QuizResultParser: ✅ Correct (positive score): "${optionText}"`);
                    } else {
                        console.warn(`QuizResultParser: ⚠ Cannot determine outcome for: "${optionText}"`);
                    }
                }
            }

            // ── Report wrong answers ─────────────────────────────────────────
            for (const wrongText of wrongOptionTexts) {
                const wrongSig = SmartBlocker.generateSignature(wrongText);
                if (!wrongSig) continue;
                chrome.runtime.sendMessage({
                    type: CONSTANTS.MESSAGES.REPORT_INCORRECT_ANSWER,
                    payload: {
                        courseId: ids.courseId,
                        quizId: ids.quizId,
                        questionSignature,
                        wrongAnswerSignature: wrongSig
                    }
                });
                wrongAnswersReported++;
            }

            // ── Store confirmed-correct answers (for partial-credit retries) ─
            if (correctOptionTexts.length > 0) {
                chrome.runtime.sendMessage({
                    type: CONSTANTS.MESSAGES.REPORT_CORRECT_ANSWERS,
                    payload: {
                        courseId: ids.courseId,
                        quizId: ids.quizId,
                        questionSignature,
                        correctAnswerTexts: correctOptionTexts
                    }
                });
                correctAnswersStored += correctOptionTexts.length;
            }

        } catch (error) {
            ErrorHandler.logError('QuizResultParser: Error processing container', error);
        }
    }

    console.log(`QuizResultParser: Done. Wrong: ${wrongAnswersReported}, Correct stored: ${correctAnswersStored}`);
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function _extractQuestionText(container) {
    const selectors = [
        '[id^="prompt-"] .rc-CML',
        '[data-testid="legend"] .rc-CML',
        'div.css-ybrhvy .rc-CML',
        '.rc-CML p',
        '.rc-CML',
        '[data-testid*="question-text"]',
        'h3',
    ];
    for (const sel of selectors) {
        const el = container.querySelector(sel);
        if (el?.innerText?.trim().length > 3) return el.innerText.trim();
    }
    const fallback = container.innerText?.trim().substring(0, 300) || '';
    return fallback.length > 3 ? fallback : '';
}

function _extractOptionText(optionEl) {
    const selectors = [
        '.cds-checkboxAndRadio-labelContent .rc-CML p',
        '.cds-checkboxAndRadio-labelContent',
        '.cds-checkboxAndRadio-labelText .rc-CML p',
        '.cds-checkboxAndRadio-labelText',
        '.rc-CML p',
        '.rc-Option__text',
        'p',
    ];
    let text = '';
    for (const sel of selectors) {
        const el = optionEl.querySelector(sel);
        if (el?.innerText?.trim().length > 0) { text = el.innerText.trim(); break; }
    }
    if (!text) text = optionEl.innerText?.trim() || '';
    return text.replace(/^[A-Za-z0-9]+[.)]\s*/, '').trim();
}
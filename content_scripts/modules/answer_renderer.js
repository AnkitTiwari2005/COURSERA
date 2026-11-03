// content_scripts/modules/answer_renderer.js

/**
 * @module AnswerRenderer
 * @description Renders the solved answers on the Coursera page by selecting
 * radio buttons, checking checkboxes, or highlighting options.
 */

class AnswerRenderer {
    /**
     * Normalizes text for comparison: lowercase, trim, collapse whitespace.
     * @param {string} text
     * @returns {string}
     */
    static _normalize(text) {
        return (text || '').toLowerCase().replace(/\s+/g, ' ').trim();
    }

    /**
     * Checks if a given answer text matches an option text.
     * Priority: exact match → normalized match.
     * Does NOT use includes() to avoid false positive partial matches.
     * @param {string} optionText
     * @param {string} answerText
     * @returns {boolean}
     */
    static _isMatch(optionText, answerText) {
        if (optionText === answerText) return true; // Exact
        const normOpt = AnswerRenderer._normalize(optionText);
        const normAns = AnswerRenderer._normalize(answerText);
        return normOpt === normAns;
    }

    /**
     * Simulates a React-compatible click on an input element.
     * React overrides the native input setter, so we must use the native prototype
     * to trigger a real change that React will detect.
     * @param {HTMLInputElement} inputEl
     */
    static _triggerReactChange(inputEl) {
        try {
            // Get the native input value setter to bypass React's synthetic wrapper
            const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
                window.HTMLInputElement.prototype, 'checked'
            );
            if (nativeInputValueSetter && nativeInputValueSetter.set) {
                nativeInputValueSetter.set.call(inputEl, true);
            } else {
                inputEl.checked = true;
            }
        } catch (e) {
            // Fallback: direct assignment
            inputEl.checked = true;
        }

        // Fire both native and synthetic events for maximum React compatibility
        inputEl.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
        inputEl.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true }));
        inputEl.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
        inputEl.dispatchEvent(new Event('input', { bubbles: true }));
        inputEl.dispatchEvent(new Event('change', { bubbles: true }));
    }

    /**
     * Renders the provided answers by either auto-selecting or highlighting.
     * @param {object} questionData - The question object obtained from DOMDetector.
     * @param {string[]} answers - An array of strings representing the correct answer texts.
     * @param {boolean} autoSelect - If true, auto-selects; otherwise, only highlights.
     */
    static renderAnswer(questionData, answers, autoSelect) {
        if (!questionData || !questionData.options || !answers || answers.length === 0) {
            console.error('AnswerRenderer: Invalid input for rendering answers.', { questionData, answers });
            return;
        }

        const selectedElements = new Set();
        let matchCount = 0;

        questionData.options.forEach(option => {
            const isCorrectAnswer = answers.some(ans => AnswerRenderer._isMatch(option.text, ans));

            // Clean up any previous highlight/selection classes
            if (option.element && option.element.closest) {
                option.element.classList.remove('gs-selected-answer', 'gs-highlighted-answer');
                const labelParent = option.element.closest(
                    '.rc-RadioChoice__label, .rc-CheckboxChoice__label, label'
                );
                if (labelParent) {
                    labelParent.classList.remove('gs-selected-answer', 'gs-highlighted-answer');
                }
            }

            if (isCorrectAnswer && !selectedElements.has(option.element)) {
                if (!option.element) {
                    console.warn('AnswerRenderer: option.element is null/undefined for option:', option.text);
                    return;
                }

                if (autoSelect) {
                    // Strategy 1: Click the label directly (most reliable for Coursera's hidden inputs)
                    const labelEl = option.labelElement ||
                        option.element.closest('label') ||
                        option.element.closest('.rc-RadioChoice__label, .rc-CheckboxChoice__label');

                    if (labelEl) {
                        console.log('AnswerRenderer: Clicking label for option:', option.text);
                        labelEl.click();
                        labelEl.classList.add('gs-selected-answer');
                        matchCount++;
                    } else if (option.element.type === 'radio' || option.element.type === 'checkbox') {
                        // Strategy 2: React-compatible native setter + events (fallback)
                        console.log('AnswerRenderer: Using native setter for option:', option.text);
                        AnswerRenderer._triggerReactChange(option.element);
                        // Also add visual highlight class to the input's parent
                        const closestLabel = option.element.closest('label') ||
                            option.element.parentElement;
                        if (closestLabel) closestLabel.classList.add('gs-selected-answer');
                        matchCount++;
                    }
                } else {
                    // Highlight-only mode (autoSolve off)
                    const labelParent = option.element.closest(
                        '.rc-RadioChoice__label, .rc-CheckboxChoice__label, label'
                    );
                    if (labelParent) {
                        labelParent.classList.add('gs-highlighted-answer');
                    } else {
                        option.element.classList.add('gs-highlighted-answer');
                    }
                    matchCount++;
                }
                selectedElements.add(option.element);
            }
        });

        if (matchCount === 0) {
            console.warn('AnswerRenderer: No options were matched/selected.',
                '\n  Answers from AI:', answers,
                '\n  Available options:', questionData.options.map(o => o.text));
        } else {
            console.log(`AnswerRenderer: Successfully matched and acted on ${matchCount}/${answers.length} answer(s).`);
        }

        // Return matchCount so callers can detect partial matches
        return matchCount;
    }
}

export { AnswerRenderer };

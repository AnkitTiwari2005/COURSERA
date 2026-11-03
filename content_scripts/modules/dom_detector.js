// content_scripts/modules/dom_detector.js
/**
 * @module DOMDetector
 * @description Provides utilities to detect and extract quiz questions and their options
 * from the Coursera page's DOM.
 */
class DOMDetector {
    constructor() {
        this.questions = [];
    }

    /**
     * Initializes the detection process by finding all potential quiz question containers.
     */
    detect() {
        console.log("DOMDetector: Starting detection...");
        this.questions = [];
        // UPDATED: More robust selectors for different types of question containers
        // This includes general quiz questions, assignment submissions, and self-review pages.
        const questionContainerSelectors = [
            // Selectors for specific question types or patterns
            // MODIFIED: Broadened this selector to catch all 'part-Submission_' types,
            // including 'CheckboxQuestion' and 'MultipleChoiceQuestion'.
            '[data-testid^="part-Submission_"]', // Covers general MCQs, Checkbox, and "Reflect" types
            '.rc-FormPartsQuestion', // Common standard quiz question container
            // MODIFIED: Make the 'div[role="group"][aria-labelledby*="-legend"]' selector more specific
            // by ensuring it also contains a .rc-FormPartsQuestion or similar to avoid over-detection.
            // Also consider if it's a direct question element within this structure:
            'div[role="group"][aria-labelledby*="-legend"] .rc-FormPartsQuestion',
            'div[role="group"][aria-labelledby*="-legend"][data-testid*="question"]',
            '.rc-QuizQuestion', // Another general Coursera quiz question class
            // Add more general, but still specific enough, selectors if quizzes are missed
            '.c-quiz-question' // Another common class for older Coursera quizzes
        ];

        let potentialQuestionContainers = [];
        questionContainerSelectors.forEach(selector => {
            document.querySelectorAll(selector).forEach(container => {
                // Ensure unique containers are added to avoid duplicates if multiple selectors match the same element
                if (!potentialQuestionContainers.includes(container)) {
                    potentialQuestionContainers.push(container);
                }
            });
        });

        if (potentialQuestionContainers.length === 0) {
            console.log("DOMDetector: No potential quiz question containers found.");
            return;
        }
        console.log(`DOMDetector: Found ${potentialQuestionContainers.length} potential quiz question containers.`);

        for (const container of potentialQuestionContainers) {
            console.log("DOMDetector: Processing potential question container:", container);
            try {
                const question = this.extractQuestion(container);
                if (question) {
                    this.questions.push(question);
                    console.log("DOMDetector: Successfully extracted and added question:", question.question.substring(0, 50) + "...");
                } else {
                    console.warn("DOMDetector: Skipping container, extractQuestion returned null for:", container);
                }
            } catch (error) {
                console.error(`DOMDetector: Critical error extracting question from container:`, container, error);
            }
        }
        console.log(`DOMDetector: Extracted ${this.questions.length} valid questions.`);
    }

    /**
     * Extracts a single question and its options from a given container element.
     * @param {Element} container - The DOM element containing the question.
     * @returns {Object|null} The extracted question object, or null if extraction fails or data is insufficient.
     */
    extractQuestion(container) {
        let questionText = null;
        let options = [];
        let codeSnippet = null; // To store extracted code

        // --- Question Text Extraction ---
        console.log("DOMDetector: Attempting to extract question text...");
        const questionTextSelectors = [
            '[data-testid="legend"] .rc-CML p', // Common for questions with explicit legend
            '[data-testid="legend"]', // Direct legend text (might include question number, which will be cleaned)
            '.rc-FormPartsQuestion__contentCell .rc-CML p', // Content within a common question part structure
            'div[data-test-id="question-text"] p', // Common for older quizzes
            '.rc-CML p', // General CML paragraph, should be within a question context, last resort
            '.rc-CodeBlockV2 + p', // Paragraph immediately following a code block (might be question text)
            '.rc-CML.html-rendered-content > p' // Another common pattern for HTML content
        ];

        for (const selector of questionTextSelectors) {
            const element = container.querySelector(selector);
            if (element && element.textContent.trim()) {
                questionText = element.textContent.trim();
                // Clean up leading numbers or letters (e.g., "1. " or "A. ") if it's not part of the question.
                // This is a heuristic, be careful with actual question content starting with numbers/letters.
                questionText = questionText.replace(/^\s*\d+\.\s*|^[A-Z]\.\s*/, '').trim();
                console.log(`DOMDetector: Question text found using "${selector}":`, questionText.substring(0, Math.min(questionText.length, 50)) + "...");
                break;
            }
        }

        // CRITICAL VALIDATION: Ensure a substantial question text is found
        if (!questionText || questionText.length < 10) { // Require at least 10 characters for question text
            console.warn(`DOMDetector: Insufficient or no question text found for container. Skipping.`, container);
            return null;
        }

        // --- Code Snippet Extraction ---
        console.log("DOMDetector: Attempting to extract code snippet...");
        // Priority 1: Check for the hidden textarea used by Monaco Editor
        const monacoTextarea = container.querySelector('.monaco-editor textarea.inputarea[aria-label*="Editor content"]');
        if (monacoTextarea && monacoTextarea.value.trim()) {
            codeSnippet = monacoTextarea.value.trim();
            console.log("DOMDetector: Code snippet extracted from Monaco textarea.");
        } else {
            console.log("DOMDetector: Monaco textarea not found or empty, trying other selectors.");
            // Priority 2: Iterate through view-line spans within the Monaco editor's visible area
            // Target specific Monaco editor parts that hold code, usually within `rc-CodeBlockV2` or similar
            const codeLineElements = container.querySelectorAll(
                '.rc-CodeBlockV2 .view-line > span, ' + // Direct span children of view-line
                '.rc-CodeBlockV2 code, ' + // General code tag within a block
                '.rc-CodeBlockV2 pre' // Preformatted text block
            );
            let collectedLines = [];
            codeLineElements.forEach(lineElement => {
                // Filter out line numbers or other non-code elements if present
                if (lineElement.closest('.line-numbers') === null) {
                    collectedLines.push(lineElement.textContent);
                }
            });

            if (collectedLines.length > 0) {
                // Join lines, then trim to remove any empty lines that might have been collected
                codeSnippet = collectedLines.join('\n').trim(); // Use '\n' to preserve line breaks
                if (codeSnippet) {
                    console.log("DOMDetector: Code snippet extracted line by line from code elements.");
                } else {
                    console.log("DOMDetector: Line by line extraction resulted in empty snippet.");
                }
            } else {
                console.log("DOMDetector: No code lines found with targeted selectors.");
            }
        }

        // Combine question text and code snippet
        if (questionText && codeSnippet) {
            // Ensure proper markdown formatting for code
            questionText = `${questionText}\n\n\`\`\`javascript\n${codeSnippet}\n\`\`\``;
            console.log("DOMDetector: Combined question text with code snippet.");
        } else if (!questionText && codeSnippet) {
            // If only code is found, make the code the question text (less common for quizzes but possible)
            questionText = `\`\`\`javascript\n${codeSnippet}\n\`\`\``;
            console.log("DOMDetector: Question text set to only code snippet.");
        }

        // --- Options Extraction ---
        console.log("DOMDetector: Attempting to extract options...");
        const optionContainerSelectors = [
            '[data-testid="Submission_MultipleChoiceQuestion__option"]',
            '.rc-Option', // Most consistent option wrapper
            '.rc-FormPartsQuestion__choices > div', // General choices wrapper
            'div[role="radio"]', // If options are directly role="radio"
            'div[role="checkbox"]', // If options are directly role="checkbox"
            '.c-choice-group__item', // Found in some older structures
            '.rc-FormPartsQuestion__option', // Another common option class
            'div[data-test-id="choice-item"]' // Yet another option selector
        ];

        let rawOptionsElements = [];
        optionContainerSelectors.forEach(selector => {
            container.querySelectorAll(selector).forEach(optionElement => {
                if (!rawOptionsElements.includes(optionElement)) {
                    rawOptionsElements.push(optionElement);
                }
            });
        });

        // Fallback for options if primary selectors don't work, look for inputs directly and find their labels/parents
        if (rawOptionsElements.length === 0) {
            console.log("DOMDetector: No option containers found with primary selectors, trying direct input elements.");
            container.querySelectorAll('input[type="radio"], input[type="checkbox"]').forEach(input => {
                // Find the closest parent element that typically wraps the input and its text (e.g., a label or a div acting as an option)
                const parentElement = input.closest('label') || input.closest('.rc-Option') || input.closest('div[role="group"] > div') || input.closest('div');
                if (parentElement && !rawOptionsElements.includes(parentElement)) {
                    rawOptionsElements.push(parentElement);
                }
            });
        }
        console.log(`DOMDetector: Found ${rawOptionsElements.length} raw option elements.`);

        rawOptionsElements.forEach((optionElement, index) => {
            let optionText = null;
            let optionValue = null;
            let inputElement = null;
            let labelElement = null;

            // Try to find the associated input element first
            inputElement = optionElement.querySelector('input[type="radio"], input[type="checkbox"]');

            // Find the label that wraps or is associated with the input — clicking the label
            // is more reliable than clicking the hidden input on React/custom-styled forms
            if (inputElement) {
                // Label might be the parent of the input, or a sibling label, or the option container itself
                labelElement = inputElement.closest('label') ||
                               optionElement.querySelector('label') ||
                               (optionElement.tagName === 'LABEL' ? optionElement : null);
            }

            // NEW: Prioritize code element extraction within the option
            const codeElementsInOption = optionElement.querySelectorAll('pre, code, .monaco-editor .view-line > span');
            let collectedOptionCodeLines = [];
            codeElementsInOption.forEach(lineElement => {
                if (lineElement.closest('.line-numbers') === null) {
                    collectedOptionCodeLines.push(lineElement.textContent);
                }
            });

            if (collectedOptionCodeLines.length > 0 && collectedOptionCodeLines.join('\n').trim().length > 5) {
                optionText = collectedOptionCodeLines.join('\n').trim();
                console.log("DOMDetector: Code snippet extracted from option element.");
            } else {
                // Try to find the option text — CDS-specific selectors first (2024-2025 Coursera)
                const textElement =
                    optionElement.querySelector('.cds-checkboxAndRadio-labelContent .rc-CML p') ||
                    optionElement.querySelector('.cds-checkboxAndRadio-labelContent') ||
                    optionElement.querySelector('.cds-checkboxAndRadio-labelText .rc-CML p') ||
                    optionElement.querySelector('.rc-Option .rc-CML p') ||
                    optionElement.querySelector('.rc-Option__text') ||
                    optionElement.querySelector('span:not([data-testid="visually-hidden"])') ||
                    optionElement.querySelector('.cml-viewer p') ||
                    optionElement.querySelector('p') ||
                    optionElement.querySelector('.rc-CML') ||
                    optionElement;

                if (textElement && textElement.textContent.trim()) {
                    optionText = textElement.textContent.trim();
                    // Strip leading option letters (A. / A) / 1. / 1) formats)
                    optionText = optionText.replace(/^[A-Za-z0-9]+[.)]\s*/, '').trim();
                } else {
                    optionText = optionElement.textContent.trim().replace(/^[A-Za-z0-9]+[.)]\s*/, '').trim();
                }
            }

            // Always clean Monaco Editor artifacts from the extracted optionText
            if (optionText) {
                optionText = DOMDetector._cleanMonacoEditorArtifacts(optionText);
            }

            if (inputElement && inputElement.value !== undefined && inputElement.value !== null && inputElement.value !== '') {
                optionValue = inputElement.value;
            } else {
                optionValue = optionText ? optionText.replace(/[^a-zA-Z0-9]/g, '_').toLowerCase().substring(0, 50) : `option_${index}`;
                console.warn(`DOMDetector: inputElement.value not found or empty for option, generated fallback value: ${optionValue}.`);
            }

            if (optionText && inputElement) {
                // Store both the input element AND the label element for more reliable clicking
                options.push({ text: optionText, value: optionValue, element: inputElement, labelElement: labelElement });
            } else {
                console.warn(`DOMDetector: Skipping malformed option. No text or input element found for:`, optionElement);
            }
        });

        // CRITICAL VALIDATION: Ensure at least two options are found for valid multiple-choice questions
        // A quiz question should have at least 2 options to be solvable.
        if (options.length < 2) {
            console.warn(`DOMDetector: Insufficient options extracted (found ${options.length}) for question "${questionText.substring(0, Math.min(questionText.length, 50))}..." Skipping this question.`);
            return null;
        }

        // Determine question type (crucial for distinguishing radio vs. checkbox)
        // This is done by checking the 'type' attribute of the input elements within the options.
        const questionType = options.some(opt => opt.element && opt.element.type === 'checkbox') ? 'multiple' : 'single';

        console.log("DOMDetector: Successfully extracted question data:", {
            question: questionText,
            options: options.map(opt => ({ text: opt.text, value: opt.value })),
            questionType: questionType
        });

        return {
            container: container,
            question: questionText,
            options: options,
            questionType: questionType
        };
    }

    /**
     * Cleans common Monaco Editor UI strings and CSS artifacts from extracted text.
     * @param {string} text - The input text potentially containing Monaco artifacts.
     * @returns {string} The cleaned text.
     * @private
     */
    static _cleanMonacoEditorArtifacts(text) {
        // Regex to remove common Monaco editor UI strings
        // This includes "Enter to Rename", "Shift+Enter to Preview", and specific CSS class patterns
        const monacoRegex = /(\s*(?:Enter to Rename|Shift\+Enter to Preview)\s*|\.monaco-list\.list_id_\d+:[^\s]+\s*\{[^}]*?\})/g;
        return text.replace(monacoRegex, '').trim();
    }

    /**
     * Returns the detected questions.
     * @returns {Array<Object>} An array of question objects.
     */
    getQuestions() {
        return this.questions;
    }
}

export { DOMDetector };
// utils/prompt_builder.js

/**
 * @module PromptBuilder
 * @description Generates optimized prompts for the Google Gemini API based on quiz question data.
 * Aims to maximize accuracy and ensure relevant output format.
 */

import { ErrorHandler } from './error_handler.js';

class PromptBuilder {
    /**
     * Builds a comprehensive prompt for the Gemini API to solve a quiz question.
     * @param {object} questionData - Object containing question text, options, and type.
     * - `question`: The main question string.
     * - `options`: Array of option objects `{ text: string, value: string, element: Element }`.
     * - `questionType`: 'single' or 'multiple'.
     * @param {boolean} includeExplanation - If true, requests an explanation for the answer.
     * @returns {Array<object>} An array of message parts (text, role) for the Gemini API.
     */
    static buildQuizPrompt(questionData, includeExplanation) {
        if (!questionData || !questionData.question || !questionData.options || questionData.options.length === 0) {
            ErrorHandler.logError('PromptBuilder: Invalid question data provided for prompt construction.');
            throw new Error('Invalid question data for prompt construction.');
        }

        const { question, options, questionType } = questionData;

        let optionsString = '';
        options.forEach((option) => {
            optionsString += `- ${option.text}\n`;
        });

        const systemInstruction = `You are an expert academic assistant. Provide accurate answers to quiz questions. You MUST respond with a valid JSON object.`;

        let schemaFormat = `{"answers": ["Exact Option Text 1", "Exact Option Text 2"]}`;
        if (questionType === 'single') {
             schemaFormat = `{"answers": ["Exact Option Text 1"]}`;
        }
        
        let formatInstruction = `Your response MUST be ONLY a JSON object in this format:\n${schemaFormat}\nExtract the exact option text as it appears in the choices. Do not prepend letters or bullets.`;
        if (includeExplanation) {
             formatInstruction = `Your response MUST be ONLY a JSON object in this format:\n{"answers": ["..."], "explanation": "clear, concise explanation here"}\nExtract the exact option text as it appears in the choices. Do not prepend letters or bullets.`;
        }

        const userPrompt = `Question: ${question}\n\nOptions:\n${optionsString}\n\n${formatInstruction}`;

        return [
            { role: "system", content: systemInstruction },
            { role: "user", content: userPrompt }
        ];
    }

    /**
     * Builds a comprehensive prompt for the Gemini API to solve a batch of quiz questions.
     * @param {Array<object>} questionsArray - Array of questionData objects.
     * @param {boolean} includeExplanation - If true, requests an explanation for the answers.
     * @returns {Array<object>} An array of message parts (text, role) for the API.
     */
    static buildBatchQuizPrompt(questionsArray, includeExplanation) {
        if (!questionsArray || questionsArray.length === 0) {
            ErrorHandler.logError('PromptBuilder: Invalid question data provided for batch prompt construction.');
            throw new Error('Invalid question data for batch prompt construction.');
        }

        const systemInstruction = `You are an expert academic assistant specializing in programming and computer science. \
Analyze each question carefully and provide accurate answers.

CRITICAL RULES:
1. For "multiple" (checkbox) questions: You MUST select ALL correct answers — there can be 2, 3, or even 4 correct options. NEVER return just one answer for a multiple-choice question unless you are absolutely certain only one is correct.
2. For "single" (radio) questions: Select exactly ONE correct answer.
3. Return the EXACT text of the options as given — do not paraphrase, shorten, or add letters/bullets.
4. You MUST respond with a valid JSON object containing answers for ALL questions.`;

        let questionsString = '';
        questionsArray.forEach((q, qIndex) => {
            let optionsString = '';
            q.options.forEach((option, oIdx) => {
                optionsString += `  ${oIdx + 1}. ${option.text}\n`;
            });
            const typeLabel = q.questionType === 'multiple'
                ? 'MULTIPLE SELECT (pick ALL correct answers — may be 2 or more)'
                : 'SINGLE SELECT (pick exactly one correct answer)';

            let questionBlock = `--- Question Index: ${qIndex} [${typeLabel}] ---\n${q.question}\nOptions:\n${optionsString}`;

            // If we have confirmed-correct answers from a previous attempt, tell the AI
            if (q.confirmedCorrectAnswers && q.confirmedCorrectAnswers.length > 0) {
                questionBlock += `\nNOTE: From a previous attempt, these answers are CONFIRMED CORRECT (already selected and verified):\n`;
                q.confirmedCorrectAnswers.forEach(ans => {
                    questionBlock += `  ✓ "${ans}"\n`;
                });
                questionBlock += `You MUST include the above confirmed answers in your response. Additionally, identify any OTHER correct answers from the remaining options that were MISSED in the previous attempt.\n`;
            }

            questionsString += questionBlock + '\n';
        });

        const explanationField = includeExplanation ? `, "explanation": "clear, concise explanation"` : '';

        // Show example with multiple answers for multi-select to avoid AI bias
        const formatInstruction = `Respond ONLY with a JSON object. Keys are question indices (as strings). Values contain exact option text(s).
For MULTIPLE SELECT questions, the "answers" array MUST contain ALL correct options.

Example format:
{
  "0": { "answers": ["Exact Option Text A", "Exact Option Text B"]${explanationField} },
  "1": { "answers": ["Exact Option Text C"]${explanationField} },
  "2": { "answers": ["Exact Option Text D", "Exact Option Text E", "Exact Option Text F"]${explanationField} }
}

Do NOT prepend letters (A., B.) or bullets to the answer text. Copy option text exactly as shown.`;

        const userPrompt = `Answer the following ${questionsArray.length} question(s):\n\n${questionsString}\n${formatInstruction}`;

        return [
            { role: "system", content: systemInstruction },
            { role: "user", content: userPrompt }
        ];
    }

    /**
     * Builds a prompt specifically for generating an explanation for an already selected answer.
     * @param {string} question - The original question text.
     * @param {Array<object>} options - The original options array from DOMDetector.
     * @param {string[]} selectedAnswerTexts - The text of the answers that were selected (e.g., ["Option A text", "Option B text"]).
     * @returns {Array<object>} An OpenAI API prompt.
     */
    static buildExplanationPrompt(question, options, selectedAnswerTexts) {
        if (!question || !options || options.length === 0 || !selectedAnswerTexts || selectedAnswerTexts.length === 0) {
            ErrorHandler.logError('PromptBuilder: Invalid data for explanation prompt construction.');
            throw new Error('Invalid data for explanation prompt construction.');
        }

        let optionsString = '';
        options.forEach((option, index) => {
            const letter = String.fromCharCode(65 + index);
            optionsString += `${letter}. ${option.text}\n`;
        });

        const selectedAnswersDisplay = selectedAnswerTexts.map(text => `"${text}"`).join(' and ');

        return [
            { role: "system", content: "You are an expert academic assistant. You MUST respond with a valid JSON object." },
            { role: "user", content: `For the following quiz question, provide a detailed but concise explanation for why the selected answer(s) are correct.\n\nQuestion: ${question}\n\nOptions:\n${optionsString}\n\nSelected Answer(s): ${selectedAnswersDisplay}\n\nReturn JSON: {"explanation": "your detailed explanation here"}` }
        ];
    }
}

export { PromptBuilder };
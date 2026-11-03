// utils/response_parser.js

/**
 * @module ResponseParser
 * @description Parses the raw JSON response from the NVIDIA API to extract
 * the identified correct answers and any requested explanations.
 * Designed to be flexible to various output formats.
 */

import { ErrorHandler } from './error_handler.js';

class ResponseParser {
    /**
     * Helper to safely extract and parse JSON from model output text.
     * @param {string} text 
     * @returns {object}
     */
    static extractJson(text) {
        if (!text) return null;
        let cleaned = text.replace(/```json/gi, '').replace(/```/g, '').trim();
        try {
            return JSON.parse(cleaned);
        } catch (e) {
            const match = text.match(/\{[\s\S]*\}/);
            if (match) {
                let candidate = match[0];
                try {
                    return JSON.parse(candidate);
                } catch (e2) {
                    try {
                        candidate = candidate.replace(/,\s*([\}\]])/g, '$1');
                        return JSON.parse(candidate);
                    } catch (e3) {
                        ErrorHandler.logError('ResponseParser: Failed to parse repaired JSON.', { candidate, error: e3 });
                        throw e2;
                    }
                }
            }
            throw e;
        }
    }

    /**
     * Parses the NVIDIA API response to extract quiz answers and explanations.
     * @param {object} nvidiaResponse - The raw JSON response object from the NVIDIA API.
     * @param {Array<object>} options - The original array of option objects from DOMDetector (includes {text, value, element}).
     * @param {'single'|'multiple'} questionType - The type of question.
     * @returns {object} An object containing:
     * - `answers`: Array of strings, each being the text of a correct answer.
     * - `explanation`: string or null, if an explanation was provided.
     * - `confidence`: number (0-100), inferred or directly from model (placeholder).
     * @throws {Error} If no valid answer or response text can be extracted.
     */
    static parseNvidiaQuizResponse(nvidiaResponse, options, questionType) {
        if (!nvidiaResponse || !nvidiaResponse.choices || nvidiaResponse.choices.length === 0) {
            ErrorHandler.logError('ResponseParser: Invalid or empty NVIDIA response received.', nvidiaResponse);
            throw new Error('Invalid or empty response from NVIDIA API.');
        }

        const choice = nvidiaResponse.choices[0];
        let responseText = choice?.message?.content || choice?.message?.reasoning_content;

        if (!responseText) {
            ErrorHandler.logError('ResponseParser: No text content found in NVIDIA response choice.', nvidiaResponse);
            throw new Error('No answer text provided by NVIDIA API.');
        }

        console.log('ResponseParser: NVIDIA raw response text:', responseText);

        let parsedJson = null;
        try {
            parsedJson = ResponseParser.extractJson(responseText);
        } catch (e) {
            ErrorHandler.logError('ResponseParser: Failed to parse JSON from NVIDIA response.', { responseText, error: e });
            throw new Error('Failed to parse JSON response from NVIDIA API.');
        }

        if (!parsedJson || (!parsedJson.answers && !parsedJson.explanation)) {
            ErrorHandler.logError('ResponseParser: JSON did not contain answers or explanation.', parsedJson);
            throw new Error('Invalid JSON structure returned by model.');
        }

        let finalParsedAnswers = [];
        if (parsedJson.answers && Array.isArray(parsedJson.answers)) {
            for (const ans of parsedJson.answers) {
                // 1st: exact match
                const exactMatch = options.find(opt => opt.text === ans);
                if (exactMatch && !finalParsedAnswers.includes(exactMatch.text)) {
                    finalParsedAnswers.push(exactMatch.text);
                    continue;
                }
                // 2nd: normalized (lowercase + trim + collapse whitespace)
                const normAns = ans.toLowerCase().replace(/\s+/g, ' ').trim();
                const normMatch = options.find(opt =>
                    opt.text.toLowerCase().replace(/\s+/g, ' ').trim() === normAns
                );
                if (normMatch && !finalParsedAnswers.includes(normMatch.text)) {
                    finalParsedAnswers.push(normMatch.text);
                } else {
                    console.warn(`ResponseParser: Could not match answer "${ans}" to any option.`);
                }
            }
        }

        if (finalParsedAnswers.length === 0 && parsedJson.answers && parsedJson.answers.length > 0) {
             console.warn("ResponseParser: Could not validate any answers from JSON against options. Falling back to the raw JSON answers.");
             finalParsedAnswers = parsedJson.answers;
        }

        if (finalParsedAnswers.length === 0 && !parsedJson.explanation) {
             ErrorHandler.logError('ResponseParser: Failed to extract any valid answer from response text.', responseText);
             throw new Error('ResponseParser: Failed to extract any valid answer from response text.');
        }

        return {
            answers: finalParsedAnswers,
            explanation: parsedJson.explanation || null,
            confidence: 100 // Placeholder. NVIDIA API doesn't directly provide confidence score.
        };
    }

    /**
     * Parses the NVIDIA API response for a batch of quiz questions.
     * @param {object} nvidiaResponse - The raw JSON response object from the NVIDIA API.
     * @param {Array<object>} questionsArray - The original array of questionData objects.
     * @returns {Array<object>} An array of parsed result objects in the same order as questionsArray.
     */
    static parseNvidiaBatchQuizResponse(nvidiaResponse, questionsArray) {
        if (!nvidiaResponse || !nvidiaResponse.choices || nvidiaResponse.choices.length === 0) {
            ErrorHandler.logError('ResponseParser: Invalid or empty NVIDIA batch response received.', nvidiaResponse);
            throw new Error('Invalid or empty batch response from NVIDIA API.');
        }

        const choice = nvidiaResponse.choices[0];
        let responseText = choice?.message?.content || choice?.message?.reasoning_content;

        if (!responseText) {
            ErrorHandler.logError('ResponseParser: No text content found in NVIDIA batch response choice.', nvidiaResponse);
            throw new Error('No answer text provided by NVIDIA API for batch.');
        }

        console.log('ResponseParser: NVIDIA raw batch response text:', responseText);

        let parsedJson = null;
        try {
            parsedJson = ResponseParser.extractJson(responseText);
        } catch (e) {
            ErrorHandler.logError('ResponseParser: Failed to parse JSON from NVIDIA batch response.', { responseText, error: e });
            throw new Error('Failed to parse JSON batch response from NVIDIA API.');
        }

        const results = [];
        for (let i = 0; i < questionsArray.length; i++) {
            const qData = questionsArray[i];
            const answerData = parsedJson[String(i)];

            if (!answerData) {
                console.warn(`ResponseParser: No answer data found for question index ${i}`);
                results.push({
                    status: 'error',
                    message: 'No answer found for this question in batch response.'
                });
                continue;
            }

            let finalParsedAnswers = [];
            if (answerData.answers && Array.isArray(answerData.answers)) {
                for (const ans of answerData.answers) {
                    // 1st: exact match
                    const exactMatch = qData.options.find(opt => opt.text === ans);
                    if (exactMatch && !finalParsedAnswers.includes(exactMatch.text)) {
                        finalParsedAnswers.push(exactMatch.text);
                        continue;
                    }
                    // 2nd: normalized (lowercase + trim + collapse whitespace)
                    const normAns = ans.toLowerCase().replace(/\s+/g, ' ').trim();
                    const normMatch = qData.options.find(opt =>
                        opt.text.toLowerCase().replace(/\s+/g, ' ').trim() === normAns
                    );
                    if (normMatch && !finalParsedAnswers.includes(normMatch.text)) {
                        finalParsedAnswers.push(normMatch.text);
                    } else {
                        console.warn(`ResponseParser (batch): Could not match answer "${ans}" to any option for question index ${i}.`);
                    }
                }
            }

            if (finalParsedAnswers.length === 0 && answerData.answers && answerData.answers.length > 0) {
                 finalParsedAnswers = answerData.answers;
            }

            if (finalParsedAnswers.length === 0 && !answerData.explanation) {
                results.push({
                    status: 'error',
                    message: 'Failed to extract valid answers.'
                });
            } else {
                results.push({
                    status: 'success',
                    answers: finalParsedAnswers,
                    explanation: answerData.explanation || null,
                    confidence: 100
                });
            }
        }

        return results;
    }
}

export { ResponseParser };

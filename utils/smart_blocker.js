// utils/smart_blocker.js

import { StorageManager } from './storage_manager.js';
import { ErrorHandler } from './error_handler.js';
import { CONSTANTS } from './constants.js';

class SmartBlocker {
    // A promise that ensures storage operations are executed sequentially.
    // Each new operation will chain after the previous one completes.
    static _pendingStorageOperation = Promise.resolve();

    /**
     * Generates a simple, consistent signature (hash) for a given text string.
     * This is used to identify questions and answer options across attempts,
     * making them resistant to minor UI changes but sensitive to content changes.
     * @param {string} text - The text to generate a signature for.
     * @returns {string} The generated signature.
     */
    static generateSignature(text) {
        if (!text || typeof text !== 'string') {
            return '';
        }
        // Normalize: lowercase, remove leading/trailing whitespace, collapse multiple spaces
        // Also remove common punctuation that doesn't alter meaning for robust matching
        const normalizedText = text
            .toLowerCase()
            .replace(/[.,/#!$%^&*;:{}=\-_`~()]/g, '') // Remove common punctuation
            .replace(/\s+/g, ' ') // Replace multiple spaces with single space
            .trim();
        
        // Simple string hash function (djb2 variant)
        let hash = 0;
        for (let i = 0; i < normalizedText.length; i++) {
            const char = normalizedText.charCodeAt(i);
            hash = ((hash << 5) - hash) + char;
            hash |= 0; // Convert to 32bit integer
        }
        return String(hash);
    }

    /**
     * Stores an incorrectly selected answer signature for a specific question within a quiz.
     * This operation is now chained to ensure sequential execution, preventing race conditions.
     * @param {string} courseId - The ID of the Coursera course (from URL).
     * @param {string} quizId - The ID of the quiz (from URL).
     * @param {string} questionSignature - The generated signature of the question.
     * @param {string} wrongAnswerSignature - The generated signature of the answer option that was wrong.
     */
    static async addWrongAnswer(courseId, quizId, questionSignature, wrongAnswerSignature) {
        console.log(`SmartBlocker: addWrongAnswer — quiz: ${courseId}_${quizId}, sig: ${wrongAnswerSignature}`);

        if (!courseId || !quizId || !questionSignature || !wrongAnswerSignature) {
            ErrorHandler.logError('SmartBlocker: Missing parameters for addWrongAnswer.', {courseId, quizId, questionSignature, wrongAnswerSignature});
            return;
        }

        const storageKey = CONSTANTS.STORAGE_KEYS.SMART_BLOCKER_DATA_KEY;
        const quizSpecificKey = `${courseId}_${quizId}`;

        SmartBlocker._pendingStorageOperation = SmartBlocker._pendingStorageOperation.then(async () => {
            try {
                // Use chrome.storage.local directly — StorageManager uses sync which has 8KB/item limit
                const raw = await chrome.storage.local.get(storageKey);
                const storedData = raw[storageKey] || {};
                const quizData = storedData[quizSpecificKey] || {};
                const questionWrongAnswers = quizData[questionSignature] || [];

                if (!questionWrongAnswers.includes(wrongAnswerSignature)) {
                    questionWrongAnswers.push(wrongAnswerSignature);
                    quizData[questionSignature] = questionWrongAnswers;
                    storedData[quizSpecificKey] = quizData;
                    await chrome.storage.local.set({ [storageKey]: storedData });
                    console.log(`SmartBlocker: ✅ Stored wrong answer for ${quizSpecificKey} / q:${questionSignature}`);
                } else {
                    console.log(`SmartBlocker: Already recorded wrong answer for q:${questionSignature}`);
                }
            } catch (error) {
                ErrorHandler.logError('SmartBlocker: Failed to add wrong answer', error);
            }
        }).catch(err => ErrorHandler.logError('SmartBlocker: Chain error', err));

        return SmartBlocker._pendingStorageOperation;
    }

    /**
     * Retrieves the list of previously marked wrong answer signatures for a given question in a quiz.
     * @param {string} courseId - The ID of the Coursera course.
     * @param {string} quizId - The ID of the quiz.
     * @param {string} questionSignature - The signature of the question to retrieve wrong answers for.
     * @returns {Promise<string[]>} A promise that resolves to an array of wrong answer signatures.
     * Returns an empty array if no data is found or an error occurs.
     */
    static async getWrongAnswers(courseId, quizId, questionSignature) {
        if (!courseId || !quizId || !questionSignature) return [];

        const storageKey = CONSTANTS.STORAGE_KEYS.SMART_BLOCKER_DATA_KEY;
        const quizSpecificKey = `${courseId}_${quizId}`;

        try {
            const raw = await chrome.storage.local.get(storageKey);
            const storedData = raw[storageKey] || {};
            const wrongAnswers = (storedData[quizSpecificKey] || {})[questionSignature] || [];
            console.log(`SmartBlocker: getWrongAnswers — ${quizSpecificKey} / q:${questionSignature} → [${wrongAnswers}]`);
            return wrongAnswers;
        } catch (error) {
            ErrorHandler.logError('SmartBlocker: Failed to retrieve wrong answers', error);
            return [];
        }
    }

    /**
     * Clears smart blocker data. Can clear for a specific quiz, or all data.
     * @param {string} [courseId] - Optional. The ID of the Coursera course.
     * @param {string} [quizId] - Optional. The ID of the quiz.
     */
    static async clearWrongAnswers(courseId, quizId) {
        const storageKey = CONSTANTS.STORAGE_KEYS.SMART_BLOCKER_DATA_KEY;
        try {
            if (courseId && quizId) {
                const quizSpecificKey = `${courseId}_${quizId}`;
                const storedData = await StorageManager.get(storageKey) || {};
                if (storedData[quizSpecificKey]) {
                    delete storedData[quizSpecificKey];
                    await StorageManager.set(storageKey, storedData);
                    console.log(`SmartBlocker: Cleared wrong answers for quiz ${quizSpecificKey}`);
                } else {
                    console.log(`SmartBlocker: No data found for quiz ${quizSpecificKey} to clear.`);
                }
            } else {
                await StorageManager.remove(storageKey); // Clear all if no specific quiz
                console.log('SmartBlocker: Cleared all smart blocker data.');
            }
        } catch (error) {
            ErrorHandler.logError('SmartBlocker: Failed to clear wrong answers data', error);
        }
    }

    // ─── Confirmed-Correct Answer Storage ────────────────────────────────────

    /**
     * Stores confirmed-correct answer texts for a question.
     * Called from quiz_result_parser when we see "Nice work" on a selected option.
     * @param {string} courseId
     * @param {string} quizId
     * @param {string} questionSignature
     * @param {string[]} correctAnswerTexts - Raw option texts that were correct
     */
    static async addCorrectAnswers(courseId, quizId, questionSignature, correctAnswerTexts) {
        if (!courseId || !quizId || !questionSignature || !correctAnswerTexts?.length) return;

        const storageKey = 'smartBlockerCorrectAnswers';
        const quizKey = `${courseId}_${quizId}`;

        SmartBlocker._pendingStorageOperation = SmartBlocker._pendingStorageOperation.then(async () => {
            try {
                const raw = await chrome.storage.local.get(storageKey);
                const storedData = raw[storageKey] || {};
                const quizData = storedData[quizKey] || {};
                quizData[questionSignature] = correctAnswerTexts;
                storedData[quizKey] = quizData;
                await chrome.storage.local.set({ [storageKey]: storedData });
                console.log(`SmartBlocker: ✅ Stored ${correctAnswerTexts.length} correct answer(s) for q:${questionSignature}`);
            } catch (error) {
                ErrorHandler.logError('SmartBlocker: Failed to store correct answers', error);
            }
        });
        return SmartBlocker._pendingStorageOperation;
    }

    /**
     * Retrieves confirmed-correct answer texts for a question.
     * @param {string} courseId
     * @param {string} quizId
     * @param {string} questionSignature
     * @returns {Promise<string[]>} Array of confirmed-correct answer texts (may be empty)
     */
    static async getCorrectAnswers(courseId, quizId, questionSignature) {
        if (!courseId || !quizId || !questionSignature) return [];
        const storageKey = 'smartBlockerCorrectAnswers';
        const quizKey = `${courseId}_${quizId}`;
        try {
            const raw = await chrome.storage.local.get(storageKey);
            const storedData = raw[storageKey] || {};
            return (storedData[quizKey] || {})[questionSignature] || [];
        } catch (error) {
            ErrorHandler.logError('SmartBlocker: Failed to retrieve correct answers', error);
            return [];
        }
    }
}

export { SmartBlocker };
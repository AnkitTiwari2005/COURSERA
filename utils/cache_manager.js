// utils/cache_manager.js

/**
 * @module CacheManager
 * @description Manages a local cache for previously solved quiz questions and their answers.
 * Uses `chrome.storage.local` for potentially larger data sets (compared to `sync`).
 */

// Note: StorageManager is not directly used here but typically exists if you have custom storage logic.
// import { StorageManager } from './storage_manager.js';
import { CONSTANTS } from './constants.js';
import { ErrorHandler } from './error_handler.js'; // Ensure ErrorHandler is imported here too

// Cache is stored as an object where keys are question hashes and values are answer objects
// { questionHash: { answers: [], explanation: null, confidence: 100 }, ... }

class CacheManager {
    /**
     * Retrieves a cached answer for a given question hash.
     * @param {string} questionHash - The unique hash of the question.
     * @returns {Promise<object|null>} The cached answer object, or null if not found.
     */
    static async get(questionHash) {
        try {
            const cachedAnswers = await chrome.storage.local.get(CONSTANTS.STORAGE_KEYS.CACHED_ANSWERS);
            if (cachedAnswers && cachedAnswers[CONSTANTS.STORAGE_KEYS.CACHED_ANSWERS]) {
                return cachedAnswers[CONSTANTS.STORAGE_KEYS.CACHED_ANSWERS][questionHash] || null;
            }
            return null;
        } catch (error) {
            ErrorHandler.logError(`CacheManager: Failed to retrieve cached answer for hash '${questionHash}'`, error);
            return null; // Return null on error, don't block
        }
    }

    /**
     * Stores a solved answer in the cache.
     * Implements basic cache size management (e.g., limit to X items or purge oldest).
     * @param {string} questionHash - The unique hash of the question.
     * @param {object} answerData - The answer object to cache.
     * @returns {Promise<void>}
     */
    static async set(questionHash, answerData) {
        try {
            let cachedAnswers = await chrome.storage.local.get(CONSTANTS.STORAGE_KEYS.CACHED_ANSWERS);
            cachedAnswers = cachedAnswers[CONSTANTS.STORAGE_KEYS.CACHED_ANSWERS] || {};

            // Basic cache size limit: Keep only the 500 most recent answers
            const maxCacheSize = 500;
            const keys = Object.keys(cachedAnswers);
            if (keys.length >= maxCacheSize) {
                // Find and remove the oldest entry by timestamp (safe with optional chaining)
                const oldestKey = keys.reduce((a, b) =>
                    (cachedAnswers[a]?.timestamp ?? 0) < (cachedAnswers[b]?.timestamp ?? 0) ? a : b
                );
                delete cachedAnswers[oldestKey];
            }

            cachedAnswers[questionHash] = { ...answerData, timestamp: Date.now() }; // Add timestamp for LRU-like eviction

            await chrome.storage.local.set({ [CONSTANTS.STORAGE_KEYS.CACHED_ANSWERS]: cachedAnswers });
            // console.log(`CacheManager: Cached answer for hash '${questionHash}'`);
        } catch (error) {
            ErrorHandler.logError(`CacheManager: Failed to set cached answer for hash '${questionHash}'`, error);
            // Non-critical error, do not re-throw
        }
    }

    /**
     * Generates a unique, deterministic hash for a quiz question.
     * The hash is SCOPED to the specific quiz so the same question in
     * different quizzes never collides in the cache.
     * @param {string} questionText - The text of the question.
     * @param {Array<object>} options - An array of option objects (each with a 'text' property).
     * @param {string} [quizId=''] - The quiz/assignment ID from the URL (scopes the cache per quiz).
     * @returns {string} The unique hash string.
     */
    static generateQuestionHash(questionText, options, quizId = '') {
        if (typeof questionText !== 'string' || !Array.isArray(options)) {
            ErrorHandler.logError('CacheManager: Invalid question data types for hash generation.', { questionText, options });
            return `invalid-hash-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
        }

        const normalizedQuestionText = questionText.trim().toLowerCase();
        const sortedOptions = options
            .map(opt => (opt && typeof opt.text === 'string' ? opt.text.trim().toLowerCase() : ''))
            .sort()
            .join('|');

        // Include quizId so same question text in different quizzes gets different cache entries
        const combinedString = `${quizId}::${normalizedQuestionText}::${sortedOptions}`;

        let hash = 0;
        for (let i = 0; i < combinedString.length; i++) {
            const char = combinedString.charCodeAt(i);
            hash = ((hash << 5) - hash) + char;
            hash |= 0;
        }
        return hash.toString();
    }

    /**
     * Clears the entire question cache.
     * @returns {Promise<void>}
     */
    static async clearCache() {
        try {
            await chrome.storage.local.remove(CONSTANTS.STORAGE_KEYS.CACHED_ANSWERS);
            console.log('CacheManager: Question cache cleared.');
        } catch (error) {
            ErrorHandler.logError('CacheManager: Failed to clear question cache.', error);
        }
    }
}

export { CacheManager };
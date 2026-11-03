// utils/constants.js

/**
 * @module CONSTANTS
 * @description Centralized module for all global constants used throughout the extension.
 * Ensures consistency and easy modification of critical values.
 */

const CONSTANTS = {
    // NVIDIA API Configuration
    NVIDIA_API_URL: 'https://integrate.api.nvidia.com/v1/chat/completions',
    NVIDIA_MODEL: 'nvidia/nemotron-3.5-super-vl-120b-a12b',
    
    // Chrome Storage Keys
    STORAGE_KEYS: {
        NVIDIA_API_KEY: 'nvidiaApiKey',
        SETTINGS_GROUP: 'solverSettings',
        SETTINGS: {
            AUTO_SOLVE: 'autoSolve',
            EXPLANATIONS: 'showExplanations',
            MIN_CONFIDENCE: 'minConfidence',
            DELAY_SOLVE_MS: 'delayBeforeSolveMs',
            AUTO_SUBMIT: 'autoSubmit'  // NEW: Auto-submit quiz after solving
        },
        CACHED_ANSWERS: 'cachedAnswers',
        SMART_BLOCKER_DATA_KEY: 'smartBlockerWrongAnswers'
    },

    // Inter-script Message Types
    MESSAGES: {
        SOLVE_QUESTION_REQUEST: 'SOLVE_QUESTION_REQUEST',    // Content Script -> Background
        SOLVE_BATCH_REQUEST: 'SOLVE_BATCH_REQUEST',
        SOLVER_STATUS_UPDATE: 'SOLVER_STATUS_UPDATE',        // Content Script -> Popup, Background -> Popup (optional)
        TRIGGER_SOLVER: 'TRIGGER_SOLVER',                    // Popup -> Content Script
        FETCH_SETTINGS_REQUEST: 'FETCH_SETTINGS_REQUEST',    // Content Script -> Background
        REPORT_INCORRECT_ANSWER: 'REPORT_INCORRECT_ANSWER',   // NEW: Content Script -> Background (for feedback)
        REPORT_CORRECT_ANSWERS: 'REPORT_CORRECT_ANSWERS'  // NEW: store confirmed-correct answers from feedback page
    },

    // Other configurations
    TOAST_DURATION_MS: 3000,
    TOOLTIP_DURATION_MS: 3000,
    DEBOUNCE_DELAY_MS: 1000 // For MutationObserver
};

export { CONSTANTS };

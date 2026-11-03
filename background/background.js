// background/background.js
console.log("Service Worker Started - Dynamic Module Injection for Result Parser"); // Updated log for clarity

/**
 * @module BackgroundServiceWorker
 * @description The main background service worker for the Coursera Gemini Solver.
 * Handles inter-script communication, Gemini API calls, and global extension logic.
 */
import { ApiClient } from '../utils/api_client.js';
import { StorageManager } from '../utils/storage_manager.js';
import { CONSTANTS } from '../utils/constants.js';
import { ErrorHandler } from '../utils/error_handler.js';
import { PromptBuilder } from '../utils/prompt_builder.js';
import { ResponseParser } from '../utils/response_parser.js';
import * as UrlParser from '../utils/url_parser.js'; // CHANGED: Import all from UrlParser
import { SmartBlocker } from '../utils/smart_blocker.js'; // MOVED: Statically import SmartBlocker here

// Define the patterns for Coursera quiz/assignment pages
const courseraQuizPatterns = [
    "https://www.coursera.org/learn/*/*/*/*/attempt*",
    "https://www.coursera.org/learn/*/*/*/*/quiz*", // Added for quiz pages generally
    "https://www.coursera.org/learn/*/*/*/*/exam*", // Added for exam pages
    "https://www.coursera.org/learn/*/*/*/*/assessment*" // Added for assessment pages
];

// Define patterns for Coursera quiz result pages
const courseraResultPatterns = [
    "https://www.coursera.org/learn/*/*/quiz/*/result*",
    "https://www.coursera.org/learn/*/exam/*/result*",
    "https://www.coursera.org/learn/*/assessment/*/result*",
    "https://www.coursera.org/learn/*/supplement/*/result*",
    "https://www.coursera.org/learn/*/assignment-submission/*/view-feedback*", // Covers cases like your example URL
    "https://www.coursera.org/learn/*/assignment-submission/*/*/view-feedback*" // More general for potentially nested slugs
];

// Function to check if a URL matches any of our patterns
function matchesPattern(url, patterns) {
    for (const pattern of patterns) {
        const regexPattern = pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\\\*/g, '.*?');
        const regex = new RegExp(`^${regexPattern}$`);
        if (regex.test(url)) {
            return true;
        }
    }
    return false;
}

async function handlePageNavigation(tabId, url) {
    if (!url || !url.startsWith("http")) return;

    const isQuizPage = matchesPattern(url, courseraQuizPatterns);
    const isResultPage = matchesPattern(url, courseraResultPatterns);

    if (isQuizPage && !isResultPage) {
        console.log(`Background: Coursera Quiz Page Detected: ${url}`);
        try {
            const results = await chrome.scripting.executeScript({
                target: { tabId: tabId },
                function: () => window.courseraSolverInjected
            });

            if (!results || !results[0] || !results[0].result) {
                await chrome.scripting.executeScript({
                    target: { tabId: tabId },
                    files: ['content_scripts/loader.js'],
                    injectImmediately: true
                });
                console.log("Background: loader.js injected successfully.");
            } else {
                console.log("Background: coursera_solver.js already injected.");
            }
        } catch (error) {
            console.error("Background: Failed to inject loader.js:", error);
        }
    } else if (isResultPage) {
        console.log(`Background: Coursera Quiz Result Page Detected: ${url}`);
        try {
            await chrome.scripting.executeScript({
                target: { tabId: tabId },
                files: ['content_scripts/quiz_result_loader.js'],
                injectImmediately: true
            });
            console.log("Background: quiz_result_loader.js injected successfully.");
        } catch (error) {
            console.error("Background: Failed to inject quiz_result_loader.js:", error);
        }
    }
}

// Listen for tab updates (initial load / hard refresh)
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (changeInfo.status === 'complete' && tab.url) {
        handlePageNavigation(tabId, tab.url);
    }
});

// Listen for SPA history navigation
if (chrome.webNavigation && chrome.webNavigation.onHistoryStateUpdated) {
    chrome.webNavigation.onHistoryStateUpdated.addListener((details) => {
        // webNavigation triggers for the main frame
        if (details.frameId === 0) {
            handlePageNavigation(details.tabId, details.url);
        }
    });
}

/**
 * Listener for messages from other parts of the extension (popup, content scripts).
 */
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === CONSTANTS.MESSAGES.SOLVE_QUESTION_REQUEST) {
        handleSolveQuestionRequest(message, sendResponse);
        return true; // Keep message channel open for async response
    } else if (message.type === CONSTANTS.MESSAGES.SOLVE_BATCH_REQUEST) {
        handleSolveBatchRequest(message, sendResponse);
        return true;
    } else if (message.type === CONSTANTS.MESSAGES.FETCH_SETTINGS_REQUEST) {
        handleFetchSettingsRequest(sendResponse);
        return true; // Keep message channel open for async response
    } else if (message.type === CONSTANTS.MESSAGES.REPORT_INCORRECT_ANSWER) {
        handleReportIncorrectAnswer(message, sender);
        return false;
    } else if (message.type === CONSTANTS.MESSAGES.REPORT_CORRECT_ANSWERS) {
        handleReportCorrectAnswers(message);
        return false;
    }
    return false;
});

async function handleSolveQuestionRequest(message, sendResponse) {
    console.log('Background: Received SOLVE_QUESTION_REQUEST', message.payload);
    const { questionData } = message.payload;
    try {
        const apiKey = await StorageManager.get(CONSTANTS.STORAGE_KEYS.NVIDIA_API_KEY);
        if (!apiKey) {
            sendResponse({
                status: 'error',
                message: 'NVIDIA API Key not found. Please set it in the extension popup.'
            });
            return;
        }

        const settings = await StorageManager.get(CONSTANTS.STORAGE_KEYS.SETTINGS_GROUP) || {};
        const showExplanations = settings[CONSTANTS.STORAGE_KEYS.SETTINGS.EXPLANATIONS] ?? false;

        const prompt = PromptBuilder.buildQuizPrompt(questionData, showExplanations);
        console.log('Background: Prompt built:', prompt);

        const nvidiaResponse = await ApiClient.callNvidiaApi(apiKey, prompt);
        console.log('Background: NVIDIA API Response:', nvidiaResponse);

        const parsedResult = ResponseParser.parseNvidiaQuizResponse(
            nvidiaResponse,
            questionData.options,
            questionData.questionType
        );

        if (!parsedResult || !parsedResult.answers.length) {
            sendResponse({
                status: 'error',
                message: 'Could not parse valid answers from NVIDIA response.'
            });
            return;
        }

        sendResponse({
            status: 'success',
            answers: parsedResult.answers,
            explanation: parsedResult.explanation || null,
            confidence: parsedResult.confidence || 100
        });

    } catch (error) {
        ErrorHandler.logError('Error solving question with NVIDIA API:', error, questionData);
        sendResponse({
            status: 'error',
            message: error.message || 'Failed to get answer from NVIDIA API. Check API key or network.',
            details: error.details
        });
    }
}

async function handleSolveBatchRequest(message, sendResponse) {
    console.log('Background: Received SOLVE_BATCH_REQUEST', message.payload);
    const { questionsArray } = message.payload;
    try {
        const apiKey = await StorageManager.get(CONSTANTS.STORAGE_KEYS.NVIDIA_API_KEY);
        if (!apiKey) {
            sendResponse({
                status: 'error',
                message: 'NVIDIA API Key not found. Please set it in the extension popup.'
            });
            return;
        }

        const settings = await StorageManager.get(CONSTANTS.STORAGE_KEYS.SETTINGS_GROUP) || {};
        const showExplanations = settings[CONSTANTS.STORAGE_KEYS.SETTINGS.EXPLANATIONS] ?? false;

        const prompt = PromptBuilder.buildBatchQuizPrompt(questionsArray, showExplanations);
        console.log('Background: Batch Prompt built:', prompt);

        const nvidiaResponse = await ApiClient.callNvidiaApi(apiKey, prompt);
        console.log('Background: NVIDIA API Batch Response:', nvidiaResponse);

        const parsedResults = ResponseParser.parseNvidiaBatchQuizResponse(
            nvidiaResponse,
            questionsArray
        );

        sendResponse({
            status: 'success',
            results: parsedResults
        });

    } catch (error) {
        ErrorHandler.logError('Error solving question batch with NVIDIA API:', error, questionsArray);
        sendResponse({
            status: 'error',
            message: error.message || 'Failed to get answer batch from NVIDIA API. Check API key or network.',
            details: error.details,
            statusCode: error.statusCode || null
        });
    }
}

async function handleFetchSettingsRequest(sendResponse) {
    try {
        const settings = await StorageManager.get(CONSTANTS.STORAGE_KEYS.SETTINGS_GROUP) || {};
        sendResponse({
            status: 'success',
            payload: {
                autoSolve: settings[CONSTANTS.STORAGE_KEYS.SETTINGS.AUTO_SOLVE] ?? true,
                showExplanations: settings[CONSTANTS.STORAGE_KEYS.SETTINGS.EXPLANATIONS] ?? false,
                minConfidence: settings[CONSTANTS.STORAGE_KEYS.SETTINGS.MIN_CONFIDENCE] ?? 70,
                delayBeforeSolveMs: settings[CONSTANTS.STORAGE_KEYS.SETTINGS.DELAY_SOLVE_MS] ?? 500,
                autoSubmit: settings[CONSTANTS.STORAGE_KEYS.SETTINGS.AUTO_SUBMIT] ?? false
            }
        });
    } catch (error) {
        ErrorHandler.logError('Error fetching settings for content script:', error);
        sendResponse({ status: 'error', message: 'Failed to load settings.' });
    }
}

async function handleReportIncorrectAnswer(message, sender) {
    const { courseId, quizId, questionSignature, wrongAnswerSignature } = message.payload;

    if (!courseId || !quizId || !questionSignature || !wrongAnswerSignature) {
        // Fallback: try extracting from sender URL if payload is missing IDs (legacy path)
        ErrorHandler.logError('Background: REPORT_INCORRECT_ANSWER missing IDs in payload', message.payload);
        return;
    }

    try {
        await SmartBlocker.addWrongAnswer(courseId, quizId, questionSignature, wrongAnswerSignature);
        console.log(`Background: ✅ Wrong answer recorded \u2014 quiz: ${courseId}_${quizId}, sig: ${wrongAnswerSignature}`);
    } catch (error) {
        ErrorHandler.logError('Background: Failed to record wrong answer', error);
    }
}


async function handleReportCorrectAnswers(message) {
    const { courseId, quizId, questionSignature, correctAnswerTexts } = message.payload;
    if (!courseId || !quizId || !questionSignature || !correctAnswerTexts?.length) return;
    try {
        await SmartBlocker.addCorrectAnswers(courseId, quizId, questionSignature, correctAnswerTexts);
        console.log(`Background: Stored ${correctAnswerTexts.length} confirmed-correct answer(s) for question ${questionSignature}.`);
    } catch (error) {
        ErrorHandler.logError('Background: Failed to store correct answers:', error);
    }
}

/**

 * Listener for extension installation/update.
 * Sets default settings on first install.
 */
chrome.runtime.onInstalled.addListener(async (details) => {
    if (details.reason === chrome.runtime.OnInstalledReason.INSTALL) {
        console.log("Extension installed. Setting default preferences.");
        try {
            // Set default settings only if not already present
            const currentSettings = await StorageManager.get(CONSTANTS.STORAGE_KEYS.SETTINGS_GROUP) || {};
            const defaultSettings = {
                [CONSTANTS.STORAGE_KEYS.SETTINGS.AUTO_SOLVE]: true,
                [CONSTANTS.STORAGE_KEYS.SETTINGS.EXPLANATIONS]: false,
                [CONSTANTS.STORAGE_KEYS.SETTINGS.MIN_CONFIDENCE]: 70,
                [CONSTANTS.STORAGE_KEYS.SETTINGS.DELAY_SOLVE_MS]: 500
            };
            // Merge defaults, but don't overwrite existing user settings
            await StorageManager.set(CONSTANTS.STORAGE_KEYS.SETTINGS_GROUP, { ...defaultSettings, ...currentSettings });
        } catch (error) {
            ErrorHandler.logError('Failed to set default settings on install:', error);
        }
    }
});
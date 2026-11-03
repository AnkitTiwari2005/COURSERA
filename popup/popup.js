// popup/popup.js

/**
 * @module Popup
 * @description Main script for the extension popup. Initializes UI components,
 * manages settings, and handles communication with the background script.
 */

import { ApiKeyInput } from './components/api_key_input.js';
import { StorageManager } from '../utils/storage_manager.js';
import { CONSTANTS } from '../utils/constants.js';
import { ErrorHandler } from '../utils/error_handler.js';

document.addEventListener('DOMContentLoaded', initializePopup);

/**
 * Initializes all components and event listeners when the popup DOM is loaded.
 */
async function initializePopup() {
    const apiKeyInputEl = document.getElementById('nvidiaApiKey');
    const saveApiKeyBtnEl = document.getElementById('saveApiKeyBtn');
    const apiKeyStatusEl = document.getElementById('apiKeyStatus');
    const triggerSolverBtnEl = document.getElementById('triggerSolverBtn');
    const solverStatusEl = document.getElementById('solverStatus');

    const autoSolveToggle = document.getElementById('autoSolveToggle');
    const autoSubmitToggle = document.getElementById('autoSubmitToggle');
    const explanationToggle = document.getElementById('explanationToggle');
    const confidenceThreshold = document.getElementById('confidenceThreshold');
    const confidenceValueSpan = document.getElementById('confidenceValue');
    const delayBeforeSolveInput = document.getElementById('delayBeforeSolve');

    // Initialize API Key management
    const apiKeyManager = new ApiKeyInput(apiKeyInputEl, saveApiKeyBtnEl, apiKeyStatusEl, triggerSolverBtnEl);

    // Load and set initial settings
    await loadSettings({
        autoSolveToggle, autoSubmitToggle, explanationToggle, confidenceThreshold,
        confidenceValueSpan, delayBeforeSolveInput
    });

    // Event Listeners for Settings
    autoSolveToggle.addEventListener('change', () => saveSetting(CONSTANTS.STORAGE_KEYS.SETTINGS.AUTO_SOLVE, autoSolveToggle.checked));
    autoSubmitToggle.addEventListener('change', () => saveSetting(CONSTANTS.STORAGE_KEYS.SETTINGS.AUTO_SUBMIT, autoSubmitToggle.checked));
    explanationToggle.addEventListener('change', () => saveSetting(CONSTANTS.STORAGE_KEYS.SETTINGS.EXPLANATIONS, explanationToggle.checked));
    
    confidenceThreshold.addEventListener('input', () => {
        confidenceValueSpan.textContent = `${confidenceThreshold.value}%`;
        saveSetting(CONSTANTS.STORAGE_KEYS.SETTINGS.MIN_CONFIDENCE, parseInt(confidenceThreshold.value));
    });
    
    delayBeforeSolveInput.addEventListener('change', () => {
        const delay = Math.max(0, parseInt(delayBeforeSolveInput.value) || 0);
        delayBeforeSolveInput.value = delay; // Ensure non-negative integer
        saveSetting(CONSTANTS.STORAGE_KEYS.SETTINGS.DELAY_SOLVE_MS, delay);
    });

    // Manual Trigger Solver Button
    triggerSolverBtnEl.addEventListener('click', async () => {
        solverStatusEl.textContent = 'Triggering solver...';
        solverStatusEl.className = 'status-message';
        try {
            const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
            if (tab) {
                // Send a message to the content script in the active tab
                // The content script will then initiate the solving process.
                const response = await chrome.tabs.sendMessage(tab.id, {
                    type: CONSTANTS.MESSAGES.TRIGGER_SOLVER,
                    payload: {
                        source: 'popup' // Indicate manual trigger from popup
                    }
                });

                if (response && response.status === 'success') {
                    solverStatusEl.textContent = `Solver activated. Found ${response.solvedCount || 0} questions.`;
                    solverStatusEl.className = 'status-message success';
                } else {
                     const errorMsg = response?.message || 'Failed to trigger solver.';
                    solverStatusEl.textContent = `Error: ${errorMsg}`;
                    solverStatusEl.className = 'status-message error';
                }
            } else {
                solverStatusEl.textContent = 'Error: No active tab found.';
                solverStatusEl.className = 'status-message error';
            }
        } catch (error) {
            ErrorHandler.logError('Error triggering solver from popup', error);
            solverStatusEl.textContent = 'An unexpected error occurred.';
            solverStatusEl.className = 'status-message error';
        } finally {
             setTimeout(() => {
                solverStatusEl.textContent = '';
                solverStatusEl.className = 'status-message';
            }, 5000);
        }
    });

    // Listen for messages from content scripts (e.g., solver completion status)
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
        if (message.type === CONSTANTS.MESSAGES.SOLVER_STATUS_UPDATE) {
            solverStatusEl.textContent = message.payload.message;
            solverStatusEl.className = `status-message ${message.payload.type}`;
             setTimeout(() => {
                solverStatusEl.textContent = '';
                solverStatusEl.className = 'status-message';
            }, 5000);
            sendResponse({ status: 'received' });
        }
        // Add more message types if needed
    });
}

/**
 * Loads user settings from storage and updates the UI.
 * @param {object} elements - Object containing references to setting UI elements.
 */
async function loadSettings(elements) {
    try {
        const settings = (await StorageManager.get(CONSTANTS.STORAGE_KEYS.SETTINGS_GROUP)) || {};
        elements.autoSolveToggle.checked = settings[CONSTANTS.STORAGE_KEYS.SETTINGS.AUTO_SOLVE] ?? true;
        elements.autoSubmitToggle.checked = settings[CONSTANTS.STORAGE_KEYS.SETTINGS.AUTO_SUBMIT] ?? false;
        elements.explanationToggle.checked = settings[CONSTANTS.STORAGE_KEYS.SETTINGS.EXPLANATIONS] ?? false;
        elements.confidenceThreshold.value = settings[CONSTANTS.STORAGE_KEYS.SETTINGS.MIN_CONFIDENCE] ?? 70;
        elements.confidenceValueSpan.textContent = `${elements.confidenceThreshold.value}%`;
        elements.delayBeforeSolveInput.value = settings[CONSTANTS.STORAGE_KEYS.SETTINGS.DELAY_SOLVE_MS] ?? 500;
    } catch (error) {
        ErrorHandler.logError('Failed to load settings', error);
        elements.autoSolveToggle.checked = true;
        elements.autoSubmitToggle.checked = false;
        elements.explanationToggle.checked = false;
        elements.confidenceThreshold.value = 70;
        elements.confidenceValueSpan.textContent = '70%';
        elements.delayBeforeSolveInput.value = 500;
    }
}

/**
 * Saves a single setting to storage.
 * @param {string} key - The storage key for the setting.
 * @param {*} value - The value to save.
 */
async function saveSetting(key, value) {
    try {
        // Settings are stored as a group object to minimize storage operations
        const settings = await StorageManager.get(CONSTANTS.STORAGE_KEYS.SETTINGS_GROUP) || {};
        settings[key] = value;
        await StorageManager.set(CONSTANTS.STORAGE_KEYS.SETTINGS_GROUP, settings);
        console.log(`Setting saved: ${key} = ${value}`); // For debugging
    } catch (error) {
        ErrorHandler.logError(`Failed to save setting: ${key}`, error);
    }
}
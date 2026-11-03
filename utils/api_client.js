// utils/api_client.js

/**
 * @module ApiClient
 * @description Centralized module for interacting with the NVIDIA API.
 * Handles API requests, headers, and basic error mapping.
 */

import { CONSTANTS } from './constants.js';
import { ErrorHandler } from './error_handler.js';

class ApiClient {
    /**
     * Calls the NVIDIA API with the provided prompt.
     * @param {string} apiKey - The user's NVIDIA API key.
     * @param {Array<object>} messages - The messages array for the NVIDIA API.
     * @param {number} [retries=3] - Number of retry attempts.
     * @param {number} [delay=1000] - Initial delay in milliseconds for exponential backoff.
     * @returns {Promise<object>} The parsed JSON response.
     */
    static async callNvidiaApi(apiKey, messages, retries = 3, delay = 1000) {
        if (!apiKey) {
            throw new Error('APIClient: NVIDIA API Key is missing.');
        }
        if (!Array.isArray(messages) || messages.length === 0) {
            throw new Error('APIClient: Invalid or empty prompt provided.');
        }

        const url = CONSTANTS.NVIDIA_API_URL;
        const body = JSON.stringify({
            model: CONSTANTS.NVIDIA_MODEL || "nvidia/nemotron-3.5-super-vl-120b-a12b",
            messages: messages,
            temperature: 0.1,
            top_p: 0.95,
            max_tokens: 8192,
            stream: false,
            chat_template_kwargs: { enable_thinking: false }
        });

        for (let i = 0; i <= retries; i++) {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 60000); // 60s timeout per attempt

            try {
                const response = await fetch(url, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Accept': 'application/json',
                        'Authorization': `Bearer ${apiKey}`
                    },
                    body: body,
                    signal: controller.signal
                });
                clearTimeout(timeoutId);

                if (!response.ok) {
                    const errorData = await response.json().catch(() => ({}));
                    let errorMessage = `NVIDIA API Error: ${response.status} ${response.statusText}`;

                    if (response.status === 401 || response.status === 403) {
                        errorMessage = `NVIDIA API Error: Invalid or Unauthorized API Key. Please check your key.`;
                    } else if (response.status === 429) {
                        errorMessage = `NVIDIA API Error (429): Rate limit exceeded. Please wait and try again.`;
                    } else if (errorData.error?.message) {
                        errorMessage = `NVIDIA API Error: ${errorData.error.message}`;
                    } else if (errorData.detail) {
                        errorMessage = `NVIDIA API Error: ${errorData.detail}`;
                    }
                    
                    const error = new Error(errorMessage);
                    error.statusCode = response.status;
                    error.details = errorData;
                    throw error;
                }

                const data = await response.json();
                if (!data || !data.choices || data.choices.length === 0) {
                    throw new Error('NVIDIA API returned no choices or empty response.');
                }
                return data;

            } catch (error) {
                clearTimeout(timeoutId);
                const isRetryable = error.name === 'AbortError' || error instanceof TypeError || error.statusCode === 429 || error.statusCode >= 500;
                if (i < retries && isRetryable) {
                    console.warn(`APIClient: Retrying API call (${i + 1}/${retries}). Error: ${error.message || error.name}`);
                    await new Promise(res => setTimeout(res, delay * Math.pow(2, i))); // Exponential backoff
                } else {
                    ErrorHandler.logError('APIClient: Failed to call NVIDIA API after retries:', error);
                    throw error; // Re-throw the error if no more retries or non-retryable error
                }
            }
        }
    }
}

export { ApiClient };

// utils/url_parser.js

/**
 * @module UrlParser
 * @description Utility functions for parsing Coursera URLs and extracting relevant identifiers.
 *
 * Coursera URL formats encountered in the wild:
 *
 * ATTEMPT pages:
 *   /learn/{course-slug}/quiz/{quiz-id}/attempt
 *   /learn/{course-slug}/assignment-submission/{assignment-id}/{quiz-slug}/attempt
 *   /learn/{course-slug}/assignment-submission/{assignment-id}/attempt
 *
 * FEEDBACK / RESULT pages:
 *   /learn/{course-slug}/quiz/{quiz-id}/result
 *   /learn/{course-slug}/assignment-submission/{assignment-id}/{quiz-slug}/view-feedback
 *   /learn/{course-slug}/assignment-submission/{assignment-id}/view-feedback
 *
 * NOTE: {course-slug} can contain a UUID suffix, e.g.:
 *   chandigarh-university-3e7fe97f-f1ae-4f30-8312-b3483cc48f3e
 * NOTE: {assignment-id} is a short opaque ID like "xQXno" or "qz39D"
 * NOTE: {quiz-slug} is a human-readable slug like "quiz-5" or "assignment-2"
 *
 * The cache key uses quizId = `{assignment-id}/{quiz-slug}` for assignment submissions
 * so that Quiz-4 and Quiz-5 under the same assignment-id get different cache entries.
 */

/**
 * Extracts courseId and quizId from a Coursera ATTEMPT page URL.
 * @param {string} url
 * @returns {{ courseId: string, quizId: string } | null}
 */
function extractCourseraIdentifiers(url) {
    if (!url) return null;

    // 1. Direct quiz page: /learn/{course}/quiz/{quizId}/attempt
    const directQuizPattern = /coursera\.org\/learn\/([^/]+)\/quiz\/([^/]+)\/attempt/;
    let match = url.match(directQuizPattern);
    if (match) {
        return { courseId: match[1], quizId: match[2] };
    }

    // 2. Assignment submission with quiz slug:
    //    /learn/{course}/assignment-submission/{assignmentId}/{quizSlug}/attempt
    const assignmentWithSlugPattern = /coursera\.org\/learn\/([^/]+)\/assignment-submission\/([^/]+)\/([^/]+)\/attempt/;
    match = url.match(assignmentWithSlugPattern);
    if (match) {
        // Use assignmentId + quizSlug combined as quizId for uniqueness
        return { courseId: match[1], quizId: `${match[2]}_${match[3]}` };
    }

    // 3. Assignment submission without quiz slug:
    //    /learn/{course}/assignment-submission/{assignmentId}/attempt
    const assignmentPattern = /coursera\.org\/learn\/([^/]+)\/assignment-submission\/([^/]+)\/attempt/;
    match = url.match(assignmentPattern);
    if (match) {
        return { courseId: match[1], quizId: match[2] };
    }

    console.warn(`UrlParser: extractCourseraIdentifiers — no match for URL: ${url}`);
    return null;
}

/**
 * Extracts courseId and quizId from a Coursera FEEDBACK / RESULT page URL.
 * @param {string} url
 * @returns {{ courseId: string, quizId: string, type: string } | null}
 */
function extractCourseAndQuizIdsFromResultUrl(url) {
    if (!url) return null;

    // 1. Assignment submission with quiz slug + view-feedback:
    //    /learn/{course}/assignment-submission/{assignmentId}/{quizSlug}/view-feedback
    const assignmentWithSlugFeedback = /coursera\.org\/learn\/([^/]+)\/assignment-submission\/([^/]+)\/([^/]+)\/view-feedback/;
    let match = url.match(assignmentWithSlugFeedback);
    if (match) {
        return {
            courseId: match[1],
            quizId: `${match[2]}_${match[3]}`,   // Same combined key as attempt URL
            type: 'assignmentQuizResult'
        };
    }

    // 2. Assignment submission without quiz slug + view-feedback:
    //    /learn/{course}/assignment-submission/{assignmentId}/view-feedback
    const assignmentFeedback = /coursera\.org\/learn\/([^/]+)\/assignment-submission\/([^/]+)\/view-feedback/;
    match = url.match(assignmentFeedback);
    if (match) {
        return { courseId: match[1], quizId: match[2], type: 'assignmentFeedback' };
    }

    // 3. Direct quiz result: /learn/{course}/quiz/{quizId}/result
    const directQuizResult = /coursera\.org\/learn\/([^/]+)\/quiz\/([^/]+)\/result/;
    match = url.match(directQuizResult);
    if (match) {
        return { courseId: match[1], quizId: match[2], type: 'quizResult' };
    }

    console.warn(`UrlParser: extractCourseAndQuizIdsFromResultUrl — no match for URL: ${url}`);
    return null;
}

export { extractCourseraIdentifiers, extractCourseAndQuizIdsFromResultUrl };
/**
 * Session management utilities
 * Handles generation and persistence of session IDs
 */

const SESSION_STORAGE_KEY = 'echo_chat_session_id';

/**
 * Generates a new session ID
 */
const generateSessionId = (): string => {
  return 'sesh_' + Math.random().toString(36).substring(2, 15) + 
         Math.random().toString(36).substring(2, 15);
};

/**
 * Gets the current session ID from sessionStorage
 * Generates a new one if it doesn't exist
 */
export const getOrCreateSessionId = (): string => {
  // Check if we're in a browser environment
  if (typeof window === 'undefined') {
    return generateSessionId();
  }

  // Try to get existing session ID
  let sessionId = sessionStorage.getItem(SESSION_STORAGE_KEY);
  
  // If no session ID exists, create and store a new one
  if (!sessionId) {
    sessionId = generateSessionId();
    try {
      sessionStorage.setItem(SESSION_STORAGE_KEY, sessionId);
    } catch (e) {
      console.warn('Failed to store session ID in sessionStorage', e);
    }
  }
  
  return sessionId;
};

/**
 * Clears the current session ID
 */
export const clearSession = (): void => {
  if (typeof window !== 'undefined') {
    sessionStorage.removeItem(SESSION_STORAGE_KEY);
  }
};

export default {
  getOrCreateSessionId,
  clearSession
};
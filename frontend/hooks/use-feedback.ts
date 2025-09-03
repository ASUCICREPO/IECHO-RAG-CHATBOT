"use client"

import { useState } from "react"

interface ApiError {
  detail: string;
  code?: string;
  timestamp?: string;
}

export function useFeedback() {
  const [showRatingDialog, setShowRatingDialog] = useState(false);
  const [selectedMessageId, setSelectedMessageId] = useState<string | null>(null);
  const [showSentConfirmation, setShowSentConfirmation] = useState(false);
  const [isFeedbackLoading, setIsFeedbackLoading] = useState(false);
  const [feedbackError, setFeedbackError] = useState<string | null>(null);

  const submitFeedback = async (rating: number, feedback: string, chatHistory: any[]) => {
    if (!selectedMessageId) {
      setFeedbackError('No message selected for feedback');
      return;
    }

    setIsFeedbackLoading(true);
    setFeedbackError(null);

    try {
      const message = chatHistory.find(m => m.id === selectedMessageId);
      
      if (!message || message.sender !== 'ai' || !message.responseId) {
        throw new Error('This message cannot be rated. Please select an AI response.');
      }

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000);

      const response = await fetch(`${process.env.NEXT_PUBLIC_API_BASE_URL}/feedback`, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        },
        body: JSON.stringify({
          userId: 'api-user',
          responseId: message.responseId,
          rating: rating,
          feedback: feedback?.trim() || undefined
        }),
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        const errorData: ApiError = await response.json().catch(() => ({
          detail: response.statusText || 'Unknown error occurred'
        }));
        throw new Error(errorData.detail || `HTTP error! status: ${response.status}`);
      }
      
      setShowRatingDialog(false);
      setSelectedMessageId(null);
      setShowSentConfirmation(true);
      
      const timer = setTimeout(() => {
        setShowSentConfirmation(false);
      }, 3000);
      
      return () => clearTimeout(timer);
      
    } catch (error) {
      console.error('Feedback submission error:', error);
      
      let errorMessage = 'Failed to submit feedback. Please try again.';
      
      if (error instanceof Error) {
        if (error.name === 'AbortError') {
          errorMessage = 'Request timed out. Please check your connection and try again.';
        } else if (error.message.includes('Failed to fetch') || error.message.includes('NetworkError')) {
          errorMessage = 'Network connection failed. Please check your internet connection and try again.';
        } else {
          errorMessage = error.message || errorMessage;
        }
      }
      
      setFeedbackError(errorMessage);
    } finally {
      setIsFeedbackLoading(false);
    }
  };

  const openRatingDialog = (messageId: string) => {
    setSelectedMessageId(messageId);
    setShowRatingDialog(true);
  };

  return {
    showRatingDialog,
    setShowRatingDialog,
    selectedMessageId,
    showSentConfirmation,
    setShowSentConfirmation,
    isFeedbackLoading,
    feedbackError,
    submitFeedback,
    openRatingDialog
  };
}
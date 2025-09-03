"use client"

import { useState, useEffect, useRef } from "react"
import session from '../utils/session'

const { getOrCreateSessionId } = session;

interface Citation {
  title: string;
  source: string;
}

interface ChatResponse {
  response: string;
  citations: Citation[];
  sessionId: string;
  responseId: string;
  userId: string;
  followUpQuestions?: string[];
}

interface ChatMessage {
  id: string;
  sender: 'user' | 'ai';
  text: string;
  responseId?: string;
  citations?: Citation[];
  error?: boolean;
  followUpQuestions?: string[];
  image?: string;
  thinking?: string;
  isThinking?: boolean;
}

export function useChat() {
  const [chatHistory, setChatHistory] = useState<ChatMessage[]>([]);
  const [isChatLoading, setIsChatLoading] = useState(false);
  const [chatError, setChatError] = useState<string | null>(null);
  const [latestResponseId, setLatestResponseId] = useState<string | null>(null);
  const [autoScroll, setAutoScroll] = useState(true);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (autoScroll && messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [chatHistory, autoScroll]);

  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return;

    const handleScroll = () => {
      const { scrollTop, scrollHeight, clientHeight } = container;
      const isAtBottom = scrollHeight - scrollTop - clientHeight < 50;
      setAutoScroll(isAtBottom);
    };

    container.addEventListener('scroll', handleScroll);
    return () => container.removeEventListener('scroll', handleScroll);
  }, []);

  useEffect(() => {
    if (isChatLoading) {
      setAutoScroll(true);
    }
  }, [isChatLoading]);

  const sendMessage = async (messageText: string, selectedImage?: string | null) => {
    if (!messageText.trim() || isChatLoading) return;
    
    setIsChatLoading(true);
    setChatError(null);
    
    const userMessageId = `user-${Date.now()}`;
    
    setChatHistory(prev => [...prev, { 
      id: userMessageId,
      sender: 'user', 
      text: messageText,
      image: selectedImage || undefined
    }]);

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 30000);

      const response = await fetch(`${process.env.NEXT_PUBLIC_API_BASE_URL}/chat-stream`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          query: messageText, 
          userId: 'api-user',
          sessionId: getOrCreateSessionId(),
          image: selectedImage
        }),
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        let errorMessage = `HTTP error! status: ${response.status}`;
        try {
          const errorData = await response.json();
          errorMessage = errorData.detail || errorMessage;
        } catch (parseError) {}
        throw new Error(errorMessage);
      }
      
      const reader = response.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let streamedText = '';
      let thinkingText = '';
      let finalData: ChatResponse | null = null;
      const aiMessageId = `ai-${Date.now()}`;
      
      setChatHistory(prev => [...prev, { 
        id: aiMessageId,
        sender: 'ai', 
        text: '',
        citations: [],
        thinking: '',
        isThinking: false
      }]);

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';

          for (const line of lines) {
            if (line.trim()) {
              try {
                const data = JSON.parse(line);
                
                if (data.type === 'thinking_start') {
                  setChatHistory(prev => prev.map(msg => 
                    msg.id === aiMessageId ? { ...msg, isThinking: true } : msg
                  ));
                } else if (data.type === 'thinking' && data.data) {
                  thinkingText += data.data;
                  setChatHistory(prev => prev.map(msg => 
                    msg.id === aiMessageId ? { ...msg, thinking: thinkingText } : msg
                  ));
                  await new Promise(resolve => setTimeout(resolve, 30));
                } else if (data.type === 'thinking_end') {
                  setChatHistory(prev => prev.map(msg => 
                    msg.id === aiMessageId ? { ...msg, isThinking: false } : msg
                  ));
                } else if (data.type === 'content' && data.data) {
                  streamedText += data.data;
                  setChatHistory(prev => prev.map(msg => 
                    msg.id === aiMessageId ? { ...msg, text: streamedText } : msg
                  ));
                  await new Promise(resolve => setTimeout(resolve, 30));
                } else if (data.response && data.citations !== undefined) {
                  finalData = data;
                }
              } catch (parseError) {
                console.warn('Parse error:', parseError);
              }
            }
          }
        }
      } finally {
        reader.releaseLock();
      }

      if (finalData) {
        setLatestResponseId(finalData.responseId);
        
        setChatHistory(prev => prev.map(msg => 
          msg.id === aiMessageId 
            ? { 
                ...msg, 
                text: finalData.response,
                responseId: finalData.responseId,
                citations: finalData.citations || [],
                followUpQuestions: finalData.followUpQuestions || [],
                isThinking: false
              }
            : msg
        ));
      }

    } catch (error) {
      console.error('Chat error:', error);
      
      let errorMessage = 'Connection failed. Please check your internet and try again.';
      let isRetryable = true;
      
      if (error instanceof Error) {
        if (error.name === 'AbortError') {
          errorMessage = 'Request timed out. The server may be busy, please try again.';
        } else if (error.message.includes('Failed to fetch') || error.message.includes('NetworkError')) {
          errorMessage = 'Network connection failed. Please check your internet connection and try again.';
        } else if (error.message.includes('HTTP error! status: 5')) {
          errorMessage = 'Server error. Our team has been notified. Please try again in a few minutes.';
        } else if (error.message.includes('HTTP error! status: 4')) {
          errorMessage = 'Request error. Please check your input and try again.';
          isRetryable = false;
        } else {
          errorMessage = error.message
            .replace(/^Internal server error: \d+: /, '')
            .replace(/^HTTP error! status: \d+/, 'Connection error');
        }
      }
      
      const errorMessageId = `error-${Date.now()}`;
      setChatHistory(prev => [...prev, {
        id: errorMessageId,
        sender: 'ai',
        text: `❌ ${errorMessage}${isRetryable ? '\n\n🔄 Click "Try again" below to retry your message.' : ''}`,
        error: true
      }]);
      
      setChatError(null);
    } finally {
      setIsChatLoading(false);
    }
  };

  const retryMessage = (messageId: string) => {
    const errorIndex = chatHistory.findIndex(m => m.id === messageId);
    if (errorIndex > 0) {
      const userMessage = chatHistory[errorIndex - 1];
      if (userMessage.sender === 'user') {
        setChatHistory(prev => prev.filter(m => m.id !== messageId));
        sendMessage(userMessage.text, userMessage.image);
      }
    }
  };

  const resetChat = () => {
    setChatHistory([]);
    setChatError(null);
    setLatestResponseId(null);
  };

  return {
    chatHistory,
    isChatLoading,
    chatError,
    latestResponseId,
    messagesEndRef,
    scrollContainerRef,
    sendMessage,
    retryMessage,
    resetChat
  };
}
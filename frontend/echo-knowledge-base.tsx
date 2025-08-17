"use client"

import { useState, useEffect, useMemo, useRef } from "react"
import session from './utils/session'
const { getOrCreateSessionId } = session;
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { 
  AlertCircle,
  ArrowRight, 
  ChevronDown, 
  Globe, 
  Heart, 
  Home, 
  Lightbulb,
  MessageSquare, 
  Mic, 
  MoreVertical, 
  RefreshCw,
  Send, 
  Star, 
  X 
} from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Textarea } from "@/components/ui/textarea"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"


const questionCards = [
  "What causes TB?",
  "What are the main symptoms of pulmonary TB?",
  "What is Ni-Kshay used for?",
  "How to improve crop irrigation efficiency?",
  "What are sustainable farming practices?",
  "What is crop rotation?",
]

interface Citation {
  title: string;
  source: string;
}

interface ApiError {
  detail: string;
  code?: string;
  timestamp?: string;
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
}

function CitationList({ citations }: { citations: Citation[] }) {
  const [expanded, setExpanded] = useState(false);

  if (!citations?.length) return null;

  return (
    <div className="mt-2 text-sm">
      <button 
        onClick={() => setExpanded(!expanded)}
        className="text-blue-600 hover:text-blue-800 flex items-center gap-1 text-xs"
      >
        {expanded ? 'Hide sources' : `Show sources (${citations.length})`}
        <ChevronDown className={`w-3 h-3 transition-transform ${expanded ? 'rotate-180' : ''}`} />
      </button>
      
      {expanded && (
        <div className="mt-2 space-y-1.5">
          {citations.map((cite, i) => (
            <div key={i} className="p-2 bg-gray-50 border border-gray-200 rounded text-xs">
              {cite.source.startsWith('s3://') ? (
                <button 
                  onClick={async () => {
                    try {
                      const encodedPath = encodeURIComponent(cite.source);
                      const response = await fetch(`${process.env.NEXT_PUBLIC_API_BASE_URL}/document-url/${encodedPath}`);
                      if (!response.ok) {
                        throw new Error(`HTTP ${response.status}`);
                      }
                      const data = await response.json();
                      if (data.url) {
                        window.open(data.url, '_blank');
                      } else {
                        alert('Document URL not available');
                      }
                    } catch (error) {
                      console.error('Failed to get document URL:', error);
                      alert('Failed to open document');
                    }
                  }}
                  className="text-left text-blue-700 hover:text-blue-900 hover:bg-blue-100 px-1 py-0.5 rounded transition-colors text-xs font-medium break-words"
                >
                  📄 {cite.source.split('/').pop()?.replace('.pdf', '') || cite.source}
                </button>
              ) : (
                <span className="text-gray-600 text-xs break-words">
                  📄 {cite.source}
                </span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ChatMessage({ message, onRate, onFollowUpClick }: { 
  message: ChatMessage, 
  onRate: () => void,
  onFollowUpClick?: (question: string) => void 
}) {
  return (
    <>
      <div className={`flex ${message.sender === 'user' ? 'justify-end' : 'justify-start'} mb-4 items-start gap-3`}>
      {/* Chatbot Avatar - Left side */}
      {message.sender === 'ai' && (
        <Avatar className="w-8 h-8 bg-[#fb2c36] text-white flex-shrink-0">
          <AvatarFallback className="bg-[#fb2c36] text-white font-bold">E</AvatarFallback>
        </Avatar>
      )}
      
      <div className={`max-w-[80%] p-2 sm:p-3 rounded-lg ${
        message.sender === 'user' 
          ? 'bg-blue-600 text-white' 
          : 'bg-white text-gray-800 border border-gray-200'
      }`}>
        <div className="whitespace-pre-wrap text-xs sm:text-base">
          {message.sender === 'ai' ? (
            <div dangerouslySetInnerHTML={{
              __html: message.text
                // Headers
                .replace(/^### (.*$)/gm, '<h3 class="text-sm sm:text-lg font-semibold mt-2 sm:mt-3 mb-1 sm:mb-2">$1</h3>')
                .replace(/^## (.*$)/gm, '<h2 class="text-base sm:text-xl font-semibold mt-2 sm:mt-4 mb-1 sm:mb-2">$1</h2>')
                .replace(/^# (.*$)/gm, '<h1 class="text-lg sm:text-2xl font-bold mt-2 sm:mt-4 mb-2 sm:mb-3">$1</h1>')
                // Bold and italic
                .replace(/\*\*(.*?)\*\*/g, '<strong class="font-semibold">$1</strong>')
                .replace(/\*(.*?)\*/g, '<em class="italic">$1</em>')
                // Code
                .replace(/`(.*?)`/g, '<code class="bg-gray-200 px-1 rounded text-xs sm:text-sm font-mono">$1</code>')
                // Lists
                .replace(/^\* (.*$)/gm, '<li class="ml-3 sm:ml-4 list-disc">$1</li>')
                .replace(/^- (.*$)/gm, '<li class="ml-3 sm:ml-4 list-disc">$1</li>')
                .replace(/^\d+\. (.*$)/gm, '<li class="ml-3 sm:ml-4 list-decimal">$1</li>')
                // Links
                .replace(/\[([^\]]+)\]\(([^\)]+)\)/g, '<a href="$2" class="text-blue-600 hover:underline" target="_blank" rel="noopener noreferrer">$1</a>')
                // Line breaks
                .replace(/\n/g, '<br>')
            }} />
          ) : (
            message.text
          )}
        </div>
        
        {/* Citations */}
        {message.sender === 'ai' && message.citations && message.citations.length > 0 && (
          <div className="mt-2">
            <CitationList citations={message.citations} />
          </div>
        )}
        

      </div>
      
      {/* User Avatar - Right side */}
      {message.sender === 'user' && (
        <Avatar className="w-8 h-8 bg-blue-600 text-white flex-shrink-0">
          <AvatarFallback className="bg-blue-600 text-white font-bold">U</AvatarFallback>
        </Avatar>
      )}
      </div>
      
      {/* Follow-up Questions - Only show for the latest AI message */}
      {message.sender === 'ai' && message.followUpQuestions && message.followUpQuestions.length > 0 && onFollowUpClick && (
        <div className="max-w-[80%] ml-11 mb-4 space-y-2">
          <div className="flex items-center gap-2 mb-2">
            <Lightbulb className="w-4 h-4 text-blue-600" />
            <span className="text-blue-600 font-medium text-sm">Follow-up questions:</span>
          </div>
          <div className="space-y-2">
            {message.followUpQuestions.map((question, index) => (
              <button
                key={index}
                className="w-full text-left p-1.5 sm:p-2 bg-white border border-blue-200 hover:bg-blue-50 text-blue-600 rounded-lg transition-colors duration-200 flex items-start gap-2"
                onClick={() => onFollowUpClick(question)}
              >
                <ArrowRight className="w-3 h-3 sm:w-4 sm:h-4 text-blue-500 flex-shrink-0 mt-0.5" />
                <span className="text-xs sm:text-sm leading-tight break-all">{question}</span>
              </button>
            ))}
          </div>
        </div>
      )}
      
      {/* Feedback Button - Below the message box */}
      {message.sender === 'ai' && message.responseId && (
        <div className="flex justify-start ml-11 -mt-2">
          <button 
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              onRate();
            }}
            className="text-xs text-yellow-400 hover:text-yellow-500 flex items-center gap-1 font-medium"
          >
            <Star className="w-3 h-3" strokeWidth={2.5} />
            Rate this response
          </button>
        </div>
      )}
    </>
  );
}

// API Status Indicator Component
function ApiStatusIndicator({ status }: { status: 'loading' | 'online' | 'offline' | 'error' }) {
  const statusConfig = {
    loading: { text: 'Connecting...', color: 'bg-yellow-500' },
    online: { text: 'Online', color: 'bg-green-500' },
    offline: { text: 'Offline', color: 'bg-gray-500' },
    error: { text: 'Connection Error', color: 'bg-red-500' }
  };

  const { text, color } = statusConfig[status] || statusConfig.offline;

  return (
    <div className="flex items-center text-xs text-gray-600 dark:text-gray-400">
      <span className="mr-2">API Status:</span>
      <span className={`inline-block w-2 h-2 rounded-full ${color} mr-1`}></span>
      <span>{text}</span>
    </div>
  );
}

// Check API health status
async function checkApiHealth(apiBaseUrl: string): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000); // 5 second timeout

    const response = await fetch(`${apiBaseUrl}/health`, {
      method: 'GET',
      headers: { 'Accept': 'application/json' },
      signal: controller.signal
    });

    clearTimeout(timeoutId);
    
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const data = await response.json();
    return data.status === 'healthy';
  } catch (error) {
    console.error('Health check failed:', error);
    return false;
  }
}

export default function Component() {
  // Chat state
  const [chatHistory, setChatHistory] = useState<ChatMessage[]>([]);
  const [isChatLoading, setIsChatLoading] = useState<boolean>(false);
  const [chatError, setChatError] = useState<string | null>(null);
  const [latestResponseId, setLatestResponseId] = useState<string | null>(null);
  const [apiStatus, setApiStatus] = useState<'loading' | 'online' | 'offline' | 'error'>('loading');
  const [lastHealthCheck, setLastHealthCheck] = useState<Date | null>(null);
  const [query, setQuery] = useState<string>("");
  const [currentPage, setCurrentPage] = useState<string>("home");
  const [showRatingDialog, setShowRatingDialog] = useState<boolean>(false);
  const [selectedRating, setSelectedRating] = useState<number>(0);
  const [feedback, setFeedback] = useState<string>("");
  const [showSentConfirmation, setShowSentConfirmation] = useState<boolean>(false);
  const [isFeedbackLoading, setIsFeedbackLoading] = useState<boolean>(false);
  const [feedbackError, setFeedbackError] = useState<string | null>(null);
  const [selectedLanguage, setSelectedLanguage] = useState<string>("EN");
  const [selectedMessageId, setSelectedMessageId] = useState<string | null>(null);
  const [autoScroll, setAutoScroll] = useState(true);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const [showQuickStart, setShowQuickStart] = useState(true);
  const [currentFollowUps, setCurrentFollowUps] = useState<string[]>([]);
  
  // Auto-scroll to bottom when new messages arrive or during streaming
  useEffect(() => {
    if (autoScroll && messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [chatHistory, autoScroll]);

  // Handle scroll events to detect user interruption
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

  // Re-enable auto-scroll when streaming starts
  useEffect(() => {
    if (isChatLoading) {
      setAutoScroll(true);
    }
  }, [isChatLoading]);

  // Check API health on component mount and periodically
  useEffect(() => {
    const apiBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL;
    if (!apiBaseUrl) {
      setApiStatus('error');
      setChatError('API base URL is not configured');
      return;
    }

    const checkHealth = async () => {
      try {
        setApiStatus('loading');
        const isHealthy = await checkApiHealth(apiBaseUrl);
        setApiStatus(isHealthy ? 'online' : 'offline');
        setLastHealthCheck(new Date());
      } catch (error) {
        console.error('Health check failed:', error);
        setApiStatus('error');
      }
    };

    // Initial check
    checkHealth();

    // Periodic check every 5 minutes
    const intervalId = setInterval(checkHealth, 5 * 60 * 1000);

    // Cleanup interval on component unmount
    return () => clearInterval(intervalId);
  }, []);

  // Send chat message
  const handleFeedbackSubmit = async () => {
    // Validate inputs
    if (selectedRating === 0) {
      setFeedbackError('Please select a rating');
      return;
    }

    if (!selectedMessageId) {
      setFeedbackError('No message selected for feedback');
      return;
    }

    setIsFeedbackLoading(true);
    setFeedbackError(null);

    try {
      // Find the message being rated
      const message = chatHistory.find(m => m.id === selectedMessageId);
      
      // Validate message
      if (!message || message.sender !== 'ai' || !message.responseId) {
        throw new Error('This message cannot be rated. Please select an AI response.');
      }

      // Create a controller for the fetch request to support timeout
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000); // 10 second timeout

      // Send feedback to the server
      const response = await fetch(`${process.env.NEXT_PUBLIC_API_BASE_URL}/feedback`, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        },
        body: JSON.stringify({
          userId: 'api-user', // TODO: Replace with actual user ID when auth is implemented
          responseId: message.responseId,
          rating: selectedRating,
          feedback: feedback?.trim() || undefined
        }),
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      // Handle non-OK responses
      if (!response.ok) {
        const errorData: ApiError = await response.json().catch(() => ({
          detail: response.statusText || 'Unknown error occurred'
        }));
        throw new Error(errorData.detail || `HTTP error! status: ${response.status}`);
      }
      
      // Reset form state on success
      setShowRatingDialog(false);
      setSelectedRating(0);
      setFeedback('');
      setSelectedMessageId(null);
      
      // Show success confirmation
      setShowSentConfirmation(true);
      
      // Hide confirmation after 3 seconds
      const timer = setTimeout(() => {
        setShowSentConfirmation(false);
      }, 3000);
      
      // Cleanup timer on component unmount
      return () => clearTimeout(timer);
      
    } catch (error) {
      console.error('Feedback submission error:', error);
      
      // Format user-friendly error message
      let errorMessage = 'Failed to submit feedback. Please try again.';
      
      if (error instanceof Error) {
        if (error.name === 'AbortError') {
          errorMessage = 'Request timed out. Please check your connection and try again.';
        } else {
          errorMessage = error.message || errorMessage;
        }
      }
      
      setFeedbackError(errorMessage);
    } finally {
      setIsFeedbackLoading(false);
    }
  };

  const handleSend = async (messageText?: string) => {
    const textToSend = messageText || query.trim();
    if (!textToSend || isChatLoading) return;
    
    setIsChatLoading(true);
    setChatError(null);
    
    // Clear follow-up questions when user starts typing a new message
    setCurrentFollowUps([]);
    
    // Hide quick start when user sends a message
    setShowQuickStart(false);
    
    const userMessage = textToSend;
    const userMessageId = `user-${Date.now()}`;
    
    // Add user message to history
    setChatHistory(prev => [...prev, { 
      id: userMessageId,
      sender: 'user', 
      text: userMessage 
    }]);
    
    if (!messageText) setQuery("");

    try {
      // Create a controller for the fetch request to support timeout
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 30000); // 30 second timeout

      const response = await fetch(`${process.env.NEXT_PUBLIC_API_BASE_URL}/chat-stream`, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ 
          query: userMessage, 
          userId: 'api-user',
          sessionId: getOrCreateSessionId()
        }),
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      
      const reader = response.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let streamedText = '';
      let finalData: ChatResponse | null = null;
      const aiMessageId = `ai-${Date.now()}`;
      
      // Add placeholder AI message
      setChatHistory(prev => [...prev, { 
        id: aiMessageId,
        sender: 'ai', 
        text: '',
        citations: []
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
                
                if (data.type === 'content' && data.data) {
                  streamedText += data.data;
                  setChatHistory(prev => prev.map(msg => 
                    msg.id === aiMessageId 
                      ? { ...msg, text: streamedText }
                      : msg
                  ));
                  // Add delay to slow down streaming effect
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
        
        // Update current follow-ups
        if (finalData.followUpQuestions && finalData.followUpQuestions.length > 0) {
          setCurrentFollowUps(finalData.followUpQuestions);
        }
        
        setChatHistory(prev => prev.map(msg => 
          msg.id === aiMessageId 
            ? { 
                ...msg, 
                text: finalData.response,
                responseId: finalData.responseId,
                citations: finalData.citations || [],
                followUpQuestions: finalData.followUpQuestions || []
              }
            : msg
        ));
      }

    } catch (error) {
      console.error('Chat error:', error);
      
      const errorMessage = error instanceof Error ? 
        error.message : 'Failed to get response from the chatbot. Please try again.';
      
      setChatHistory(prev => [...prev, { 
        id: `error-${Date.now()}`,
        sender: 'ai', 
        text: `Error: ${errorMessage}`,
        error: true
      }]);
      
      setChatError(errorMessage);
    } finally {
      setIsChatLoading(false);
    }
  }

  const handleFollowUpClick = (question: string) => {
    // Clear current follow-ups when a follow-up is clicked
    setCurrentFollowUps([]);
    // Send the follow-up question
    handleSend(question);
  };





  // Health check function 
  const fetchHealth = async () => {
    try {
      const res = await fetch(`${process.env.NEXT_PUBLIC_API_BASE_URL}/health`);
      if (res.ok) {
        const data = await res.json();
        setApiStatus(data.status === 'healthy' ? 'online' : 'offline');
      } else {
        setApiStatus('offline');
      }
    } catch (error) {
      console.error('Health check failed:', error);
      setApiStatus('error');
    }
  };

  // Health check on mount and periodically
  useEffect(() => {
    fetchHealth();
    // Check health every 60 seconds
    const intervalId = setInterval(fetchHealth, 60000);
    return () => clearInterval(intervalId);
  }, []);

  const handleQuestionClick = (question: string) => {
    if (question === "What is Ni-Kshay used for?") {
      setCurrentPage("nikshay-answer");
    }
  };

  const goHome = () => {
    setCurrentPage("home")
  }

  if (currentPage === "nikshay-answer") {
    return (
      <div className="flex flex-col h-screen bg-gray-50 dark:bg-gray-900">
        {/* Header */}
        <header className="bg-white dark:bg-gray-800 shadow-sm">
          <div className="max-w-7xl mx-auto px-4 py-3 sm:px-6 lg:px-8">
            <div className="flex justify-between items-center">
              <div className="flex items-center">
                <img
                  src="https://hebbkx1anhila5yf.public.blob.vercel-storage.com/image-QuV3bpvNh9r2l0UYMmNrFvG1GotwpE.png"
                  alt="ECHO India Project ECHO logo"
                  className="h-10 w-auto"
                />
                <Button variant="ghost" size="icon" onClick={goHome} className="ml-4">
                  <Home className="w-5 h-5" />
                </Button>
              </div>
              <div className="flex items-center space-x-4">
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="outline"
                      className="bg-[#000000] text-[#ffffff] border-[#000000] hover:bg-[#101828] rounded-lg px-3 py-1.5 h-auto"
                    >
                      <Globe className="w-4 h-4 mr-1" />
                      {selectedLanguage}
                      <ChevronDown className="w-4 h-4 ml-1" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="bg-white border border-[#e5e7eb] rounded-lg shadow-lg">
                    <DropdownMenuItem onClick={() => setSelectedLanguage("EN")}>English (EN)</DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
                <Button variant="ghost" size="icon">
                  <MoreVertical className="w-5 h-5" />
                </Button>
              </div>
            </div>
          </div>
        </header>

        {/* Chat Content */}
        <main className="flex-1 overflow-y-auto">
          <div className="max-w-4xl mx-auto p-6">
            {/* Welcome Back Message */}
            <div className="bg-white rounded-lg p-6 border border-gray-200 mb-6">
              <div className="flex items-start gap-3">
                <Avatar className="w-8 h-8 bg-red-600 text-white">
                  <AvatarFallback className="bg-red-600 text-white font-bold">E</AvatarFallback>
                </Avatar>
                <div className="flex-1">
                  <p className="text-gray-900 leading-relaxed">
                    Welcome back, Priya! 👋 It's great to see you again! Last time we chatted about NTEP symptomatic
                    screening checklist. Would you like to continue from there, or is there something new you'd like to
                    learn about today?
                  </p>
                </div>
              </div>
              <div className="mt-4 ml-11">
                <Button variant="ghost" size="icon" className="w-6 h-6 p-0" onClick={() => setShowRatingDialog(true)}>
                  <Star className="w-4 h-4 text-[#efb100]" />
                </Button>
              </div>
            </div>
          </div>

          {/* User Question */}
          <div className="flex justify-end mb-6">
            <div className="bg-[#4285f4] text-white px-4 py-2 rounded-full max-w-xs">
              <span className="text-sm">What is Ni-Kshay used for?</span>
            </div>
            <Avatar className="w-8 h-8 bg-[#4285f4] text-[#ffffff] ml-3">
              <AvatarFallback className="bg-[#4285f4] text-[#ffffff] font-bold">U</AvatarFallback>
            </Avatar>
          </div>

          {/* AI Response */}
          <div className="bg-[#ffffff] rounded-lg p-6 border border-[#e5e7eb] mb-6">
            <div className="flex items-start gap-3">
              <Avatar className="w-8 h-8 bg-[#fb2c36] text-[#ffffff]">
                <AvatarFallback className="bg-[#fb2c36] text-[#ffffff] font-bold">E</AvatarFallback>
              </Avatar>
              <div className="flex-1">
                <p className="text-[#101828] leading-relaxed mb-4">Great question about Nikshay! 💻</p>
                <p className="text-[#101828] leading-relaxed mb-4">
                  <strong>**Nikshay**</strong> is India's national web-based TB case notification and patient tracking
                  system. It's the digital backbone of NTEP!
                </p>
                <p className="text-[#101828] leading-relaxed mb-4">
                  <strong>**What Nikshay is used for:**</strong> 🔍 <strong>**Case Notification:**</strong> Registering
                  and tracking all TB cases 📊 <strong>**Treatment Monitoring:**</strong> Monitoring patients' treatment
                  progress 💰 <strong>**DBT Integration:**</strong> Linking patients for Direct Benefit Transfer 💳{" "}
                  <strong>**Program Management:**</strong> Tracking TB program performance 📋{" "}
                  <strong>**Health Facility Management:**</strong> Connecting all health facilities As a CHO, you'll
                  register patients in Nikshay, update their treatment outcomes, and generate reports. It's the digital
                  future of TB control! 🚀 Now that you understand the Nikshay system, would you like to learn about DBT
                  benefits or the patient registration process?
                </p>
              </div>
            </div>
            <div className="mt-4 ml-11">
              <Button variant="ghost" size="icon" className="w-6 h-6 p-0" onClick={() => setShowRatingDialog(true)}>
                <Star className="w-4 h-4 text-[#efb100]" />
              </Button>
            </div>
          </div>

          {/* Follow-up Questions */}
          <div className="mb-6">
            <div className="flex items-center gap-2 mb-4">
              <div className="w-2 h-2 bg-[#4285f4] rounded-full"></div>
              <span className="text-[#4285f4] font-medium">Follow-up questions:</span>
            </div>
            <div className="space-y-3">
              <Button
                variant="outline"
                className="w-full justify-start text-left h-auto p-4 bg-[#ffffff] border-[#e5e7eb] hover:bg-[#f3f3f5] text-[#4285f4] font-normal rounded-lg"
              >
                <ArrowRight className="w-4 h-4 mr-2 text-[#4285f4]" />
                How do I register a TB case in Nikshay?
              </Button>
              <Button
                variant="outline"
                className="w-full justify-start text-left h-auto p-4 bg-[#ffffff] border-[#e5e7eb] hover:bg-[#f3f3f5] text-[#4285f4] font-normal rounded-lg"
              >
                <ArrowRight className="w-4 h-4 mr-2 text-[#4285f4]" />
                What information is required for Nikshay entry?
              </Button>
              <Button
                variant="outline"
                className="w-full justify-start text-left h-auto p-4 bg-[#ffffff] border-[#e5e7eb] hover:bg-[#f3f3f5] text-[#4285f4] font-normal rounded-lg"
              >
                <ArrowRight className="w-4 h-4 mr-2 text-[#4285f4]" />
                Who can access the Nikshay portal?
              </Button>
            </div>
          </div>

          {/* Continue Exploring */}
          <div className="mb-6">
            <div className="flex items-center gap-2 mb-4">
              <div className="w-2 h-2 bg-[#10b981] rounded-full"></div>
              <span className="text-[#10b981] font-medium">Continue exploring:</span>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                className="bg-[#ffffff] border-[#10b981] text-[#10b981] hover:bg-[#f0fdf4] rounded-full px-4 py-2 h-auto"
              >
                DBT Benefits
              </Button>
              <Button
                variant="outline"
                className="bg-[#ffffff] border-[#10b981] text-[#10b981] hover:bg-[#f0fdf4] rounded-full px-4 py-2 h-auto"
              >
                Digital Health Systems
              </Button>
              <Button
                variant="outline"
                className="bg-[#ffffff] border-[#10b981] text-[#10b981] hover:bg-[#f0fdf4] rounded-full px-4 py-2 h-auto"
              >
                Patient Registration
              </Button>
            </div>
          </div>

          {/* Sources */}
          <div className="mb-6">
            <div className="flex items-center gap-2 mb-4">
              <div className="w-2 h-2 bg-[#6b7280] rounded-full"></div>
              <span className="text-[#6b7280] font-medium">Sources:</span>
            </div>
            <div className="bg-[#ffffff] rounded-lg p-4 border border-[#e5e7eb]">
              <div className="flex items-start gap-3">
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-[#101828] font-medium">
                      Module 12: Nikshay System and Digital Platforms - CHO Training Guide
                    </span>
                    <div className="bg-[#10b981] text-white px-2 py-1 rounded text-xs font-medium flex items-center gap-1">
                      <div className="w-3 h-3 bg-white rounded-full flex items-center justify-center">
                        <div className="w-1.5 h-1.5 bg-[#10b981] rounded-full"></div>
                      </div>
                      approved
                    </div>
                  </div>
                  <p className="text-[#6b7280] text-sm mb-1">Page 5 • NTEP Digital Systems Module</p>
                  <p className="text-[#6b7280] text-sm mb-1">Nikshay Platform Usage</p>
                  <p className="text-[#6b7280] text-sm">Updated: 2/14/2024</p>
                </div>
              </div>
              <div className="mt-4">
                <Button variant="ghost" size="icon" className="w-6 h-6 p-0" onClick={() => setShowRatingDialog(true)}>
                  <Star className="w-4 h-4 text-[#efb100]" />
                </Button>
              </div>
            </div>
          </div>

          {/* Dialogs are now rendered at the root level */}

          {/* Input Field */}
          <div className="relative flex items-center">
            <Button
              variant="ghost"
              size="icon"
              className="absolute left-2 top-1/2 transform -translate-y-1/2 w-8 h-8 text-[#717182] hover:text-[#101828]"
            >
              <Mic className="w-4 h-4" />
            </Button>
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Type your query here..."
              className="w-full pl-12 pr-12 py-3 text-base bg-[#ffffff] border-[#d1d5dc] rounded-full focus:border-[#efb100] focus:ring-[#efb100]"
            />
            <Button
              variant="ghost"
              size="icon"
              className="absolute right-2 top-1/2 transform -translate-y-1/2 w-8 h-8 text-[#717182] hover:text-[#101828]"
            >
              <Send className="w-4 h-4" />
            </Button>
          </div>
        </main>
      </div>
    );
  }

  // Enhanced Rating Dialog
  const ratingDialog = (
    <Dialog open={showRatingDialog} onOpenChange={(open) => {
      if (!open) {
        setShowRatingDialog(false);
        setSelectedMessageId(null);
        setSelectedRating(0);
        setFeedback('');
      } else {
        setShowRatingDialog(true);
      }
    }}>
      <DialogContent className="bg-white rounded-xl border-0 shadow-2xl p-0 overflow-hidden w-full max-w-md">
        {/* Header */}
        <div className="bg-gradient-to-r from-blue-600 to-blue-500 p-6 text-white">
          <div className="flex justify-between items-center mb-2">
            <DialogTitle className="text-xl font-bold flex items-center gap-2">
              <Star className="w-5 h-5 text-yellow-300 fill-yellow-300" />
              Rate This Response
            </DialogTitle>
          </div>
          <p className="text-blue-100 text-sm">Your feedback helps us improve our responses</p>
        </div>
        
        <div className="p-6">
          {/* Rating Stars */}
          <div className="flex flex-col items-center mb-6">
            <div className="flex gap-1 mb-2">
              {[1, 2, 3, 4, 5].map((star) => (
                <button
                  key={star}
                  onClick={() => setSelectedRating(star)}
                  className={`p-2 rounded-full transition-all duration-200 ${
                    star <= selectedRating 
                      ? 'bg-yellow-50 text-yellow-500' 
                      : 'text-gray-300 hover:text-yellow-400'
                  }`}
                >
                  <Star 
                    className={`w-8 h-8 transition-transform duration-200 ${
                      star <= selectedRating ? 'scale-110 fill-current' : 'fill-none'
                    }`} 
                    strokeWidth={star <= selectedRating ? 1.5 : 2}
                  />
                </button>
              ))}
            </div>
            <p className="text-sm text-gray-500 mt-2">
              {selectedRating === 0 
                ? 'Tap to rate' 
                : selectedRating <= 2 
                  ? 'We appreciate your honesty!' 
                  : selectedRating <= 4 
                    ? 'Thanks for your feedback!' 
                    : 'We\'re glad you liked it!'}
            </p>
          </div>

          {/* Feedback Form */}
          {selectedRating > 0 && (
            <div className="space-y-4 animate-fade-in">
              <div className="space-y-2">
                <label htmlFor="feedback" className="block text-sm font-medium text-gray-700">
                  {selectedRating <= 2 ? 'What can we improve?' : 'What did you like most?'}
                </label>
                <Textarea
                  id="feedback"
                  placeholder={selectedRating <= 2 
                    ? 'Let us know how we can do better...' 
                    : 'Share what you found helpful...'}
                  value={feedback}
                  onChange={(e) => setFeedback(e.target.value)}
                  className="min-h-[100px] border-gray-300 focus:border-blue-500 focus:ring-2 focus:ring-blue-100 transition-colors"
                />
              </div>
              
              <div className="flex justify-end gap-3 pt-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    setShowRatingDialog(false);
                    setSelectedRating(0);
                    setFeedback('');
                  }}
                  className="px-5 py-2 text-gray-700 hover:bg-gray-50 border-gray-300"
                >
                  Cancel
                </Button>
                <Button
                  type="button"
                  onClick={handleFeedbackSubmit}
                  disabled={isFeedbackLoading}
                  className="px-5 py-2 bg-blue-600 hover:bg-blue-700 text-white shadow-sm transition-colors"
                >
                  {isFeedbackLoading ? (
                    <>
                      <svg className="animate-spin -ml-1 mr-2 h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                      </svg>
                      Sending...
                    </>
                  ) : (
                    'Submit Feedback'
                  )}
                </Button>
              </div>
              
              {feedbackError && (
                <div className="text-red-600 text-sm mt-2 flex items-center gap-1.5">
                  <AlertCircle className="w-4 h-4" />
                  {feedbackError}
                </div>
              )}
            </div>
          )}
        </div>
        

      </DialogContent>
    </Dialog>
  );

  // Confirmation Dialog
  const confirmationDialog = showSentConfirmation && (
    <Dialog open={showSentConfirmation} onOpenChange={setShowSentConfirmation}>
      <DialogContent className="bg-[#f0fdf4] border-[#a7f3d0] rounded-lg p-6 max-w-xs text-center">
        <div className="flex justify-center mb-4">
          <div className="bg-[#d1fae5] p-3 rounded-full">
            <Heart className="w-6 h-6 text-[#10b981] fill-[#10b981]" />
          </div>
        </div>
        <DialogTitle className="text-xl font-semibold text-[#101828] mb-2">Sent! {"\u{1F389}"}</DialogTitle>
        <p className="text-[#4a5565]">Thanks for your feedback</p>
      </DialogContent>
    </Dialog>
  );

  // Home page
  return (
    <div className="flex flex-col h-screen bg-gray-50 dark:bg-gray-900">
      {ratingDialog}
      {confirmationDialog}
      <header className="bg-white dark:bg-gray-800 shadow-sm sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 py-3 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center">
            <div className="flex items-center gap-3">
              <img
                src="https://hebbkx1anhila5yf.public.blob.vercel-storage.com/image-QuV3bpvNh9r2l0UYMmNrFvG1GotwpE.png"
                alt="ECHO India Project ECHO logo"
                className="h-10 w-auto"
              />
              <Button 
                variant="ghost" 
                size="icon" 
                onClick={() => {
                  setChatHistory([]);
                  setQuery('');
                  setShowQuickStart(true);
                  setCurrentFollowUps([]);
                  setChatError(null);
                  setLatestResponseId(null);
                }}
                className="text-gray-600 hover:text-gray-800 hover:bg-gray-100"
                title="Reset to home"
              >
                <Home className="w-5 h-5" />
              </Button>
            </div>
            <div className="flex items-center space-x-4">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="outline"
                    className="bg-[#000000] text-[#ffffff] border-[#000000] hover:bg-white hover:text-black hover:border-gray-300 rounded-lg px-3 py-1.5 h-auto transition-colors"
                  >
                    <Globe className="w-4 h-4 mr-1" />
                    {selectedLanguage}
                    <ChevronDown className="w-4 h-4 ml-1" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="bg-white border border-[#e5e7eb] rounded-lg shadow-lg">
                  <DropdownMenuItem onClick={() => setSelectedLanguage("EN")}>English (EN)</DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>
        </div>
      </header>

      <main ref={scrollContainerRef} className="flex-1 bg-gray-50 dark:bg-gray-900 py-2 sm:py-4 overflow-y-auto pb-32">
        {/* Chat Area */}
        <div className="p-3 sm:p-6 mx-2 sm:mx-4">
          {/* Banner positioned like chat messages */}
          <div className="flex items-start gap-3 mb-4">
            <Avatar className="w-8 h-8 bg-[#fb2c36] text-white flex-shrink-0">
              <AvatarFallback className="bg-[#fb2c36] text-white font-bold">E</AvatarFallback>
            </Avatar>
            <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm p-2 sm:p-3 flex-1">
              <h1 className="text-sm sm:text-lg font-bold text-[#101828] dark:text-white mb-1 sm:mb-2">iECHO AI Assistant</h1>
              <p className="text-xs sm:text-base text-[#4a5565] dark:text-gray-300">Hello! 👋 I'm your iECHO AI assistant, ready to help with TB management and agriculture questions. I can educate you about TB treatment, NTEP guidelines, Nikshay system, and sustainable farming practices.</p>
            </div>
          </div>

          {/* Question Cards */}
          {showQuickStart && (
            <div className="ml-11 mr-11 grid gap-1 sm:gap-2 mb-4">
              <h2 className="text-sm sm:text-xl font-semibold text-gray-800 dark:text-white mb-1">Quick Start</h2>
              <div className="grid md:grid-cols-2 gap-1 sm:gap-2">
                {questionCards.map((question, index) => (
                  <button
                    key={index}
                    className="w-full justify-start text-left h-auto p-2 sm:p-4 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700 text-gray-800 dark:text-gray-200 font-normal rounded-lg transition-colors duration-200 flex items-start gap-2"
                    onClick={() => {
                      setShowQuickStart(false);
                      handleSend(question);
                    }}
                  >
                    <MessageSquare className="h-4 w-4 mt-0.5 text-blue-500 flex-shrink-0" />
                    <span className="text-xs sm:text-sm leading-relaxed break-all">{question}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Show chat messages */}
          <div className="flex-1 overflow-y-auto space-y-4 pb-16">
            {chatHistory.map((message, index) => {
              // Only show follow-up questions for the latest AI message
              const isLatestAiMessage = message.sender === 'ai' && 
                index === chatHistory.length - 1 && 
                !isChatLoading;
              
              return (
                <div key={message.id} className="relative">
                  <ChatMessage 
                    message={{
                      ...message,
                      followUpQuestions: isLatestAiMessage ? message.followUpQuestions : undefined
                    }} 
                    onRate={() => {
                      setSelectedMessageId(message.id);
                      setShowRatingDialog(true);
                    }}
                    onFollowUpClick={isLatestAiMessage ? handleFollowUpClick : undefined}
                  />
                </div>
              );
            })}
            {isChatLoading && (
              <div className="flex justify-start">
                <div className="bg-gray-100 p-3 rounded-lg max-w-[80%]">
                  <div className="flex space-x-2">
                    <div className="w-2 h-2 rounded-full bg-gray-400 animate-bounce"></div>
                    <div className="w-2 h-2 rounded-full bg-gray-400 animate-bounce" style={{ animationDelay: '0.2s' }}></div>
                    <div className="w-2 h-2 rounded-full bg-gray-400 animate-bounce" style={{ animationDelay: '0.4s' }}></div>
                  </div>
                </div>
              </div>
            )}
            {chatError && (
              <div className="text-red-600 text-sm p-2 rounded bg-red-50">
                {chatError}
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>
        </div>

        {/* Input Field - Fixed at bottom */}
        <div className="fixed bottom-0 left-0 right-0 bg-white dark:bg-gray-900 border-t border-gray-200 dark:border-gray-700 p-4">
          <div className="max-w-4xl mx-auto">
            <div className="flex items-center gap-3">
              <div className="relative flex-1">
                <Input
                  value={query}
                  onChange={(e) => {
                    setQuery(e.target.value);
                    // Clear follow-ups when user starts typing
                    if (e.target.value.trim() && currentFollowUps.length > 0) {
                      setCurrentFollowUps([]);
                    }
                  }}
                  placeholder="Type your query here..."
                  className="w-full px-4 py-3 text-xs sm:text-base bg-gray-200 border-gray-300 text-gray-800 placeholder-gray-500 rounded-full focus:border-blue-500 focus:ring-2 focus:ring-blue-100 transition-colors"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !isChatLoading) handleSend()
                  }}
                  disabled={isChatLoading}
                />
              </div>
              <Button
                size="icon"
                className="w-11 h-11 rounded-full bg-gray-400 hover:bg-gray-500 text-white flex-shrink-0"
                onClick={() => handleSend()}
                disabled={isChatLoading || !query.trim()}
                aria-label="Send message"
              >
                {isChatLoading ? (
                  <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/></svg>
                ) : (
                  <Send className="w-4 h-4" />
                )}
              </Button>
            </div>
          </div>
        </div>
      </main>
    </div>
  )
}

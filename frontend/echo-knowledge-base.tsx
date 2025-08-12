"use client"

import { useState, useEffect, useMemo } from "react"
import session from './utils/session'
const { getOrCreateSessionId } = session;
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { 
  AlertCircle,
  ArrowRight, 
  ChevronDown, 
  FileText, 
  Globe, 
  Heart, 
  Home, 
  MessageSquare, 
  Mic, 
  MoreVertical, 
  RefreshCw, 
  Search,
  Send, 
  Star, 
  X 
} from "lucide-react";
import { formatDistanceToNow } from 'date-fns';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Textarea } from "@/components/ui/textarea"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Badge } from "@/components/ui/badge"

const questionCards = [
  "What causes TB - bacterial, viral or both?",
  "What is the full form of DOTS?",
  "When was RNTCP renamed to NTEP?",
  "What is Ni-Kshay used for?",
  "DRTB categories and treatment",
  "CHO counselling role",
  "DBT benefits for TB patients",
  "Nikshay platform features",
]

interface Citation {
  title: string;
  source: string;
  excerpt: string;
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
}

interface ChatMessage {
  id: string;
  sender: 'user' | 'ai';
  text: string;
  responseId?: string;
  citations?: Citation[];
  error?: boolean;
}

function CitationList({ citations }: { citations: Citation[] }) {
  const [expanded, setExpanded] = useState(false);

  if (!citations?.length) return null;

  return (
    <div className="mt-2 text-sm">
      <button 
        onClick={() => setExpanded(!expanded)}
        className="text-blue-600 hover:underline flex items-center gap-1 text-xs"
      >
        {expanded ? 'Hide sources' : `Show sources (${citations.length})`}
        <ChevronDown className={`w-3 h-3 transition-transform ${expanded ? 'rotate-180' : ''}`} />
      </button>
      
      {expanded && (
        <div className="mt-2 space-y-2 pl-4 border-l-2 border-gray-200">
          {citations.map((cite, i) => (
            <div key={i} className="p-2 bg-gray-50 rounded text-xs">
              <div className="font-medium">{cite.title}</div>
              <div className="text-gray-500 text-xs">{cite.source}</div>
              <p className="text-xs mt-1 text-gray-700">{cite.excerpt}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ChatMessage({ message, onRate }: { message: ChatMessage, onRate: () => void }) {
  return (
    <div className={`flex ${message.sender === 'user' ? 'justify-end' : 'justify-start'} mb-4`}>
      <div className={`max-w-[80%] p-3 rounded-lg ${
        message.sender === 'user' 
          ? 'bg-blue-600 text-white' 
          : 'bg-gray-100 text-gray-800'
      }`}>
        <div className="whitespace-pre-wrap">{message.text}</div>
        
        {/* Citations */}
        {message.sender === 'ai' && message.citations && message.citations.length > 0 && (
          <div className="mt-2">
            <CitationList citations={message.citations} />
          </div>
        )}
        
        {/* Feedback Button */}
        {message.sender === 'ai' && message.responseId && (
          <button 
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              onRate();
            }}
            className="mt-2 text-xs text-gray-500 hover:text-gray-700 flex items-center gap-1"
          >
            <Star className="w-3 h-3" />
            Rate this response
          </button>
        )}
      </div>
    </div>
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

  const handleSend = async () => {
    if (!query.trim() || isChatLoading) return;
    
    setIsChatLoading(true);
    setChatError(null);
    
    const userMessage = query.trim();
    const userMessageId = `user-${Date.now()}`;
    
    // Add user message to history
    setChatHistory(prev => [...prev, { 
      id: userMessageId,
      sender: 'user', 
      text: userMessage 
    }]);
    
    setQuery("");

    try {
      // Create a controller for the fetch request to support timeout
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 30000); // 30 second timeout

      const response = await fetch(`${process.env.NEXT_PUBLIC_API_BASE_URL}/chat`, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        },
        body: JSON.stringify({ 
          query: userMessage, 
          userId: 'api-user', // TODO: Replace with actual user ID when auth is implemented
          sessionId: getOrCreateSessionId()
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
      
      const data: ChatResponse = await response.json();
      
      if (!data.responseId || !data.response) {
        throw new Error('Invalid response format from server');
      }
      
      setLatestResponseId(data.responseId);
      
      // Add AI response to history with responseId and citations
      setChatHistory(prev => [...prev, { 
        id: data.responseId,
        sender: 'ai', 
        text: data.response,
        responseId: data.responseId,
        citations: data.citations || []
      }]);

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

  // Documents state with proper typing
  const [documents, setDocuments] = useState<Array<{
    id: string;
    title?: string;
    name?: string;
    description?: string;
    source?: string;
    updatedAt?: string | Date;
    createdAt?: string | Date;
    category?: string;
  }>>([]);
  
  const [isDocumentsLoading, setIsDocumentsLoading] = useState(false);
  const [documentsError, setDocumentsError] = useState<string | null>(null);
  
  // Search and filter state
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('All');
  
  // Document pagination state
  const [docCurrentPage, setDocCurrentPage] = useState(1);
  const itemsPerPage = 6; // Show 6 items per page
  
  // Filter documents based on search query and selected category
  const filteredDocuments = useMemo(() => {
    return documents.filter(doc => {
      const matchesSearch = searchQuery === '' || 
        (doc.title?.toLowerCase().includes(searchQuery.toLowerCase()) ||
         doc.description?.toLowerCase().includes(searchQuery.toLowerCase()) ||
         doc.source?.toLowerCase().includes(searchQuery.toLowerCase()));
      
      const matchesCategory = selectedCategory === 'All' || 
        doc.category === selectedCategory;
      
      return matchesSearch && matchesCategory;
    });
  }, [documents, searchQuery, selectedCategory]);
  
  // Calculate pagination
  const totalPages = Math.ceil(filteredDocuments.length / itemsPerPage);
  const currentDocuments = useMemo(() => {
    const startIndex = (docCurrentPage - 1) * itemsPerPage;
    return filteredDocuments.slice(startIndex, startIndex + itemsPerPage);
  }, [filteredDocuments, docCurrentPage]);
  
  // Reset to first page when filters change
  useEffect(() => {
    setDocCurrentPage(1);
  }, [searchQuery, selectedCategory]);
  
  // Handle document click
  const handleDocumentClick = (doc: any) => {
    // For now, just log the click. Can be extended to open a preview/modal
    console.log('Document clicked:', doc);
  };

  // Fetch documents from API
  const fetchDocuments = async () => {
    setIsDocumentsLoading(true);
    setDocumentsError(null);
    try {
      const response = await fetch(`${process.env.NEXT_PUBLIC_API_BASE_URL}/documents`);
      if (!response.ok) {
        throw new Error('Failed to fetch documents');
      }
      const data = await response.json();
      
      // Normalize document data to ensure consistent structure
      const normalizedDocuments = Array.isArray(data) ? data.map(doc => ({
        id: doc.id || '',
        title: doc.title || doc.name || 'Untitled Document',
        description: doc.description || 'No description available',
        source: doc.source || 'Unknown source',
        updatedAt: doc.updatedAt || new Date().toISOString(),
        createdAt: doc.createdAt || new Date().toISOString(),
        category: doc.category || 'Uncategorized'
      })) : [];
      
      setDocuments(normalizedDocuments);
    } catch (error) {
      console.error('Error fetching documents:', error);
      setDocumentsError('Failed to load documents. Please try again later.');
    } finally {
      setIsDocumentsLoading(false);
    }
  };

  // Fetch status and documents on mount
  useEffect(() => {
    const fetchStatus = async () => {
      try {
        const res = await fetch(`${process.env.NEXT_PUBLIC_API_BASE_URL}/status`);
        if (!res.ok) throw new Error('API error');
        const data = await res.json();
        setApiStatus('online');
      } catch (e) {
        setApiStatus('error');
      }
    };

    const fetchDocuments = async () => {
      setIsDocumentsLoading(true);
      setDocumentsError(null);
      try {
        const response = await fetch(`${process.env.NEXT_PUBLIC_API_BASE_URL}/documents`);
        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
        }
        const data = await response.json();
        
        // Normalize the response to ensure we always have an array of documents
        const documents = Array.isArray(data.documents) ? data.documents : 
                         Array.isArray(data) ? data : [];
        
        // Add default values for required fields
        const normalizedDocs = documents.map((doc: any) => ({
          id: doc.id || Math.random().toString(36).substr(2, 9),
          title: doc.title || doc.name || 'Untitled Document',
          description: doc.description || '',
          source: doc.source || 'Unknown Source',
          updatedAt: doc.updatedAt || doc.createdAt || new Date().toISOString(),
          createdAt: doc.createdAt || new Date().toISOString(),
          category: doc.category || 'Uncategorized'
        }));
        
        setDocuments(normalizedDocs);
      } catch (error) {
        console.error('Error fetching documents:', error);
        setDocumentsError(error instanceof Error ? error.message : 'Failed to load documents');
      } finally {
        setIsDocumentsLoading(false);
      }
    };

    fetchStatus();
    fetchDocuments();
  }, []);

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
                <div className="flex items-center">
                  <ApiStatusIndicator status={apiStatus} />
                </div>
                <Button 
                  size="icon" 
                  variant="outline" 
                  onClick={fetchHealth} 
                  title="Retry health check"
                  className="ml-1"
                >
                  <svg 
                    width="16" 
                    height="16" 
                    fill="none" 
                    viewBox="0 0 24 24"
                    className="w-4 h-4"
                  >
                    <path 
                      d="M2 12a10 10 0 1 1 10 10" 
                      stroke="currentColor" 
                      strokeWidth="2" 
                      strokeLinecap="round" 
                      strokeLinejoin="round"
                    />
                    <polyline 
                      points="2 16 2 12 6 12" 
                      stroke="currentColor" 
                      strokeWidth="2" 
                      strokeLinecap="round" 
                      strokeLinejoin="round"
                    />
                  </svg>
                </Button>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="outline"
                      className="bg-[#000000] text-[#ffffff] border-[#000000] hover:bg-[#101828] rounded-full px-4 py-2 h-auto"
                    >
                      <Globe className="w-4 h-4 mr-2" />
                      {selectedLanguage}
                      <ChevronDown className="w-4 h-4 ml-2" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="bg-white border border-[#e5e7eb] rounded-md shadow-lg">
                    <DropdownMenuItem onClick={() => setSelectedLanguage("EN")}>English (EN)</DropdownMenuItem>
                    <DropdownMenuItem onClick={() => setSelectedLanguage("HI")}>Hindi (HI)</DropdownMenuItem>
                    <DropdownMenuItem onClick={() => setSelectedLanguage("BN")}>Bengali (BN)</DropdownMenuItem>
                    <DropdownMenuItem onClick={() => setSelectedLanguage("TA")}>Tamil (TA)</DropdownMenuItem>
                    <DropdownMenuItem onClick={() => setSelectedLanguage("TE")}>Telugu (TE)</DropdownMenuItem>
                    <DropdownMenuItem onClick={() => setSelectedLanguage("MR")}>Marathi (MR)</DropdownMenuItem>
                    <DropdownMenuItem onClick={() => setSelectedLanguage("ES")}>Spanish (ES)</DropdownMenuItem>
                    <DropdownMenuItem onClick={() => setSelectedLanguage("FR")}>French (FR)</DropdownMenuItem>
                    <DropdownMenuItem onClick={() => setSelectedLanguage("DE")}>German (DE)</DropdownMenuItem>
                    <DropdownMenuItem onClick={() => setSelectedLanguage("ZH")}>Chinese (ZH)</DropdownMenuItem>
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
            <Button 
              variant="ghost" 
              size="icon" 
              className="text-white/80 hover:bg-white/10 rounded-full h-8 w-8"
              onClick={() => setShowRatingDialog(false)}
            >
              <X className="w-4 h-4" />
            </Button>
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
        
        {/* Status Bar */}
        <div className="bg-gray-50 px-6 py-3 border-t border-gray-100 flex items-center justify-between text-xs text-gray-500">
          <div className="flex items-center gap-1.5">
            <div className={`w-2 h-2 rounded-full ${
              apiStatus === 'online' ? 'bg-green-500' : 
              apiStatus === 'offline' || apiStatus === 'error' ? 'bg-red-500' : 'bg-yellow-500'
            }`}></div>
            <span>Service Status: {apiStatus === 'online' ? 'Operational' : 'Issues Detected'}</span>
          </div>
          <button 
            onClick={fetchHealth}
            className="text-blue-600 hover:text-blue-800 flex items-center gap-1"
            disabled={apiStatus === 'loading'}
          >
            <RefreshCw className={`w-3 h-3 ${apiStatus === 'loading' ? 'animate-spin' : ''}`} />
            Refresh
          </button>
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
    <div className="flex flex-col min-h-screen bg-gray-50 dark:bg-gray-900">
      {ratingDialog}
      {confirmationDialog}
      <header className="bg-white dark:bg-gray-800 shadow-sm sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 py-3 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center">
            <div className="flex items-center">
              <img
                src="https://hebbkx1anhila5yf.public.blob.vercel-storage.com/image-QuV3bpvNh9r2l0UYMmNrFvG1GotwpE.png"
                alt="ECHO India Project ECHO logo"
                className="h-10 w-auto"
              />
            </div>
            <div className="flex items-center space-x-4">
              <div className="flex items-center space-x-2">
                <ApiStatusIndicator status={apiStatus} />
                <Button 
                  variant="outline" 
                  size="icon" 
                  onClick={fetchHealth} 
                  title="Refresh status"
                  className="h-8 w-8"
                  disabled={apiStatus === 'loading'}
                >
                  <RefreshCw className={`h-4 w-4 ${apiStatus === 'loading' ? 'animate-spin' : ''}`} />
                </Button>
              </div>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="outline"
                    className="bg-[#000000] text-[#ffffff] border-[#000000] hover:bg-[#101828] rounded-full px-4 py-2 h-auto"
                  >
                    <Globe className="w-4 h-4 mr-2" />
                    {selectedLanguage}
                    <ChevronDown className="w-4 h-4 ml-2" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="bg-white border border-[#e5e7eb] rounded-md shadow-lg">
                  <DropdownMenuItem onClick={() => setSelectedLanguage("EN")}>English (EN)</DropdownMenuItem>
                  <DropdownMenuItem onClick={() => setSelectedLanguage("HI")}>Hindi (HI)</DropdownMenuItem>
                  <DropdownMenuItem onClick={() => setSelectedLanguage("BN")}>Bengali (BN)</DropdownMenuItem>
                  <DropdownMenuItem onClick={() => setSelectedLanguage("TA")}>Tamil (TA)</DropdownMenuItem>
                  <DropdownMenuItem onClick={() => setSelectedLanguage("TE")}>Telugu (TE)</DropdownMenuItem>
                  <DropdownMenuItem onClick={() => setSelectedLanguage("MR")}>Marathi (MR)</DropdownMenuItem>
                  <DropdownMenuItem onClick={() => setSelectedLanguage("ES")}>Spanish (ES)</DropdownMenuItem>
                  <DropdownMenuItem onClick={() => setSelectedLanguage("FR")}>French (FR)</DropdownMenuItem>
                  <DropdownMenuItem onClick={() => setSelectedLanguage("DE")}>German (DE)</DropdownMenuItem>
                  <DropdownMenuItem onClick={() => setSelectedLanguage("ZH")}>Chinese (ZH)</DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>
        </div>
      </header>

      <main className="flex-1 bg-gray-50 dark:bg-gray-900 py-8">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm p-6 mb-8">
            <h1 className="text-3xl font-bold text-[#101828] dark:text-white mb-3">Welcome to your knowledge</h1>
            <p className="text-[#4a5565] dark:text-gray-300 text-lg mb-4">Ask me anything about NTEP guidelines, TB management, or related topics.</p>
            <div className="flex items-center space-x-2 text-sm text-gray-500 dark:text-gray-400">
              <span>API Status:</span>
              <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                apiStatus === 'online' ? 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200' :
                apiStatus === 'offline' ? 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200' :
                'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200'
              }`}>
                {apiStatus === 'online' ? 'Online' : apiStatus === 'offline' ? 'Offline' : 'Checking...'}
              </span>
            </div>
          </div>

          {/* Question Cards */}
          <div className="grid gap-4 mb-8">
            <h2 className="text-xl font-semibold text-gray-800 dark:text-white mb-2">Quick Start</h2>
            <div className="grid md:grid-cols-2 gap-4">
              {questionCards.map((question, index) => (
                <Button
                  key={index}
                  variant="outline"
                  className="justify-start text-left h-auto p-4 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700 text-gray-800 dark:text-gray-200 font-normal rounded-lg transition-colors duration-200"
                  onClick={() => handleQuestionClick(question)}
                >
                  <div className="flex items-center">
                    <MessageSquare className="h-4 w-4 mr-2 text-blue-500" />
                    <span>{question}</span>
                  </div>
                </Button>
              ))}
            </div>
          </div>
        </div>

        {/* Enhanced Documents Section */}
        <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 mb-6 overflow-hidden">
          <div className="p-6 border-b border-gray-200 dark:border-gray-700">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-4">
              <h2 className="text-xl font-semibold flex items-center gap-2 text-gray-800 dark:text-white">
                <FileText className="w-5 h-5 text-blue-500" /> Knowledge Base Documents
                <span className="text-sm font-normal text-gray-500 dark:text-gray-400 ml-1">
                  ({documents.length} {documents.length === 1 ? 'document' : 'documents'})
                </span>
              </h2>
              
              {/* Search Bar */}
              <div className="relative w-full sm:w-64">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
                <Input
                  type="text"
                  placeholder="Search documents..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-10 w-full"
                />
              </div>
            </div>
            
            {/* Document Categories */}
            <div className="flex flex-wrap gap-2 mb-4">
              {['All', 'Guidelines', 'Training', 'References', 'Policies'].map((category) => (
                <button
                  key={category}
                  className={`px-3 py-1 text-sm rounded-full transition-colors ${
                    selectedCategory === category
                      ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/50 dark:text-blue-300'
                      : 'text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-700'
                  }`}
                  onClick={() => setSelectedCategory(category)}
                >
                  {category}
                </button>
              ))}
            </div>
          </div>
          
          {/* Document Grid */}
          <div className="p-4">
            {isDocumentsLoading ? (
              <div className="flex items-center justify-center py-12">
                <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-blue-500"></div>
              </div>
            ) : documentsError ? (
              <div className="bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-300 p-6 rounded-lg text-center">
                <AlertCircle className="w-6 h-6 mx-auto mb-2" />
                <p className="font-medium">Error loading documents</p>
                <p className="text-sm mt-1">{documentsError}</p>
                <Button 
                  variant="outline" 
                  size="sm" 
                  className="mt-3"
                  onClick={fetchDocuments}
                >
                  <RefreshCw className="w-4 h-4 mr-2" />
                  Try Again
                </Button>
              </div>
            ) : filteredDocuments.length === 0 ? (
              <div className="text-center py-12">
                <FileText className="w-10 h-10 mx-auto text-gray-400 mb-3" />
                <h3 className="text-lg font-medium text-gray-900 dark:text-white">No documents found</h3>
                <p className="text-gray-500 dark:text-gray-400 mt-1">
                  {searchQuery
                    ? 'No documents match your search. Try different keywords.'
                    : 'There are no documents in this category yet.'}
                </p>
                {searchQuery && (
                  <Button 
                    variant="ghost" 
                    size="sm" 
                    className="mt-3"
                    onClick={() => setSearchQuery('')}
                  >
                    Clear search
                  </Button>
                )}
              </div>
            ) : (
              <>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mb-4">
                  {currentDocuments.map((doc, idx) => (
                    <div 
                      key={doc.id || idx}
                      className="group relative bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 hover:border-blue-300 dark:hover:border-blue-700 transition-all duration-200 overflow-hidden hover:shadow-md"
                    >
                      <div className="p-5">
                        <div className="flex items-start">
                          <div className="bg-blue-50 dark:bg-blue-900/20 p-2.5 rounded-lg mr-4 flex-shrink-0">
                            <FileText className="w-5 h-5 text-blue-600 dark:text-blue-400" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <h3 className="font-medium text-gray-900 dark:text-white group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors line-clamp-2 mb-1">
                              {doc.title || doc.name || 'Untitled Document'}
                            </h3>
                            {doc.description && (
                              <p className="text-sm text-gray-600 dark:text-gray-300 line-clamp-2 mb-2">
                                {doc.description}
                              </p>
                            )}
                            {doc.source && (
                              <div className="flex items-center text-xs text-gray-500 dark:text-gray-400 mt-2">
                                <span className="truncate">
                                  <span className="font-medium">Source:</span> {doc.source}
                                </span>
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                      <div className="px-5 py-3 bg-gray-50 dark:bg-gray-700/50 border-t border-gray-100 dark:border-gray-700 flex justify-between items-center">
                        <span className="text-xs text-gray-500 dark:text-gray-400">
                          Updated {formatDistanceToNow(new Date(doc.updatedAt || doc.createdAt || Date.now()), { addSuffix: true })}
                        </span>
                        <Button 
                          variant="ghost" 
                          size="sm" 
                          className="text-blue-600 hover:bg-blue-50 dark:text-blue-400 dark:hover:bg-blue-900/30"
                          onClick={() => handleDocumentClick(doc)}
                        >
                          View
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
                
                {/* Pagination */}
                {totalPages > 1 && (
                  <div className="flex items-center justify-between border-t border-gray-200 dark:border-gray-700 pt-4">
                    <div className="text-sm text-gray-500 dark:text-gray-400">
                      Showing <span className="font-medium">{(docCurrentPage - 1) * itemsPerPage + 1}</span> to{' '}
                      <span className="font-medium">
                        {Math.min(docCurrentPage * itemsPerPage, filteredDocuments.length)}
                      </span>{' '}
                      of <span className="font-medium">{filteredDocuments.length}</span> documents
                    </div>
                    <div className="flex space-x-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setDocCurrentPage(p => Math.max(1, p - 1))}
                        disabled={docCurrentPage === 1}
                        className="disabled:opacity-50"
                      >
                        Previous
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setDocCurrentPage(p => Math.min(totalPages, p + 1))}
                        disabled={docCurrentPage === totalPages}
                        className="disabled:opacity-50"
                      >
                        Next
                      </Button>
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        </div>

        {/* Chat Area */}
        <div className="bg-[#ffffff] rounded-lg p-6 border border-[#e5e7eb] mb-6 min-h-[180px]">
          {chatHistory.length === 0 && (
            <div className="flex items-start gap-3">
              <Avatar className="w-8 h-8 bg-[#fb2c36] text-[#ffffff]">
                <AvatarFallback className="bg-[#fb2c36] text-[#ffffff] font-bold">E</AvatarFallback>
              </Avatar>
              <div className="flex-1">
                <p className="text-[#101828] leading-relaxed">
                  Hello Priya! 👋 I'm your friendly ECHO AI assistant, here to support you as a Community Health Officer.
                  Think of me as your knowledgeable colleague who's always ready to help! 😊 I can help you with
                  comprehensive TB training covering all 12 modules - from basic TB knowledge to advanced topics like
                  DRTB, counselling, Nikshay system, and community engagement. Don't worry about asking "silly" questions
                  - we're all here to learn together! What would you like to explore today?
                </p>
              </div>
            </div>
          )}
          {/* Show chat messages */}
          <div className="flex-1 overflow-y-auto p-4 space-y-4">
            {chatHistory.map((message) => (
              <div key={message.id} className="relative">
                <ChatMessage 
                  message={message} 
                  onRate={() => {
                    setSelectedMessageId(message.id);
                    setShowRatingDialog(true);
                  }} 
                />
              </div>
            ))}
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
          </div>
        </div>

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
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !isChatLoading) handleSend()
            }}
            disabled={isChatLoading}
          />
          <Button
            variant="ghost"
            size="icon"
            className="absolute right-2 top-1/2 transform -translate-y-1/2 w-8 h-8 text-[#717182] hover:text-[#101828]"
            onClick={handleSend}
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
      </main>
    </div>
  )
}

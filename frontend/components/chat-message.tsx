"use client"

import { useState, useEffect } from "react"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import { config } from "@/lib/config"
import { 
  ChevronDown, 
  Lightbulb,
  ArrowRight, 
  RefreshCw,
  Star 
} from "lucide-react"

interface Citation {
  title: string;
  source: string;
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

interface ChatMessageProps {
  message: ChatMessage;
  onRate: () => void;
  onFollowUpClick?: (question: string) => void;
  onRetry?: (messageId: string) => void;
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
                      const response = await fetch(`${config.apiUrl}/document-url/${encodedPath}`);
                      if (!response.ok) throw new Error(`HTTP ${response.status}`);
                      const data = await response.json();
                      if (data.url) {
                        window.open(data.url, '_blank');
                      } else {
                        alert('Document URL not available');
                      }
                    } catch (error) {
                      console.error('Failed to get document URL:', error);
                      const errorMsg = error instanceof Error && error.message.includes('Failed to fetch') 
                        ? 'Network connection failed. Please check your internet and try again.'
                        : 'Failed to open document. Please try again later.';
                      alert(errorMsg);
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

export default function ChatMessage({ message, onRate, onFollowUpClick, onRetry }: ChatMessageProps) {
  const [showThinking, setShowThinking] = useState(false);
  
  useEffect(() => {
    if (message.isThinking) {
      setShowThinking(true);
    }
  }, [message.isThinking]);
  
  return (
    <>
      <div className={`flex ${message.sender === 'user' ? 'justify-end' : 'justify-start'} mb-4 items-start gap-3`}>
        {message.sender === 'ai' && (
          <Avatar className="w-8 h-8 bg-[#fb2c36] text-white flex-shrink-0">
            <AvatarFallback className="bg-[#fb2c36] text-white font-bold">E</AvatarFallback>
          </Avatar>
        )}
        
        <div className="max-w-[80%] space-y-2">
          {message.image && (
            <div className="w-48 h-32 md:w-64 md:h-48 rounded-lg overflow-hidden bg-gray-100">
              <img 
                src={`data:image/jpeg;base64,${message.image}`} 
                alt="Uploaded image" 
                className="w-full h-full object-cover rounded-lg" 
              />
            </div>
          )}
          
          {message.sender === 'ai' && (message.thinking || message.isThinking) && (
            <div className="bg-gray-50 border border-gray-200 rounded-lg overflow-hidden">
              <div className="w-full px-3 py-2 bg-gray-100 flex items-center gap-2 text-xs sm:text-sm text-gray-600">
                {message.isThinking ? (
                  <span>Thinking...</span>
                ) : (
                  <span>Reasoning</span>
                )}
              </div>
              {message.thinking && (
                <div className="px-3 py-2 text-xs sm:text-sm text-gray-600 italic border-t border-gray-200 max-h-20 overflow-y-auto">
                  {message.thinking}
                </div>
              )}
            </div>
          )}
          
          <div className={`p-2 sm:p-3 rounded-lg ${
            message.sender === 'user' 
              ? 'bg-blue-600 text-white' 
              : message.error
                ? 'bg-red-50 text-red-800 border border-red-200'
                : 'bg-white text-gray-800 border border-gray-200'
          }`}>
            <div className="whitespace-pre-wrap text-xs sm:text-base">
              {message.sender === 'ai' ? (
                <div dangerouslySetInnerHTML={{
                  __html: message.text
                    .replace(/^### (.*$)/gm, '<h3 class="text-sm sm:text-lg font-semibold mt-2 sm:mt-3 mb-1 sm:mb-2">$1</h3>')
                    .replace(/^## (.*$)/gm, '<h2 class="text-base sm:text-xl font-semibold mt-2 sm:mt-4 mb-1 sm:mb-2">$1</h2>')
                    .replace(/^# (.*$)/gm, '<h1 class="text-lg sm:text-2xl font-bold mt-2 sm:mt-4 mb-2 sm:mb-3">$1</h1>')
                    .replace(/\*\*(.*?)\*\*/g, '<strong class="font-semibold">$1</strong>')
                    .replace(/\*(.*?)\*/g, '<em class="italic">$1</em>')
                    .replace(/`(.*?)`/g, '<code class="bg-gray-200 px-1 rounded text-xs sm:text-sm font-mono">$1</code>')
                    .replace(/^\* (.*$)/gm, '<li class="ml-3 sm:ml-4 list-disc">$1</li>')
                    .replace(/^- (.*$)/gm, '<li class="ml-3 sm:ml-4 list-disc">$1</li>')
                    .replace(/^\d+\. (.*$)/gm, '<li class="ml-3 sm:ml-4 list-decimal">$1</li>')
                    .replace(/\[([^\]]+)\]\(([^\)]+)\)/g, '<a href="$2" class="text-blue-600 hover:underline" target="_blank" rel="noopener noreferrer">$1</a>')
                    .replace(/([a-zA-Z])(\d)/g, '$1 $2')
                    .replace(/(\d)([a-zA-Z])/g, '$1 $2')
                    .replace(/\n/g, '<br>')
                }} />
              ) : (
                message.text
              )}
            </div>
            
            {message.sender === 'ai' && message.citations && message.citations.length > 0 && (
              <div className="mt-2">
                <CitationList citations={message.citations} />
              </div>
            )}
            
            {message.sender === 'ai' && !message.error && (
              <div className="flex justify-end mt-1">
                <span className="text-[10px] text-gray-400">Chatbot can make mistakes. Please double-check responses.</span>
              </div>
            )}
          </div>
        </div>
        
        {message.sender === 'user' && (
          <Avatar className="w-8 h-8 bg-blue-600 text-white flex-shrink-0">
            <AvatarFallback className="bg-blue-600 text-white font-bold">U</AvatarFallback>
          </Avatar>
        )}
      </div>
      
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
      
      {message.sender === 'ai' && (
        <div className="flex justify-start ml-11 -mt-2 gap-3">
          {message.error && onRetry && (
            <button 
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                onRetry(message.id);
              }}
              className="text-xs text-blue-500 hover:text-blue-600 flex items-center gap-1 font-medium"
            >
              <RefreshCw className="w-3 h-3" strokeWidth={2.5} />
              Try again
            </button>
          )}
          {message.responseId && (
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
          )}
        </div>
      )}
    </>
  );
}
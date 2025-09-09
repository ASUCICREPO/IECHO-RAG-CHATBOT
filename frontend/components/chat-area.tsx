"use client"

import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import ChatMessage from "./chat-message"

interface Message {
  id: string;
  sender: 'user' | 'ai';
  text: string;
  responseId?: string;
  citations?: any[];
  error?: boolean;
  followUpQuestions?: string[];
  image?: string;
  thinking?: string;
  isThinking?: boolean;
}

interface ChatAreaProps {
  chatHistory: Message[];
  isChatLoading: boolean;
  onRate: (messageId: string) => void;
  onFollowUpClick: (question: string) => void;
  onRetry: (messageId: string) => void;
}

export default function ChatArea({ chatHistory, isChatLoading, onRate, onFollowUpClick, onRetry }: ChatAreaProps) {
  return (
    <div className="flex-1 overflow-y-auto space-y-2 sm:space-y-4 pb-20 sm:pb-24">
      {chatHistory.map((message, index) => {
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
              onRate={() => onRate(message.id)}
              onFollowUpClick={isLatestAiMessage ? onFollowUpClick : undefined}
              onRetry={onRetry}
            />
          </div>
        );
      })}
      
      {isChatLoading && chatHistory.length > 0 && chatHistory[chatHistory.length - 1]?.sender === 'user' && (
        <div className="flex justify-start items-start gap-3 mb-4">
          <Avatar className="w-8 h-8 bg-[#fb2c36] text-white flex-shrink-0">
            <AvatarFallback className="bg-[#fb2c36] text-white font-bold">E</AvatarFallback>
          </Avatar>
          <div className="bg-gray-100 p-3 rounded-lg max-w-[80%]">
            <div className="flex items-center space-x-2">
              <div className="w-2 h-2 rounded-full bg-blue-500 animate-bounce"></div>
              <span className="text-sm text-gray-600">Thinking...</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
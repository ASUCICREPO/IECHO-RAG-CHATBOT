"use client"

import { useState } from "react"
import AppHeader from "@/components/app-header"
import Disclaimer from "@/components/disclaimer"
import ChatBanner from "@/components/chat-banner"
import QuickStart from "@/components/quick-start"
import ChatArea from "@/components/chat-area"
import ChatInput from "@/components/chat-input"
import RatingDialog from "@/components/rating-dialog"
import ConfirmationDialog from "@/components/confirmation-dialog"
import { useChat } from "@/hooks/use-chat"
import { useFeedback } from "@/hooks/use-feedback"

export default function Component() {
  const [selectedLanguage, setSelectedLanguage] = useState("EN");
  const [showQuickStart, setShowQuickStart] = useState(true);
  const [query, setQuery] = useState("");
  const [selectedImage, setSelectedImage] = useState<string | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [isImageUploading, setIsImageUploading] = useState(false);

  const {
    chatHistory,
    isChatLoading,
    messagesEndRef,
    scrollContainerRef,
    sendMessage,
    retryMessage,
    resetChat
  } = useChat();

  const {
    showRatingDialog,
    setShowRatingDialog,
    showSentConfirmation,
    setShowSentConfirmation,
    isFeedbackLoading,
    feedbackError,
    submitFeedback,
    openRatingDialog
  } = useFeedback();

  const handleSend = async (messageText?: string) => {
    const textToSend = messageText || query.trim();
    if (!textToSend || isChatLoading) return;
    
    setShowQuickStart(false);
    
    if (!messageText) {
      setQuery("");
    }
    
    await sendMessage(textToSend, selectedImage);
    
    setSelectedImage(null);
    setImagePreview(null);
    setIsImageUploading(false);
  };

  const handleHomeClick = () => {
    resetChat();
    setQuery('');
    setShowQuickStart(true);
    setSelectedImage(null);
    setImagePreview(null);
  };

  const handleFeedbackSubmit = async (rating: number, feedback: string) => {
    await submitFeedback(rating, feedback, chatHistory);
  };

  return (
    <div className="flex flex-col h-screen bg-gray-50 dark:bg-gray-900">
      <RatingDialog 
        open={showRatingDialog}
        onOpenChange={setShowRatingDialog}
        onSubmit={handleFeedbackSubmit}
        isLoading={isFeedbackLoading}
        error={feedbackError}
      />
      
      <ConfirmationDialog 
        open={showSentConfirmation}
        onOpenChange={setShowSentConfirmation}
      />
      
      <AppHeader 
        selectedLanguage={selectedLanguage}
        setSelectedLanguage={setSelectedLanguage}
        onHomeClick={handleHomeClick}
      />

      <main ref={scrollContainerRef} className="flex-1 bg-gray-50 dark:bg-gray-900 py-1 sm:py-4 overflow-y-auto pb-28 sm:pb-32">
        <Disclaimer />
        
        <div className="p-1 sm:p-6 mx-1 sm:mx-4">
          <ChatBanner />

          {showQuickStart && (
            <QuickStart 
              onQuestionClick={(question) => {
                setShowQuickStart(false);
                handleSend(question);
              }}
            />
          )}

          <ChatArea 
            chatHistory={chatHistory}
            isChatLoading={isChatLoading}
            onRate={openRatingDialog}
            onFollowUpClick={handleSend}
            onRetry={retryMessage}
          />

          <div ref={messagesEndRef} />
        </div>
      </main>

      <ChatInput 
        query={query}
        setQuery={setQuery}
        onSend={() => handleSend()}
        isLoading={isChatLoading}
        selectedImage={selectedImage}
        setSelectedImage={setSelectedImage}
        imagePreview={imagePreview}
        setImagePreview={setImagePreview}
        isImageUploading={isImageUploading}
        setIsImageUploading={setIsImageUploading}
      />
    </div>
  );
}
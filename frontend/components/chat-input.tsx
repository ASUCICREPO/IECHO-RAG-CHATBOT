"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { ImagePlus, Send, X } from "lucide-react"

interface ChatInputProps {
  query: string;
  setQuery: (query: string) => void;
  onSend: () => void;
  isLoading: boolean;
  selectedImage: string | null;
  setSelectedImage: (image: string | null) => void;
  imagePreview: string | null;
  setImagePreview: (preview: string | null) => void;
  isImageUploading: boolean;
  setIsImageUploading: (uploading: boolean) => void;
}

export default function ChatInput({ 
  query, 
  setQuery, 
  onSend, 
  isLoading, 
  selectedImage, 
  setSelectedImage, 
  imagePreview, 
  setImagePreview,
  isImageUploading,
  setIsImageUploading
}: ChatInputProps) {
  const handleImageUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file && file.type.startsWith('image/')) {
      setIsImageUploading(true);
      const reader = new FileReader();
      reader.onload = (e) => {
        const result = e.target?.result as string;
        setImagePreview(result);
        const base64 = result.split(',')[1];
        setSelectedImage(base64);
        setTimeout(() => {
          setIsImageUploading(false);
        }, 1000);
      };
      reader.readAsDataURL(file);
    }
    event.target.value = '';
  };

  const removeImage = () => {
    setSelectedImage(null);
    setImagePreview(null);
    setIsImageUploading(false);
  };

  return (
    <div className="fixed bottom-0 left-0 right-0 bg-white dark:bg-gray-900 border-t border-gray-200 dark:border-gray-700 p-1.5 sm:p-4">
      {isImageUploading && (
        <div className="max-w-4xl mx-auto mb-2">
          <div className="w-full bg-blue-400 text-white px-2 py-1 sm:px-4 sm:py-2 rounded-full flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-white animate-bounce"></div>
            <span className="text-sm">Uploading...</span>
          </div>
        </div>
      )}

      {imagePreview && (
        <div className="fixed bottom-32 sm:bottom-32 left-4 right-4 flex justify-center z-20">
          <div className="relative">
            <div className="bg-white rounded-lg overflow-hidden shadow-lg">
              <img src={imagePreview} alt="Upload preview" className="max-w-[200px] sm:max-w-xs max-h-24 sm:max-h-32 rounded-lg" />
            </div>
            <button
              onClick={removeImage}
              className="absolute -top-2 -right-2 bg-red-500 text-white rounded-full w-6 h-6 flex items-center justify-center hover:bg-red-600"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}
      
      <div className="max-w-4xl mx-auto">
        <div className="flex items-center gap-2 sm:gap-3">
          <input
            type="file"
            accept="image/*"
            onChange={handleImageUpload}
            className="hidden"
            id="image-upload"
            disabled={isLoading}
          />
          <label
            htmlFor="image-upload"
            className={`w-9 h-9 sm:w-11 sm:h-11 flex items-center justify-center flex-shrink-0 rounded-full transition-colors ${
              isLoading 
                ? 'text-gray-300 cursor-not-allowed' 
                : 'text-gray-500 hover:text-blue-600 hover:bg-blue-100 cursor-pointer'
            }`}
          >
            <ImagePlus className="w-5 h-5" />
          </label>
          <div className="relative flex-1">
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Type your query here..."
              className="w-full px-3 py-2 sm:px-4 sm:py-3 text-xs sm:text-base bg-gray-200 border-gray-300 text-gray-800 placeholder-gray-500 rounded-full focus:border-blue-500 focus:ring-2 focus:ring-blue-100 transition-colors"
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !isLoading && query.length <= 900) onSend()
              }}
              disabled={isLoading}
            />
          </div>
          <Button
            size="icon"
            className="w-9 h-9 sm:w-11 sm:h-11 rounded-full bg-gray-400 hover:bg-blue-500 text-white flex-shrink-0 transition-colors"
            onClick={onSend}
            disabled={isLoading || !query.trim() || query.length > 900}
            aria-label="Send message"
          >
            {isLoading ? (
              <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/></svg>
            ) : (
              <Send className="w-4 h-4" />
            )}
          </Button>
        </div>
      </div>
      
      <div className="max-w-4xl mx-auto mt-1 mb-1">
        <div className="flex justify-between items-center px-2">
          <span className="text-xs text-gray-500">Character count</span>
          <span className={`text-xs ${query.length > 900 ? 'text-red-500' : 'text-gray-500'}`}>{query.length}/900</span>
        </div>
      </div>
    </div>
  );
}
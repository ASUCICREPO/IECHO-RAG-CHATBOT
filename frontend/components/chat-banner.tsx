"use client"

import { Avatar, AvatarFallback } from "@/components/ui/avatar"

export default function ChatBanner() {
  return (
    <div className="flex items-start gap-2 sm:gap-3 mb-2 sm:mb-4">
      <Avatar className="w-8 h-8 bg-[#fb2c36] text-white flex-shrink-0">
        <AvatarFallback className="bg-[#fb2c36] text-white font-bold">E</AvatarFallback>
      </Avatar>
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-sm p-2 sm:p-3 flex-1">
        <h1 className="text-sm sm:text-lg font-bold text-[#101828] dark:text-white mb-1 sm:mb-2">iECHO AI Assistant</h1>
        <p className="text-xs sm:text-base text-[#4a5565] dark:text-gray-300">Hello! 👋 I'm your iECHO AI assistant, ready to help with TB management and agriculture questions. I can educate you about TB treatment, NTEP guidelines, Nikshay system, and sustainable farming practices.</p>
      </div>
    </div>
  );
}
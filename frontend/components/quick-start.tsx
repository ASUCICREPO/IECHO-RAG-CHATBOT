"use client"

import { MessageSquare } from "lucide-react"

interface QuickStartProps {
  onQuestionClick: (question: string) => void;
}

const questionCards = [
  "What causes TB?",
  "What are the main symptoms of pulmonary TB?",
  "What is Ni-Kshay used for?",
  "How to improve crop irrigation efficiency?",
  "What are sustainable farming practices?",
  "What is crop rotation?",
];

export default function QuickStart({ onQuestionClick }: QuickStartProps) {
  return (
    <div className="ml-8 sm:ml-11 mr-2 sm:mr-11 grid gap-1 sm:gap-2 mb-2 sm:mb-4">
      <h2 className="text-sm sm:text-xl font-semibold text-gray-800 dark:text-white mb-1">Quick Start</h2>
      <div className="grid md:grid-cols-2 gap-1 sm:gap-2">
        {questionCards.map((question, index) => (
          <button
            key={index}
            className="w-full justify-start text-left h-auto p-1.5 sm:p-4 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-700 text-gray-800 dark:text-gray-200 font-normal rounded-lg transition-colors duration-200 flex items-start gap-2"
            onClick={() => onQuestionClick(question)}
          >
            <MessageSquare className="h-4 w-4 mt-0.5 text-blue-500 flex-shrink-0" />
            <span className="text-xs sm:text-sm leading-relaxed break-all">{question}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
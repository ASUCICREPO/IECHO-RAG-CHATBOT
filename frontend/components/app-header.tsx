"use client"

import { Button } from "@/components/ui/button"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { ChevronDown, Globe, Home } from "lucide-react"

interface AppHeaderProps {
  selectedLanguage: string;
  setSelectedLanguage: (language: string) => void;
  onHomeClick: () => void;
}

export default function AppHeader({ selectedLanguage, setSelectedLanguage, onHomeClick }: AppHeaderProps) {
  return (
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
              onClick={onHomeClick}
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
  );
}
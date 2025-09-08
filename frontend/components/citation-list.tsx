"use client"

import { useState } from "react"
import { ChevronDown } from "lucide-react"
import { config } from "@/lib/config"

interface Citation {
  title: string;
  source: string;
}

interface CitationListProps {
  citations: Citation[];
}

export default function CitationList({ citations }: CitationListProps) {
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
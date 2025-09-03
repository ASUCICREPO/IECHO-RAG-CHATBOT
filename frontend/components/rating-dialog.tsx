"use client"

import { useState } from "react"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { AlertCircle, Star } from "lucide-react"

interface RatingDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (rating: number, feedback: string) => void;
  isLoading: boolean;
  error: string | null;
}

export default function RatingDialog({ open, onOpenChange, onSubmit, isLoading, error }: RatingDialogProps) {
  const [selectedRating, setSelectedRating] = useState(0);
  const [feedback, setFeedback] = useState("");

  const handleSubmit = () => {
    if (selectedRating === 0) return;
    onSubmit(selectedRating, feedback);
  };

  const handleClose = () => {
    onOpenChange(false);
    setSelectedRating(0);
    setFeedback("");
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="bg-white rounded-xl border-0 shadow-2xl p-0 overflow-hidden w-[90vw] max-w-md">
        <div className="bg-gradient-to-r from-blue-600 to-blue-500 p-6 text-white">
          <div className="flex justify-between items-center mb-2">
            <DialogTitle className="text-lg font-bold flex items-center gap-2">
              <Star className="w-4 h-4 text-yellow-300 fill-yellow-300" />
              Rate This Response
            </DialogTitle>
          </div>
          <p className="text-blue-100 text-xs">Your feedback helps us improve our responses</p>
        </div>
        
        <div className="p-6">
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
            <p className="text-xs text-gray-500 mt-2">
              {selectedRating === 0 
                ? 'Tap to rate' 
                : selectedRating <= 2 
                  ? 'We appreciate your honesty!' 
                  : selectedRating <= 4 
                    ? 'Thanks for your feedback!' 
                    : 'We\'re glad you liked it!'}
            </p>
          </div>

          {selectedRating > 0 && (
            <div className="space-y-4 animate-fade-in">
              <div className="space-y-2">
                <label htmlFor="feedback" className="block text-xs font-medium text-gray-700">
                  {selectedRating <= 2 ? 'What can we improve?' : 'What did you like most?'}
                </label>
                <Textarea
                  id="feedback"
                  placeholder={selectedRating <= 2 
                    ? 'Let us know how we can do better...' 
                    : 'Share what you found helpful...'}
                  value={feedback}
                  onChange={(e) => setFeedback(e.target.value)}
                  className="min-h-[60px] sm:min-h-[100px] border-gray-300 focus:border-blue-500 focus:ring-2 focus:ring-blue-100 transition-colors"
                />
              </div>
              
              <div className="flex justify-end gap-3 pt-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={handleClose}
                  className="px-5 py-2 text-gray-700 hover:bg-gray-50 border-gray-300"
                >
                  Cancel
                </Button>
                <Button
                  type="button"
                  onClick={handleSubmit}
                  disabled={isLoading}
                  className="px-5 py-2 bg-blue-600 hover:bg-blue-700 text-white shadow-sm transition-colors"
                >
                  {isLoading ? (
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
              
              {error && (
                <div className="text-red-600 text-sm mt-2 flex items-center gap-1.5">
                  <AlertCircle className="w-4 h-4" />
                  {error}
                </div>
              )}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
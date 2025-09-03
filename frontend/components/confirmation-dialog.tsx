"use client"

import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog"
import { Heart } from "lucide-react"

interface ConfirmationDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export default function ConfirmationDialog({ open, onOpenChange }: ConfirmationDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-[#f0fdf4] border-[#a7f3d0] rounded-lg p-6 max-w-xs text-center">
        <div className="flex justify-center mb-4">
          <div className="bg-[#d1fae5] p-3 rounded-full">
            <Heart className="w-6 h-6 text-[#10b981] fill-[#10b981]" />
          </div>
        </div>
        <DialogTitle className="text-xl font-semibold text-[#101828] mb-2">Sent! 🎉</DialogTitle>
        <p className="text-[#4a5565]">Thanks for your feedback</p>
      </DialogContent>
    </Dialog>
  );
}
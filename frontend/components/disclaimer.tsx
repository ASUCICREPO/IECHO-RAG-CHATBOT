"use client"

export default function Disclaimer() {
  return (
    <div className="sticky top-0 z-10 pt-0 pb-2">
      <div className="max-w-4xl mx-auto px-2 sm:px-6">
        <div className="bg-yellow-50 border border-yellow-200 rounded-lg px-0.5 py-1.5 sm:p-1.5">
          <div className="flex justify-center">
            <p className="text-[10px] sm:text-xs text-yellow-800 text-center">
              ⚠️ For informational purposes only. Not a substitute for professional advice.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
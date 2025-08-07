"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Globe, ChevronDown, MoreVertical, Star, Mic, Home, ArrowRight, Send, Heart } from "lucide-react"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Textarea } from "@/components/ui/textarea"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"

const questionCards = [
  "What causes TB - bacterial, viral or both?",
  "What is the full form of DOTS?",
  "When was RNTCP renamed to NTEP?",
  "What is Ni-Kshay used for?",
  "DRTB categories and treatment",
  "CHO counselling role",
  "DBT benefits for TB patients",
  "Nikshay platform features",
]

import { useEffect } from "react"
import { Badge } from "@/components/ui/badge"

export default function Component() {
  // Chat state
  const [chatHistory, setChatHistory] = useState<{ sender: 'user' | 'ai'; text: string }[]>([])
  const [isChatLoading, setIsChatLoading] = useState(false)
  const [chatError, setChatError] = useState<string | null>(null)

  // Send chat message
  const handleSend = async () => {
    if (!query.trim() || isChatLoading) return
    setIsChatLoading(true)
    setChatError(null)
    setChatHistory((prev) => [...prev, { sender: 'user', text: query }])
    const userMessage = query
    setQuery("")
    try {
      const res = await fetch(`${process.env.NEXT_PUBLIC_API_BASE_URL}/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: userMessage, userId: 'api-user' })
      })
      if (!res.ok) throw new Error('API error')
      const data = await res.json()
      setChatHistory((prev) => [...prev, { sender: 'ai', text: data.response || 'No response from AI.' }])
    } catch (e) {
      setChatHistory((prev) => [...prev, { sender: 'ai', text: 'Sorry, I could not get a response from the AI.' }])
      setChatError('Failed to get response from the chatbot. Please try again.')
    } finally {
      setIsChatLoading(false)
    }
  }

  const [query, setQuery] = useState("")
  const [currentPage, setCurrentPage] = useState("home")
  const [showRatingDialog, setShowRatingDialog] = useState(false)
  const [selectedRating, setSelectedRating] = useState(0)
  const [feedback, setFeedback] = useState("")
  const [showSentConfirmation, setShowSentConfirmation] = useState(false)
  const [isFeedbackLoading, setIsFeedbackLoading] = useState(false)
  const [feedbackError, setFeedbackError] = useState<string | null>(null)
  const [selectedLanguage, setSelectedLanguage] = useState("EN") // New state for selected language
  const [healthStatus, setHealthStatus] = useState<'healthy' | 'unhealthy' | 'loading'>('loading')

  // Status state
  const [status, setStatus] = useState<any>(null)
  const [isStatusLoading, setIsStatusLoading] = useState(false)
  const [statusError, setStatusError] = useState<string | null>(null)

  // Documents state
  const [documents, setDocuments] = useState<any[]>([])
  const [isDocumentsLoading, setIsDocumentsLoading] = useState(false)
  const [documentsError, setDocumentsError] = useState<string | null>(null)

  // Fetch status and documents on mount
  useEffect(() => {
    const fetchStatus = async () => {
      setIsStatusLoading(true)
      setStatusError(null)
      try {
        const res = await fetch(`${process.env.NEXT_PUBLIC_API_BASE_URL}/status`)
        if (!res.ok) throw new Error('API error')
        const data = await res.json()
        setStatus(data)
      } catch (e) {
        setStatusError('Failed to load status.')
      } finally {
        setIsStatusLoading(false)
      }
    }
    fetchStatus()

    const fetchDocuments = async () => {
      setIsDocumentsLoading(true)
      setDocumentsError(null)
      try {
        const res = await fetch(`${process.env.NEXT_PUBLIC_API_BASE_URL}/documents`)
        if (!res.ok) throw new Error('API error')
        const data = await res.json()
        setDocuments(Array.isArray(data.documents) ? data.documents : data)
      } catch (e) {
        setDocumentsError('Failed to load documents.')
      } finally {
        setIsDocumentsLoading(false)
      }
    }
    fetchDocuments()
  }, [])

  // Health check function (can be called on mount and on retry)
  const fetchHealth = async () => {
    setHealthStatus('loading')
    try {
      const res = await fetch(`${process.env.NEXT_PUBLIC_API_BASE_URL}/health`)
      if (res.ok) {
        const data = await res.json()
        if (data.status === 'healthy') setHealthStatus('healthy')
        else setHealthStatus('unhealthy')
      } else {
        setHealthStatus('unhealthy')
      }
    } catch {
      setHealthStatus('unhealthy')
    }
  }

  // Health check on mount
  useEffect(() => {
    fetchHealth()
  }, [])

  const handleQuestionClick = (question: string) => {
    if (question === "What is Ni-Kshay used for?") {
      setCurrentPage("nikshay-answer")
    }
  }

  const goHome = () => {
    setCurrentPage("home")
  }

  if (currentPage === "nikshay-answer") {
    return (
      <div className="min-h-screen bg-[#f9fafb]">
        {/* Header */}
        <header className="flex items-center justify-between p-4 bg-[#ffffff] border-b border-[#e5e7eb]">
          <div className="flex items-center">
            <img
              src="https://hebbkx1anhila5yf.public.blob.vercel-storage.com/image-QuV3bpvNh9r2l0UYMmNrFvG1GotwpE.png"
              alt="ECHO India Project ECHO logo"
              className="h-10 w-auto"
            />
            <Button variant="ghost" size="icon" onClick={goHome} className="ml-4">
              <Home className="w-5 h-5" />
            </Button>
          </div>

          <div className="flex items-center gap-2">
  {/* Health Status Badge */}
  <Badge variant={healthStatus === 'healthy' ? 'default' : healthStatus === 'unhealthy' ? 'destructive' : 'secondary'} className="mr-2">
    {healthStatus === 'loading' ? 'Checking...' : healthStatus === 'healthy' ? 'API Online' : 'API Offline'}
  </Badge>
  <Button size="icon" variant="outline" onClick={fetchHealth} title="Retry health check" className="ml-1">
    <svg width="16" height="16" fill="none" viewBox="0 0 24 24"><path d="M2 12a10 10 0 1 1 10 10" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/><polyline points="2 16 2 12 6 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
  </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="outline"
                  className="bg-[#000000] text-[#ffffff] border-[#000000] hover:bg-[#101828] rounded-full px-4 py-2 h-auto"
                >
                  <Globe className="w-4 h-4 mr-2" />
                  {selectedLanguage}
                  <ChevronDown className="w-4 h-4 ml-2" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="bg-white border border-[#e5e7eb] rounded-md shadow-lg">
                <DropdownMenuItem onClick={() => setSelectedLanguage("EN")}>English (EN)</DropdownMenuItem>
                <DropdownMenuItem onClick={() => setSelectedLanguage("HI")}>Hindi (HI)</DropdownMenuItem>
                <DropdownMenuItem onClick={() => setSelectedLanguage("BN")}>Bengali (BN)</DropdownMenuItem>
                <DropdownMenuItem onClick={() => setSelectedLanguage("TA")}>Tamil (TA)</DropdownMenuItem>
                <DropdownMenuItem onClick={() => setSelectedLanguage("TE")}>Telugu (TE)</DropdownMenuItem>
                <DropdownMenuItem onClick={() => setSelectedLanguage("MR")}>Marathi (MR)</DropdownMenuItem>
                <DropdownMenuItem onClick={() => setSelectedLanguage("ES")}>Spanish (ES)</DropdownMenuItem>
                <DropdownMenuItem onClick={() => setSelectedLanguage("FR")}>French (FR)</DropdownMenuItem>
                <DropdownMenuItem onClick={() => setSelectedLanguage("DE")}>German (DE)</DropdownMenuItem>
                <DropdownMenuItem onClick={() => setSelectedLanguage("ZH")}>Chinese (ZH)</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <Button variant="ghost" size="icon">
              <MoreVertical className="w-5 h-5" />
            </Button>
          </div>
        </header>

        {/* Chat Content */}
        <main className="max-w-4xl mx-auto p-6">
          {/* Welcome Back Message */}
          <div className="bg-[#ffffff] rounded-lg p-6 border border-[#e5e7eb] mb-6">
            <div className="flex items-start gap-3">
              <Avatar className="w-8 h-8 bg-[#fb2c36] text-[#ffffff]">
                <AvatarFallback className="bg-[#fb2c36] text-[#ffffff] font-bold">E</AvatarFallback>
              </Avatar>
              <div className="flex-1">
                <p className="text-[#101828] leading-relaxed">
                  Welcome back, Priya! 👋 It's great to see you again! Last time we chatted about NTEP symptomatic
                  screening checklist. Would you like to continue from there, or is there something new you'd like to
                  learn about today?
                </p>
              </div>
            </div>
            <div className="mt-4 ml-11">
              <Button variant="ghost" size="icon" className="w-6 h-6 p-0" onClick={() => setShowRatingDialog(true)}>
                <Star className="w-4 h-4 text-[#efb100]" />
              </Button>
            </div>
          </div>

          {/* User Question */}
          <div className="flex justify-end mb-6">
            <div className="bg-[#4285f4] text-white px-4 py-2 rounded-full max-w-xs">
              <span className="text-sm">What is Ni-Kshay used for?</span>
            </div>
            <Avatar className="w-8 h-8 bg-[#4285f4] text-[#ffffff] ml-3">
              <AvatarFallback className="bg-[#4285f4] text-[#ffffff] font-bold">U</AvatarFallback>
            </Avatar>
          </div>

          {/* AI Response */}
          <div className="bg-[#ffffff] rounded-lg p-6 border border-[#e5e7eb] mb-6">
            <div className="flex items-start gap-3">
              <Avatar className="w-8 h-8 bg-[#fb2c36] text-[#ffffff]">
                <AvatarFallback className="bg-[#fb2c36] text-[#ffffff] font-bold">E</AvatarFallback>
              </Avatar>
              <div className="flex-1">
                <p className="text-[#101828] leading-relaxed mb-4">Great question about Nikshay! 💻</p>
                <p className="text-[#101828] leading-relaxed mb-4">
                  <strong>**Nikshay**</strong> is India's national web-based TB case notification and patient tracking
                  system. It's the digital backbone of NTEP!
                </p>
                <p className="text-[#101828] leading-relaxed mb-4">
                  <strong>**What Nikshay is used for:**</strong> 🔍 <strong>**Case Notification:**</strong> Registering
                  and tracking all TB cases 📊 <strong>**Treatment Monitoring:**</strong> Monitoring patients' treatment
                  progress 💰 <strong>**DBT Integration:**</strong> Linking patients for Direct Benefit Transfer 💳{" "}
                  <strong>**Program Management:**</strong> Tracking TB program performance 📋{" "}
                  <strong>**Health Facility Management:**</strong> Connecting all health facilities As a CHO, you'll
                  register patients in Nikshay, update their treatment outcomes, and generate reports. It's the digital
                  future of TB control! 🚀 Now that you understand the Nikshay system, would you like to learn about DBT
                  benefits or the patient registration process?
                </p>
              </div>
            </div>
            <div className="mt-4 ml-11">
              <Button variant="ghost" size="icon" className="w-6 h-6 p-0" onClick={() => setShowRatingDialog(true)}>
                <Star className="w-4 h-4 text-[#efb100]" />
              </Button>
            </div>
          </div>

          {/* Follow-up Questions */}
          <div className="mb-6">
            <div className="flex items-center gap-2 mb-4">
              <div className="w-2 h-2 bg-[#4285f4] rounded-full"></div>
              <span className="text-[#4285f4] font-medium">Follow-up questions:</span>
            </div>
            <div className="space-y-3">
              <Button
                variant="outline"
                className="w-full justify-start text-left h-auto p-4 bg-[#ffffff] border-[#e5e7eb] hover:bg-[#f3f3f5] text-[#4285f4] font-normal rounded-lg"
              >
                <ArrowRight className="w-4 h-4 mr-2 text-[#4285f4]" />
                How do I register a TB case in Nikshay?
              </Button>
              <Button
                variant="outline"
                className="w-full justify-start text-left h-auto p-4 bg-[#ffffff] border-[#e5e7eb] hover:bg-[#f3f3f5] text-[#4285f4] font-normal rounded-lg"
              >
                <ArrowRight className="w-4 h-4 mr-2 text-[#4285f4]" />
                What information is required for Nikshay entry?
              </Button>
              <Button
                variant="outline"
                className="w-full justify-start text-left h-auto p-4 bg-[#ffffff] border-[#e5e7eb] hover:bg-[#f3f3f5] text-[#4285f4] font-normal rounded-lg"
              >
                <ArrowRight className="w-4 h-4 mr-2 text-[#4285f4]" />
                Who can access the Nikshay portal?
              </Button>
            </div>
          </div>

          {/* Continue Exploring */}
          <div className="mb-6">
            <div className="flex items-center gap-2 mb-4">
              <div className="w-2 h-2 bg-[#10b981] rounded-full"></div>
              <span className="text-[#10b981] font-medium">Continue exploring:</span>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                className="bg-[#ffffff] border-[#10b981] text-[#10b981] hover:bg-[#f0fdf4] rounded-full px-4 py-2 h-auto"
              >
                DBT Benefits
              </Button>
              <Button
                variant="outline"
                className="bg-[#ffffff] border-[#10b981] text-[#10b981] hover:bg-[#f0fdf4] rounded-full px-4 py-2 h-auto"
              >
                Digital Health Systems
              </Button>
              <Button
                variant="outline"
                className="bg-[#ffffff] border-[#10b981] text-[#10b981] hover:bg-[#f0fdf4] rounded-full px-4 py-2 h-auto"
              >
                Patient Registration
              </Button>
            </div>
          </div>

          {/* Sources */}
          <div className="mb-6">
            <div className="flex items-center gap-2 mb-4">
              <div className="w-2 h-2 bg-[#6b7280] rounded-full"></div>
              <span className="text-[#6b7280] font-medium">Sources:</span>
            </div>
            <div className="bg-[#ffffff] rounded-lg p-4 border border-[#e5e7eb]">
              <div className="flex items-start gap-3">
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-[#101828] font-medium">
                      Module 12: Nikshay System and Digital Platforms - CHO Training Guide
                    </span>
                    <div className="bg-[#10b981] text-white px-2 py-1 rounded text-xs font-medium flex items-center gap-1">
                      <div className="w-3 h-3 bg-white rounded-full flex items-center justify-center">
                        <div className="w-1.5 h-1.5 bg-[#10b981] rounded-full"></div>
                      </div>
                      approved
                    </div>
                  </div>
                  <p className="text-[#6b7280] text-sm mb-1">Page 5 • NTEP Digital Systems Module</p>
                  <p className="text-[#6b7280] text-sm mb-1">Nikshay Platform Usage</p>
                  <p className="text-[#6b7280] text-sm">Updated: 2/14/2024</p>
                </div>
              </div>
              <div className="mt-4">
                <Button variant="ghost" size="icon" className="w-6 h-6 p-0" onClick={() => setShowRatingDialog(true)}>
                  <Star className="w-4 h-4 text-[#efb100]" />
                </Button>
              </div>
            </div>
          </div>

          {showRatingDialog && (
            <Dialog open={showRatingDialog} onOpenChange={setShowRatingDialog}>
              <DialogContent className="bg-[#fffbeb] border-[#fde68a] rounded-lg p-6 max-w-sm">
                <DialogHeader className="flex flex-row items-center justify-between mb-4">
                  <div className="flex items-center gap-2">
  {/* Health Status Badge */}
  <Badge variant={healthStatus === 'healthy' ? 'default' : healthStatus === 'unhealthy' ? 'destructive' : 'secondary'} className="mr-2">
    {healthStatus === 'loading' ? 'Checking...' : healthStatus === 'healthy' ? 'API Online' : 'API Offline'}
  </Badge>
  <Button size="icon" variant="outline" onClick={fetchHealth} title="Retry health check" className="ml-1">
    <svg width="16" height="16" fill="none" viewBox="0 0 24 24"><path d="M2 12a10 10 0 1 1 10 10" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/><polyline points="2 16 2 12 6 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
  </Button>
                    <Star className="w-5 h-5 text-[#efb100]" />
                    <DialogTitle className="text-lg font-semibold text-[#101828]">
                      Rate this response{" "}
                      <span className="cursor-pointer" onClick={() => setShowRatingDialog(false)}>
                        X
                      </span>
                    </DialogTitle>
                  </div>
                </DialogHeader>
                <div className="flex justify-center gap-2 mb-4">
                  {[1, 2, 3, 4, 5].map((star) => (
                    <Star
                      key={star}
                      className={`w-8 h-8 cursor-pointer ${
                        star <= selectedRating ? "text-[#efb100] fill-[#efb100]" : "text-[#d1d5db]"
                      }`}
                      onClick={() => setSelectedRating(star)}
                    />
                  ))}
                </div>
                {selectedRating > 0 && (
                  <>
                    <Textarea
                      placeholder="What did you like?"
                      value={feedback}
                      onChange={(e) => setFeedback(e.target.value)}
                      className="mb-4 bg-white border-[#d1d5db] focus:border-[#efb100] focus:ring-[#efb100]"
                    />
                    <div className="flex justify-end gap-2">
                      <Button
                        variant="outline"
                        onClick={() => {
                          setShowRatingDialog(false)
                          setSelectedRating(0)
                          setFeedback("")
                        }}
                        className="border-[#d1d5db] text-[#4a5565] hover:bg-[#f3f3f5]"
                      >
                        Cancel
                      </Button>
                      <Button
                        onClick={async () => {
                          setIsFeedbackLoading(true)
                          setFeedbackError(null)
                          try {
                            // Find the latest AI response
                            const lastAI = [...chatHistory].reverse().find(m => m.sender === 'ai')?.text || 'No AI response';
                            const res = await fetch(`${process.env.NEXT_PUBLIC_API_BASE_URL}/feedback`, {
                              method: 'POST',
                              headers: { 'Content-Type': 'application/json' },
                              body: JSON.stringify({
                                userId: 'api-user',
                                rating: selectedRating,
                                feedback,
                                response: lastAI
                              })
                            })
                            if (!res.ok) throw new Error('Feedback API error')
                            setShowRatingDialog(false)
                            setSelectedRating(0)
                            setFeedback("")
                            setShowSentConfirmation(true) // Show confirmation dialog
                            setTimeout(() => {
                              setShowSentConfirmation(false) // Hide confirmation after 2 seconds
                            }, 2000)
                          } catch (e) {
                            setFeedbackError('Failed to submit feedback. Please try again.')
                          } finally {
                            setIsFeedbackLoading(false)
                          }
                        }}
                        disabled={isFeedbackLoading}
                        className="bg-[#efb100] text-white hover:bg-[#e0a000] flex items-center gap-1"
                      >
                        {isFeedbackLoading ? (
                          <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/></svg>
                        ) : (
                          <Send className="w-4 h-4" />
                        )}
                        Send
                      </Button>
                      {feedbackError && (
                        <div className="text-red-600 mt-2 text-sm">{feedbackError}</div>
                      )}
                    </div>
                  </>
                )}
              </DialogContent>
            </Dialog>
          )}

          {showSentConfirmation && (
            <Dialog open={showSentConfirmation} onOpenChange={setShowSentConfirmation}>
              <DialogContent className="bg-[#f0fdf4] border-[#a7f3d0] rounded-lg p-6 max-w-xs text-center">
                <div className="flex justify-center mb-4">
                  <div className="bg-[#d1fae5] p-3 rounded-full">
                    <Heart className="w-6 h-6 text-[#10b981] fill-[#10b981]" />
                  </div>
                </div>
                <DialogTitle className="text-xl font-semibold text-[#101828] mb-2">Sent! {"\u{1F389}"}</DialogTitle>
                <p className="text-[#4a5565]">Thanks for your feedback</p>
              </DialogContent>
            </Dialog>
          )}

          {/* Input Field */}
          <div className="relative flex items-center">
            <Button
              variant="ghost"
              size="icon"
              className="absolute left-2 top-1/2 transform -translate-y-1/2 w-8 h-8 text-[#717182] hover:text-[#101828]"
            >
              <Mic className="w-4 h-4" />
            </Button>
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Type your query here..."
              className="w-full pl-12 pr-12 py-3 text-base bg-[#ffffff] border-[#d1d5dc] rounded-full focus:border-[#efb100] focus:ring-[#efb100]"
            />
            <Button
              variant="ghost"
              size="icon"
              className="absolute right-2 top-1/2 transform -translate-y-1/2 w-8 h-8 text-[#717182] hover:text-[#101828]"
            >
              <Send className="w-4 h-4" />
            </Button>
          </div>
        </main>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-[#f9fafb]">
      {/* Header */}
      <header className="flex items-center justify-between p-4 bg-[#ffffff] border-b border-[#e5e7eb]">
        <div className="flex items-center">
          <img
            src="https://hebbkx1anhila5yf.public.blob.vercel-storage.com/image-QuV3bpvNh9r2l0UYMmNrFvG1GotwpE.png"
            alt="ECHO India Project ECHO logo"
            className="h-10 w-auto"
          />
        </div>

        <div className="flex items-center gap-2">
  {/* Health Status Badge */}
  <Badge variant={healthStatus === 'healthy' ? 'default' : healthStatus === 'unhealthy' ? 'destructive' : 'secondary'} className="mr-2">
    {healthStatus === 'loading' ? 'Checking...' : healthStatus === 'healthy' ? 'API Online' : 'API Offline'}
  </Badge>
  <Button size="icon" variant="outline" onClick={fetchHealth} title="Retry health check" className="ml-1">
    <svg width="16" height="16" fill="none" viewBox="0 0 24 24"><path d="M2 12a10 10 0 1 1 10 10" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/><polyline points="2 16 2 12 6 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
  </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="outline"
                className="bg-[#000000] text-[#ffffff] border-[#000000] hover:bg-[#101828] rounded-full px-4 py-2 h-auto"
              >
                <Globe className="w-4 h-4 mr-2" />
                {selectedLanguage}
                <ChevronDown className="w-4 h-4 ml-2" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="bg-white border border-[#e5e7eb] rounded-md shadow-lg">
              <DropdownMenuItem onClick={() => setSelectedLanguage("EN")}>English (EN)</DropdownMenuItem>
              <DropdownMenuItem onClick={() => setSelectedLanguage("HI")}>Hindi (HI)</DropdownMenuItem>
              <DropdownMenuItem onClick={() => setSelectedLanguage("BN")}>Bengali (BN)</DropdownMenuItem>
              <DropdownMenuItem onClick={() => setSelectedLanguage("TA")}>Tamil (TA)</DropdownMenuItem>
              <DropdownMenuItem onClick={() => setSelectedLanguage("TE")}>Telugu (TE)</DropdownMenuItem>
              <DropdownMenuItem onClick={() => setSelectedLanguage("MR")}>Marathi (MR)</DropdownMenuItem>
              <DropdownMenuItem onClick={() => setSelectedLanguage("ES")}>Spanish (ES)</DropdownMenuItem>
              <DropdownMenuItem onClick={() => setSelectedLanguage("FR")}>French (FR)</DropdownMenuItem>
              <DropdownMenuItem onClick={() => setSelectedLanguage("DE")}>German (DE)</DropdownMenuItem>
              <DropdownMenuItem onClick={() => setSelectedLanguage("ZH")}>Chinese (ZH)</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <Button variant="ghost" size="icon">
            <MoreVertical className="w-5 h-5" />
          </Button>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-4xl mx-auto p-6">
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-[#101828] mb-4">Welcome to your knowledge</h1>
          <p className="text-[#4a5565] text-lg mb-6">Try asking about:</p>

          {/* Question Cards */}
          <div className="grid gap-3 mb-8">
            {questionCards.map((question, index) => (
              <Button
                key={index}
                variant="outline"
                className="justify-start text-left h-auto p-4 bg-[#ffffff] border-[#e5e7eb] hover:bg-[#f3f3f5] text-[#101828] font-normal rounded-lg"
                onClick={() => handleQuestionClick(question)}
              >
                {question}
              </Button>
            ))}
          </div>
        </div>

        {/* Status Section */}
        <div className="bg-[#f8fafc] rounded-lg p-6 border border-[#e5e7eb] mb-6">
          <h2 className="text-xl font-semibold mb-3 flex items-center gap-2">
            <Globe className="w-5 h-5 text-[#4285f4]" /> Backend Status
          </h2>
          {isStatusLoading && <div className="text-[#717182]">Loading status…</div>}
          {statusError && <div className="text-red-600">{statusError}</div>}
          {!isStatusLoading && !statusError && status && (
            <pre className="bg-white rounded p-3 text-sm text-[#101828] overflow-x-auto border border-[#e5e7eb]">
              {JSON.stringify(status, null, 2)}
            </pre>
          )}
        </div>

        {/* Documents Section */}
        <div className="bg-[#f8fafc] rounded-lg p-6 border border-[#e5e7eb] mb-6">
          <h2 className="text-xl font-semibold mb-3 flex items-center gap-2">
            <Globe className="w-5 h-5 text-[#efb100]" /> Knowledge Base Documents
          </h2>
          {isDocumentsLoading && <div className="text-[#717182]">Loading documents…</div>}
          {documentsError && <div className="text-red-600">{documentsError}</div>}
          {!isDocumentsLoading && !documentsError && (
            documents.length === 0 ? (
              <div className="text-[#717182]">No documents found.</div>
            ) : (
              <ul className="list-disc ml-6">
                {documents.map((doc, idx) => (
                  <li key={doc.id || idx} className="mb-1">
                    <span className="font-medium text-[#101828]">{doc.title || doc.name || doc.id || 'Untitled'}</span>
                    {doc.description && <span className="text-[#717182] ml-2">{doc.description}</span>}
                  </li>
                ))}
              </ul>
            )
          )}
        </div>

        {/* Chat Area */}
        <div className="bg-[#ffffff] rounded-lg p-6 border border-[#e5e7eb] mb-6 min-h-[180px]">
          {chatHistory.length === 0 && (
            <div className="flex items-start gap-3">
              <Avatar className="w-8 h-8 bg-[#fb2c36] text-[#ffffff]">
                <AvatarFallback className="bg-[#fb2c36] text-[#ffffff] font-bold">E</AvatarFallback>
              </Avatar>
              <div className="flex-1">
                <p className="text-[#101828] leading-relaxed">
                  Hello Priya! 👋 I'm your friendly ECHO AI assistant, here to support you as a Community Health Officer.
                  Think of me as your knowledgeable colleague who's always ready to help! 😊 I can help you with
                  comprehensive TB training covering all 12 modules - from basic TB knowledge to advanced topics like
                  DRTB, counselling, Nikshay system, and community engagement. Don't worry about asking "silly" questions
                  - we're all here to learn together! What would you like to explore today?
                </p>
              </div>
            </div>
          )}
          {/* Show chat messages */}
          {chatHistory.map((msg, i) => (
            <div key={i} className={`flex items-start gap-3 mb-2 ${msg.sender === 'user' ? 'flex-row-reverse' : ''}`}>
              <Avatar className={`w-8 h-8 ${msg.sender === 'user' ? 'bg-[#4285f4]' : 'bg-[#fb2c36]'} text-[#fff]`}>
                <AvatarFallback className={`${msg.sender === 'user' ? 'bg-[#4285f4]' : 'bg-[#fb2c36]'} text-[#fff] font-bold`}>
                  {msg.sender === 'user' ? 'U' : 'E'}
                </AvatarFallback>
              </Avatar>
              <div className={`max-w-[80%] rounded-lg px-4 py-2 text-base ${msg.sender === 'user' ? 'bg-[#4285f4] text-white ml-auto' : 'bg-[#f3f3f5] text-[#101828]'}`}>
                {msg.text}
              </div>
            </div>
          ))}
          {isChatLoading && (
            <div className="flex items-center gap-2 mt-2 text-sm text-[#717182]">
              <span>AI is typing…</span>
              <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/></svg>
            </div>
          )}
          {chatError && (
            <div className="text-red-600 mt-2 text-sm">{chatError}</div>
          )}
        </div>

        {/* Input Field */}
        <div className="relative flex items-center">
          <Button
            variant="ghost"
            size="icon"
            className="absolute left-2 top-1/2 transform -translate-y-1/2 w-8 h-8 text-[#717182] hover:text-[#101828]"
          >
            <Mic className="w-4 h-4" />
          </Button>
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Type your query here..."
            className="w-full pl-12 pr-12 py-3 text-base bg-[#ffffff] border-[#d1d5dc] rounded-full focus:border-[#efb100] focus:ring-[#efb100]"
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !isChatLoading) handleSend()
            }}
            disabled={isChatLoading}
          />
          <Button
            variant="ghost"
            size="icon"
            className="absolute right-2 top-1/2 transform -translate-y-1/2 w-8 h-8 text-[#717182] hover:text-[#101828]"
            onClick={handleSend}
            disabled={isChatLoading || !query.trim()}
            aria-label="Send message"
          >
            {isChatLoading ? (
              <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/></svg>
            ) : (
              <Send className="w-4 h-4" />
            )}
          </Button>
        </div>
      </main>
    </div>
  )
}

import React, { useState, useRef, useEffect } from 'react';

import * as pdfjsLib from 'pdfjs-dist';
import { 
  BookOpen, 
  Upload, 
  FileText, 
  CheckCircle2, 
  HelpCircle, 
  Send, 
  Loader2, 
  X,
  MessageSquare,
  ClipboardList,
  ChevronRight,
  ArrowLeft,
  Volume2,
  Languages,
  VolumeX,
  Copy,
  Check
} from 'lucide-react';
import Markdown from 'react-markdown';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

// Utility for tailwind classes
function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// PDF.js worker setup
// Using unpkg as it's more reliable for specific package files
pdfjsLib.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${pdfjsLib.version}/build/pdf.worker.min.mjs`;

// Types
interface MCQ {
  question: string;
  options: string[];
  answer: string;
  explanation: string;
}

interface ChatMessage {
  role: 'user' | 'model';
  text: string;
  tamilText?: string;
  isTranslating?: boolean;
  isSpeakingEn?: boolean;
  isSpeakingTa?: boolean;
}

export default function App() {
  const [isInputOpen, setIsInputOpen] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [content, setContent] = useState<string>('');
  const [pastedText, setPastedText] = useState('');
  const [mcqs, setMcqs] = useState<MCQ[]>([]);
  const [isGeneratingMoreMcqs, setIsGeneratingMoreMcqs] = useState(false);
  const [chat, setChat] = useState<ChatMessage[]>([]);
  const [userInput, setUserInput] = useState('');
  const [activeTab, setActiveTab] = useState<'mcq' | 'qa'>('mcq');
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  
  const fileInputRef = useRef<HTMLInputElement>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chat]);

  


  const audioSourceRef = useRef<AudioBufferSourceNode | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);

  const stopSpeech = () => {
    if (audioSourceRef.current) {
      try {
        audioSourceRef.current.stop();
      } catch (e) {
        // Source might have already stopped
      }
      audioSourceRef.current = null;
    }
    window.speechSynthesis.cancel();
    setChat(prev => prev.map(m => ({ ...m, isSpeakingEn: false, isSpeakingTa: false })));
  };

  const handleSpeak = async (index: number, type: 'en' | 'ta') => {
    const message = chat[index];
    const text = type === 'en' ? message.text : message.tamilText;
    if (!text) return;

    // If already speaking this specific one, stop it
    if ((type === 'en' && message.isSpeakingEn) || (type === 'ta' && message.isSpeakingTa)) {
      stopSpeech();
      return;
    }

    stopSpeech();
    
    // Set speaking state
    setChat(prev => prev.map((m, i) => 
      i === index 
        ? { ...m, isSpeakingEn: type === 'en', isSpeakingTa: type === 'ta' } 
        : { ...m, isSpeakingEn: false, isSpeakingTa: false }
    ));

    try {
      // Use Gemini TTS for high quality and guaranteed support for Tamil
      const response = await ai.models.generateContent({
        model: "gemini-2.5-flash-preview-tts",
        contents: [{ parts: [{ text: text }] }],
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: { voiceName: type === 'ta' ? 'Kore' : 'Puck' },
            },
          },
        },
      });

      const part = response.candidates?.[0]?.content?.parts?.[0];
      const base64Audio = part?.inlineData?.data;

      if (base64Audio) {
        // Initialize AudioContext on user gesture
        if (!audioContextRef.current) {
          audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
        }
        
        const ctx = audioContextRef.current;
        if (ctx.state === 'suspended') {
          await ctx.resume();
        }

        // Convert base64 to ArrayBuffer
        const binaryString = atob(base64Audio);
        const bytes = new Uint8Array(binaryString.length);
        for (let i = 0; i < binaryString.length; i++) {
          bytes[i] = binaryString.charCodeAt(i);
        }
        
        // Decode audio data
        const audioBuffer = await ctx.decodeAudioData(bytes.buffer);
        
        // Create and play source
        const source = ctx.createBufferSource();
        source.buffer = audioBuffer;
        source.connect(ctx.destination);
        
        audioSourceRef.current = source;
        
        source.onended = () => {
          setChat(prev => prev.map((m, i) => i === index ? { ...m, isSpeakingEn: false, isSpeakingTa: false } : m));
          if (audioSourceRef.current === source) {
            audioSourceRef.current = null;
          }
        };

        source.start(0);
      } else {
        throw new Error('No audio data');
      }
    } catch (err) {
      console.error('Gemini TTS failed, falling back to browser TTS:', err);
      // Fallback to browser TTS
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = type === 'en' ? 'en-US' : 'ta-IN';
      utterance.onend = () => {
        setChat(prev => prev.map((m, i) => i === index ? { ...m, isSpeakingEn: false, isSpeakingTa: false } : m));
      };
      window.speechSynthesis.speak(utterance);
    }
  };

  const handleTranslate = async (index: number) => {
    const message = chat[index];
    if (message.tamilText || message.isTranslating) return;

    // Set translating state
    setChat(prev => prev.map((m, i) => i === index ? { ...m, isTranslating: true } : m));

    try {
      const response = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: [{ role: 'user', parts: [{ text: `Translate the following English text into clear, natural Tamil. Provide ONLY the Tamil script. Do not include any English transliteration or pronunciation guides: "${message.text}"` }] }],
      });

      const tamilResult = response.text || 'Translation failed.';
      
      setChat(prev => prev.map((m, i) => i === index ? { ...m, tamilText: tamilResult, isTranslating: false } : m));
    } catch (err) {
      setChat(prev => prev.map((m, i) => i === index ? { ...m, isTranslating: false } : m));
      setError('Failed to translate message.');
    }
  };

  const extractTextFromPdf = async (file: File) => {
    try {
      const arrayBuffer = await file.arrayBuffer();
      const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer });
      const pdf = await loadingTask.promise;
      let fullText = '';
      for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i);
        const textContent = await page.getTextContent();
        const pageText = textContent.items.map((item: any) => item.str).join(' ');
        fullText += pageText + '\n';
      }
      return fullText;
    } catch (err: any) {
      console.error('PDF extraction error:', err);
      throw new Error(`Failed to read PDF file. ${err.message || 'The PDF worker could not be initialized.'}`);
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsProcessing(true);
    setError(null);
    try {
      let text = '';
      if (file.type === 'application/pdf') {
        text = await extractTextFromPdf(file);
      } else {
        text = await file.text();
      }
      
      if (text.trim().length < 50) {
        throw new Error('The content is too short to process.');
      }
      
      setContent(text);
      await processContent(text);
    } catch (err: any) {
      setError(err.message || 'An error occurred while processing the file.');
    } finally {
      setIsProcessing(false);
    }
  };

  const handlePasteSubmit = async () => {
    if (!pastedText.trim()) return;
    
    setIsProcessing(true);
    setError(null);
    try {
      setContent(pastedText);
      await processContent(pastedText);
    } catch (err: any) {
      setError(err.message || 'An error occurred while processing the text.');
    } finally {
      setIsProcessing(false);
    }
  };

  const processContent = async (text: string) => {
    try {
      // Generate MCQs
      const mcqResponse = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: [{ role: 'user', parts: [{ text: `Based on the following text, generate 5 high-quality Multiple Choice Questions (MCQs). 
        Return the response as a JSON array of objects, where each object has:
        "question": string,
        "options": string array (exactly 4),
        "answer": string (the correct option text),
        "explanation": string (brief explanation).
        
        Text: ${text.substring(0, 10000)}` }] }],
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                question: { type: Type.STRING },
                options: { type: Type.ARRAY, items: { type: Type.STRING } },
                answer: { type: Type.STRING },
                explanation: { type: Type.STRING }
              },
              required: ["question", "options", "answer", "explanation"]
            }
          }
        }
      });

      const generatedMcqs = JSON.parse(mcqResponse.text || '[]');
      setMcqs(generatedMcqs);
      setIsInputOpen(false);
      setActiveTab('mcq');
      
      // Initial welcome message for chat
      setChat([{
        role: 'model',
        text: "I've analyzed your content! You can now check the MCQs generated or ask me any questions about the text. I'll answer in exactly 5 lines as requested."
      }]);
    } catch (err) {
      console.error('Processing error:', err);
      throw new Error('Failed to analyze content with AI.');
    }
  };

  const handleSendMessage = async () => {
    if (!userInput.trim() || isProcessing) return;

    const userMsg = userInput;
    setUserInput('');
    setChat(prev => [...prev, { role: 'user', text: userMsg }]);
    setIsProcessing(true);

    try {
      const response = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: [
          { role: 'user', parts: [{ text: `Context: ${content.substring(0, 15000)}` }] },
          { role: 'user', parts: [{ text: `Question: ${userMsg}` }] }
        ],
        config: {
          systemInstruction: "You are a helpful reading assistant. Answer the user's question based ONLY on the provided context. Your answer MUST be exactly 5 lines long. Use simple language. If the user asks for more details or asks again, provide another 5 lines of information."
        }
      });

      setChat(prev => [...prev, { role: 'model', text: response.text || 'Sorry, I could not generate an answer.' }]);
    } catch (err) {
      setChat(prev => [...prev, { role: 'model', text: 'Error: Failed to get response from AI.' }]);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleLoadMoreMcqs = async () => {
    if (isGeneratingMoreMcqs || !content) return;
    
    setIsGeneratingMoreMcqs(true);
    try {
      const existingQuestions = mcqs.map(m => m.question).join('\n');
      const mcqResponse = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: [{ role: 'user', parts: [{ text: `Based on the following text, generate 5 NEW high-quality Multiple Choice Questions (MCQs) that are different from these existing ones:
        ${existingQuestions}

        Return the response as a JSON array of objects, where each object has:
        "question": string,
        "options": string array (exactly 4),
        "answer": string (the correct option text),
        "explanation": string (brief explanation).
        
        Text: ${content.substring(0, 10000)}` }] }],
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                question: { type: Type.STRING },
                options: { type: Type.ARRAY, items: { type: Type.STRING } },
                answer: { type: Type.STRING },
                explanation: { type: Type.STRING }
              },
              required: ["question", "options", "answer", "explanation"]
            }
          }
        }
      });

      const newMcqs = JSON.parse(mcqResponse.text || '[]');
      setMcqs(prev => [...prev, ...newMcqs]);
    } catch (err) {
      console.error('Error loading more MCQs:', err);
      setError('Failed to generate more MCQs.');
    } finally {
      setIsGeneratingMoreMcqs(false);
    }
  };

  const copyAllMcqs = () => {
    if (mcqs.length === 0) return;
    
    const text = mcqs.map((mcq, idx) => {
      const options = mcq.options.map((opt, i) => `${String.fromCharCode(65 + i)}) ${opt}`).join('\n');
      return `${idx + 1}. ${mcq.question}\n${options}\n\nCorrect Answer: ${mcq.answer}\nExplanation: ${mcq.explanation}\n`;
    }).join('\n---\n\n');
    
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  const reset = () => {
    setContent('');
    setMcqs([]);
    setChat([]);
    setPastedText('');
    setError(null);
    setIsInputOpen(false);
  };

  return (
    <div className="min-h-screen flex flex-col font-sans">
      {/* Header */}
      <header className="bg-white border-b border-slate-200 sticky top-0 z-10">
        <div className="max-w-5xl mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2 cursor-pointer" onClick={reset}>
            <div className="bg-brand-600 p-2 rounded-lg">
              <BookOpen className="w-5 h-5 text-white" />
            </div>
            <h1 className="text-xl font-bold tracking-tight text-slate-800">"Lettura facile" / "Reading is Easy"</h1>
          </div>
          
          {content && (
            <div className="flex items-center gap-4">
              <button 
                onClick={reset}
                className="text-sm font-medium text-slate-500 hover:text-slate-800 flex items-center gap-1 transition-colors"
              >
                <ArrowLeft className="w-4 h-4" />
                New Reading
              </button>
            </div>
          )}
        </div>
      </header>

      <main className="flex-1 max-w-5xl mx-auto w-full p-4 md:p-8">
        {!content ? (
          <div className="h-[70vh] flex flex-col items-center justify-center text-center space-y-8">
            <div className="space-y-4 max-w-2xl">
              <h2 className="text-4xl md:text-6xl font-bold text-slate-900 tracking-tight leading-tight">
                Understand any document <br />
                <span className="text-brand-600">in seconds.</span>
              </h2>
              <p className="text-lg text-slate-600">
                Upload a PDF or paste text to generate MCQs and get instant answers to your questions.
              </p>
            </div>

            <button
              onClick={() => setIsInputOpen(true)}
              className="group relative inline-flex items-center justify-center px-8 py-4 font-bold text-white transition-all duration-200 bg-brand-600 font-pj rounded-xl focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-brand-600 hover:bg-brand-700 shadow-lg hover:shadow-brand-500/25"
            >
              "Lettura facile" / "Reading is Easy", Click here
              <ChevronRight className="ml-2 w-5 h-5 group-hover:translate-x-1 transition-transform" />
            </button>
          </div>
        ) : (
          <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
            {/* Tabs */}
            <div className="flex p-1 bg-slate-200/50 rounded-xl w-fit tabs-container no-print">
              <button
                onClick={() => setActiveTab('mcq')}
                className={cn(
                  "px-6 py-2 rounded-lg text-sm font-semibold transition-all flex items-center gap-2",
                  activeTab === 'mcq' ? "bg-white text-brand-700 shadow-sm" : "text-slate-600 hover:text-slate-900"
                )}
              >
                <ClipboardList className="w-4 h-4" />
                MCQ with Answer
              </button>
              <button
                onClick={() => setActiveTab('qa')}
                className={cn(
                  "px-6 py-2 rounded-lg text-sm font-semibold transition-all flex items-center gap-2",
                  activeTab === 'qa' ? "bg-white text-brand-700 shadow-sm" : "text-slate-600 hover:text-slate-900"
                )}
              >
                <MessageSquare className="w-4 h-4" />
                Ask Questions
              </button>
            </div>

            {/* Content Area */}
            <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden min-h-[500px] flex flex-col no-print">
              {activeTab === 'mcq' ? (
                <div className="p-6 space-y-8">
                  <div className="flex items-center justify-between">
                    <h3 className="text-lg font-bold text-slate-800">Knowledge Check</h3>
                    <div className="flex items-center gap-3">
                      <button 
                        onClick={copyAllMcqs}
                        className={cn(
                          "flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all",
                          copied 
                            ? "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200" 
                            : "bg-brand-50 text-brand-700 hover:bg-brand-100 ring-1 ring-brand-200"
                        )}
                      >
                        {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                        {copied ? "Copied!" : "Select all"}
                      </button>
                      <span className="text-xs font-medium px-2 py-1 bg-slate-100 text-slate-600 rounded-full">{mcqs.length} Questions</span>
                    </div>
                  </div>
                  
                  <div className="space-y-10">
                    {mcqs.map((mcq, idx) => (
                      <div key={idx} className="space-y-4">
                        <div className="flex gap-3">
                          <span className="flex-shrink-0 w-6 h-6 rounded-full bg-slate-100 text-slate-600 text-xs flex items-center justify-center font-bold">
                            {idx + 1}
                          </span>
                          <p className="font-semibold text-slate-800 leading-relaxed">{mcq.question}</p>
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pl-9">
                          {mcq.options.map((opt, oIdx) => (
                            <div 
                              key={oIdx}
                              className={cn(
                                "p-3 rounded-xl border text-sm transition-all",
                                opt === mcq.answer 
                                  ? "bg-brand-50 border-brand-200 text-brand-900 ring-1 ring-brand-200" 
                                  : "border-slate-100 bg-slate-50/50 text-slate-600"
                              )}
                            >
                              <div className="flex items-center gap-2">
                                <span className="w-5 h-5 rounded-md border border-slate-200 bg-white flex items-center justify-center text-[10px] font-bold text-slate-400">
                                  {String.fromCharCode(65 + oIdx)}
                                </span>
                                {opt}
                                {opt === mcq.answer && <CheckCircle2 className="w-4 h-4 text-brand-600 ml-auto" />}
                              </div>
                            </div>
                          ))}
                        </div>
                        <div className="pl-9">
                          <details className="group">
                            <summary className="text-xs font-bold text-slate-400 cursor-pointer hover:text-slate-600 list-none flex items-center gap-1">
                              <HelpCircle className="w-3 h-3" />
                              View Explanation
                            </summary>
                            <p className="mt-2 text-sm text-slate-500 bg-slate-50 p-3 rounded-lg border border-slate-100 italic">
                              {mcq.explanation}
                            </p>
                          </details>
                        </div>
                      </div>
                    ))}
                  </div>

                  {/* Load More Button */}
                  <div className="pt-8 border-t border-slate-100 flex justify-center">
                    <button
                      onClick={handleLoadMoreMcqs}
                      disabled={isGeneratingMoreMcqs}
                      className={cn(
                        "group relative inline-flex items-center justify-center px-6 py-3 font-bold text-white transition-all duration-200 bg-brand-600 font-pj rounded-xl focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-brand-600 hover:bg-brand-700 shadow-md hover:shadow-brand-500/25 disabled:opacity-50 disabled:cursor-not-allowed",
                        isGeneratingMoreMcqs && "animate-pulse"
                      )}
                    >
                      {isGeneratingMoreMcqs ? (
                        <>
                          <Loader2 className="mr-2 w-4 h-4 animate-spin" />
                          Generating 5 more...
                        </>
                      ) : (
                        <>
                          Next MCQ 5 nos want click here
                          <ChevronRight className="ml-2 w-4 h-4 group-hover:translate-x-1 transition-transform" />
                        </>
                      )}
                    </button>
                  </div>
                </div>
              ) : (
                <div className="flex flex-col h-[600px]">
                  <div className="flex-1 overflow-y-auto p-6 space-y-6">
                    {chat.map((msg, idx) => (
                      <div 
                        key={idx} 
                        className={cn(
                          "flex flex-col gap-2",
                          msg.role === 'user' ? "items-end" : "items-start"
                        )}
                      >
                        <div className={cn(
                          "max-w-[85%] p-4 rounded-2xl text-sm leading-relaxed relative group",
                          msg.role === 'user' 
                            ? "bg-brand-600 text-white rounded-tr-none" 
                            : "bg-slate-100 text-slate-800 rounded-tl-none border border-slate-200"
                        )}>
                          <div className="markdown-body">
                            <Markdown>{msg.text}</Markdown>
                          </div>
                          
                          {msg.role === 'model' && (
                            <div className="mt-3 pt-3 border-t border-slate-200/50 flex flex-wrap gap-2">
                              <button 
                                onClick={() => handleSpeak(idx, 'en')}
                                className={cn(
                                  "flex items-center gap-1.5 px-2 py-1 rounded-md border text-[10px] font-bold transition-all",
                                  msg.isSpeakingEn 
                                    ? "bg-brand-600 border-brand-600 text-white" 
                                    : "bg-white border-slate-200 text-slate-500 hover:text-brand-600 hover:border-brand-200"
                                )}
                              >
                                {msg.isSpeakingEn ? <VolumeX className="w-3 h-3" /> : <Volume2 className="w-3 h-3" />}
                                {msg.isSpeakingEn ? "Stop Voice" : "Voice"}
                              </button>
                              
                              {!msg.tamilText && (
                                <button 
                                  onClick={() => handleTranslate(idx)}
                                  disabled={msg.isTranslating}
                                  className="flex items-center gap-1.5 px-2 py-1 rounded-md bg-white border border-slate-200 text-[10px] font-bold text-slate-500 hover:text-brand-600 hover:border-brand-200 transition-all disabled:opacity-50"
                                >
                                  {msg.isTranslating ? (
                                    <Loader2 className="w-3 h-3 animate-spin" />
                                  ) : (
                                    <Languages className="w-3 h-3" />
                                  )}
                                  Translate into Tamil language
                                </button>
                              )}
                            </div>
                          )}
                        </div>

                        {msg.tamilText && (
                          <div className="max-w-[85%] p-4 rounded-2xl rounded-tl-none bg-emerald-50 text-emerald-900 border border-emerald-100 text-sm leading-relaxed animate-in slide-in-from-left-2 duration-300">
                            <div className="font-bold text-[10px] text-emerald-600 uppercase tracking-wider mb-1 flex items-center justify-between">
                              <div className="flex items-center gap-1">
                                <Languages className="w-3 h-3" />
                                Tamil Translation
                              </div>
                            </div>
                            <p>{msg.tamilText}</p>
                          </div>
                        )}
                      </div>
                    ))}
                    {isProcessing && (
                      <div className="flex justify-start">
                        <div className="bg-slate-100 p-4 rounded-2xl rounded-tl-none border border-slate-200">
                          <Loader2 className="w-4 h-4 animate-spin text-slate-400" />
                        </div>
                      </div>
                    )}
                    <div ref={chatEndRef} />
                  </div>
                  
                  <div className="p-4 border-t border-slate-100 bg-slate-50/50">
                    <form 
                      onSubmit={(e) => { e.preventDefault(); handleSendMessage(); }}
                      className="flex gap-2"
                    >
                      <input
                        type="text"
                        value={userInput}
                        onChange={(e) => setUserInput(e.target.value)}
                        placeholder="Ask anything about the text..."
                        className="flex-1 bg-white border border-slate-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500/20 focus:border-brand-500 transition-all"
                      />
                      <button
                        type="submit"
                        disabled={isProcessing || !userInput.trim()}
                        className="bg-brand-600 text-white p-3 rounded-xl hover:bg-brand-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors shadow-sm"
                      >
                        <Send className="w-5 h-5" />
                      </button>
                    </form>
                    <p className="text-[10px] text-center text-slate-400 mt-2 font-medium">
                      Answers are limited to 5 lines for clarity.
                    </p>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </main>

      {/* Input Modal */}
      {isInputOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="bg-white w-full max-w-xl rounded-3xl shadow-2xl overflow-hidden animate-in zoom-in-95 duration-200 flex flex-col max-h-[90vh]">
            <div className="p-5 border-b border-slate-100 flex items-center justify-between bg-white shrink-0">
              <h3 className="text-lg font-bold text-slate-800">Choose your source</h3>
              <button 
                onClick={() => setIsInputOpen(false)}
                className="p-2 hover:bg-slate-100 rounded-full transition-colors"
              >
                <X className="w-5 h-5 text-slate-400" />
              </button>
            </div>
            
            <div className="p-6 overflow-y-auto space-y-6">
              {/* Upload Section */}
              <div className="space-y-3">
                <label className="text-xs font-bold text-slate-400 uppercase tracking-wider">Upload Document</label>
                <div 
                  onClick={() => fileInputRef.current?.click()}
                  className="border-2 border-dashed border-slate-200 rounded-2xl p-6 flex flex-col items-center justify-center gap-3 hover:border-brand-400 hover:bg-brand-50/30 cursor-pointer transition-all group"
                >
                  <div className="w-12 h-12 bg-slate-50 rounded-xl flex items-center justify-center group-hover:bg-brand-100 transition-colors">
                    <Upload className="w-6 h-6 text-slate-400 group-hover:text-brand-600 transition-colors" />
                  </div>
                  <div className="text-center">
                    <p className="text-sm font-bold text-slate-700">Click to upload PDF</p>
                    <p className="text-xs text-slate-400">or drag and drop file here</p>
                  </div>
                  <input 
                    type="file" 
                    ref={fileInputRef} 
                    onChange={handleFileUpload}
                    className="hidden" 
                    accept=".pdf,.txt"
                  />
                </div>
              </div>

              <div className="relative">
                <div className="absolute inset-0 flex items-center">
                  <span className="w-full border-t border-slate-100"></span>
                </div>
                <div className="relative flex justify-center text-[10px] uppercase">
                  <span className="bg-white px-3 text-slate-400 font-bold">Or paste text</span>
                </div>
              </div>

              {/* Paste Section */}
              <div className="space-y-3">
                <textarea
                  value={pastedText}
                  onChange={(e) => setPastedText(e.target.value)}
                  placeholder="Paste your text data here..."
                  className="w-full h-32 bg-slate-50 border border-slate-200 rounded-2xl p-4 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500/20 focus:border-brand-500 transition-all resize-none"
                />
              </div>
            </div>

            <div className="p-4 bg-slate-50 border-t border-slate-100 shrink-0">
              <button
                onClick={handlePasteSubmit}
                disabled={!pastedText.trim() || isProcessing}
                className={cn(
                  "w-full py-3.5 font-bold rounded-xl transition-all flex items-center justify-center gap-2 shadow-lg",
                  pastedText.trim() && !isProcessing 
                    ? "bg-brand-600 text-white hover:bg-brand-700 shadow-brand-500/20 animate-pulse-subtle" 
                    : "bg-slate-200 text-slate-400 cursor-not-allowed"
                )}
              >
                {isProcessing ? <Loader2 className="w-5 h-5 animate-spin" /> : <FileText className="w-5 h-5" />}
                {isProcessing ? "Processing..." : "Generate MCQs & Start Reading"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Processing Overlay */}
      {isProcessing && !isInputOpen && !content && (
        <div className="fixed inset-0 z-[60] flex flex-col items-center justify-center bg-white/80 backdrop-blur-md">
          <div className="relative">
            <div className="w-20 h-20 border-4 border-brand-100 border-t-brand-600 rounded-full animate-spin"></div>
            <BookOpen className="w-8 h-8 text-brand-600 absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2" />
          </div>
          <p className="mt-6 text-xl font-bold text-slate-800">Reading and Understanding...</p>
          <p className="mt-2 text-slate-500">Generating MCQs and preparing your assistant</p>
        </div>
      )}

      {/* Error Toast */}
      {error && (
        <div className="fixed bottom-8 left-1/2 -translate-x-1/2 z-[70] bg-red-600 text-white px-6 py-3 rounded-xl shadow-xl flex items-center gap-3 animate-in slide-in-from-bottom-4">
          <HelpCircle className="w-5 h-5" />
          <span className="font-medium">{error}</span>
          <button onClick={() => setError(null)} className="p-1 hover:bg-white/20 rounded-lg">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Footer */}
      <footer className="py-8 border-t border-slate-100 text-center">
        <p className="text-sm text-slate-400 font-medium">
          Powered by iniyan.talkies
        </p>
      </footer>
    </div>
  );
}

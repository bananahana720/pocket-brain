import React, { useState, useEffect, useRef, forwardRef, useImperativeHandle } from 'react';
import { Mic, Send, MicOff, X, Sparkles, Wand2, CheckSquare, Lightbulb } from 'lucide-react';
import { NoteType } from '../types';

// --- Web Speech API Type Definitions ---
interface SpeechRecognitionEvent extends Event {
  resultIndex: number;
  results: SpeechRecognitionResultList;
}

interface SpeechRecognitionResultList {
  length: number;
  item(index: number): SpeechRecognitionResult;
  [index: number]: SpeechRecognitionResult;
}

interface SpeechRecognitionResult {
  isFinal: boolean;
  length: number;
  item(index: number): SpeechRecognitionAlternative;
  [index: number]: SpeechRecognitionAlternative;
}

interface SpeechRecognitionAlternative {
  transcript: string;
  confidence: number;
}

interface SpeechRecognitionErrorEvent extends Event {
  error: string;
  message: string;
}

interface SpeechRecognition extends EventTarget {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: (event: SpeechRecognitionEvent) => void;
  onerror: (event: SpeechRecognitionErrorEvent) => void;
  onend: () => void;
}

interface SpeechRecognitionConstructor {
  new (): SpeechRecognition;
}

declare global {
  interface Window {
    SpeechRecognition?: SpeechRecognitionConstructor;
    webkitSpeechRecognition?: SpeechRecognitionConstructor;
  }
}
// ----------------------------------------

interface InputAreaProps {
  onSave: (content: string, presetType?: NoteType) => void;
  onBatchSave: (content: string) => void;
}

export interface InputAreaHandle {
  focus: () => void;
}

const InputArea = forwardRef<InputAreaHandle, InputAreaProps>(({ onSave, onBatchSave }, ref) => {
  const [text, setText] = useState('');
  const [isListening, setIsListening] = useState(false);
  const [presetType, setPresetType] = useState<NoteType | null>(null);
  const [isFocused, setIsFocused] = useState(false);
  const [isBatchMode, setIsBatchMode] = useState(false);
  const recognitionRef = useRef<SpeechRecognition | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const hasSpeechAPI = typeof window !== 'undefined' && ('SpeechRecognition' in window || 'webkitSpeechRecognition' in window);

  useImperativeHandle(ref, () => ({
    focus: () => {
      textareaRef.current?.focus();
    }
  }));

  useEffect(() => {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (SpeechRecognition) {
      const recognition = new SpeechRecognition();
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.lang = 'en-US';

      recognition.onresult = (event: SpeechRecognitionEvent) => {
        let finalTranscript = '';
        for (let i = event.resultIndex; i < event.results.length; ++i) {
          if (event.results[i].isFinal) {
            finalTranscript += event.results[i][0].transcript;
          }
        }
        if (finalTranscript) {
          setText((prev) => prev + (prev ? ' ' : '') + finalTranscript);
        }
      };

      recognition.onerror = (event: SpeechRecognitionErrorEvent) => {
        console.error('Speech recognition error', event.error);
        setIsListening(false);
      };

      recognition.onend = () => {
        setIsListening(false);
      };

      recognitionRef.current = recognition;
    }
  }, []);

  const toggleListening = () => {
    if (!recognitionRef.current) {
      alert('Speech recognition is not supported in this browser.');
      return;
    }

    if (isListening) {
      recognitionRef.current.stop();
      setIsListening(false);
    } else {
      try {
        recognitionRef.current.start();
        setIsListening(true);
      } catch (e) {
        console.error('Failed to start speech recognition:', e);
      }
    }
  };

  const handleSave = () => {
    if (!text.trim()) return;
    if (isBatchMode) {
      onBatchSave(text);
    } else {
      onSave(text, presetType ?? undefined);
    }
    resetInput();
  };

  const handleBatchSave = () => {
    if (!text.trim()) return;
    onBatchSave(text);
    resetInput();
  };

  const resetInput = () => {
    setText('');
    setPresetType(null);
    setIsBatchMode(false);
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
      textareaRef.current.focus();
    }
  }

  const handleQuickAction = (action: 'task' | 'idea' | 'voice' | 'batch') => {
    if (action === 'task') {
      setPresetType(prev => prev === NoteType.TASK ? null : NoteType.TASK);
      setIsBatchMode(false);
      textareaRef.current?.focus();
    } else if (action === 'idea') {
      setPresetType(prev => prev === NoteType.IDEA ? null : NoteType.IDEA);
      setIsBatchMode(false);
      textareaRef.current?.focus();
    } else if (action === 'voice') {
      setPresetType(null);
      setIsBatchMode(false);
      toggleListening();
    } else if (action === 'batch') {
      setIsBatchMode(prev => !prev);
      setPresetType(null);
      textareaRef.current?.focus();
      if (textareaRef.current) {
        textareaRef.current.style.height = '120px';
      }
    }
  };

  const getPlaceholder = () => {
    if (isListening) return "Listening...";
    if (presetType === NoteType.TASK) return "Creating a Task...";
    if (presetType === NoteType.IDEA) return "Creating an Idea...";
    if (isBatchMode) return "Dump multiple thoughts here, AI will split them...";
    return "Capture a thought...";
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      handleSave();
    }
  };

  const handleInput = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setText(e.target.value);
    e.target.style.height = 'auto';
    e.target.style.height = `${Math.min(e.target.scrollHeight, 160)}px`;
  };

  return (
    <div className="fixed bottom-0 left-0 right-0 z-50">
      {/* Gradient Fade Top */}
      <div className="h-12 bg-gradient-to-t from-white/100 dark:from-zinc-900/100 to-transparent pointer-events-none" />
      
      {/* Main Input Bar */}
      <div className={`bg-white/80 dark:bg-zinc-900/80 backdrop-blur-xl border-t border-zinc-200/50 dark:border-zinc-700/50 pb-safe px-4 pt-3 transition-all duration-500 ${isListening ? 'shadow-[0_-4px_20px_rgba(244,63,94,0.15)]' : ''}`}>
        {/* Quick Actions */}
        <div className={`max-w-2xl mx-auto overflow-hidden transition-all duration-300 ${isFocused && !presetType && !isBatchMode ? 'max-h-0 opacity-0 mb-0' : 'max-h-12 opacity-100 mb-2'}`}>
          <div className="flex gap-2">
            <button
              onClick={() => handleQuickAction('task')}
              className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition-all ${
                presetType === NoteType.TASK
                  ? 'bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-400 border border-emerald-200 dark:border-emerald-800'
                  : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-200 dark:hover:bg-zinc-700'
              }`}
            >
              <CheckSquare className="w-3.5 h-3.5" /> Task
            </button>
            <button
              onClick={() => handleQuickAction('idea')}
              className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition-all ${
                presetType === NoteType.IDEA
                  ? 'bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-400 border border-amber-200 dark:border-amber-800'
                  : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-200 dark:hover:bg-zinc-700'
              }`}
            >
              <Lightbulb className="w-3.5 h-3.5" /> Idea
            </button>
            {hasSpeechAPI && (
            <button
              onClick={() => handleQuickAction('voice')}
              className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition-all ${
                isListening
                  ? 'bg-rose-100 dark:bg-rose-900/40 text-rose-700 dark:text-rose-400 border border-rose-200 dark:border-rose-800'
                  : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-200 dark:hover:bg-zinc-700'
              }`}
            >
              <Mic className="w-3.5 h-3.5" /> Voice
            </button>
            )}
            <button
              onClick={() => handleQuickAction('batch')}
              className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition-all ${
                isBatchMode
                  ? 'bg-violet-100 dark:bg-violet-900/40 text-violet-700 dark:text-violet-400 border border-violet-200 dark:border-violet-800'
                  : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-200 dark:hover:bg-zinc-700'
              }`}
            >
              <Wand2 className="w-3.5 h-3.5" /> Batch
            </button>
          </div>
        </div>

        <div className="max-w-2xl mx-auto flex items-end gap-3 mb-2">
          
          {/* Text Area Container */}
          <div className={`relative flex-1 border rounded-[20px] transition-all shadow-sm overflow-hidden ${
             isListening
             ? 'bg-white dark:bg-zinc-800 border-rose-200 ring-2 ring-rose-500/20'
             : 'bg-zinc-100/50 dark:bg-zinc-800/50 border-zinc-200 dark:border-zinc-700 focus-within:bg-white dark:focus-within:bg-zinc-800 focus-within:ring-2 focus-within:ring-brand-500/20 focus-within:border-brand-500/50 hover:shadow-md'
          }`}>
              {isListening && (
                  <div className="absolute right-2 top-2 flex items-center gap-2 pointer-events-none">
                      <span className="flex h-2.5 w-2.5 relative">
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-rose-400 opacity-75"></span>
                        <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-rose-500"></span>
                      </span>
                  </div>
              )}
              
              <textarea
                ref={textareaRef}
                value={text}
                onChange={handleInput}
                onKeyDown={handleKeyDown}
                onFocus={() => setIsFocused(true)}
                onBlur={() => setIsFocused(false)}
                placeholder={getPlaceholder()}
                className={`w-full bg-transparent border-0 rounded-[20px] pl-4 pr-10 py-3 text-zinc-800 dark:text-zinc-100 placeholder-zinc-400 focus:ring-0 resize-none text-[15px] leading-relaxed ${isBatchMode ? 'min-h-[120px] max-h-60' : 'max-h-40 min-h-[48px]'}`}
                rows={1}
              />
              
              {text.length > 0 && !isListening && (
                  <button 
                      onClick={() => setText('')}
                      className="absolute right-2 top-2.5 p-1 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 transition-colors rounded-full hover:bg-zinc-100 dark:hover:bg-zinc-700"
                  >
                      <X className="w-4 h-4" />
                  </button>
              )}
          </div>

          {/* Action Buttons */}
          <div className="flex gap-2 shrink-0">
            {/* Mic Toggle */}
            {hasSpeechAPI && (
            <button
              onClick={toggleListening}
              className={`h-12 w-12 rounded-full flex items-center justify-center transition-all duration-300 border ${
                isListening
                  ? 'bg-rose-50 dark:bg-rose-900/30 border-rose-200 dark:border-rose-800 text-rose-600 animate-pulse shadow-inner'
                  : 'bg-white dark:bg-zinc-800 border-zinc-200 dark:border-zinc-700 text-zinc-500 dark:text-zinc-400 hover:text-zinc-800 dark:hover:text-zinc-200 hover:border-zinc-300 shadow-sm'
              }`}
              aria-label="Toggle voice recording"
            >
              {isListening ? <MicOff className="w-5 h-5" /> : <Mic className="w-5 h-5" />}
            </button>
            )}
            
            {/* Actions container (switches based on input) */}
            {text.trim().length > 5 ? (
                <>
                   {/* Magic Batch Split (hidden when already in batch mode) */}
                   {!isBatchMode && (
                     <button
                          onClick={handleBatchSave}
                          title="AI Batch Split"
                          className="h-12 w-12 rounded-full flex items-center justify-center transition-all duration-300 bg-violet-100 border border-violet-200 text-violet-600 hover:bg-violet-200 hover:scale-105 shadow-sm"
                      >
                          <Wand2 className="w-5 h-5" />
                      </button>
                   )}

                    {/* Standard Save */}
                    <button
                        onClick={handleSave}
                        title={isBatchMode ? "Batch Split (⌘+Enter)" : "Save (⌘+Enter)"}
                        className={`h-12 w-12 rounded-full flex items-center justify-center transition-all duration-300 hover:scale-105 shadow-md ${
                          isBatchMode
                            ? 'bg-violet-600 border border-violet-500 text-white hover:bg-violet-700 shadow-violet-500/30'
                            : 'bg-brand-600 border border-brand-500 text-white hover:bg-brand-700 shadow-brand-500/30'
                        }`}
                    >
                        {isBatchMode ? <Wand2 className="w-5 h-5" /> : <Send className="w-5 h-5 ml-0.5" />}
                    </button>
                </>
            ) : (
                // Greyed out save when empty
                <button
                    disabled
                    className="h-12 w-12 rounded-full flex items-center justify-center transition-all duration-300 bg-zinc-100 dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 text-zinc-300 dark:text-zinc-600 shadow-none cursor-not-allowed"
                >
                    <Send className="w-5 h-5 ml-0.5" />
                </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
});

InputArea.displayName = 'InputArea';
export default InputArea;
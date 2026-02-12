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
  onCleanupDraft: (content: string, mode: 'single' | 'batch') => Promise<{ cleanedText: string; items?: string[] }>;
  onTranscribe?: (audio: Blob) => Promise<string>;
}

export interface InputAreaHandle {
  focus: () => void;
}

interface DraftDiffLine {
  lineNumber: number;
  original: string;
  cleaned: string;
  changed: boolean;
}

interface CleanupPreviewState {
  mode: 'single' | 'batch';
  originalText: string;
  cleanedText: string;
  lines: DraftDiffLine[];
  changedCount: number;
}

function buildDraftDiff(originalText: string, cleanedText: string): DraftDiffLine[] {
  const originalLines = originalText.split('\n');
  const cleanedLines = cleanedText.split('\n');
  const maxLines = Math.max(originalLines.length, cleanedLines.length, 1);

  return Array.from({ length: maxLines }, (_, index) => {
    const original = originalLines[index] || '';
    const cleaned = cleanedLines[index] || '';
    return {
      lineNumber: index + 1,
      original,
      cleaned,
      changed: original !== cleaned,
    };
  });
}

const InputArea = forwardRef<InputAreaHandle, InputAreaProps>(({ onSave, onBatchSave, onCleanupDraft, onTranscribe }, ref) => {
  const [text, setText] = useState('');
  const [isListening, setIsListening] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [presetType, setPresetType] = useState<NoteType | null>(null);
  const [isFocused, setIsFocused] = useState(false);
  const [isBatchMode, setIsBatchMode] = useState(false);
  const [isCleaning, setIsCleaning] = useState(false);
  const [cleanupPreview, setCleanupPreview] = useState<CleanupPreviewState | null>(null);
  const recognitionRef = useRef<SpeechRecognition | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const recorderStreamRef = useRef<MediaStream | null>(null);
  const recorderChunksRef = useRef<Blob[]>([]);
  const transcriptionRequestRef = useRef(0);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const hasSpeechAPI = typeof window !== 'undefined' && ('SpeechRecognition' in window || 'webkitSpeechRecognition' in window);
  const hasMediaRecorder =
    typeof window !== 'undefined' &&
    typeof window.MediaRecorder !== 'undefined' &&
    typeof navigator !== 'undefined' &&
    !!navigator.mediaDevices?.getUserMedia;
  const canUseAIDictation = !!onTranscribe && hasMediaRecorder;
  const hasVoiceInput = canUseAIDictation || hasSpeechAPI;

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

  const resizeTextarea = (expanded = false) => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = 'auto';
    const maxHeight = expanded || isBatchMode ? 240 : 160;
    textarea.style.height = `${Math.min(textarea.scrollHeight, maxHeight)}px`;
  };

  const appendTranscript = (transcript: string) => {
    const cleaned = transcript.trim();
    if (!cleaned) return;
    setText(prev => (prev.trim() ? `${prev.trimEnd()} ${cleaned}` : cleaned));
    requestAnimationFrame(() => resizeTextarea(isBatchMode));
  };

  const stopRecorderStream = () => {
    if (recorderStreamRef.current) {
      recorderStreamRef.current.getTracks().forEach(track => track.stop());
      recorderStreamRef.current = null;
    }
  };

  const transcribeAudioBlob = async (audioBlob: Blob) => {
    if (!onTranscribe) return;
    const requestId = ++transcriptionRequestRef.current;
    setIsTranscribing(true);

    try {
      const transcript = await onTranscribe(audioBlob);
      if (requestId !== transcriptionRequestRef.current) return;
      appendTranscript(transcript);
    } catch (error) {
      console.error('Audio transcription failed:', error);
    } finally {
      if (requestId === transcriptionRequestRef.current) {
        setIsTranscribing(false);
      }
    }
  };

  const startRecorderListening = async (): Promise<boolean> => {
    if (!canUseAIDictation || !onTranscribe) return false;

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          channelCount: 1,
        },
      });

      const preferredMimeTypes = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'];
      const mimeType = preferredMimeTypes.find(type => window.MediaRecorder.isTypeSupported(type));
      const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);

      recorderStreamRef.current = stream;
      recorderChunksRef.current = [];

      recorder.ondataavailable = event => {
        if (event.data.size > 0) {
          recorderChunksRef.current.push(event.data);
        }
      };

      recorder.onerror = event => {
        console.error('Media recorder error:', event);
        setIsListening(false);
        stopRecorderStream();
        recorderRef.current = null;
      };

      recorder.onstop = () => {
        const recordedBlob = new Blob(recorderChunksRef.current, {
          type: recorder.mimeType || 'audio/webm',
        });
        recorderChunksRef.current = [];
        recorderRef.current = null;
        stopRecorderStream();
        setIsListening(false);

        if (recordedBlob.size > 0) {
          void transcribeAudioBlob(recordedBlob);
        }
      };

      recorderRef.current = recorder;
      recorder.start(250);
      setIsListening(true);
      return true;
    } catch (error) {
      console.error('Failed to start audio recorder:', error);
      stopRecorderStream();
      recorderRef.current = null;
      return false;
    }
  };

  const stopListening = (updateState = true) => {
    const recorder = recorderRef.current;
    if (recorder && recorder.state !== 'inactive') {
      if (!updateState) {
        recorder.onstop = null;
        recorder.onerror = null;
        recorder.ondataavailable = null;
      }
      recorder.stop();
      if (!updateState) {
        recorderRef.current = null;
        stopRecorderStream();
      }
    } else if (recorder) {
      recorderRef.current = null;
      stopRecorderStream();
    }

    if (recognitionRef.current) {
      try {
        recognitionRef.current.stop();
      } catch {
        // no-op: recognizer may already be stopped.
      }
    }
    if (updateState) {
      setIsListening(false);
    }
  };

  const toggleListening = async () => {
    if (isTranscribing) return;

    if (!hasVoiceInput) {
      alert('Voice recording is not supported in this browser.');
      return;
    }

    if (isListening) {
      stopListening();
      return;
    }

    const startedRecorder = await startRecorderListening();
    if (startedRecorder) return;

    if (!recognitionRef.current) {
      alert('Voice recording is not supported in this browser.');
      return;
    }

    try {
      recognitionRef.current.start();
      setIsListening(true);
    } catch (e) {
      console.error('Failed to start speech recognition:', e);
    }
  };

  useEffect(() => {
    return () => {
      transcriptionRequestRef.current += 1;
      stopListening(false);
      stopRecorderStream();
      try {
        recognitionRef.current?.stop();
      } catch {
        // no-op: stopping an inactive recognizer can throw on some browsers.
      }
    };
  }, []);

  const handleSave = () => {
    if (!text.trim() || isCleaning || isTranscribing || cleanupPreview) return;
    if (isBatchMode) {
      onBatchSave(text);
    } else {
      onSave(text, presetType ?? undefined);
    }
    resetInput();
  };

  const handleBatchSave = () => {
    if (!text.trim() || isCleaning || isTranscribing || cleanupPreview) return;
    onBatchSave(text);
    resetInput();
  };

  const resetInput = () => {
    transcriptionRequestRef.current += 1;
    setIsTranscribing(false);
    stopListening();
    setText('');
    setPresetType(null);
    setIsBatchMode(false);
    setCleanupPreview(null);
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
      void toggleListening();
    } else if (action === 'batch') {
      setIsBatchMode(prev => !prev);
      setPresetType(null);
      textareaRef.current?.focus();
      requestAnimationFrame(() => resizeTextarea(!isBatchMode));
    }
  };

  const handleCleanup = async () => {
    const content = text.trim();
    if (!content || isCleaning || isTranscribing || cleanupPreview || isListening) return;

    setIsCleaning(true);
    try {
      const mode = isBatchMode ? 'batch' : 'single';
      const result = await onCleanupDraft(content, mode);
      const nextText =
        mode === 'batch' && result.items?.length
          ? result.items.join('\n')
          : result.cleanedText.trim() || content;
      const lines = buildDraftDiff(content, nextText);
      const changedCount = lines.reduce((count, line) => count + (line.changed ? 1 : 0), 0);
      setCleanupPreview({
        mode,
        originalText: content,
        cleanedText: nextText,
        lines,
        changedCount,
      });
    } catch (error) {
      console.error('Draft clean-up failed:', error);
    } finally {
      setIsCleaning(false);
    }
  };

  const closeCleanupPreview = () => {
    setCleanupPreview(null);
    textareaRef.current?.focus();
  };

  const applyCleanupPreview = (action: 'replace' | 'keep-both') => {
    if (!cleanupPreview) return;
    const preview = cleanupPreview;
    setCleanupPreview(null);

    if (action === 'keep-both' && preview.originalText.trim()) {
      onSave(preview.originalText, !isBatchMode ? presetType ?? undefined : undefined);
    }

    setText(preview.cleanedText);
    requestAnimationFrame(() => resizeTextarea(preview.mode === 'batch'));
    textareaRef.current?.focus();
  };

  useEffect(() => {
    if (!cleanupPreview) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        closeCleanupPreview();
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [cleanupPreview]);

  const getPlaceholder = () => {
    if (isTranscribing) return "Transcribing...";
    if (isCleaning) return "Cleaning draft...";
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
    resizeTextarea();
  };

  return (
    <div className="fixed bottom-0 left-0 right-0 z-50">
      {/* Gradient Fade Top */}
      <div className="h-12 bg-gradient-to-t from-white/100 dark:from-zinc-900/100 to-transparent pointer-events-none" />
      
      {/* Main Input Bar */}
      <div className={`bg-white/80 dark:bg-zinc-900/80 backdrop-blur-xl border-t border-zinc-200/50 dark:border-zinc-700/50 pb-safe px-4 pt-3 transition-all duration-500 ${isListening ? 'shadow-[0_-4px_20px_rgba(244,63,94,0.15)]' : isTranscribing ? 'shadow-[0_-4px_20px_rgba(37,99,235,0.15)]' : ''}`}>
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
            {hasVoiceInput && (
            <button
              onClick={() => handleQuickAction('voice')}
              disabled={isTranscribing}
              className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition-all ${
                isListening
                  ? 'bg-rose-100 dark:bg-rose-900/40 text-rose-700 dark:text-rose-400 border border-rose-200 dark:border-rose-800'
                  : isTranscribing
                    ? 'bg-brand-100 dark:bg-brand-900/40 text-brand-700 dark:text-brand-300 border border-brand-200 dark:border-brand-700'
                  : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-200 dark:hover:bg-zinc-700'
              }`}
            >
              <Mic className="w-3.5 h-3.5" /> Dictate
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
             : isTranscribing
               ? 'bg-white dark:bg-zinc-800 border-brand-200 ring-2 ring-brand-500/20'
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
              
              {text.length > 0 && !isListening && !isTranscribing && (
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
            {hasVoiceInput && (
            <button
              onClick={() => void toggleListening()}
              disabled={isTranscribing}
              className={`h-12 w-12 rounded-full flex items-center justify-center transition-all duration-300 border ${
                isListening
                  ? 'bg-rose-50 dark:bg-rose-900/30 border-rose-200 dark:border-rose-800 text-rose-600 animate-pulse shadow-inner'
                  : isTranscribing
                    ? 'bg-brand-50 dark:bg-brand-900/30 border-brand-200 dark:border-brand-800 text-brand-600 shadow-inner'
                  : 'bg-white dark:bg-zinc-800 border-zinc-200 dark:border-zinc-700 text-zinc-500 dark:text-zinc-400 hover:text-zinc-800 dark:hover:text-zinc-200 hover:border-zinc-300 shadow-sm'
              } disabled:opacity-60 disabled:cursor-not-allowed`}
              aria-label="Toggle voice recording"
            >
              {isListening ? <MicOff className="w-5 h-5" /> : <Mic className={`w-5 h-5 ${isTranscribing ? 'animate-pulse' : ''}`} />}
            </button>
            )}
            
            {/* Actions container (switches based on input) */}
            {text.trim().length > 5 ? (
                <>
                    <button
                        onClick={handleCleanup}
                        disabled={isCleaning || isListening || isTranscribing || !!cleanupPreview}
                        title={isBatchMode ? "Clean + split draft for review" : "Clean draft for review"}
                        className={`h-12 w-12 rounded-full flex items-center justify-center transition-all duration-300 border shadow-sm disabled:opacity-60 disabled:cursor-not-allowed disabled:hover:scale-100 ${
                          isBatchMode
                            ? 'bg-violet-50 dark:bg-violet-900/30 border-violet-200 dark:border-violet-800 text-violet-600'
                            : 'bg-amber-50 dark:bg-amber-900/30 border-amber-200 dark:border-amber-800 text-amber-600'
                        } hover:scale-105`}
                    >
                        <Sparkles className={`w-5 h-5 ${isCleaning ? 'animate-spin' : ''}`} />
                    </button>

                   {/* Magic Batch Split (hidden when already in batch mode) */}
                   {!isBatchMode && (
                     <button
                          onClick={handleBatchSave}
                          disabled={isListening || isTranscribing || isCleaning || !!cleanupPreview}
                          title="AI Batch Split"
                          className="h-12 w-12 rounded-full flex items-center justify-center transition-all duration-300 bg-violet-100 border border-violet-200 text-violet-600 hover:bg-violet-200 hover:scale-105 shadow-sm disabled:opacity-60 disabled:cursor-not-allowed disabled:hover:scale-100"
                      >
                          <Wand2 className="w-5 h-5" />
                      </button>
                   )}

                    {/* Standard Save */}
                    <button
                        onClick={handleSave}
                        disabled={isCleaning || isListening || isTranscribing || !!cleanupPreview}
                        title={isBatchMode ? "Batch Split (⌘+Enter)" : "Save (⌘+Enter)"}
                        className={`h-12 w-12 rounded-full flex items-center justify-center transition-all duration-300 hover:scale-105 disabled:opacity-60 disabled:cursor-not-allowed disabled:hover:scale-100 shadow-md ${
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

      {cleanupPreview && (
        <div
          className="fixed inset-0 z-[80] bg-zinc-900/45 backdrop-blur-sm p-4 sm:p-6 flex items-end sm:items-center justify-center"
          onClick={(event) => {
            if (event.target === event.currentTarget) {
              closeCleanupPreview();
            }
          }}
        >
          <div className="w-full max-w-5xl bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 rounded-2xl shadow-2xl animate-fade-in">
            <div className="px-5 pt-5 pb-3 border-b border-zinc-200 dark:border-zinc-700">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h3 className="text-sm font-bold text-zinc-800 dark:text-zinc-100">Review Cleaned Draft</h3>
                  <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-1">
                    {cleanupPreview.changedCount === 0
                      ? 'No text changes detected. You can still apply the cleaned draft.'
                      : `${cleanupPreview.changedCount} line${cleanupPreview.changedCount === 1 ? '' : 's'} changed.`}
                  </p>
                </div>
                <span className="text-[10px] font-semibold uppercase tracking-wide px-2 py-1 rounded-full bg-zinc-100 dark:bg-zinc-800 text-zinc-500 dark:text-zinc-400">
                  {cleanupPreview.mode === 'batch' ? 'Batch Cleanup' : 'Draft Cleanup'}
                </span>
              </div>
            </div>

            <div className="p-4 grid grid-cols-1 md:grid-cols-2 gap-3 max-h-[54vh] overflow-y-auto">
              <div className="rounded-xl border border-zinc-200 dark:border-zinc-700 overflow-hidden">
                <div className="px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400 bg-zinc-50 dark:bg-zinc-800/70 border-b border-zinc-200 dark:border-zinc-700">
                  Original
                </div>
                <div className="p-2 font-mono text-xs leading-6">
                  {cleanupPreview.lines.map(line => (
                    <div
                      key={`orig-${line.lineNumber}`}
                      className={`grid grid-cols-[28px_1fr] gap-2 px-2 rounded ${line.changed ? 'bg-rose-50/80 dark:bg-rose-900/20' : ''}`}
                    >
                      <span className="text-zinc-400 select-none">{line.lineNumber}</span>
                      <span className="text-zinc-700 dark:text-zinc-300 whitespace-pre-wrap break-words">
                        {line.original || ' '}
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="rounded-xl border border-zinc-200 dark:border-zinc-700 overflow-hidden">
                <div className="px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400 bg-zinc-50 dark:bg-zinc-800/70 border-b border-zinc-200 dark:border-zinc-700">
                  Cleaned
                </div>
                <div className="p-2 font-mono text-xs leading-6">
                  {cleanupPreview.lines.map(line => (
                    <div
                      key={`clean-${line.lineNumber}`}
                      className={`grid grid-cols-[28px_1fr] gap-2 px-2 rounded ${line.changed ? 'bg-emerald-50/80 dark:bg-emerald-900/20' : ''}`}
                    >
                      <span className="text-zinc-400 select-none">{line.lineNumber}</span>
                      <span className="text-zinc-800 dark:text-zinc-100 whitespace-pre-wrap break-words">
                        {line.cleaned || ' '}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div className="px-5 pb-5 pt-2 flex flex-wrap gap-2 justify-end border-t border-zinc-200 dark:border-zinc-700">
              <button
                onClick={closeCleanupPreview}
                className="px-3 py-2 rounded-lg text-xs font-semibold text-zinc-600 dark:text-zinc-300 border border-zinc-200 dark:border-zinc-700 hover:bg-zinc-100 dark:hover:bg-zinc-800"
              >
                Cancel
              </button>
              <button
                onClick={() => applyCleanupPreview('keep-both')}
                className="px-3 py-2 rounded-lg text-xs font-semibold text-amber-700 dark:text-amber-300 border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20 hover:bg-amber-100 dark:hover:bg-amber-900/30"
              >
                Keep Original + Cleaned Copy
              </button>
              <button
                onClick={() => applyCleanupPreview('replace')}
                className="px-3 py-2 rounded-lg text-xs font-semibold text-white bg-brand-600 border border-brand-500 hover:bg-brand-700"
              >
                Apply Cleaned Draft
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
});

InputArea.displayName = 'InputArea';
export default React.memo(InputArea);

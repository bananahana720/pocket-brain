import React from 'react';

interface Props {
  fallback?: React.ReactNode;
  children: React.ReactNode;
}

interface State {
  hasError: boolean;
}

/* eslint-disable @typescript-eslint/no-explicit-any */

// Error boundaries must be class components. React types are resolved at runtime
// via CDN importmap, so we use `any` cast to avoid missing @types/react issues.
const ErrorBoundary: any = class ErrorBoundaryImpl extends (React.Component as any)<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(error: Error, errorInfo: any) {
    console.error('ErrorBoundary caught an error:', error, errorInfo);
  }

  render() {
    if ((this as any).state.hasError) {
      if ((this as any).props.fallback) {
        return (this as any).props.fallback;
      }
      return (
        <div className="flex flex-col items-center justify-center py-16 px-4">
          <div className="mission-note rounded-2xl border border-zinc-200/70 dark:border-zinc-700/70 p-8 max-w-sm w-full text-center shadow-sm">
            <div className="w-12 h-12 bg-rose-50 dark:bg-rose-900/30 rounded-full flex items-center justify-center mx-auto mb-4">
              <svg className="w-6 h-6 text-rose-500" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9 3.75h.008v.008H12v-.008Z" />
              </svg>
            </div>
            <h3 className="font-display text-2xl leading-none text-zinc-800 dark:text-zinc-100 mb-2">Something went wrong</h3>
            <p className="text-sm mission-muted mb-6">An unexpected error occurred. Your data is safe.</p>
            <button
              onClick={() => (this as any).setState({ hasError: false })}
              className="px-4 py-2 bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium rounded-xl transition-colors shadow-sm"
            >
              Try Again
            </button>
          </div>
        </div>
      );
    }

    return (this as any).props.children;
  }
};

export default ErrorBoundary;

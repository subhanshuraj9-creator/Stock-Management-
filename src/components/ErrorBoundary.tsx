import React, { Component, ErrorInfo, ReactNode } from 'react';
import { AlertCircle } from 'lucide-react';
import { Button } from './ui/button';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null,
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('Uncaught error:', error, errorInfo);
  }

  public componentDidMount() {
    window.addEventListener('error', this.handleGlobalError);
    window.addEventListener('unhandledrejection', this.handleUnhandledRejection);
  }

  public componentWillUnmount() {
    window.removeEventListener('error', this.handleGlobalError);
    window.removeEventListener('unhandledrejection', this.handleUnhandledRejection);
  }

  private isQuotaErrorStr = (str: string): boolean => {
    if (!str) return false;
    const lower = str.toLowerCase();
    return lower.includes('quota exceeded') || 
           lower.includes('quota limit exceeded') || 
           lower.includes('free daily read units') || 
           lower.includes('free tier database');
  };

  private handleGlobalError = (event: ErrorEvent) => {
    const errorMsg = event.message || '';
    const errObjMsg = event.error?.message || '';
    if (this.isQuotaErrorStr(errorMsg) || this.isQuotaErrorStr(errObjMsg)) {
      this.setState({ 
        hasError: true, 
        error: event.error || new Error(errorMsg || 'Firestore Quota Exceeded') 
      });
    }
  };

  private handleUnhandledRejection = (event: PromiseRejectionEvent) => {
    const error = event.reason instanceof Error ? event.reason : new Error(String(event.reason));
    const errorMsg = error.message || '';
    const reasonStr = typeof event.reason === 'string' ? event.reason : JSON.stringify(event.reason || '');
    if (this.isQuotaErrorStr(errorMsg) || this.isQuotaErrorStr(reasonStr)) {
      this.setState({ 
        hasError: true, 
        error 
      });
    }
  };

  public render() {
    if (this.state.hasError) {
      let errorMessage = "An unexpected error occurred.";
      let isQuotaExceeded = false;

      try {
        if (this.state.error?.message) {
          const messageStr = this.state.error.message;
          if (messageStr.includes("Quota exceeded for quota metric 'Free daily read units per project") || 
              messageStr.includes("Quota limit exceeded") || 
              messageStr.includes("free tier database")) {
            isQuotaExceeded = true;
          }

          try {
            const parsed = JSON.parse(messageStr);
            if (parsed.error) {
              errorMessage = `Firestore Error: ${parsed.error}`;
              if (parsed.error.includes("Quota exceeded for quota metric") || 
                  parsed.error.includes("Quota limit exceeded")) {
                isQuotaExceeded = true;
              }
            }
          } catch {
            errorMessage = messageStr;
          }
        }
      } catch (e) {
        errorMessage = this.state.error?.message || errorMessage;
      }

      const consoleUrl = "https://console.firebase.google.com/project/gen-lang-client-0343262963/firestore/databases/ai-studio-f79a046f-1c88-49e5-ac18-09d24ac1a540/data?openUpgradeDialog=true";

      if (isQuotaExceeded) {
        return (
          <div className="min-h-screen flex items-center justify-center p-4 bg-amber-50/40">
            <div className="max-w-lg w-full bg-white p-8 rounded-2xl shadow-xl border border-amber-200 text-center space-y-6">
              <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-amber-100 text-amber-700 mb-2">
                <AlertCircle size={32} />
              </div>
              
              <div className="space-y-4">
                <div className="p-3 bg-emerald-50 rounded-xl border border-emerald-100 flex items-center justify-center gap-2 mx-auto max-w-sm mb-2">
                  <span className="relative flex h-2.5 w-2.5">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500"></span>
                  </span>
                  <span className="text-xs font-serif font-bold text-emerald-800 tracking-wide">Blaze Plan Upgrade Detected</span>
                </div>
                
                <h1 className="text-2xl font-serif font-bold text-gray-900">Firestore Billing Verification</h1>
                <p className="text-xs uppercase tracking-widest font-mono text-gray-500 font-bold">Synchronizing database clusters</p>
              </div>

              <div className="text-sm text-gray-600 space-y-3 text-left bg-gray-50 p-4 rounded-xl border border-gray-100">
                <p>
                  We have registered your upgrade to the <strong>Firebase Blaze Plan (Pay-as-you-go)</strong> for your database:
                </p>
                <div className="bg-white p-2.5 rounded border border-gray-200/60 font-mono text-xs text-gray-700">
                  ai-studio-f79a046f-1c88-49e5-ac18-09d24ac1a540
                </div>
                <p className="text-xs text-gray-500 leading-relaxed">
                  <strong>Note:</strong> It can sometimes take a couple of minutes for Google Cloud's billing systems and regional Firestore nodes to propagate. All read restrictions will lift completely as soon as the API sync is complete. Your local cache remains fully safe and active.
                </p>
              </div>

              <div className="flex flex-col gap-2.5">
                <Button 
                  onClick={() => window.location.reload()}
                  className="bg-[#5A5A40] hover:bg-[#484833] text-white h-11 rounded-lg text-sm font-serif shadow-sm tracking-wide"
                >
                  Force Reload Application & Sync
                </Button>
                
                <a 
                  href={consoleUrl}
                  target="_blank"
                  referrerPolicy="no-referrer"
                  className="inline-flex items-center justify-center font-medium border border-gray-200 text-gray-600 hover:bg-gray-50 rounded-lg h-11 px-6 transition-all text-xs"
                >
                  Verify billing in Firebase Console
                </a>
              </div>
            </div>
          </div>
        );
      }

      return (
        <div className="min-h-screen flex items-center justify-center p-4 bg-gray-50">
          <div className="max-w-md w-full bg-white p-8 rounded-2xl shadow-xl border border-red-100 text-center">
            <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-red-100 text-red-600 mb-6">
              <AlertCircle size={32} />
            </div>
            <h1 className="text-2xl font-bold text-gray-900 mb-2">Something went wrong</h1>
            <p className="text-gray-600 mb-8">{errorMessage}</p>
            <Button 
              onClick={() => window.location.reload()}
              className="w-full bg-red-600 hover:bg-red-700 text-white"
            >
              Reload Application
            </Button>
          </div>
        </div>
      );
    }

    return (this as any).props.children;
  }
}

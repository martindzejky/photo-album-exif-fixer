// Simple logging service for the app

export interface LogEntry {
  id: string;
  timestamp: Date;
  level: "info" | "warning" | "error" | "success";
  message: string;
  details?: string;
}

class LoggerService {
  private logs: LogEntry[] = [];
  private listeners: ((logs: LogEntry[]) => void)[] = [];
  private idCounter = 0;
  private static readonly MAX_LOGS = 100;

  constructor() {
    // Set up global error handler
    if (typeof window !== "undefined") {
      window.addEventListener("error", (event) => {
        this.error(
          "Uncaught error occurred",
          `${
            event.error?.message || event.message
          }. Check browser console for details.`
        );
      });

      window.addEventListener("unhandledrejection", (event) => {
        this.error(
          "Unhandled promise rejection",
          `${event.reason}. Check browser console for details.`
        );
      });
    }
  }

  /**
   * Add a log entry
   */
  log(level: LogEntry["level"], message: string, details?: string): void {
    const entry: LogEntry = {
      id: `log-${++this.idCounter}`,
      timestamp: new Date(),
      level,
      message,
      details,
    };

    this.logs.push(entry);
    if (this.logs.length > LoggerService.MAX_LOGS) {
      // Keep only the most recent MAX_LOGS entries
      this.logs = this.logs.slice(-LoggerService.MAX_LOGS);
    }
    this.notifyListeners();
  }

  /**
   * Convenience methods
   */
  info(message: string, details?: string): void {
    this.log("info", message, details);
  }

  warning(message: string, details?: string): void {
    this.log("warning", message, details);
  }

  error(message: string, details?: string): void {
    this.log("error", message, details);
  }

  success(message: string, details?: string): void {
    this.log("success", message, details);
  }

  /**
   * Get all logs
   */
  getLogs(): LogEntry[] {
    return [...this.logs];
  }

  /**
   * Subscribe to log updates
   */
  subscribe(listener: (logs: LogEntry[]) => void): () => void {
    this.listeners.push(listener);

    // Return unsubscribe function
    return () => {
      const index = this.listeners.indexOf(listener);
      if (index > -1) {
        this.listeners.splice(index, 1);
      }
    };
  }

  /**
   * Clear all logs
   */
  clear(): void {
    this.logs = [];
    this.notifyListeners();
  }

  private notifyListeners(): void {
    this.listeners.forEach((listener) => listener([...this.logs]));
  }
}

// Export singleton instance
export const logger = new LoggerService();

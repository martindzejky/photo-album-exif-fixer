// Simple logging service for the app

export interface LogEntry {
	timestamp: Date;
	level: 'info' | 'warning' | 'error' | 'success';
	message: string;
	details?: string;
}

class LoggerService {
	private logs: LogEntry[] = [];
	private listeners: ((logs: LogEntry[]) => void)[] = [];

	/**
	 * Add a log entry
	 */
	log(level: LogEntry['level'], message: string, details?: string): void {
		const entry: LogEntry = {
			timestamp: new Date(),
			level,
			message,
			details
		};

		this.logs.push(entry);
		this.notifyListeners();

		// Keep only last 100 entries
		if (this.logs.length > 100) {
			this.logs = this.logs.slice(-100);
		}
	}

	/**
	 * Convenience methods
	 */
	info(message: string, details?: string): void {
		this.log('info', message, details);
	}

	warning(message: string, details?: string): void {
		this.log('warning', message, details);
	}

	error(message: string, details?: string): void {
		this.log('error', message, details);
	}

	success(message: string, details?: string): void {
		this.log('success', message, details);
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
		this.listeners.forEach(listener => listener([...this.logs]));
	}
}

// Export singleton instance
export const logger = new LoggerService();

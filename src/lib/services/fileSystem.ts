// File System Access API service for folder selection and file operations

export interface FolderHandle {
	handle: FileSystemDirectoryHandle;
	name: string;
	path: string;
}

class FileSystemService {
	private rootHandle: FileSystemDirectoryHandle | null = null;

	/**
	 * Check if File System Access API is supported
	 */
	isSupported(): boolean {
		return 'showDirectoryPicker' in window;
	}

	/**
	 * Request user to select a root folder
	 */
	async selectRootFolder(): Promise<FolderHandle> {
		if (!this.isSupported()) {
			throw new Error('File System Access API not supported. Please use Chrome/Edge.');
		}

		try {
			const handle = await window.showDirectoryPicker({
				mode: 'readwrite',
				startIn: 'pictures'
			});

			this.rootHandle = handle;
			
			return {
				handle,
				name: handle.name,
				path: handle.name
			};
		} catch (error) {
			if (error instanceof Error && error.name === 'AbortError') {
				throw new Error('Folder selection was cancelled.');
			}
			throw new Error(`Failed to select folder: ${error}`);
		}
	}

	/**
	 * Get the current root folder handle
	 */
	getRootHandle(): FileSystemDirectoryHandle | null {
		return this.rootHandle;
	}

	/**
	 * Get immediate subdirectories (albums) from root
	 */
	async getAlbums(): Promise<FolderHandle[]> {
		if (!this.rootHandle) {
			throw new Error('No root folder selected');
		}

		const albums: FolderHandle[] = [];
		
		try {
			for await (const [name, entry] of this.rootHandle.entries()) {
				if (entry.kind === 'directory') {
					albums.push({
						handle: entry,
						name,
						path: `${this.rootHandle.name}/${name}`
					});
				}
			}
		} catch (error) {
			throw new Error(`Failed to read albums: ${error}`);
		}

		return albums.sort((a, b) => a.name.localeCompare(b.name));
	}

	/**
	 * Clear the current root folder selection
	 */
	clearSelection(): void {
		this.rootHandle = null;
	}
}

// Export singleton instance
export const fileSystemService = new FileSystemService();

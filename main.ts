import { Plugin, Notice, MarkdownRenderer, Component, requestUrl, Modal, App, TFile } from 'obsidian';

/**
 * Global debug flag.
 * Set to true to enable console logging.
 */
declare const DEBUG: boolean;

/**
 * Extending the Obsidian App interface to include `openWithDefaultApp`.
 * This is a mobile-specific API often available but not strictly typed in the main definitions.
 */
declare module 'obsidian' {
    interface App {
        openWithDefaultApp(path: string): void;
    }
}

/**
 * Main Plugin Class for Android PDF Export.
 * 
 * This plugin works around the lack of native PDF export on Android by:
 * 1. Rendering Markdown to HTML.
 * 2. Inlining all resources (images) as Base64.
 * 3. Saving the HTML file.
 * 4. Allowing the user to open it in a browser to use the system "Print" dialog.
 */
export default class AndroidPdfPlugin extends Plugin {
    
    /**
     * specialized CSS styles for the exported HTML.
     * Includes print-media queries to ensure better output.
     */
    private readonly styles = `
    <style>
        body { 
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Oxygen-Sans, Ubuntu, Cantarell, "Helvetica Neue", sans-serif;
            color: #000;
            background: #fff;
            padding: 20px;
            line-height: 1.6;
            font-size: 14px;
            max-width: 800px;
            margin: 0 auto;
        }
        img { max-width: 100%; height: auto; display: block; margin: 10px 0; }
        h1, h2, h3, h4, h5, h6 { margin-top: 1.5em; margin-bottom: 0.5em; page-break-after: avoid; }
        blockquote { border-left: 4px solid #ccc; padding-left: 10px; color: #666; }
        code { background: #f4f4f4; padding: 2px 5px; border-radius: 3px; font-family: monospace; }
        pre { background: #f4f4f4; padding: 10px; border-radius: 5px; overflow-x: auto; }
        table { border-collapse: collapse; width: 100%; margin: 15px 0; }
        th, td { border: 1px solid #ddd; padding: 8px; text-align: left; }
        th { background-color: #f2f2f2; }
        a { color: #007bff; text-decoration: none; }
        /* Print-specific overrides */
        @media print {
            body { 
                padding: 0; 
                margin: 0; 
                -webkit-print-color-adjust: exact; 
                print-color-adjust: exact; 
            }
            a { text-decoration: none; color: black; }
            .print-hidden { display: none; }
        }
    </style>
    `;

    /**
     * Plugin entry point.
     */
    async onload() {
        // 1. Add Ribbon Icon
        this.addRibbonIcon('pdf-file', 'Export to PDF', () => {
            this.generatePdf();
        });

        // 2. Add Command Palette Item
        this.addCommand({
            id: 'export-android-pdf',
            name: 'Export current file to PDF',
            callback: () => this.generatePdf()
        });
    }

    /**
     * Main orchestration function.
     * 
     * Steps:
     * 1. Get Active File.
     * 2. Render Markdown to DOM.
     * 3. Process/Embed Images.
     * 4. Wrap in HTML Template.
     * 5. Save to File system.
     * 6. Open Modal.
     */
    async generatePdf() {
        const activeFile = this.app.workspace.getActiveFile();
        if (!activeFile) {
            new Notice('No active file selected.');
            return;
        }

        if (typeof DEBUG !== 'undefined' && DEBUG) console.log(`[AndroidPdf] Starting export for ${activeFile.path}`);
        new Notice(`Generating HTML for printing...`);

        // Create a temporary hidden container to render the markdown
        const tempContainer = document.body.createDiv('print-temp-container');
        tempContainer.style.display = 'none';
        
        try {
            // STEP 1: Render Markdown
            await this.renderMarkdown(activeFile, tempContainer);

            // STEP 2: Create Export Folder
            const exportFolder = await this.createUniqueExportFolder(activeFile.basename);

            // STEP 3: Process Images (Embed them)
            await this.processImages(tempContainer);
            
            // STEP 4: Sanitize (Remove Videos, etc)
            this.sanitizeElements(tempContainer);

            // STEP 5: Generate Final HTML String
            const fullHtml = this.generateHtmlTemplate(activeFile.basename, tempContainer.innerHTML);

            // STEP 6: Save and Notify
            await this.saveAndPrompt(activeFile.basename, exportFolder, fullHtml);

        } catch (e) {
            console.error('[AndroidPdf] Export failed', e);
            new Notice('PDF Export failed. Check console for details.');
        } finally {
            // Cleanup
            document.body.removeChild(tempContainer);
        }
    }

    /**
     * Renders markdown content into an HTML container.
     */
    async renderMarkdown(file: TFile, container: HTMLElement) {
        if (typeof DEBUG !== 'undefined' && DEBUG) console.log('[AndroidPdf] Rendering markdown...');
        const content = await this.app.vault.read(file);
        
        // MarkdownRenderer takes care of plugins, callouts, and internal Obsidian syntax
        await MarkdownRenderer.render(
            this.app,
            content,
            container,
            file.path,
            new Component()
        );
    }

    /**
     * Creates a unique folder for the export to avoid collisions.
     */
    async createUniqueExportFolder(basename: string): Promise<string> {
        const safeBasename = basename.replace(/[^a-z0-9]/gi, '_');
        let folderName = `${safeBasename}-Export`
        
        if (!(await this.app.vault.adapter.exists(folderName))) {
            await this.app.vault.createFolder(folderName);
            return folderName;
        }

        // Handle duplicates by appending number
        let i = 1;
        while (await this.app.vault.adapter.exists(`${folderName}-${i}`)) {
            i++;
        }
        const newFolderName = `${folderName}-${i}`;
        await this.app.vault.createFolder(newFolderName);
        return newFolderName;
    }

    /**
     * Iterates through the rendered HTML and replaces all image links with Base64 data.
     * This ensures the resulting HTML file works offline.
     */
    async processImages(container: HTMLElement) {
        // 1. Convert Obsidian internal embeds (<span class="internal-embed">) to standard <img> tags
        const embeds = Array.from(container.querySelectorAll('span.internal-embed'));
        for (const span of embeds) {
            const src = span.getAttribute('src');
            if (!src) continue;

            const ext = src.split('.').pop()?.toLowerCase();
            const imageExtensions = ['png', 'jpg', 'jpeg', 'gif', 'bmp', 'svg', 'webp', 'heic'];
            
            if (ext && imageExtensions.includes(ext)) {
                const img = document.createElement('img');
                img.setAttribute('src', src);
                img.setAttribute('data-is-embed', 'true'); // Flag to process differently later
                img.style.maxWidth = '100%';
                span.replaceWith(img);
            }
        }

        // 2. Process actual <img> tags
        const images = Array.from(container.querySelectorAll('img'));
        const promises = images.map(async (img, index) => {
            await this.embedSingleImage(img, index);
        });

        await Promise.all(promises);
    }

    /**
     * Processes a single image element: resolves source, fetches data, and converts to Base64.
     */
    async embedSingleImage(img: HTMLImageElement, index: number) {
        const originalSrc = img.getAttribute('src');
        if (!originalSrc || originalSrc.startsWith('data:')) return; // Already embedded or empty

        try {
            const isEmbed = img.getAttribute('data-is-embed') === 'true';
            let linktext = '';
            
            // Determine the "file name" to search for in Vault
            if (isEmbed) {
                linktext = originalSrc;
            } else {
                const decodedSrc = decodeURIComponent(originalSrc);
                linktext = decodedSrc.split('?')[0];
                linktext = linktext.split('/').pop() || '';
            }

            let buffer: ArrayBuffer | null = null;
            let mimeType = 'image/png';

            // ATTEMPT 1: Resolve Local File in Vault
            const activeFile = this.app.workspace.getActiveFile();
            // getFirstLinkpathDest resolves [[Link]] or 'Path/To/File.png' relative to active file
            let file = this.app.metadataCache.getFirstLinkpathDest(linktext, activeFile?.path || '');

            // Fallback: search by name only if path resolution failed
            if (!file && linktext) {
                const found = this.app.vault.getFiles().find(f => f.name === linktext);
                file = found || null;
            }

            if (file) {
                 if (typeof DEBUG !== 'undefined' && DEBUG) console.log(`[AndroidPdf] Found local file: ${file.path}`);
                 buffer = await this.app.vault.readBinary(file);
                 mimeType = this.getMimeType(file.extension);
            } else if (!isEmbed && originalSrc.startsWith('http')) {
                // ATTEMPT 2: Public URL (http/https)
                if (typeof DEBUG !== 'undefined' && DEBUG) console.log(`[AndroidPdf] Fetching remote: ${originalSrc}`);
                const response = await requestUrl({ url: originalSrc });
                buffer = response.arrayBuffer;
                mimeType = response.headers['content-type'] || 'image/png';
            }

            // ATTEMPT 3: Embed Base64
            if (buffer) {
                const base64 = await this.arrayBufferToBase64Async(buffer, mimeType);
                img.setAttribute('src', base64);
                
                // Remove attributes that might interfere with simple displaying
                img.removeAttribute('srcset');
                img.removeAttribute('data-src');
                img.removeAttribute('data-is-embed');
                img.removeAttribute('sizes');
            } else {
                console.warn(`[AndroidPdf] Could not resolve image: ${originalSrc}`);
                img.alt = `[Image Missing: ${originalSrc}]`;
                img.style.border = "1px solid red";
            }

        } catch (err) {
            console.error(`[AndroidPdf] Failed to process image ${originalSrc}`, err);
        }
    }

    /**
     * Helper to map extensions to MimeTypes.
     */
    getMimeType(extension: string): string {
        switch(extension.toLowerCase()) {
            case 'jpg':
            case 'jpeg': return 'image/jpeg';
            case 'webp': return 'image/webp';
            case 'gif': return 'image/gif';
            case 'svg': return 'image/svg+xml';
            case 'bmp': return 'image/bmp';
            default: return 'image/png';
        }
    }

    /**
     * Helper to read ArrayBuffer to Base64 String using FileReader.
     */
    async arrayBufferToBase64Async(buffer: ArrayBuffer, mimeType: string): Promise<string> {
        return new Promise<string>((resolve, reject) => {
            const blob = new Blob([buffer], { type: mimeType });
            const reader = new FileReader();
            reader.onloadend = () => {
                if (reader.result) {
                    resolve(reader.result as string);
                } else {
                    reject(new Error('Empty conversion result'));
                }
            };
            reader.onerror = reject;
            reader.readAsDataURL(blob);
        });
    }

    /**
     * Removes unsupported elements for print (video, audio, etc).
     */
    sanitizeElements(container: HTMLElement) {
        container.querySelectorAll('video, audio, iframe').forEach(el => {
            const placeholder = document.createElement('div');
            placeholder.innerText = `[Media/Embed not supported in PDF Export]`;
            placeholder.style.border = '1px dashed #ccc';
            placeholder.style.padding = '10px';
            placeholder.style.color = '#888';
            placeholder.style.textAlign = 'center';
            el.replaceWith(placeholder);
        });
    }

    /**
     * Wraps the content in a full HTML document structure.
     */
    generateHtmlTemplate(title: string, contentHtml: string): string {
        return `
<!DOCTYPE html>
<html>
<head>
    <title>${title}</title>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    ${this.styles}
</head>
<body>
    ${contentHtml}
    <script>
        // Auto-trigger print when opened
        window.onload = function() {
            setTimeout(function() {
                window.print();
            }, 500);
        }
    </script>
</body>
</html>`;
    }

    /**
     * Saves the HTML file and opens the feedback modal.
     */
    async saveAndPrompt(basename: string, folderName: string, fullHtml: string) {
        if (typeof DEBUG !== 'undefined' && DEBUG) console.log('[AndroidPdf] Saving to vault...');
        
        // Convert to ArrayBuffer
        // @ts-ignore - TextEncoder is available in Obsidian environment
        const buffer = new TextEncoder().encode(fullHtml).buffer;
        
        const htmlPath = `${folderName}/index.html`;
        await this.app.vault.createBinary(htmlPath, buffer);
        
        new Notice(`Exported to: ${folderName}`);
        new OpenPdfModal(this.app, htmlPath).open();
    }
}

/**
 * Modal to prompt the user to open the generated file.
 */
class OpenPdfModal extends Modal {
    filePath: string;

    constructor(app: App, filePath: string) {
        super(app);
        this.filePath = filePath;
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.createEl('h2', { text: 'PDF Export Ready' });
        contentEl.createEl('p', { text: `HTML file generated at: ${this.filePath}` });
        contentEl.createEl('p', { text: 'Open this file in your browser to print it as a PDF.' });

        const div = contentEl.createDiv({ cls: 'modal-button-container' });
        
        const btnOpen = div.createEl('button', { text: 'Open in Browser', cls: 'mod-cta' });
        btnOpen.addEventListener('click', () => {
            this.app.openWithDefaultApp(this.filePath);
            this.close();
        });

        const btnCancel = div.createEl('button', { text: 'Done' });
        btnCancel.addEventListener('click', () => {
            this.close();
        });
    }

    onClose() {
        this.contentEl.empty();
    }
}

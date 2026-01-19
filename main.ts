import { Plugin, Notice, MarkdownRenderer, Component, Platform, requestUrl, Modal, App } from 'obsidian';
// @ts-ignore
// import html2pdf from 'html2pdf.js'; // REMOVED: Using Native Print

declare const DEBUG: boolean;

// Extending App interface to include openWithDefaultApp for mobile
declare module 'obsidian' {
    interface App {
        openWithDefaultApp(path: string): void;
    }
}

export default class AndroidPdfPlugin extends Plugin {
    
    async onload() {
        // Add ribbon icon
        this.addRibbonIcon('pdf-file', 'Export to PDF', () => {
            this.generatePdf();
        });

        // Add command palette item
        this.addCommand({
            id: 'export-android-pdf',
            name: 'Export current file to PDF',
            callback: () => this.generatePdf()
        });
    }

    async generatePdf() {
        const activeFile = this.app.workspace.getActiveFile();
        if (!activeFile) {
            new Notice('No active file selected.');
            return;
        }

        if (typeof DEBUG !== 'undefined' && DEBUG) console.log(`[AndroidPdf] Starting export for ${activeFile.path}`);
        new Notice(`Generating HTML for printing...`);

        // --- 1. PREPARE TEMP CONTAINER ---
        const tempContainer = document.body.createDiv('print-temp-container');
        tempContainer.style.display = 'none';
        
        try {
            // --- STEP 2: RENDER MARKDOWN ---
            try {
                if (typeof DEBUG !== 'undefined' && DEBUG) console.log('[AndroidPdf] Rendering markdown...');
                const content = await this.app.vault.read(activeFile);
                await MarkdownRenderer.render(
                    this.app,
                    content,
                    tempContainer,
                    activeFile.path,
                    new Component()
                );
            } catch (err) {
                console.error('[AndroidPdf] Markdown rendering failed', err);
                new Notice('Failed to render Markdown content.');
                throw err;
            }

            // --- STEP 3: PREPARE FOLDER ---
            const exportFolder = await this.createUniqueExportFolder(activeFile.basename);
            if (typeof DEBUG !== 'undefined' && DEBUG) console.log(`[AndroidPdf] Export folder created: ${exportFolder}`);

            // --- STEP 4: PROCESS IMAGES ---
            try {
                if (typeof DEBUG !== 'undefined' && DEBUG) console.log('[AndroidPdf] Processing images...');
                await this.processImages(tempContainer, exportFolder);
                this.sanitizeElements(tempContainer);
            } catch (err) {
                console.error('[AndroidPdf] Image processing failed', err);
                new Notice('Failed to process images.');
                throw err; 
            }

            // --- STEP 5: CREATE HTML ---
            let fullHtml = '';
            try {
                const css = `
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
                        body { padding: 0; margin: 0; }
                        a { text-decoration: none; color: black; }
                    }
                </style>
                `;

                fullHtml = `
                    <!DOCTYPE html>
                    <html>
                    <head>
                        <title>${activeFile.basename}</title>
                        <meta charset="utf-8">
                        <meta name="viewport" content="width=device-width, initial-scale=1">
                        ${css}
                    </head>
                    <body>
                        ${tempContainer.innerHTML}
                        <script>
                            // Auto-trigger print when opened
                            window.onload = function() {
                                setTimeout(function() {
                                    window.print();
                                }, 500);
                            }
                        </script>
                    </body>
                    </html>
                `;
            } catch (err) {
                console.error('[AndroidPdf] HTML generation failed', err);
                new Notice('Failed to generate HTML structure.');
                throw err;
            }

            // --- STEP 6: SAVE AND PROMPT ---
            try {
                if (typeof DEBUG !== 'undefined' && DEBUG) console.log('[AndroidPdf] Saving to vault...');
                // @ts-ignore
                const fullHtmlBuffer = new TextEncoder().encode(fullHtml).buffer;
                
                const htmlPath = `${exportFolder}/index.html`;
                await this.app.vault.createBinary(htmlPath, fullHtmlBuffer);
                
                if (typeof DEBUG !== 'undefined' && DEBUG) console.log(`[AndroidPdf] Saved to ${htmlPath}`);
                
                new Notice(`Exported to: ${exportFolder}`);
                new OpenPdfModal(this.app, htmlPath).open();

            } catch (err) {
                console.error('[AndroidPdf] Saving failed', err);
                new Notice('Failed to save the HTML file.');
                throw err;
            }

        } catch (e) {
            // Main catch for any unexpected flow interruptions
            if (typeof DEBUG !== 'undefined' && DEBUG) console.error('[AndroidPdf] General aborted', e);
        } finally {
            document.body.removeChild(tempContainer);
        }
    }

    async createUniqueExportFolder(basename: string): Promise<string> {
        // Sanitize basename to ensure valid folder name
        const safeBasename = basename.replace(/[^a-z0-9]/gi, '_');
        let folderName = `${safeBasename}-Export`
        
        if (!(await this.app.vault.adapter.exists(folderName))) {
            await this.app.vault.createFolder(folderName);
            return folderName;
        }

        let i = 1;
        while (await this.app.vault.adapter.exists(`${folderName}-${i}`)) {
            i++;
        }
        const newFolderName = `${folderName}-${i}`;
        await this.app.vault.createFolder(newFolderName);
        return newFolderName;
    }

    async saveFileToVault(buffer: ArrayBuffer, filename: string): Promise<string> {
        let safeName = filename;
        let i = 1;
        while (await this.app.vault.adapter.exists(safeName)) {
            safeName = filename.replace('.html', ` (${i}).html`);
            i++;
        }
        await this.app.vault.createBinary(safeName, buffer);
        return safeName;
    }

    async processImages(container: HTMLElement, exportFolder: string) {
        // Phase 1: Handle Obsidian "internal-embed" spans
        const embeds = Array.from(container.querySelectorAll('span.internal-embed'));
        
        for (const span of embeds) {
            const src = span.getAttribute('src');
            if (!src) continue;

            const ext = src.split('.').pop()?.toLowerCase();
            const imageExtensions = ['png', 'jpg', 'jpeg', 'gif', 'bmp', 'svg', 'webp', 'heic'];
            
            if (ext && imageExtensions.includes(ext)) {
                const img = document.createElement('img');
                img.setAttribute('src', src);
                img.setAttribute('data-is-embed', 'true');
                img.style.maxWidth = '100%';
                span.replaceWith(img);
            }
        }

        // Phase 2: Process all img tags -> Convert to Base64
        const images = Array.from(container.querySelectorAll('img'));
        
        const promises = images.map(async (img, index) => {
            const originalSrc = img.getAttribute('src');
            
            // Skip already embedded images
            if (!originalSrc || originalSrc.startsWith('data:')) return;

            // Mark processing to avoid loops if needed, though map is safe
            try {
                if (typeof DEBUG !== 'undefined' && DEBUG) console.log(`[AndroidPdf] Processing img src: ${originalSrc}`);

                const isEmbed = img.getAttribute('data-is-embed') === 'true';
                let linktext = '';
                
                if (isEmbed) {
                    linktext = originalSrc;
                } else {
                    const decodedSrc = decodeURIComponent(originalSrc);
                    linktext = decodedSrc.split('?')[0];
                    linktext = linktext.split('/').pop() || '';
                }

                let buffer: ArrayBuffer | null = null;
                let mimeType = 'image/png'; // default

                 // 1. Resolve Local File
                 const activeFile = this.app.workspace.getActiveFile();
                 let file = this.app.metadataCache.getFirstLinkpathDest(linktext, activeFile?.path || '');

                 if (!file && linktext) {
                     const found = this.app.vault.getFiles().find(f => f.name === linktext);
                     file = found || null;
                 }

                if (file) {
                    if (typeof DEBUG !== 'undefined' && DEBUG) console.log(`[AndroidPdf] Found local file: ${file.path}`);
                    buffer = await this.app.vault.readBinary(file);
                    
                    // Determine Mime Type from Extension
                    const ext = file.extension.toLowerCase();
                    if (ext === 'png') mimeType = 'image/png';
                    else if (ext === 'jpg' || ext === 'jpeg') mimeType = 'image/jpeg';
                    else if (ext === 'webp') mimeType = 'image/webp';
                    else if (ext === 'gif') mimeType = 'image/gif';
                    else if (ext === 'svg') mimeType = 'image/svg+xml';
                    
                } else if (!isEmbed && originalSrc.startsWith('http')) {
                    // 2. Network Request
                    if (typeof DEBUG !== 'undefined' && DEBUG) console.log(`[AndroidPdf] Trying requestUrl: ${originalSrc}`);
                    const response = await requestUrl({ url: originalSrc });
                    buffer = response.arrayBuffer;
                    mimeType = response.headers['content-type'] || 'image/png';
                }

                // 3. Convert to Base64 and Embed
                if (buffer) {
                    // Convert ArrayBuffer to Base64 string using FileReader (async) for better performance/handling
                    const base64 = await new Promise<string>((resolve, reject) => {
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

                    // Set the src to the Data URI
                    img.setAttribute('src', base64);
                    
                    // Clean up attributes
                    img.removeAttribute('srcset');
                    img.removeAttribute('data-src');
                    img.removeAttribute('data-is-embed');
                    img.removeAttribute('sizes'); // important to remove sizes so browser uses natural size or style
                    
                    if (typeof DEBUG !== 'undefined' && DEBUG) console.log(`[AndroidPdf] Embedded image ${index} (${mimeType})`);
                } else {
                     console.error(`[AndroidPdf] Could not resolve buffer for: ${originalSrc}`);
                     img.alt = `[Image Missing]`;
                     // Optional: Add a visual placeholder
                     img.style.border = "1px solid red";
                }

            } catch (err) {
                console.error(`[AndroidPdf] Failed to process image ${originalSrc}`, err);
            }
        });

        await Promise.all(promises);
    }

    arrayBufferToBase64(buffer: ArrayBuffer): string {
        // Legacy, unused now
        let binary = '';
        const bytes = new Uint8Array(buffer);
        const len = bytes.byteLength;
        for (let i = 0; i < len; i++) {
            binary += String.fromCharCode(bytes[i]);
        }
        return window.btoa(binary);
    }

    sanitizeElements(container: HTMLElement) {
        // Remove videos/iframes which render as black/white boxes
        container.querySelectorAll('video, audio, iframe').forEach(el => {
            const placeholder = document.createElement('div');
            placeholder.innerText = `[Media/Embed not supported in PDF]`;
            placeholder.style.border = '1px dashed #ccc';
            placeholder.style.padding = '10px';
            placeholder.style.color = '#888';
            el.replaceWith(placeholder);
        });
    }

    async saveBlobToVault(blob: Blob, filename: string) {
        // Legacy method, unused now but kept for reference
        const arrayBuffer = await blob.arrayBuffer();
        await this.saveFileToVault(arrayBuffer, filename);
    }

    delay(ms: number) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}

class OpenPdfModal extends Modal {
    filePath: string;

    constructor(app: App, filePath: string) {
        super(app);
        this.filePath = filePath;
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.createEl('h2', { text: 'HTML Generated' });
        contentEl.createEl('p', { text: 'The print-ready HTML file has been saved to your vault.' });
        contentEl.createEl('p', { text: 'Would you like to open it in your default browser to print it as PDF?' });

        const div = contentEl.createDiv({ cls: 'modal-button-container' });
        
        const btnOpen = div.createEl('button', { text: 'Open in Browser', cls: 'mod-cta' });
        btnOpen.addEventListener('click', () => {
            this.app.openWithDefaultApp(this.filePath);
            this.close();
        });

        const btnCancel = div.createEl('button', { text: 'Cancel' });
        btnCancel.addEventListener('click', () => {
            this.close();
        });
    }

    onClose() {
        this.contentEl.empty();
    }
}
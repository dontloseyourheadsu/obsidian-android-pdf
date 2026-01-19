import { Plugin, Notice, MarkdownRenderer, Component, Platform, requestUrl } from 'obsidian';
// @ts-ignore
import html2pdf from 'html2pdf.js';

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

        new Notice(`Generating PDF for ${activeFile.basename}...`);

        // --- 1. PREPARE CONTAINER ---
        // We create a container that mimics a piece of paper (A4 width approx 794px at 96dpi)
        // This ensures the PDF looks like a document, not a thin phone screenshot.
        const container = document.body.createDiv('print-container');
        container.style.position = 'absolute';
        container.style.left = '-9999px'; // Hide off-screen
        container.style.top = '0';
        container.style.width = '794px'; // A4 width
        container.style.minHeight = '1123px'; // A4 height
        container.style.backgroundColor = 'white';
        container.style.color = 'black';
        container.style.padding = '40px'; 
        container.style.fontSize = '14px';
        
        try {
            // --- 2. RENDER MARKDOWN ---
            const content = await this.app.vault.read(activeFile);
            await MarkdownRenderer.render(
                this.app,
                content,
                container,
                activeFile.path,
                new Component()
            );

            // --- 3. FIX IMAGES (CORS BYPASS) ---
            // We fetch external images using Obsidian's requestUrl (which bypasses CORS)
            // and convert them to Base64 data URIs.
            await this.processImages(container);

            // --- 4. SANITIZE (Remove videos/embeds) ---
            this.sanitizeElements(container);

            // --- 5. GENERATE PDF ---
            const opt = {
                margin: 10,
                filename: `${activeFile.basename}.pdf`,
                image: { type: 'jpeg', quality: 0.98 },
                html2canvas: { 
                    scale: 2, 
                    useCORS: true, 
                    scrollY: 0,
                    windowWidth: 794 // Force canvas to match our container
                },
                jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' }
            };

            const pdfBlob = await html2pdf().set(opt).from(container).output('blob');
            
            // --- 6. SAVE TO VAULT ---
            await this.saveBlobToVault(pdfBlob, `${activeFile.basename}.pdf`);
            new Notice(`Saved: ${activeFile.basename}.pdf`);

        } catch (e) {
            console.error(e);
            new Notice('PDF Export failed. Check console.');
        } finally {
            document.body.removeChild(container);
        }
    }

    async processImages(container: HTMLElement) {
        const images = Array.from(container.querySelectorAll('img'));
        
        const promises = images.map(async (img) => {
            const src = img.getAttribute('src');
            
            // Skip if it's already local (app://) or base64 (data:)
            if (!src || src.startsWith('data:') || src.startsWith('app://')) return;

            // Check if it's an external http/https link
            if (src.startsWith('http')) {
                try {
                    // Use Obsidian's requestUrl to bypass CORS
                    const response = await requestUrl({ url: src });
                    
                    // Create buffer from response
                    const buffer = response.arrayBuffer;
                    
                    // Convert buffer to base64
                    const base64 = this.arrayBufferToBase64(buffer);
                    const contentType = response.headers['content-type'] || 'image/jpeg';
                    
                    // Replace src with base64 data URI
                    img.src = `data:${contentType};base64,${base64}`;
                } catch (err) {
                    console.error(`Failed to fetch image ${src}`, err);
                    img.alt = `[Image Load Failed]`;
                }
            }
        });

        await Promise.all(promises);
    }

    arrayBufferToBase64(buffer: ArrayBuffer): string {
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
        const arrayBuffer = await blob.arrayBuffer();
        let safeName = filename;
        let i = 1;
        while (await this.app.vault.adapter.exists(safeName)) {
            safeName = filename.replace('.pdf', ` (${i}).pdf`);
            i++;
        }
        await this.app.vault.createBinary(safeName, arrayBuffer);
    }
}
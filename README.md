# Android PDF Export for Obsidian

This plugin is a workaround to enable exporting Obsidian notes to PDF on Android devices, a feature currently missing from the mobile version of Obsidian.

## How it Works (The Workaround)

Since Obsidian mobile does not possess a native PDF export engine, this plugin relies on the Android system's printing capabilities:

1.  **Render**: It uses Obsidian's internal Markdown renderer to convert your note into HTML.
2.  **Embed**: It finds all images (local and remote) and embeds them directly into the HTML file as Base64 data. This makes the HTML file "self-contained" (single-file), so it doesn't break when opened outside of Obsidian.
3.  **Save**: It saves this HTML file into your vault in a specific export folder.
4.  **Print**: It prompts you to open this file in your default browser (Chrome, WebView, etc.). The file includes a small script to automatically trigger the browser's "Print" dialog. From there, you can choose "Save as PDF".

## Features

- **Native Rendering**: Uses Obsidian's `MarkdownRenderer` so your plugins, callouts, and syntax highlighting should look mostly correct.
- **Offline Images**: Automatically converts local images (from your vault) into embedded Base64 data.
- **Remote Images**: Fetches and embeds images from the web (HTTP/HTTPS).
- **Clean Output**: Includes basic CSS optimization for printing (hides scrollbars, optimizes margins).
- **Sanitization**: Replaces unsupported media (Videos, Iframes) with placeholders to prevent print errors.

## Installation

1.  Open Obsidian Settings > Community Plugins.
2.  Turn off "Safe mode".
3.  Click "Browse" and search for "Android PDF Export" (once published).
4.  Install and Enable.

## How to Use

1.  Open the note you want to export.
2.  Click the **Ribbon Icon** (PDF Document icon) OR open the Command Palette and search for **"Export current file to PDF"**.
3.  Wait for the "Generating HTML..." notification.
4.  A modal will appear asking to **"Open in Browser"**. Click it.
5.  Your browser should open the file and automatically show the Print dialog.
6.  Select **"Save as PDF"** as the printer.

## Development & Contributing

Contributions are welcome!

### Prerequisites

- Node.js
- Obsidian (for testing)

### Setup

1.  Fork and clone this repository.
2.  Run `npm install` to install dependencies.
3.  Run `npm run dev` to start the compiler in watch mode.
4.  Copy the `main.js`, `manifest.json`, and `styles.css` to your test vault's `.obsidian/plugins/obsidian-android-pdf/` folder.

### Testing

You can test this on the desktop version of Obsidian as well, though the styling options and printing behavior might vary slightly compared to Android's WebView.

### Contributing

- **Code**: Submit a Pull Request. Please attempt to follow existing code styles.
- **Issues**: Open an issue if you find bugs or have feature requests.

## License

MIT License. See [LICENSE](LICENSE) file.

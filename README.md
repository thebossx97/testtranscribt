# Local Whisper Transcriber

Browser-based audio transcription using Whisper AI. Upload audio files or capture screen/tab audio for transcription, all processed locally in your browser.

## Features

- **100% Local Processing** - No data sent to servers, runs entirely in your browser
- **File Upload** - Support for audio and video files (MP3, WAV, MP4, etc.)
- **Screen/Tab Capture** - Experimental feature to capture and transcribe audio from browser tabs
- **Multiple Models** - Choose between Tiny (fastest), Base (balanced), or Small (most accurate)
- **Export Options** - Copy to clipboard or download as text file

## Usage

### Option 1: File Upload
1. Click "Choose audio file" and select your audio/video file
2. Click "Transcribe file" to process
3. Wait for transcription to complete
4. Copy or download the transcript

### Option 2: Screen/Tab Capture (Experimental)
1. Click "Share screen/tab + audio"
2. Select the tab/window you want to capture
3. **Important**: Enable "Share audio" checkbox in the picker
4. Click "Stop capture" when done
5. Transcription will process automatically

## Technical Details

### Improvements Over Original

**Reliability Enhancements:**
- ✅ File size validation (max 500MB)
- ✅ Proper AudioContext cleanup to prevent memory leaks
- ✅ Race condition prevention with processing state management
- ✅ MediaRecorder compatibility detection with fallback mime types
- ✅ Audio track validation for screen capture
- ✅ Timeout protection for model loading (5 min)
- ✅ Proper error handling throughout
- ✅ Cleanup on page unload

**Code Quality:**
- ✅ Separated concerns (HTML, CSS, JS in separate files)
- ✅ State management pattern
- ✅ Comprehensive error messages
- ✅ Better user feedback
- ✅ Timestamped download filenames

**Browser Compatibility:**
- Chrome/Edge: Full support including tab audio capture
- Firefox: File upload works, screen capture limited
- Safari: File upload works, screen capture not supported

### Browser Requirements

- Modern browser with Web Audio API support
- For screen capture: Chrome/Edge recommended
- Sufficient RAM (model downloads ~40-150MB depending on selection)

### Model Information

| Model | Size | Speed | Accuracy | Languages |
|-------|------|-------|----------|-----------|
| Tiny  | ~40MB | Fastest | Good | English only |
| Base  | ~75MB | Balanced | Better | English only |
| Small | ~150MB | Slower | Best | Multi-language |

Models are cached in browser storage after first download.

## File Structure

```
testtranscribt/
├── index-improved.html    # Main application (improved version)
├── index.html            # Original simple version
├── css/
│   └── styles.css        # All styling
├── js/
│   └── app.js           # Application logic
└── README.md            # This file
```

## Development

No build process required. Simply open `index-improved.html` in a modern browser.

For local development with live reload, you can use any static server:

```bash
# Python
python -m http.server 8000

# Node.js (with Express server)
npm install
npm start

# Or simple static server
npx serve

# PHP
php -S localhost:8000
```

## Deployment

### Railway.app

1. Push code to GitHub
2. Go to [Railway.app](https://railway.app)
3. Click "New Project" → "Deploy from GitHub repo"
4. Select your repository
5. Railway will auto-detect and deploy using the configuration files

The app will be available at your Railway-provided URL.

**Start command:** `npm start` (automatically configured)

## Known Limitations

1. **Screen Capture**: Experimental feature, behavior varies by browser and OS
2. **File Size**: Very large files (>500MB) may cause browser performance issues
3. **Model Loading**: First load requires internet connection to download model
4. **Audio Format**: Some exotic audio codecs may not be supported

## Privacy

All processing happens locally in your browser. No audio data is sent to any server. The Whisper model is downloaded once from Hugging Face CDN and cached locally.

## Credits

- Whisper AI by OpenAI
- Transformers.js by Xenova
- UI inspired by modern design systems

## License

MIT License - Feel free to use and modify as needed.

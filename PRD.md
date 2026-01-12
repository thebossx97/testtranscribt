# Product Requirements Document: Local Whisper Transcriber

**Version:** 1.0  
**Last Updated:** January 12, 2026  
**Status:** Production  
**Deployment:** [Railway.app](https://railway.app)

---

## Executive Summary

Local Whisper Transcriber is a browser-based audio transcription application that runs OpenAI's Whisper AI models entirely in the user's browser. It provides privacy-focused, offline-capable transcription for audio files and screen/tab audio capture with support for 20+ languages.

---

## Product Vision

**Mission:** Provide accessible, privacy-first audio transcription without requiring server infrastructure, API keys, or sending user data to external services.

**Target Users:**
- Content creators needing quick transcriptions
- Privacy-conscious users who don't want to upload audio to cloud services
- Developers and researchers working with audio data
- Users in regions with limited internet connectivity (after initial model download)
- Multilingual users needing transcription in various languages

---

## Core Features

### 1. Model Management

**Startup Experience:**
- Full-screen loading overlay during initial setup
- Sequential download of 3 Whisper models (Tiny, Base, Small)
- Real-time progress tracking with visual indicators
- Model status display (waiting → downloading → loaded)
- Total download: ~710MB (one-time, cached permanently)
- Estimated time: 3-5 minutes on typical connection

**Model Selection:**
- **Tiny Model:** ~75MB, fastest processing, good accuracy, multilingual
- **Base Model:** ~145MB, balanced speed/accuracy, multilingual (default)
- **Small Model:** ~490MB, highest accuracy, multilingual, slower processing

**Technical Implementation:**
- Models loaded from Hugging Face CDN via transformers.js
- Browser IndexedDB caching for instant subsequent loads
- Automatic fallback if CDN unavailable
- Memory-efficient model switching

### 2. Language Support

**Supported Languages (20+):**
- Auto-detect (default)
- English, Spanish, French, German, Italian
- Portuguese, Dutch, Russian, Chinese, Japanese
- Korean, Arabic, Hindi, Turkish, Polish
- Ukrainian, Vietnamese, Thai, Swedish

**Language Detection:**
- Automatic language detection when set to "Auto-detect"
- Manual language selection for better accuracy
- Multilingual models support all languages
- Language persists across transcriptions

### 3. File Transcription

**Supported Formats:**
- Audio: MP3, WAV, M4A, AAC, OGG, FLAC, WMA
- Video: MP4, WebM, MKV, AVI, MOV (extracts audio)
- Maximum file size: 500MB

**User Flow:**
1. Click "Choose audio file" button
2. Select file from local system
3. File name displayed with size validation
4. Click "Transcribe file" to process
5. Progress indicator during transcription
6. Transcript appears in text area
7. Copy or download options enabled

**Technical Details:**
- File decoded using Web Audio API
- Automatic resampling to 16kHz (Whisper requirement)
- Chunked processing (30s chunks, 5s stride) for long files
- Memory-efficient processing with cleanup
- Error handling for unsupported formats

### 4. Screen/Tab Audio Capture

**Capabilities:**
- Capture audio from browser tabs
- Capture audio from application windows
- Capture system audio (OS-dependent)
- Live transcription with periodic updates

**User Flow:**
1. Click "Share screen/tab + audio" button
2. Browser shows screen picker dialog
3. Select tab/window to capture
4. **Critical:** Enable "Share audio" checkbox
5. Recording starts with visual indicator
6. Live transcription updates every 10 seconds
7. Click "Stop capture" to finalize
8. Final complete transcription displayed

**Live Transcription Behavior:**
- Updates every 10 seconds during recording
- Voice activity detection skips silent periods
- Timestamp-based incremental text extraction
- Complete transcript shown on stop

**Known Limitations:**
- Browser models may hallucinate on long recordings
- Background noise can affect quality
- Best results with clear speech, minimal background noise
- Recommended: Record 30-60s, then stop for best quality

**Browser Compatibility:**
- Chrome/Edge: Full support with tab audio
- Firefox: Limited screen capture support
- Safari: Not supported

### 5. Transcript Management

**Display:**
- Large, scrollable text area
- Auto-scroll to bottom on updates
- Monospace font for readability
- Character count display

**Export Options:**
- **Copy to Clipboard:** One-click copy of full transcript
- **Download as TXT:** Timestamped filename (e.g., `transcript-2026-01-12-143022.txt`)
- Visual feedback on successful copy

**Editing:**
- Text area is editable
- Users can correct/modify transcript before export
- Changes persist until new transcription

---

## User Interface

### Layout

**Header:**
- App title with icon
- Subtitle explaining functionality
- Model selector dropdown
- Language selector dropdown

**Main Panel:**
- Transcript text area (primary focus)
- Alert/notification area
- Status indicator
- Progress text

**Control Panel:**
- File upload section
  - Choose file button
  - Selected file display
  - Transcribe button
- Screen capture section
  - Start capture button
  - Stop capture button
- Export section
  - Copy button
  - Download button

### Visual Design

**Color Scheme:**
- Dark theme (background: #0a0a0a)
- Accent color: #3b82f6 (blue)
- Success: #10b981 (green)
- Warning: #f59e0b (orange)
- Error: #ef4444 (red)

**Typography:**
- System font stack for UI
- Monospace for transcript
- Clear hierarchy with size/weight

**Interactions:**
- Smooth transitions (200ms)
- Hover states on all interactive elements
- Disabled states clearly indicated
- Loading spinners for async operations

---

## Technical Architecture

### Frontend Stack

**Core Technologies:**
- Pure HTML5, CSS3, JavaScript (ES6+)
- No framework dependencies
- Modular file structure

**Key Libraries:**
- **Transformers.js:** Whisper model inference
- **ONNX Runtime:** WebAssembly execution
- **Web Audio API:** Audio processing

**Browser APIs:**
- MediaRecorder API (audio capture)
- AudioContext API (audio processing)
- Screen Capture API (tab/window capture)
- IndexedDB (model caching)
- Clipboard API (copy functionality)

### State Management

```javascript
state = {
    transcriber: null,              // Loaded Whisper pipeline
    currentModelId: null,           // Active model ID
    selectedFile: null,             // Selected audio file
    currentTranscript: '',          // Current transcript text
    isLoadingModel: false,          // Model loading state
    isTranscribing: false,          // Transcription in progress
    shareStream: null,              // MediaStream for capture
    shareRecorder: null,            // MediaRecorder instance
    shareChunks: [],                // Recorded audio chunks
    audioContexts: [],              // Track for cleanup
    loadedModels: {},               // Cached model instances
    allModelsLoaded: false,         // Startup complete flag
    isLiveTranscribing: false,      // Live transcription active
    lastProcessedTimestamp: 0       // For incremental updates
}
```

### Audio Processing Pipeline

1. **Input:** File or MediaRecorder chunks
2. **Decode:** AudioContext.decodeAudioData()
3. **Resample:** OfflineAudioContext to 16kHz mono
4. **Convert:** AudioBuffer → Float32Array
5. **Transcribe:** Whisper model inference
6. **Output:** Text with optional timestamps

### Model Loading

**Startup Sequence:**
1. Initialize transformers.js library
2. Configure WASM backend (multi-threaded)
3. Load Tiny model (first, fastest)
4. Load Base model (second)
5. Load Small model (third, largest)
6. Cache all models in IndexedDB
7. Hide startup screen, show main UI

**Configuration:**
```javascript
env.allowLocalModels = false;  // Force CDN loading
env.backends.onnx.wasm.numThreads = navigator.hardwareConcurrency || 4;
env.backends.onnx.wasm.proxy = false;
```

### Live Transcription Algorithm

**Approach:** Timestamp-based incremental extraction

1. MediaRecorder captures 10-second chunks
2. On chunk arrival:
   - Combine all accumulated chunks
   - Decode complete audio stream
   - Check voice activity (RMS energy > 0.01)
   - If silent, skip transcription
   - Transcribe with `return_timestamps: true`
   - Extract text segments after `lastProcessedTimestamp`
   - Append new text to existing transcript
   - Update `lastProcessedTimestamp`

**Voice Activity Detection:**
```javascript
RMS = sqrt(sum(sample^2) / length)
if RMS > 0.01: process
else: skip (silence/noise)
```

---

## Performance Characteristics

### Model Performance

| Model | Size | Load Time | Transcription Speed | Accuracy |
|-------|------|-----------|---------------------|----------|
| Tiny  | 75MB | 10-15s    | ~0.5x realtime      | Good     |
| Base  | 145MB| 20-30s    | ~1x realtime        | Better   |
| Small | 490MB| 60-90s    | ~2x realtime        | Best     |

*Note: Times vary by device and network speed*

### Memory Usage

- Idle: ~100MB
- Model loaded: +75-490MB (model size)
- Transcribing: +50-200MB (audio buffer)
- Peak: ~800MB (Small model + large file)

### Browser Requirements

**Minimum:**
- Chrome 90+, Edge 90+, Firefox 88+
- 4GB RAM
- Modern CPU (2015+)
- 1GB free disk space (model cache)

**Recommended:**
- Chrome 120+, Edge 120+
- 8GB+ RAM
- Multi-core CPU
- SSD storage

---

## Quality & Limitations

### What Works Well

✅ **File Transcription:**
- Excellent accuracy on clear audio
- Handles multiple languages
- Works with various formats
- Reliable for files up to 500MB

✅ **Short Recordings:**
- 30-60 second captures work great
- Clear speech transcribed accurately
- Minimal hallucination on short clips

✅ **Privacy:**
- 100% local processing
- No data sent to servers
- Works offline after model download

### Known Limitations

❌ **Live Transcription Quality:**
- Browser models (Tiny/Base/Small) hallucinate on long recordings
- Background noise causes repetition loops
- Silence triggers hallucination
- Best used for short bursts, not continuous streaming

❌ **Browser Constraints:**
- Large files may cause memory issues
- Model download requires good internet
- Screen capture limited to Chrome/Edge
- No iOS Safari support for capture

❌ **Model Limitations:**
- Smaller models less accurate than server-side Whisper
- No speaker diarization
- No word-level timestamps in UI
- Limited punctuation accuracy

### Recommended Usage

**Best Practices:**
1. Use file transcription for best quality
2. For live capture: record 30-60s, then stop
3. Use Base or Small model for better accuracy
4. Ensure clear audio with minimal background noise
5. Select language manually if known

**Not Recommended:**
- Continuous live transcription > 2 minutes
- Noisy environments
- Multiple speakers (no diarization)
- Real-time streaming applications

---

## Security & Privacy

### Data Handling

- **No server communication:** All processing in browser
- **No analytics:** No tracking or telemetry
- **No storage:** Transcripts not saved automatically
- **Local models:** Cached in browser IndexedDB
- **User control:** User must explicitly save/copy transcripts

### Content Security Policy

```
default-src 'self';
script-src 'self' 'unsafe-inline' 'unsafe-eval' https://cdn.jsdelivr.net https://huggingface.co;
connect-src 'self' https://huggingface.co https://cdn.jsdelivr.net blob: data:;
worker-src 'self' blob: data:;
```

*Note: `unsafe-eval` required for WebAssembly*

### Permissions Required

- **Microphone:** Not used (no mic recording)
- **Screen Capture:** Only when user clicks "Share screen"
- **Storage:** IndexedDB for model caching
- **Clipboard:** Only when user clicks "Copy"

---

## Deployment

### Hosting

**Platform:** Railway.app  
**Type:** Static site with Node.js server  
**Auto-deploy:** Push to main branch triggers deployment

### Configuration Files

**package.json:**
```json
{
  "name": "testtranscribt",
  "version": "1.0.0",
  "scripts": {
    "start": "node server.js"
  },
  "dependencies": {
    "express": "^4.18.2"
  }
}
```

**server.js:**
- Express server serving static files
- Port from environment variable
- Serves index.html as default

**Procfile:**
```
web: npm start
```

**railway.json:**
```json
{
  "$schema": "https://railway.app/railway.schema.json",
  "build": {
    "builder": "NIXPACKS"
  },
  "deploy": {
    "startCommand": "npm start",
    "restartPolicyType": "ON_FAILURE",
    "restartPolicyMaxRetries": 10
  }
}
```

### Environment Variables

None required - fully static application.

### CDN Dependencies

- **Transformers.js:** https://cdn.jsdelivr.net/npm/@xenova/transformers
- **Models:** https://huggingface.co/Xenova/whisper-*

---

## Future Enhancements

### Potential Features

**High Priority:**
1. **Better live transcription:** Investigate larger models or streaming approaches
2. **Speaker diarization:** Identify different speakers
3. **Timestamp display:** Show word-level timestamps in UI
4. **Batch processing:** Upload multiple files
5. **Format options:** Export as SRT, VTT, JSON

**Medium Priority:**
6. **Audio playback:** Play audio with transcript highlighting
7. **Search in transcript:** Find specific words/phrases
8. **Custom vocabulary:** Add domain-specific terms
9. **Translation:** Translate transcript to other languages
10. **Noise reduction:** Pre-process audio to reduce background noise

**Low Priority:**
11. **Themes:** Light mode option
12. **Keyboard shortcuts:** Power user features
13. **History:** Save recent transcriptions
14. **Cloud sync:** Optional backup to user's cloud storage
15. **Mobile app:** Native iOS/Android versions

### Technical Improvements

- **WebGPU support:** Faster inference when available
- **Streaming inference:** True real-time transcription
- **Progressive model loading:** Start with Tiny, upgrade to larger
- **Service worker:** Full offline capability
- **Web Workers:** Offload processing from main thread

---

## Success Metrics

### User Engagement

- **Daily Active Users:** Track unique visitors
- **Transcription Volume:** Number of files/captures processed
- **Model Usage:** Distribution across Tiny/Base/Small
- **Language Usage:** Most common languages selected

### Performance

- **Load Time:** Time to interactive after model download
- **Transcription Speed:** Average time per minute of audio
- **Error Rate:** Failed transcriptions / total attempts
- **Browser Compatibility:** Success rate by browser

### Quality

- **User Retention:** Return visits within 7 days
- **Session Duration:** Time spent in application
- **Feature Usage:** File vs. capture usage ratio
- **Export Rate:** Transcripts copied/downloaded

---

## Support & Documentation

### User Documentation

- **README.md:** Installation and basic usage
- **In-app help:** Tooltips and status messages
- **Error messages:** Clear, actionable guidance

### Developer Documentation

- **Code comments:** Inline documentation
- **Architecture notes:** This PRD
- **API documentation:** Transformers.js integration

### Troubleshooting

**Common Issues:**
1. "Failed to load models" → Check internet, CDN access
2. "No audio track" → Enable "Share audio" in picker
3. Hallucination → Use shorter recordings, file transcription
4. Memory errors → Use smaller model, smaller files
5. Browser compatibility → Use Chrome/Edge

---

## Changelog

### Version 1.0 (Current)

**Features:**
- Multi-model support (Tiny, Base, Small)
- 20+ language support with auto-detection
- File transcription (audio/video)
- Screen/tab audio capture
- Live transcription with incremental updates
- Voice activity detection
- Copy/download export
- Full startup experience with progress tracking

**Technical:**
- Transformers.js integration
- WebAssembly ONNX runtime
- Timestamp-based incremental transcription
- Memory-efficient audio processing
- Comprehensive error handling
- Railway deployment

---

## Appendix

### File Structure

```
testtranscribt/
├── .devcontainer/          # Dev container config
├── .git/                   # Git repository
├── .gitignore             # Git ignore rules
├── css/
│   └── styles.css         # All application styles
├── js/
│   └── app.js            # Main application logic
├── index.html            # Main HTML file
├── server.js             # Express server for deployment
├── package.json          # Node.js dependencies
├── Procfile              # Railway start command
├── railway.json          # Railway configuration
├── README.md             # User documentation
└── PRD.md               # This document
```

### Key Functions

**Model Management:**
- `initTransformers()` - Initialize library
- `preloadAllModels()` - Load all models on startup
- `loadModelIfNeeded()` - Lazy load specific model

**Audio Processing:**
- `blobToFloat32()` - Convert audio to Whisper format
- `transcribeFloat32()` - Main transcription function
- `hasVoiceActivity()` - Detect speech vs. silence

**Live Transcription:**
- `startScreenShare()` - Initialize capture
- `processAccumulatedChunks()` - Process recorded audio
- `cleanupScreenShare()` - Release resources

**UI Updates:**
- `setStatus()` - Update status indicator
- `showAlert()` - Display notifications
- `updateStartupProgress()` - Model loading progress

### Dependencies

**Runtime:**
- Transformers.js v2.x
- ONNX Runtime Web
- Whisper models (Xenova/whisper-*)

**Development:**
- Express 4.x (deployment server)
- Node.js 18+ (deployment)

**Browser APIs:**
- Web Audio API
- MediaRecorder API
- Screen Capture API
- IndexedDB
- Clipboard API
- Fetch API

---

**Document End**

const { pipeline, env } = window;

// Configure transformers.js
env.allowLocalModels = true;
env.backends.onnx.wasm.numThreads = navigator.hardwareConcurrency || 4;

// Constants
const MAX_FILE_SIZE_MB = 500;
const MODEL_LOAD_TIMEOUT = 300000; // 5 minutes

// State management
const state = {
    transcriber: null,
    currentModelId: null,
    selectedFile: null,
    currentTranscript: '',
    isProcessing: false,
    shareStream: null,
    shareRecorder: null,
    shareChunks: [],
    audioContexts: [] // Track for cleanup
};

// DOM elements
const els = {
    alert: document.getElementById('alert'),
    status: document.getElementById('status'),
    statusText: document.getElementById('statusText'),
    modelSelect: document.getElementById('modelSelect'),
    fileInput: document.getElementById('fileInput'),
    selectFileBtn: document.getElementById('selectFileBtn'),
    fileName: document.getElementById('fileName'),
    transcribeFileBtn: document.getElementById('transcribeFileBtn'),
    startShareBtn: document.getElementById('startShareBtn'),
    stopShareBtn: document.getElementById('stopShareBtn'),
    copyBtn: document.getElementById('copyBtn'),
    downloadBtn: document.getElementById('downloadBtn'),
    progressText: document.getElementById('progressText'),
        progressBar: document.getElementById('progressBar'),
        progressFill: document.getElementById('progressFill'),
    transcript: document.getElementById('transcript'),
};

// Utility functions
function showAlert(message, type = 'error') {
    els.alert.textContent = message;
    els.alert.className = 'alert show ' + (type === 'success' ? 'alert-success' : type === 'warning' ? 'alert-warning' : 'alert-error');
    setTimeout(() => els.alert.classList.remove('show'), 6000);
}

function setStatus(text, active = false) {
    els.statusText.textContent = text;
    if (active) {
        els.status.classList.add('active');
    } else {
        els.status.classList.remove('active');
    }
}

function cleanupAudioContexts() {
    state.audioContexts.forEach(ctx => {
        if (ctx.state !== 'closed') {
            ctx.close().catch(err => console.warn('Failed to close AudioContext:', err));
        }
    });
    state.audioContexts = [];
}

function validateFile(file) {
    if (!file) {
        throw new Error('No file selected');
    }
    
    const sizeMB = file.size / 1024 / 1024;
    if (sizeMB > MAX_FILE_SIZE_MB) {
        throw new Error(`File too large (${Math.round(sizeMB)}MB). Maximum size is ${MAX_FILE_SIZE_MB}MB.`);
    }
    
    return true;
}

async function loadModelIfNeeded() {
    const modelId = els.modelSelect.value;
    
    // Already loaded
    if (state.transcriber && state.currentModelId === modelId) {
        return;
    }
    
    // Prevent concurrent loads
    if (state.isProcessing) {
        throw new Error('Another operation is in progress');
    }
    
    state.isProcessing = true;
    
    try {
        setStatus('Loading model: ' + modelId + ' (first time may take 1–2 minutes)…', true);
        els.progressText.textContent = 'Downloading model files...';
        els.transcribeFileBtn.disabled = true;

                // Show progress bar
                els.progressBar.style.display = 'block';
                els.progressFill.style.width = '0%';

                // Simulate progress (transformers.js doesn't provide real progress)
                const progressInterval = setInterval(() => {
                                const currentWidth = parseFloat(els.progressFill.style.width) || 0;
                                if (currentWidth < 90) {
                                                    els.progressFill.style.width = (currentWidth + 2) + '%';
                                                }
                            }, 200);
        
        // Load with timeout
        const loadPromise = pipeline('automatic-speech-recognition', modelId);
        const timeoutPromise = new Promise((_, reject) => 
            setTimeout(() => reject(new Error('Model load timeout')), MODEL_LOAD_TIMEOUT)
        );
        
        state.transcriber = await Promise.race([loadPromise, timeoutPromise]);
        state.currentModelId = modelId;

                // Complete progress
                clearInterval(progressInterval);
                els.progressFill.style.width = '100%';
                setTimeout(() => els.progressBar.style.display = 'none', 1000);
        
        setStatus('Model ready: ' + modelId, true);
        els.progressText.textContent = '';
        showAlert('Model loaded successfully.', 'success');
        
        if (state.selectedFile) {
            els.transcribeFileBtn.disabled = false;
        }
    } catch (err) {
        console.error('Model load error:', err);
        state.transcriber = null;
        state.currentModelId = null;
        setStatus('Model failed to load');
        els.progressText.textContent = '';
                clearInterval(progressInterval);
                els.progressBar.style.display = 'none';
        showAlert('Failed to load model: ' + err.message);
        throw err;
    } finally {
        state.isProcessing = false;
    }
}

async function blobToFloat32(blob) {
    let audioCtx = null;
    try {
        const arrayBuffer = await blob.arrayBuffer();
        audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        state.audioContexts.push(audioCtx);
        
        const decoded = await audioCtx.decodeAudioData(arrayBuffer);
        const raw = decoded.getChannelData(0);
        return new Float32Array(raw);
    } catch (err) {
        console.error('Audio decode error:', err);
        throw new Error('Failed to decode audio: ' + err.message);
    } finally {
        if (audioCtx) {
            audioCtx.close().catch(err => console.warn('Failed to close AudioContext:', err));
            state.audioContexts = state.audioContexts.filter(ctx => ctx !== audioCtx);
        }
    }
}

async function fileToFloat32(file) {
    let audioCtx = null;
    try {
        const arrayBuffer = await file.arrayBuffer();
        audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        state.audioContexts.push(audioCtx);
        
        const decoded = await audioCtx.decodeAudioData(arrayBuffer);
        const raw = decoded.getChannelData(0);
        return new Float32Array(raw);
    } catch (err) {
        console.error('File decode error:', err);
        throw new Error('Failed to decode audio file: ' + err.message);
    } finally {
        if (audioCtx) {
            audioCtx.close().catch(err => console.warn('Failed to close AudioContext:', err));
            state.audioContexts = state.audioContexts.filter(ctx => ctx !== audioCtx);
        }
    }
}

async function transcribeFloat32(float32Data) {
    if (state.isProcessing) {
        throw new Error('Another transcription is in progress');
    }
    
    state.isProcessing = true;
    
    try {
        await loadModelIfNeeded();
        if (!state.transcriber) {
            throw new Error('Model not available');
        }
        
        els.progressText.textContent = 'Running Whisper model in browser…';
        setStatus('Transcribing…', true);
        
        const result = await state.transcriber(float32Data);
        state.currentTranscript = result.text || '';
        els.transcript.textContent = state.currentTranscript || '[Empty transcript]';
        els.progressText.textContent = '';
        setStatus('Done. Ready.', false);
        
        if (state.currentTranscript.trim().length > 0) {
            els.copyBtn.disabled = false;
            els.downloadBtn.disabled = false;
        }
    } finally {
        state.isProcessing = false;
    }
}

async function transcribeSelectedFile() {
    if (!state.selectedFile) {
        showAlert('Please choose an audio file first.');
        return;
    }
    
    try {
        validateFile(state.selectedFile);
        
        els.transcribeFileBtn.disabled = true;
        els.copyBtn.disabled = true;
        els.downloadBtn.disabled = true;
        els.progressText.textContent = 'Decoding audio…';
        setStatus('Processing audio file…', true);
        els.transcript.innerHTML = '';
        
        const audioData = await fileToFloat32(state.selectedFile);
        await transcribeFloat32(audioData);
    } catch (err) {
        console.error('Transcription error:', err);
        setStatus('Error during transcription');
        els.progressText.textContent = '';
        showAlert('Error during transcription: ' + err.message);
    } finally {
        if (state.selectedFile && state.transcriber && !state.isProcessing) {
            els.transcribeFileBtn.disabled = false;
        }
    }
}

function getSupportedMimeType() {
    const types = [
        'audio/webm;codecs=opus',
        'audio/webm',
        'audio/ogg;codecs=opus',
        'audio/mp4'
    ];
    
    for (const type of types) {
        if (MediaRecorder.isTypeSupported(type)) {
            return type;
        }
    }
    
    return null;
}

async function startScreenShare() {
    try {
        await loadModelIfNeeded();
        if (!state.transcriber) {
            return;
        }
        
        if (state.isProcessing) {
            showAlert('Another operation is in progress', 'warning');
            return;
        }
        
        const mimeType = getSupportedMimeType();
        if (!mimeType) {
            showAlert('Your browser does not support audio recording', 'error');
            return;
        }
        
        els.startShareBtn.disabled = true;
        els.stopShareBtn.disabled = false;
        els.transcribeFileBtn.disabled = true;
        els.copyBtn.disabled = true;
        els.downloadBtn.disabled = true;
        els.progressText.textContent = 'Waiting for you to select what to share…';
        
        const stream = await navigator.mediaDevices.getDisplayMedia({
            video: true,
            audio: true
        });
        
        // Check if audio track exists
        const audioTracks = stream.getAudioTracks();
        if (audioTracks.length === 0) {
            stream.getTracks().forEach(t => t.stop());
            throw new Error('No audio track available. Make sure to enable "Share audio" when selecting the tab/window.');
        }
        
        state.shareStream = stream;
        state.shareChunks = [];
        
        state.shareRecorder = new MediaRecorder(stream, { mimeType });
        
        state.shareRecorder.ondataavailable = (e) => {
            if (e.data && e.data.size > 0) {
                state.shareChunks.push(e.data);
            }
        };
        
        state.shareRecorder.onstop = async () => {
            try {
                els.progressText.textContent = 'Processing captured audio…';
                
                if (state.shareChunks.length === 0) {
                    throw new Error('No audio data captured');
                }
                
                const blob = new Blob(state.shareChunks, { type: mimeType });
                const float32 = await blobToFloat32(blob);
                els.transcript.innerHTML = '';
                els.copyBtn.disabled = true;
                els.downloadBtn.disabled = true;
                await transcribeFloat32(float32);
            } catch (err) {
                console.error('Capture processing error:', err);
                showAlert('Error processing captured audio: ' + err.message);
            } finally {
                cleanupScreenShare();
            }
        };
        
        // Handle stream ending (user stops sharing)
        stream.getVideoTracks()[0].addEventListener('ended', () => {
            if (state.shareRecorder && state.shareRecorder.state === 'recording') {
                state.shareRecorder.stop();
            }
        });
        
        setStatus('Capturing screen/tab audio…', true);
        els.progressText.textContent = 'Recording… stop when you want to transcribe.';
        state.shareRecorder.start();
    } catch (err) {
        console.error('Screen share error:', err);
        cleanupScreenShare();
        
        if (err.name === 'NotAllowedError' || err.name === 'AbortError') {
            setStatus('Capture cancelled', false);
        } else {
            setStatus('Capture not started');
            showAlert('Could not start screen/tab capture: ' + err.message);
        }
    }
}

function cleanupScreenShare() {
    if (state.shareStream) {
        state.shareStream.getTracks().forEach(t => t.stop());
        state.shareStream = null;
    }
    state.shareRecorder = null;
    state.shareChunks = [];
    els.startShareBtn.disabled = false;
    els.stopShareBtn.disabled = true;
    if (state.selectedFile && state.transcriber && !state.isProcessing) {
        els.transcribeFileBtn.disabled = false;
    }
    els.progressText.textContent = '';
}

function stopScreenShare() {
    if (state.shareRecorder && state.shareRecorder.state === 'recording') {
        state.shareRecorder.stop();
    } else {
        cleanupScreenShare();
        setStatus('Capture stopped', false);
    }
}

// Event handlers
function handleFileSelect(e) {
    const file = e.target.files[0];
    if (!file) {
        state.selectedFile = null;
        els.fileName.textContent = 'No file selected';
        els.transcribeFileBtn.disabled = true;
        return;
    }
    
    try {
        validateFile(file);
        state.selectedFile = file;
        els.fileName.textContent = file.name + ' (' +
            Math.round(file.size / 1024 / 1024 * 10) / 10 + ' MB)';
        els.transcript.innerHTML = '';
        state.currentTranscript = '';
        els.copyBtn.disabled = true;
        els.downloadBtn.disabled = true;
        
        if (state.transcriber && !state.isProcessing) {
            els.transcribeFileBtn.disabled = false;
        } else {
            els.transcribeFileBtn.disabled = true;
            if (!state.transcriber) {
                setStatus('Model not loaded yet', false);
            }
        }
    } catch (err) {
        showAlert(err.message, 'error');
        state.selectedFile = null;
        els.fileName.textContent = 'No file selected';
        els.transcribeFileBtn.disabled = true;
    }
}

function handleModelChange() {
    state.transcriber = null;
    state.currentModelId = null;
    setStatus('Model changed. Will load on next use.', false);
    els.transcribeFileBtn.disabled = !state.selectedFile || state.isProcessing;
}

async function handleCopy() {
    if (!state.currentTranscript) return;
    try {
        await navigator.clipboard.writeText(state.currentTranscript);
        showAlert('Transcript copied to clipboard.', 'success');
    } catch (err) {
        showAlert('Could not copy to clipboard: ' + err.message);
    }
}

function handleDownload() {
    if (!state.currentTranscript) return;
    const blob = new Blob([state.currentTranscript], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'transcript_' + new Date().toISOString().slice(0, 19).replace(/:/g, '-') + '.txt';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

// Initialize event listeners
function initializeApp() {
    els.selectFileBtn.addEventListener('click', () => els.fileInput.click());
    els.fileInput.addEventListener('change', handleFileSelect);
    els.modelSelect.addEventListener('change', handleModelChange);
    els.transcribeFileBtn.addEventListener('click', transcribeSelectedFile);
    els.startShareBtn.addEventListener('click', startScreenShare);
    els.stopShareBtn.addEventListener('click', stopScreenShare);
    els.copyBtn.addEventListener('click', handleCopy);
    els.downloadBtn.addEventListener('click', handleDownload);
    
    // Cleanup on page unload
    window.addEventListener('beforeunload', () => {
        cleanupScreenShare();
        cleanupAudioContexts();
    });
    
    // Auto-load model on app initialization
    loadModelIfNeeded().catch(err => console.warn('Auto-load failed:', err));}


// Start the app when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializeApp);
} else {
    initializeApp();
}

// Wait for transformers.js to load - access via window object
let pipeline, env;

// Initialize transformers.js when available
function initTransformers() {
    console.log('Checking for transformers.js...');
    console.log('window.transformers:', typeof window.transformers);
    console.log('window.pipeline:', typeof window.pipeline);
    console.log('window.env:', typeof window.env);
    
    // Try different ways transformers.js might be exposed
    if (window.transformers && window.transformers.pipeline && window.transformers.env) {
        console.log('Found transformers.js as window.transformers');
        pipeline = window.transformers.pipeline;
        env = window.transformers.env;
    } else if (window.pipeline && window.env) {
        console.log('Found transformers.js as window.pipeline/env');
        pipeline = window.pipeline;
        env = window.env;
    } else {
        // Check if script is still loading
        const scripts = document.querySelectorAll('script[src*="transformers"]');
        console.log('Transformers script tags found:', scripts.length);
        scripts.forEach((script, i) => {
            console.log(`Script ${i}:`, script.src, 'loaded:', script.readyState || 'unknown');
        });
        
        console.error('Transformers.js not loaded yet or not found');
        return false;
    }
    
    try {
        // Configure transformers.js
        env.allowLocalModels = true;
        env.backends.onnx.wasm.numThreads = navigator.hardwareConcurrency || 4;
        env.backends.onnx.wasm.proxy = false;
        
        console.log('Transformers.js initialized successfully');
        console.log('Pipeline type:', typeof pipeline);
        console.log('Env type:', typeof env);
        return true;
    } catch (err) {
        console.error('Error configuring transformers.js:', err);
        return false;
    }
}

// Constants
const MAX_FILE_SIZE_MB = 500;
const MODEL_LOAD_TIMEOUT = 300000; // 5 minutes

// State management
const state = {
    transcriber: null,
    currentModelId: null,
    selectedFile: null,
    currentTranscript: '',
    isLoadingModel: false,
    isTranscribing: false,
    shareStream: null,
    shareRecorder: null,
    shareChunks: [],
    audioContexts: [] // Track for cleanup
};

// Helper to check if any operation is in progress
function isAnyOperationInProgress() {
    return state.isLoadingModel || state.isTranscribing;
}

// DOM elements
const els = {
    alert: document.getElementById('alert'),
    status: document.getElementById('status'),
    statusText: document.getElementById('statusText'),
    loadModelBtn: document.getElementById('loadModelBtn'),
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

function logState() {
    console.log('State:', {
        isLoadingModel: state.isLoadingModel,
        isTranscribing: state.isTranscribing,
        hasTranscriber: !!state.transcriber,
        currentModelId: state.currentModelId,
        hasSelectedFile: !!state.selectedFile
    });
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
        console.log('Model already loaded:', modelId);
        return;
    }
    
    // Prevent concurrent model loads
    if (state.isLoadingModel) {
        console.warn('Model is already being loaded');
        throw new Error('Model is already being loaded');
    }
    
    // Ensure transformers.js is initialized
    if (!pipeline || !env) {
        if (!initTransformers()) {
            throw new Error('Transformers.js library not loaded. Please refresh the page.');
        }
    }
    
    console.log('Starting model load:', modelId);
    state.isLoadingModel = true;
    let progressInterval = null;
    let lastProgress = 0;
    let filesDownloaded = 0;
    let totalFiles = 0;
    let startTime = Date.now();
    let lastUpdateTime = Date.now();
    
    try {
        setStatus('Preparing to download model...', true);
        els.progressText.textContent = 'Initializing download...';
        els.transcribeFileBtn.disabled = true;

        // Show progress bar immediately
        console.log('Showing progress bar, element exists:', !!els.progressBar);
        if (els.progressBar) {
            els.progressBar.style.display = 'block';
            els.progressFill.style.width = '0%';
            console.log('Progress bar displayed, style:', els.progressBar.style.display);
        } else {
            console.error('Progress bar element not found!');
        }
        
        // Start a fallback progress animation in case real progress doesn't work
        let simulatedProgress = 0;
        let hasRealProgress = false;
        
        progressInterval = setInterval(() => {
            if (!hasRealProgress && simulatedProgress < 90) {
                simulatedProgress += 0.5; // Slow increment
                if (els.progressFill) {
                    els.progressFill.style.width = simulatedProgress + '%';
                }
                
                const elapsed = Math.floor((Date.now() - startTime) / 1000);
                els.progressText.textContent = `Downloading model... ${Math.round(simulatedProgress)}% (${elapsed}s elapsed)`;
            }
        }, 500);
        
        // Load with timeout and detailed progress tracking
        const loadPromise = pipeline('automatic-speech-recognition', modelId, {
            progress_callback: (progress) => {
                console.log('Progress callback received:', progress);
                hasRealProgress = true; // We got real progress, stop simulation
                
                if (progress.status === 'progress') {
                    // Real download progress
                    if (progress.progress !== undefined) {
                        const percent = Math.round(progress.progress);
                        lastProgress = percent;
                        simulatedProgress = percent; // Sync simulation with real progress
                        
                        if (els.progressFill) {
                            els.progressFill.style.width = percent + '%';
                        }
                        
                        // Calculate elapsed time and estimate remaining
                        const elapsed = (Date.now() - startTime) / 1000; // seconds
                        const estimatedTotal = percent > 0 ? (elapsed / percent) * 100 : 0;
                        const remaining = Math.max(0, estimatedTotal - elapsed);
                        
                        // Show which file is being downloaded
                        const fileName = progress.file ? progress.file.split('/').pop() : 'model files';
                        let statusText = `Downloading ${fileName}: ${percent}%`;
                        
                        if (remaining > 0 && percent > 5) {
                            const mins = Math.floor(remaining / 60);
                            const secs = Math.floor(remaining % 60);
                            if (mins > 0) {
                                statusText += ` (~${mins}m ${secs}s remaining)`;
                            } else {
                                statusText += ` (~${secs}s remaining)`;
                            }
                        }
                        
                        els.progressText.textContent = statusText;
                        setStatus(`Downloading model: ${percent}%`, true);
                        lastUpdateTime = Date.now();
                    }
                } else if (progress.status === 'download') {
                    // Alternative progress format
                    console.log('Download progress:', progress);
                    if (progress.loaded && progress.total) {
                        const percent = Math.round((progress.loaded / progress.total) * 100);
                        simulatedProgress = percent;
                        if (els.progressFill) {
                            els.progressFill.style.width = percent + '%';
                        }
                        const mb = (progress.loaded / 1024 / 1024).toFixed(1);
                        const totalMb = (progress.total / 1024 / 1024).toFixed(1);
                        els.progressText.textContent = `Downloading: ${mb}MB / ${totalMb}MB (${percent}%)`;
                        setStatus(`Downloading model: ${percent}%`, true);
                    }
                } else if (progress.status === 'done') {
                    filesDownloaded++;
                    console.log(`File downloaded: ${progress.file || 'unknown'} (${filesDownloaded} files)`);
                    els.progressText.textContent = `Downloaded ${filesDownloaded} file(s)...`;
                } else if (progress.status === 'ready') {
                    console.log('Model ready');
                    els.progressText.textContent = 'Loading model into memory...';
                    setStatus('Initializing model...', true);
                    if (els.progressFill) {
                        els.progressFill.style.width = '95%';
                    }
                } else if (progress.status === 'initiate') {
                    console.log('Download initiated:', progress.file);
                    totalFiles++;
                    els.progressText.textContent = `Starting download: ${progress.file || 'model file'}`;
                }
            }
        });
        
        const timeoutPromise = new Promise((_, reject) => 
            setTimeout(() => reject(new Error('Model load timeout')), MODEL_LOAD_TIMEOUT)
        );
        
        state.transcriber = await Promise.race([loadPromise, timeoutPromise]);
        state.currentModelId = modelId;

        // Complete progress
        if (progressInterval) {
            clearInterval(progressInterval);
        }
        if (els.progressFill) {
            els.progressFill.style.width = '100%';
        }
        
        console.log('Model loaded successfully:', modelId, `(${filesDownloaded} files downloaded)`);
        setStatus('Model ready: ' + modelId, true);
        els.progressText.textContent = `✓ Model loaded (${filesDownloaded} files)`;
        showAlert('Model loaded successfully and ready to transcribe!', 'success');
        
        // Hide progress bar after a moment
        setTimeout(() => {
            if (els.progressBar) {
                els.progressBar.style.display = 'none';
            }
            els.progressText.textContent = '';
        }, 2000);
        
        if (state.selectedFile && !state.isTranscribing) {
            els.transcribeFileBtn.disabled = false;
        }
    } catch (err) {
        console.error('Model load error:', err);
        state.transcriber = null;
        state.currentModelId = null;
        setStatus('Model failed to load');
        els.progressText.textContent = '';
        if (progressInterval) {
            clearInterval(progressInterval);
        }
        if (els.progressBar) {
            els.progressBar.style.display = 'none';
        }
        showAlert('Failed to load model: ' + err.message);
        throw err;
    } finally {
        state.isLoadingModel = false;
        console.log('Model load finished, isLoadingModel:', state.isLoadingModel);
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
    if (state.isTranscribing) {
        console.warn('Transcription already in progress');
        throw new Error('Another transcription is in progress');
    }
    
    console.log('Starting transcription, audio samples:', float32Data.length);
    state.isTranscribing = true;
    
    try {
        // Load model if needed (this has its own state management)
        await loadModelIfNeeded();
        
        if (!state.transcriber) {
            throw new Error('Model not available');
        }
        
        console.log('Running transcription...');
        els.progressText.textContent = 'Running Whisper model in browser…';
        setStatus('Transcribing…', true);
        
        const result = await state.transcriber(float32Data);
        state.currentTranscript = result.text || '';
        els.transcript.textContent = state.currentTranscript || '[Empty transcript]';
        els.progressText.textContent = '';
        setStatus('Done. Ready.', false);
        
        console.log('Transcription complete, length:', state.currentTranscript.length);
        
        if (state.currentTranscript.trim().length > 0) {
            els.copyBtn.disabled = false;
            els.downloadBtn.disabled = false;
        }
    } finally {
        state.isTranscribing = false;
        console.log('Transcription finished, isTranscribing:', state.isTranscribing);
    }
}

async function transcribeSelectedFile() {
    if (!state.selectedFile) {
        showAlert('Please choose an audio file first.');
        return;
    }
    
    if (isAnyOperationInProgress()) {
        showAlert('Please wait for the current operation to complete.', 'warning');
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
        
        console.log('Decoding audio file:', state.selectedFile.name);
        const audioData = await fileToFloat32(state.selectedFile);
        await transcribeFloat32(audioData);
    } catch (err) {
        console.error('Transcription error:', err);
        setStatus('Error during transcription');
        els.progressText.textContent = '';
        showAlert('Error during transcription: ' + err.message);
    } finally {
        if (state.selectedFile && state.transcriber && !isAnyOperationInProgress()) {
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
        if (isAnyOperationInProgress()) {
            showAlert('Please wait for the current operation to complete.', 'warning');
            return;
        }
        
        await loadModelIfNeeded();
        if (!state.transcriber) {
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
        
        // Request display media with audio
        const stream = await navigator.mediaDevices.getDisplayMedia({
            video: true,
            audio: {
                echoCancellation: false,
                noiseSuppression: false,
                autoGainControl: false
            }
        });
        
        // Check if audio track exists
        const audioTracks = stream.getAudioTracks();
        if (audioTracks.length === 0) {
            stream.getTracks().forEach(t => t.stop());
            els.startShareBtn.disabled = false;
            els.stopShareBtn.disabled = true;
            els.progressText.textContent = '';
            throw new Error('No audio track available. Make sure to enable "Share audio" when selecting the tab/window.');
        }
        
        console.log('Audio track captured:', audioTracks[0].label, 'enabled:', audioTracks[0].enabled);
        
        state.shareStream = stream;
        state.shareChunks = [];
        
        // Create audio-only stream for recording
        const audioStream = new MediaStream();
        audioTracks.forEach(track => audioStream.addTrack(track));
        
        // Record only audio
        state.shareRecorder = new MediaRecorder(audioStream, { mimeType });
        
        state.shareRecorder.ondataavailable = (e) => {
            if (e.data && e.data.size > 0) {
                console.log('Audio chunk received:', e.data.size, 'bytes');
                state.shareChunks.push(e.data);
            }
        };
        
        state.shareRecorder.onstop = async () => {
            try {
                els.progressText.textContent = 'Processing captured audio…';
                
                if (state.shareChunks.length === 0) {
                    throw new Error('No audio data captured');
                }
                
                console.log('Total chunks:', state.shareChunks.length);
                const blob = new Blob(state.shareChunks, { type: mimeType });
                console.log('Audio blob size:', blob.size, 'bytes');
                
                const float32 = await blobToFloat32(blob);
                console.log('Audio samples:', float32.length);
                
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
        
        state.shareRecorder.onerror = (e) => {
            console.error('MediaRecorder error:', e);
            showAlert('Recording error: ' + e.error);
            cleanupScreenShare();
        };
        
        // Handle stream ending (user stops sharing)
        const videoTrack = stream.getVideoTracks()[0];
        if (videoTrack) {
            videoTrack.addEventListener('ended', () => {
                console.log('Video track ended, stopping recording');
                if (state.shareRecorder && state.shareRecorder.state === 'recording') {
                    state.shareRecorder.stop();
                }
            });
        }
        
        setStatus('Capturing screen/tab audio…', true);
        els.progressText.textContent = 'Recording… stop when you want to transcribe.';
        
        // Start recording with timeslice for regular data chunks
        state.shareRecorder.start(1000);
        console.log('Recording started with mime type:', mimeType);
    } catch (err) {
        console.error('Screen share error:', err);
        cleanupScreenShare();
        
        if (err.name === 'NotAllowedError' || err.name === 'AbortError') {
            setStatus('Capture cancelled', false);
            els.progressText.textContent = '';
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
    if (state.selectedFile && state.transcriber && !isAnyOperationInProgress()) {
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
        
        if (state.transcriber && !isAnyOperationInProgress()) {
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
    console.log('Model changed, clearing current model');
    state.transcriber = null;
    state.currentModelId = null;
    setStatus('Model changed. Will load on next use.', false);
    els.transcribeFileBtn.disabled = !state.selectedFile || isAnyOperationInProgress();
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
    
    // Manual model load button
    if (els.loadModelBtn) {
        els.loadModelBtn.addEventListener('click', () => {
            els.loadModelBtn.style.display = 'none';
            loadModelIfNeeded().catch(err => {
                console.error('Manual load failed:', err);
                els.loadModelBtn.style.display = 'inline-block';
            });
        });
    }
    
    // Cleanup on page unload
    window.addEventListener('beforeunload', () => {
        cleanupScreenShare();
        cleanupAudioContexts();
    });
    
    // Wait for transformers.js to be ready, then auto-load model
    let attempts = 0;
    const maxAttempts = 40; // 20 seconds max (increased from 10)
    
    const checkAndLoad = () => {
        attempts++;
        
        if (initTransformers()) {
            console.log('Transformers.js loaded, starting model download...');
            setStatus('Starting model download...', true);
            els.progressText.textContent = 'This may take 1-2 minutes on first load...';
            
            loadModelIfNeeded().catch(err => {
                console.warn('Auto-load failed:', err);
                setStatus('Model load failed. Click "Load Model" to retry.', false);
                els.progressText.textContent = '';
                if (els.loadModelBtn) {
                    els.loadModelBtn.style.display = 'inline-block';
                }
            });
        } else if (attempts < maxAttempts) {
            console.log(`Waiting for transformers.js... (attempt ${attempts}/${maxAttempts})`);
            setStatus('Loading AI library...', true);
            setTimeout(checkAndLoad, 500);
        } else {
            console.error('Transformers.js failed to load after 20 seconds');
            console.log('Final check - window keys:', Object.keys(window).filter(k => k.toLowerCase().includes('transform')));
            setStatus('Failed to load library. Click "Load Model" to retry.', false);
            showAlert('Failed to load Transformers.js library. Please check your internet connection and refresh.', 'error');
            if (els.loadModelBtn) {
                els.loadModelBtn.style.display = 'inline-block';
            }
        }
    };
    
    // Start checking after script has had time to execute
    setTimeout(checkAndLoad, 500);
}


// Start the app when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializeApp);
} else {
    initializeApp();
}

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

// All available models
// Note: Using models that are confirmed to work with transformers.js
const AVAILABLE_MODELS = [
    { id: 'Xenova/whisper-tiny.en', name: 'Whisper Tiny', size: '~40MB' },
    { id: 'Xenova/whisper-base.en', name: 'Whisper Base', size: '~75MB' },
    { id: 'Xenova/whisper-small.en', name: 'Whisper Small', size: '~250MB' }
];

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
    audioContexts: [], // Track for cleanup
    loadedModels: {}, // Cache for preloaded models
    allModelsLoaded: false
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
    // Startup screen elements
    startupScreen: document.getElementById('startupScreen'),
    startupModelName: document.getElementById('startupModelName'),
    startupProgressFill: document.getElementById('startupProgressFill'),
    startupProgressText: document.getElementById('startupProgressText'),
    modelTiny: document.getElementById('modelTiny'),
    modelBase: document.getElementById('modelBase'),
    modelSmall: document.getElementById('modelSmall'),
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

// Update startup screen model status
function updateStartupModelStatus(modelIndex, status, icon = '⏳') {
    const modelElements = [els.modelTiny, els.modelBase, els.modelSmall];
    const modelEl = modelElements[modelIndex];
    
    if (modelEl) {
        const iconEl = modelEl.querySelector('.model-icon');
        const statusEl = modelEl.querySelector('.model-status');
        
        if (iconEl) iconEl.textContent = icon;
        if (statusEl) statusEl.textContent = status;
        
        // Update classes
        modelEl.classList.remove('loading', 'complete');
        if (status.includes('Loading') || status.includes('Downloading')) {
            modelEl.classList.add('loading');
        } else if (status.includes('✓') || status.includes('Complete')) {
            modelEl.classList.add('complete');
        }
    }
}

// Preload all models sequentially
async function preloadAllModels() {
    console.log('=== preloadAllModels() CALLED ===');
    console.log('Available models:', AVAILABLE_MODELS);
    console.log('Pipeline available:', typeof pipeline);
    console.log('Env available:', typeof env);
    
    // Show startup screen
    if (els.startupScreen) {
        console.log('Showing startup screen');
        document.body.classList.add('loading');
    } else {
        console.error('Startup screen element not found!');
    }
    
    console.log('Starting model loop, count:', AVAILABLE_MODELS.length);
    
    for (let i = 0; i < AVAILABLE_MODELS.length; i++) {
        const model = AVAILABLE_MODELS[i];
        console.log(`\n=== Preloading model ${i + 1}/${AVAILABLE_MODELS.length}: ${model.name} (${model.size}) ===`);
        console.log('Model ID:', model.id);
        
        try {
            // Update startup screen
            if (els.startupModelName) {
                els.startupModelName.textContent = `Loading ${model.name} Model (${i + 1}/${AVAILABLE_MODELS.length})`;
            }
            if (els.startupProgressText) {
                els.startupProgressText.textContent = `Downloading ${model.name} model ${model.size}...`;
            }
            
            updateStartupModelStatus(i, 'Loading...', '⏳');
            
            if (els.startupProgressFill) {
                els.startupProgressFill.style.width = '0%';
            }
            
            let startTime = Date.now();
            let simulatedProgress = 0;
            let hasRealProgress = false;
            
            // Fallback progress animation
            const progressInterval = setInterval(() => {
                if (!hasRealProgress && simulatedProgress < 90) {
                    simulatedProgress += 0.5;
                    if (els.startupProgressFill) {
                        els.startupProgressFill.style.width = simulatedProgress + '%';
                    }
                    const elapsed = Math.floor((Date.now() - startTime) / 1000);
                    if (els.startupProgressText) {
                        els.startupProgressText.textContent = `Downloading ${model.name} model... ${Math.round(simulatedProgress)}% (${elapsed}s)`;
                    }
                    updateStartupModelStatus(i, `${Math.round(simulatedProgress)}% (${elapsed}s)`, '⏳');
                }
            }, 500);
            
            // Load the model - simplified approach
            console.log(`Attempting to load model: ${model.id}`);
            console.log('Pipeline function available:', typeof pipeline);
            
            let loadedModel;
            try {
                // Simple pipeline call - let transformers.js handle everything
                console.log('Loading model with pipeline...');
                loadedModel = await pipeline('automatic-speech-recognition', model.id);
                
                console.log(`✓ Model ${model.name} loaded successfully`);
                console.log('Loaded model type:', typeof loadedModel);
                
                // Test if model is callable
                if (!loadedModel) {
                    throw new Error('Model loaded but is null/undefined');
                }
                
                console.log('Model appears valid');
            } catch (loadErr) {
                console.error(`❌ Failed to load ${model.name}`);
                console.error('Error type:', loadErr.name);
                console.error('Error message:', loadErr.message);
                console.error('Full error:', loadErr);
                throw loadErr;
            }
            
            clearInterval(progressInterval);
            
            // Store the loaded model
            console.log(`Storing model with ID: ${model.id}`);
            console.log('Model object type:', typeof loadedModel);
            state.loadedModels[model.id] = loadedModel;
            console.log('Models in state after storing:', Object.keys(state.loadedModels));
            
            if (els.startupProgressFill) {
                els.startupProgressFill.style.width = '100%';
            }
            
            const elapsed = Math.floor((Date.now() - startTime) / 1000);
            console.log(`✓ ${model.name} model loaded successfully in ${elapsed}s`);
            
            if (els.startupProgressText) {
                els.startupProgressText.textContent = `✓ ${model.name} loaded in ${elapsed}s`;
            }
            
            updateStartupModelStatus(i, `✓ Complete (${elapsed}s)`, '✅');
            
            // Brief pause to show completion
            await new Promise(resolve => setTimeout(resolve, 800));
            
        } catch (err) {
            console.error(`❌ Failed to load ${model.name} model:`, err);
            console.error('Error message:', err.message);
            console.error('Error stack:', err.stack);
            
            // Update UI to show error
            updateStartupModelStatus(i, `❌ Failed: ${err.message}`, '❌');
            if (els.startupProgressText) {
                els.startupProgressText.textContent = `Error loading ${model.name}: ${err.message}`;
            }
            
            // Don't continue if model fails - this is critical
            if (els.startupModelName) {
                els.startupModelName.textContent = `❌ Failed to Load ${model.name} Model`;
            }
            
            showAlert(`Critical error: ${model.name} model failed to load. ${err.message}`, 'error');
            
            // Stop here - don't continue loading other models if one fails
            throw new Error(`Model loading failed: ${err.message}`);
        }
    }
    
    console.log('Model loop completed');
    
    // All models loaded
    state.allModelsLoaded = true;
    
    console.log('\n=== All models preloaded successfully ===');
    console.log('Loaded models:', Object.keys(state.loadedModels));
    console.log('Total models loaded:', Object.keys(state.loadedModels).length);
    
    // Verify at least one model loaded
    if (Object.keys(state.loadedModels).length === 0) {
        console.error('❌ No models were loaded successfully!');
        if (els.startupProgressText) {
            els.startupProgressText.textContent = 'No models loaded. Please refresh and try again.';
        }
        showAlert('Failed to load any models. Please refresh the page.', 'error');
        return;
    }
    
    // Update startup screen
    if (els.startupModelName) {
        els.startupModelName.textContent = '✓ All Models Loaded!';
    }
    if (els.startupProgressText) {
        els.startupProgressText.textContent = 'Initializing application...';
    }
    if (els.startupProgressFill) {
        els.startupProgressFill.style.width = '100%';
    }
    
    // Set the default model
    const defaultModelId = els.modelSelect.value;
    console.log('Setting default model:', defaultModelId);
    console.log('Available loaded models:', Object.keys(state.loadedModels));
    
    if (state.loadedModels[defaultModelId]) {
        state.transcriber = state.loadedModels[defaultModelId];
        state.currentModelId = defaultModelId;
        console.log('✓ Default model set:', defaultModelId);
    } else {
        console.warn('Default model not found in loaded models!');
        // Use the first loaded model as fallback
        const firstModelId = Object.keys(state.loadedModels)[0];
        if (firstModelId) {
            state.transcriber = state.loadedModels[firstModelId];
            state.currentModelId = firstModelId;
            console.log('Using fallback model:', firstModelId);
        }
    }
    
    // Enable transcribe button if file is selected and model is ready
    if (state.selectedFile && state.transcriber) {
        els.transcribeFileBtn.disabled = false;
        console.log('✓ Transcribe button enabled');
    }
    
    // Hide startup screen with fade out
    setTimeout(() => {
        if (els.startupScreen) {
            els.startupScreen.classList.add('hidden');
        }
        document.body.classList.remove('loading');
        
        // Show which model is active
        const activeModelName = state.currentModelId ? state.currentModelId.split('/')[1] : 'unknown';
        setStatus(`Ready with ${activeModelName} model`, false);
        showAlert('All models loaded successfully! Ready to transcribe.', 'success');
        
        console.log('App ready. Active model:', state.currentModelId);
        console.log('Transcriber available:', !!state.transcriber);
    }, 1500);
}

async function loadModelIfNeeded() {
    const modelId = els.modelSelect.value;
    
    // Check if model is already preloaded
    if (state.loadedModels[modelId]) {
        console.log('Using preloaded model:', modelId);
        state.transcriber = state.loadedModels[modelId];
        state.currentModelId = modelId;
        return;
    }
    
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
        audioCtx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 16000 });
        state.audioContexts.push(audioCtx);
        
        console.log('AudioContext sample rate:', audioCtx.sampleRate);
        
        const decoded = await audioCtx.decodeAudioData(arrayBuffer);
        console.log('Decoded audio - duration:', decoded.duration, 'sample rate:', decoded.sampleRate);
        
        const raw = decoded.getChannelData(0);
        
        // Resample to 16kHz if needed
        if (decoded.sampleRate !== 16000) {
            console.log('Resampling from', decoded.sampleRate, 'to 16000 Hz');
            const offlineCtx = new OfflineAudioContext(1, Math.ceil(decoded.duration * 16000), 16000);
            const source = offlineCtx.createBufferSource();
            source.buffer = decoded;
            source.connect(offlineCtx.destination);
            source.start(0);
            const resampled = await offlineCtx.startRendering();
            return new Float32Array(resampled.getChannelData(0));
        }
        
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
        audioCtx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 16000 });
        state.audioContexts.push(audioCtx);
        
        console.log('AudioContext sample rate:', audioCtx.sampleRate);
        
        const decoded = await audioCtx.decodeAudioData(arrayBuffer);
        console.log('Decoded audio - duration:', decoded.duration, 'sample rate:', decoded.sampleRate, 'channels:', decoded.numberOfChannels);
        
        const raw = decoded.getChannelData(0);
        
        // Resample to 16kHz if needed
        if (decoded.sampleRate !== 16000) {
            console.log('Resampling from', decoded.sampleRate, 'to 16000 Hz');
            const offlineCtx = new OfflineAudioContext(1, Math.ceil(decoded.duration * 16000), 16000);
            const source = offlineCtx.createBufferSource();
            source.buffer = decoded;
            source.connect(offlineCtx.destination);
            source.start(0);
            const resampled = await offlineCtx.startRendering();
            return new Float32Array(resampled.getChannelData(0));
        }
        
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
    console.log('Sample rate should be 16000 for Whisper');
    state.isTranscribing = true;
    
    try {
        // Load model if needed (this has its own state management)
        await loadModelIfNeeded();
        
        if (!state.transcriber) {
            throw new Error('Model not available');
        }
        
        console.log('Current model ID:', state.currentModelId);
        console.log('Transcriber object:', state.transcriber);
        
        console.log('Running transcription...');
        console.log('Transcriber type:', typeof state.transcriber);
        console.log('Audio data length:', float32Data.length);
        
        els.progressText.textContent = 'Running Whisper model in browser…';
        setStatus('Transcribing…', true);
        
        // Call the transcriber with proper format
        const result = await state.transcriber(float32Data, {
            chunk_length_s: 30,
            stride_length_s: 5,
            return_timestamps: false
        });
        
        console.log('Transcription result:', result);
        
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
    const newModelId = els.modelSelect.value;
    console.log('Model changed to:', newModelId);
    console.log('Available models:', Object.keys(state.loadedModels));
    
    // Switch to preloaded model if available
    if (state.loadedModels[newModelId]) {
        state.transcriber = state.loadedModels[newModelId];
        state.currentModelId = newModelId;
        const modelName = newModelId.split('/')[1];
        setStatus(`Ready with ${modelName} model`, false);
        console.log('✓ Switched to preloaded model:', newModelId);
        
        // Enable transcribe button if file is selected
        if (state.selectedFile && !isAnyOperationInProgress()) {
            els.transcribeFileBtn.disabled = false;
        }
    } else {
        console.warn('Model not found in preloaded models:', newModelId);
        state.transcriber = null;
        state.currentModelId = null;
        setStatus('Model not preloaded. Please refresh the page.', false);
        els.transcribeFileBtn.disabled = true;
    }
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
            preloadAllModels().catch(err => {
                console.error('Manual preload failed:', err);
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
            console.log('✓ Transformers.js initialized successfully');
            console.log('✓ About to call preloadAllModels()...');
            
            setStatus('Starting to preload all models...', true);
            els.progressText.textContent = 'This will take 3-5 minutes on first load. All models will be cached for instant use later.';
            
            // Call preloadAllModels
            preloadAllModels().then(() => {
                console.log('✓ preloadAllModels() completed successfully');
            }).catch(err => {
                console.error('❌ Preload failed:', err);
                console.error('Error details:', err.stack);
                setStatus('Model preload failed. Click "Load Model" to retry.', false);
                els.progressText.textContent = '';
                
                // Show error on startup screen
                if (els.startupProgressText) {
                    els.startupProgressText.textContent = `Error: ${err.message}`;
                }
                
                if (els.loadModelBtn) {
                    els.loadModelBtn.style.display = 'inline-block';
                }
            });
        } else if (attempts < maxAttempts) {
            console.log(`Waiting for transformers.js... (attempt ${attempts}/${maxAttempts})`);
            setStatus('Loading AI library...', true);
            
            // Update startup screen
            if (els.startupProgressText) {
                els.startupProgressText.textContent = `Loading AI library... (attempt ${attempts}/${maxAttempts})`;
            }
            
            setTimeout(checkAndLoad, 500);
        } else {
            console.error('❌ Transformers.js failed to load after 20 seconds');
            console.log('Final check - window keys:', Object.keys(window).filter(k => k.toLowerCase().includes('transform')));
            
            setStatus('Failed to load library. Click "Load Model" to retry.', false);
            showAlert('Failed to load Transformers.js library. Please check your internet connection and refresh.', 'error');
            
            // Update startup screen with error
            if (els.startupModelName) {
                els.startupModelName.textContent = '❌ Failed to Load AI Library';
            }
            if (els.startupProgressText) {
                els.startupProgressText.textContent = 'Transformers.js library failed to load. Please refresh the page.';
            }
            
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

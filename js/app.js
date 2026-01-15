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
        // CRITICAL: Set allowLocalModels to FALSE to force CDN loading
        // This fixes the "Unsupported model type" error
        env.allowLocalModels = false;
        env.backends.onnx.wasm.numThreads = navigator.hardwareConcurrency || 4;
        env.backends.onnx.wasm.proxy = false;
        
        console.log('✓ Transformers.js configured:');
        console.log('  - allowLocalModels:', env.allowLocalModels);
        console.log('  - WASM threads:', env.backends.onnx.wasm.numThreads);
        console.log('  - Pipeline type:', typeof pipeline);
        console.log('  - Env type:', typeof env);
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
// Using multilingual models for language support
// MEMORY OPTIMIZATION: Removed whisper-small to reduce peak memory usage
// Small model can use ~800MB+ which causes issues on lower-end machines
// Using quantized models where available for lower memory footprint
const AVAILABLE_MODELS = [
    { id: 'Xenova/whisper-tiny', name: 'Whisper Tiny', size: '~75MB', multilingual: true, quantized: true },
    { id: 'Xenova/whisper-base', name: 'Whisper Base', size: '~145MB', multilingual: true, quantized: true }
];

// Common languages for Whisper
const LANGUAGES = [
    { code: null, name: 'Auto-detect' },
    { code: 'en', name: 'English' },
    { code: 'es', name: 'Spanish' },
    { code: 'fr', name: 'French' },
    { code: 'de', name: 'German' },
    { code: 'it', name: 'Italian' },
    { code: 'pt', name: 'Portuguese' },
    { code: 'nl', name: 'Dutch' },
    { code: 'ru', name: 'Russian' },
    { code: 'zh', name: 'Chinese' },
    { code: 'ja', name: 'Japanese' },
    { code: 'ko', name: 'Korean' },
    { code: 'ar', name: 'Arabic' },
    { code: 'hi', name: 'Hindi' },
    { code: 'tr', name: 'Turkish' },
    { code: 'pl', name: 'Polish' },
    { code: 'uk', name: 'Ukrainian' },
    { code: 'vi', name: 'Vietnamese' },
    { code: 'th', name: 'Thai' },
    { code: 'sv', name: 'Swedish' }
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
    allModelsLoaded: false,
    // Live transcription state (AudioWorklet VAD)
    isLiveTranscribing: false,
    shareStream: null,
    audioContext: null,
    audioWorkletNode: null,
    isSpeaking: false,
    speechStartTime: 0,
    // Diarization state
    utterances: [],              // Store all utterances with features
    speakers: [],                // Identified speakers
    speakerColors: [             // Visual speaker distinction
        '#3b82f6', '#10b981', '#f59e0b', '#ef4444', 
        '#8b5cf6', '#ec4899', '#14b8a6', '#f97316'
    ],
    // Meeting management
    currentMeeting: null,
    meetingDB: null,
    // Memory optimization
    lowMemoryMode: false,
    // Live transcription mode (separate from standard VAD)
    liveTranscription: {
        enabled: false,
        intervalId: null,
        isProcessing: false,
        lastDisplayedText: '',
        pendingSnapshots: [],
        bufferStartTime: 0
    },
    // AI Intelligence models (Phase 3)
    aiModels: {
        summarizer: null,           // DistilBART for summarization
        classifier: null,           // BERT for classification (optional)
        isLoading: false,
        modelsLoaded: false,
        loadProgress: 0
    },
    // Meeting Intelligence data (Phase 3)
    meetingIntelligence: {
        summary: {
            executive: '',          // 1-2 sentences
            standard: '',           // 1 paragraph
            detailed: []            // Bullet points
        },
        actionItems: [],            // Extracted action items
        decisions: [],              // Key decisions made
        topics: [],                 // Main topics discussed
        questions: [],              // Questions asked (answered/unanswered)
        keyPoints: [],              // Important points
        sentiment: {                // Overall sentiment
            positive: 0,
            neutral: 0,
            negative: 0
        },
        lastProcessedUtterance: 0   // Track processing state
    }
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
    languageSelect: document.getElementById('languageSelect'),
    fileInput: document.getElementById('fileInput'),
    selectFileBtn: document.getElementById('selectFileBtn'),
    fileName: document.getElementById('fileName'),
    transcribeFileBtn: document.getElementById('transcribeFileBtn'),
    startShareBtn: document.getElementById('startShareBtn'),
    stopShareBtn: document.getElementById('stopShareBtn'),
    copyBtn: document.getElementById('copyBtn'),
    downloadBtn: document.getElementById('downloadBtn'),
    saveMeetingBtn: document.getElementById('saveMeetingBtn'),
    historyBtn: document.getElementById('historyBtn'),
    closeSidebarBtn: document.getElementById('closeSidebarBtn'),
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
    // Phase 3: Intelligence tab elements
    intelligenceTab: document.getElementById('intelligenceTab'),
    aiModelStatus: document.getElementById('aiModelStatus'),
    aiStatusText: document.getElementById('aiStatusText'),
    loadAIModelsBtn: document.getElementById('loadAIModelsBtn'),
    unloadAIModelsBtn: document.getElementById('unloadAIModelsBtn'),
    aiLoadingProgress: document.getElementById('aiLoadingProgress'),
    aiProgressFill: document.getElementById('aiProgressFill'),
    aiProgressText: document.getElementById('aiProgressText'),
    generateIntelligenceSection: document.getElementById('generateIntelligenceSection'),
    generateIntelligenceBtn: document.getElementById('generateIntelligenceBtn'),
    intelligenceContent: document.getElementById('intelligenceContent'),
    intelligenceEmptyState: document.getElementById('intelligenceEmptyState'),
    summaryExecutive: document.getElementById('summaryExecutive'),
    actionItemsList: document.getElementById('actionItemsList'),
    decisionsList: document.getElementById('decisionsList'),
    topicsList: document.getElementById('topicsList'),
    questionsList: document.getElementById('questionsList'),
    sentimentPositive: document.getElementById('sentimentPositive'),
    sentimentNeutral: document.getElementById('sentimentNeutral'),
    sentimentNegative: document.getElementById('sentimentNegative'),
    sentimentPositiveCount: document.getElementById('sentimentPositiveCount'),
    sentimentNeutralCount: document.getElementById('sentimentNeutralCount'),
    sentimentNegativeCount: document.getElementById('sentimentNegativeCount'),
    exportMarkdownBtn: document.getElementById('exportMarkdownBtn'),
    exportJsonBtn: document.getElementById('exportJsonBtn'),
    exportTextBtn: document.getElementById('exportTextBtn'),
    lowMemoryMode: document.getElementById('lowMemoryMode'),
    toggleLiveMode: document.getElementById('toggleLiveMode')
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
    const modelElements = [els.modelTiny, els.modelBase];
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
            
            // Load the model with proper configuration
            console.log(`\nAttempting to load model: ${model.id}`);
            console.log('Pipeline available:', typeof pipeline);
            console.log('env.allowLocalModels:', env.allowLocalModels);
            
            let loadedModel;
            try {
                // Load with proper options for Whisper models
                console.log('Loading with automatic-speech-recognition pipeline...');
                loadedModel = await pipeline('automatic-speech-recognition', model.id, {
                    quantized: true, // Use quantized models for smaller size
                    progress_callback: (progress) => {
                        if (progress.status === 'progress' && progress.progress !== undefined) {
                            const percent = Math.round(progress.progress);
                            simulatedProgress = percent;
                            hasRealProgress = true;
                            
                            if (els.startupProgressFill) {
                                els.startupProgressFill.style.width = percent + '%';
                            }
                            const elapsed = Math.floor((Date.now() - startTime) / 1000);
                            if (els.startupProgressText) {
                                els.startupProgressText.textContent = `Downloading ${model.name}: ${percent}% (${elapsed}s)`;
                            }
                            updateStartupModelStatus(i, `${percent}% (${elapsed}s)`, '📥');
                        }
                    }
                });
                
                console.log(`✓ Model ${model.name} loaded successfully`);
                console.log('Model type:', typeof loadedModel);
                
                if (!loadedModel) {
                    throw new Error('Model is null/undefined after loading');
                }
                
            } catch (loadErr) {
                console.error(`❌ Failed to load ${model.name}`);
                console.error('Error:', loadErr.message);
                console.error('Stack:', loadErr.stack);
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

// ==================== AUDIOWORKLET VAD FOR SCREEN CAPTURE ====================

// VAD Configuration
const VAD_CONFIG = {
    sampleRate: 16000,
    energyThreshold: 0.01,        // RMS energy threshold for speech
    silenceFramesNeeded: 25,      // ~0.8s of silence to end utterance
    speechFramesNeeded: 5,        // ~0.15s of speech to start utterance
    maxUtteranceSeconds: 15       // Maximum utterance length before force-split
};

// Live Transcription Configuration (separate mode)
const LIVE_CONFIG = {
    snapshotDuration: 6,           // 6s snapshots (good context)
    updateInterval: 3,              // Update every 3s (feels real-time)
    overlapDuration: 2,             // 2s overlap for smooth merging
    maxConcurrentJobs: 1,           // Process one at a time
    cacheSize: 8,                   // Keep last 8 snapshots (~24s history)
    minRMS: 0.008                   // Skip quiet audio
};

// Remove duplicate sentences from transcript
function removeDuplicateSentences(text) {
    const sentences = text.match(/[^.!?\n]+[.!?\n]*/g) || [text];
    const seen = new Set();
    const unique = [];
    
    for (const sentence of sentences) {
        const normalized = sentence.trim().toLowerCase()
            .replace(/[.,!?;:]/g, '')
            .replace(/\s+/g, ' ');
        
        if (normalized.length > 3 && !seen.has(normalized)) {
            seen.add(normalized);
            unique.push(sentence);
        }
    }
    
    return unique.join(' ').trim();
}

// Create AudioWorklet processor as inline blob
// Handle VAD events from AudioWorklet
async function handleVADEvent(event) {
    const { type, audio, timestamp, duration, features } = event.data;
    
    if (type === 'speech_start') {
        console.log(`🗣️ Speech started at ${timestamp?.toFixed(2)}s`);
        state.isSpeaking = true;
        state.speechStartTime = Date.now();
        setStatus('🎤 Speaking...', true);
        
    } else if (type === 'speech_end') {
        console.log(`🔇 Speech ended: ${duration}s, features:`, features);
        state.isSpeaking = false;
        setStatus('⚙️ Transcribing with timestamps...', true);
        
        // Transcribe with diarization
        await transcribeUtteranceWithDiarization(audio, timestamp, features);
        
        setStatus('👂 Listening...', true);
    }
}

// Transcribe a single utterance (speech segment)
// Transcribe with speaker diarization
async function transcribeUtteranceWithDiarization(audioFloat32, startTime, features) {
    if (state.isTranscribing) {
        console.log('⏭️ Already transcribing, queuing...');
        return;
    }
    
    try {
        state.isTranscribing = true;
        
        console.log(`📊 Transcribing ${audioFloat32.length} samples...`);
        
        // Transcribe with WORD-LEVEL timestamps
        const language = els.languageSelect ? els.languageSelect.value : null;
        const options = {
            chunk_length_s: 30,
            stride_length_s: 5,
            return_timestamps: 'word',  // KEY: Word-level timestamps!
            condition_on_previous_text: false,  // Prevent hallucination feedback loops
            
            // BALANCED: Light anti-hallucination (not too strict)
            compression_ratio_threshold: 2.8,   // Only block extreme repetition (was 2.4)
            no_speech_threshold: 0.7            // Only skip very quiet audio (was 0.6)
        };
        
        if (language) {
            options.language = language;
        }
        
        const result = await state.transcriber(audioFloat32, options);
        
        console.log('Whisper output:', result);
        
        // Extract text and chunks (word timestamps)
        const text = result.text?.trim() || '';
        const chunks = result.chunks || [];
        
        if (!text || text.length === 0) {
            console.log('⏭️ Empty transcription, skipping');
            return;
        }
        
        // LIGHT anti-hallucination: Only block extreme repetition
        if (isExtremeRepetition(text)) {
            console.warn('🚫 Blocked extreme repetition:', text.substring(0, 100));
            showAlert('⚠️ Skipped repetitive audio', 'warning');
            return;
        }
        
        // Identify speaker
        const speakerId = identifySpeaker(features);
        const speaker = state.speakers[speakerId];
        
        // Store utterance
        const utterance = {
            id: state.utterances.length,
            text: text,
            speaker: speaker,
            speakerId: speakerId,
            timestamp: startTime,
            duration: audioFloat32.length / VAD_CONFIG.sampleRate,
            features: features,
            chunks: chunks  // Word-level timestamps
        };
        
        state.utterances.push(utterance);
        
        // Update display
        updateDiarizedTranscript();
        
        // Enable export buttons
        els.copyBtn.disabled = false;
        els.downloadBtn.disabled = false;
        els.saveMeetingBtn.disabled = false;
        
        console.log(`✅ Speaker ${speakerId + 1}: "${text}"`);
        
    } catch (error) {
        console.error('❌ Transcription error:', error);
        showAlert(`Transcription failed: ${error.message}`);
    } finally {
        state.isTranscribing = false;
    }
}

// Normalize features to reduce noise and improve clustering
function normalizeFeatures(features) {
    // Clamp pitch to reasonable human range (80-400 Hz)
    const pitch = Math.max(80, Math.min(400, features.pitch || 150));
    
    // Clamp formant
    const formant = Math.max(0, Math.min(100, features.formant || 0));
    
    // Energy already normalized by RMS
    const energy = Math.max(0, Math.min(1, features.energy || 0));
    
    // Spectral bands already normalized to sum to 1
    return {
        pitch,
        formant,
        energy,
        lowBand: features.lowBand || 0,
        midBand: features.midBand || 0,
        highBand: features.highBand || 0,
        pitchVariance: Math.max(0, Math.min(1000, features.pitchVariance || 0)),
        energyVariance: features.energyVariance || 0,
        duration: features.duration || 0
    };
}

// Speaker identification using advanced feature clustering
function identifySpeaker(rawFeatures) {
    // Normalize features to reduce noise
    const features = normalizeFeatures(rawFeatures);
    
    // Log features for debugging
    console.log('📊 Speaker features:', {
        pitch: features.pitch?.toFixed(1),
        formant: features.formant?.toFixed(1),
        energy: features.energy?.toFixed(3),
        lowBand: features.lowBand?.toFixed(3),
        midBand: features.midBand?.toFixed(3),
        highBand: features.highBand?.toFixed(3),
        pitchVariance: features.pitchVariance?.toFixed(1)
    });
    
    if (state.speakers.length === 0) {
        // First speaker
        state.speakers.push({
            id: 0,
            name: 'Speaker 1',
            emoji: '👤',
            color: state.speakerColors[0],
            features: {...features},
            utteranceCount: 1,
            totalDuration: features.duration || 0
        });
        console.log('🆕 First speaker created: Speaker 1');
        return 0;
    }
    
    // Calculate distances to all existing speakers
    const distances = state.speakers.map((speaker, idx) => ({
        id: idx,
        distance: calculateFeatureDistance(features, speaker.features)
    }));
    
    distances.sort((a, b) => a.distance - b.distance);
    const closest = distances[0];
    const secondClosest = distances[1];
    
    // More conservative threshold to prevent over-segmentation
    const baseThreshold = 0.35;  // Increased from 0.20
    const adaptiveThreshold = baseThreshold * (1 + state.speakers.length * 0.03);  // Reduced multiplier
    
    // Require significant separation from second-closest speaker
    const separationRatio = secondClosest ? (secondClosest.distance / closest.distance) : 2.0;
    const requiresClearSeparation = separationRatio < 1.3;  // If too close to second speaker, be conservative
    
    console.log(`🎯 Closest: Speaker ${closest.id + 1} (distance: ${closest.distance.toFixed(3)}, threshold: ${adaptiveThreshold.toFixed(3)})`);
    if (secondClosest) {
        console.log(`   Second: Speaker ${secondClosest.id + 1} (distance: ${secondClosest.distance.toFixed(3)}, separation: ${separationRatio.toFixed(2)}x)`);
    }
    
    if (closest.distance < adaptiveThreshold && !requiresClearSeparation) {
        // Assign to existing speaker with confidence-weighted update
        const speaker = state.speakers[closest.id];
        speaker.utteranceCount++;
        speaker.totalDuration += features.duration || 0;
        
        // Exponential moving average with adaptive learning rate
        const confidence = 1 / (1 + closest.distance);
        const alpha = 0.15 * confidence;
        
        // Update all features
        speaker.features.pitch = (1 - alpha) * speaker.features.pitch + alpha * features.pitch;
        speaker.features.energy = (1 - alpha) * speaker.features.energy + alpha * features.energy;
        speaker.features.formant = (1 - alpha) * (speaker.features.formant || 0) + alpha * (features.formant || 0);
        speaker.features.lowBand = (1 - alpha) * (speaker.features.lowBand || 0) + alpha * (features.lowBand || 0);
        speaker.features.midBand = (1 - alpha) * (speaker.features.midBand || 0) + alpha * (features.midBand || 0);
        speaker.features.highBand = (1 - alpha) * (speaker.features.highBand || 0) + alpha * (features.highBand || 0);
        speaker.features.pitchVariance = (1 - alpha) * (speaker.features.pitchVariance || 0) + alpha * (features.pitchVariance || 0);
        
        console.log(`✅ Assigned to Speaker ${closest.id + 1} (confidence: ${(confidence * 100).toFixed(1)}%)`);
        return closest.id;
    } else {
        // Create new speaker
        if (state.speakers.length >= 8) {
            console.warn('⚠️ Max speakers (8) reached, assigning to closest');
            return closest.id;
        }
        
        const newId = state.speakers.length;
        const avatarEmojis = ['👤', '👨', '👩', '🧑', '👨‍💼', '👩‍💼', '🧑‍💻', '👨‍🎓'];
        
        state.speakers.push({
            id: newId,
            name: `Speaker ${newId + 1}`,
            emoji: avatarEmojis[newId % avatarEmojis.length],
            color: state.speakerColors[newId % state.speakerColors.length],
            features: {...features},
            utteranceCount: 1,
            totalDuration: features.duration || 0
        });
        console.log(`🆕 New speaker detected: Speaker ${newId + 1}`);
        return newId;
    }
}

function calculateFeatureDistance(f1, f2) {
    // Weighted multi-dimensional distance for better speaker separation
    const weights = {
        pitch: 2.0,          // Most important for speaker ID
        formant: 1.8,        // Vowel characteristics
        midBand: 1.5,        // Timbre
        lowBand: 1.2,
        highBand: 1.0,
        energy: 0.5,         // Less important (volume varies)
        pitchVariance: 0.8
    };
    
    // Normalize and calculate weighted differences
    const pitchDiff = Math.abs(f1.pitch - f2.pitch) / 200;  // ~200 Hz range
    const formantDiff = Math.abs((f1.formant || 0) - (f2.formant || 0)) / 50;
    const lowDiff = Math.abs((f1.lowBand || 0) - (f2.lowBand || 0));
    const midDiff = Math.abs((f1.midBand || 0) - (f2.midBand || 0));
    const highDiff = Math.abs((f1.highBand || 0) - (f2.highBand || 0));
    const energyDiff = Math.abs(f1.energy - f2.energy) / 0.1;
    const varianceDiff = Math.abs((f1.pitchVariance || 0) - (f2.pitchVariance || 0)) / 100;
    
    const distance = Math.sqrt(
        weights.pitch * pitchDiff * pitchDiff +
        weights.formant * formantDiff * formantDiff +
        weights.lowBand * lowDiff * lowDiff +
        weights.midBand * midDiff * midDiff +
        weights.highBand * highDiff * highDiff +
        weights.energy * energyDiff * energyDiff +
        weights.pitchVariance * varianceDiff * varianceDiff
    );
    
    const totalWeight = Object.values(weights).reduce((a, b) => a + b, 0);
    return distance / Math.sqrt(totalWeight);
}

// Update display with diarized transcript
function updateDiarizedTranscript() {
    // Build formatted transcript with speakers and timestamps
    let formatted = '';
    
    // MEMORY OPTIMIZATION: In low memory mode, only show last 10 minutes
    let utterancesToShow = state.utterances;
    
    if (state.lowMemoryMode && state.utterances.length > 0) {
        const now = state.utterances[state.utterances.length - 1].timestamp;
        const tenMinutesAgo = now - 600; // 10 minutes in seconds
        
        utterancesToShow = state.utterances.filter(utt => utt.timestamp >= tenMinutesAgo);
        
        if (utterancesToShow.length < state.utterances.length) {
            const hiddenCount = state.utterances.length - utterancesToShow.length;
            formatted += `\n[💾 Low Memory Mode: ${hiddenCount} older utterances hidden]\n`;
        }
    }
    
    for (const utt of utterancesToShow) {
        const time = formatTimestamp(utt.timestamp);
        const speaker = utt.speaker.name;
        
        // Add speaker label with timestamp
        formatted += `\n[${time}] ${speaker}:\n${utt.text}\n`;
    }
    
    els.transcript.textContent = formatted.trim();
    els.transcript.scrollTop = els.transcript.scrollHeight;
    
    // Update current transcript for compatibility (always use full transcript)
    state.currentTranscript = state.utterances.map(utt => {
        const time = formatTimestamp(utt.timestamp);
        return `[${time}] ${utt.speaker.name}:\n${utt.text}`;
    }).join('\n\n');
    
    // Update meeting stats
    updateMeetingStats();
}

// Update meeting statistics display
function updateMeetingStats() {
    const statsDiv = document.getElementById('meetingStats');
    
    if (state.utterances.length === 0) {
        if (statsDiv) statsDiv.style.display = 'none';
        return;
    }
    
    // Show stats
    if (statsDiv) statsDiv.style.display = 'block';
    
    // Calculate duration (from first to last utterance)
    const firstTime = state.utterances[0].timestamp;
    const lastUtt = state.utterances[state.utterances.length - 1];
    const lastTime = lastUtt.timestamp + (lastUtt.duration || 0);
    const durationSec = Math.floor(lastTime - firstTime);
    
    const mins = Math.floor(durationSec / 60);
    const secs = durationSec % 60;
    const durationStr = `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    
    // Count words
    const totalWords = state.utterances.reduce((sum, utt) => {
        return sum + utt.text.split(/\s+/).filter(w => w.length > 0).length;
    }, 0);
    
    // Update display
    const statDuration = document.getElementById('statDuration');
    const statSpeakers = document.getElementById('statSpeakers');
    const statUtterances = document.getElementById('statUtterances');
    const statWords = document.getElementById('statWords');
    
    if (statDuration) statDuration.textContent = durationStr;
    if (statSpeakers) statSpeakers.textContent = state.speakers.length.toString();
    if (statUtterances) statUtterances.textContent = state.utterances.length.toString();
    if (statWords) statWords.textContent = totalWords.toString();
}

function formatTimestamp(seconds) {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    const ms = Math.floor((seconds % 1) * 10);
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}.${ms}`;
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
        
        // Get selected language
        const language = els.languageSelect ? els.languageSelect.value : null;
        const options = {
            chunk_length_s: 30,
            stride_length_s: 5,
            return_timestamps: false,
            condition_on_previous_text: false  // Critical: prevents hallucination/repetition
        };
        
        // Add language if specified
        if (language) {
            options.language = language;
            console.log('Transcribing with language:', language);
        } else {
            console.log('Transcribing with auto-detect');
        }
        
        // Call the transcriber with proper format
        const result = await state.transcriber(float32Data, options);
        
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
    console.log('\n🎬 Starting screen share with VAD processing...');
    
    try {
        if (isAnyOperationInProgress()) {
            showAlert('Please wait for the current operation to complete.');
            return;
        }
        
        // Load Whisper model if needed
        await loadModelIfNeeded();
        if (!state.transcriber) {
            return;
        }
        
        // Update UI
        els.startShareBtn.disabled = true;
        els.stopShareBtn.disabled = false;
        els.transcribeFileBtn.disabled = true;
        els.copyBtn.disabled = true;
        els.downloadBtn.disabled = true;
        els.progressText.textContent = 'Waiting for you to select what to share…';
        
        // Request screen/tab capture with audio
        const stream = await navigator.mediaDevices.getDisplayMedia({
            video: true,  // Required for screen share dialog
            audio: {
                echoCancellation: false,
                noiseSuppression: false,
                autoGainControl: false
            }
        });
        
        // Check if audio track exists
        const audioTrack = stream.getAudioTracks()[0];
        if (!audioTrack) {
            stream.getTracks().forEach(t => t.stop());
            els.startShareBtn.disabled = false;
            els.stopShareBtn.disabled = true;
            els.progressText.textContent = '';
            throw new Error('No audio track. Please check "Share audio" in the screen picker!');
        }
        
        console.log('✅ Got audio track:', audioTrack.label);
        state.shareStream = stream;
        
        // Create audio context
        state.audioContext = new AudioContext({ sampleRate: VAD_CONFIG.sampleRate });
        const source = state.audioContext.createMediaStreamSource(stream);
        
        // Load AudioWorklet processor from static file
        await state.audioContext.audioWorklet.addModule('js/vad-processor.js');
        
        // Create worklet node
        state.audioWorkletNode = new AudioWorkletNode(
            state.audioContext, 
            'vad-processor',
            {
                processorOptions: {
                    energyThreshold: VAD_CONFIG.energyThreshold,
                    silenceFramesNeeded: VAD_CONFIG.silenceFramesNeeded,
                    speechFramesNeeded: VAD_CONFIG.speechFramesNeeded
                }
            }
        );
        
        // Listen for VAD events and live mode snapshots
        state.audioWorkletNode.port.onmessage = (event) => {
            if (event.data.type === 'snapshot_ready') {
                // Handle live mode snapshot
                handleSnapshotReady(event.data.audio, event.data.timestamp);
            } else {
                // Handle standard VAD events
                handleVADEvent(event);
            }
        };
        
        // Connect: source -> worklet -> (silent) destination
        source.connect(state.audioWorkletNode);
        state.audioWorkletNode.connect(state.audioContext.destination);
        
        // Clear transcript
        els.transcript.innerHTML = '<em style="color: var(--color-gray-400);">🎙️ Listening for speech - transcription appears when you pause</em>';
        state.currentTranscript = '';
        state.isLiveTranscribing = true;
        
        // Handle stream ending (user stops sharing)
        const videoTrack = stream.getVideoTracks()[0];
        if (videoTrack) {
            videoTrack.addEventListener('ended', () => {
                console.log('Video track ended, stopping recording');
                stopScreenShare();
            });
        }
        
        setStatus('🎙️ Listening for speech...', true);
        els.progressText.textContent = 'Screen audio capture active. Speak naturally!';
        showAlert('Screen audio capture active! Speak naturally and pause between sentences.');
        
        console.log('✅ VAD processing started');
        
    } catch (error) {
        console.error('❌ Failed to start:', error);
        showAlert(error.message);
        cleanupScreenShare();
    }
}

function cleanupScreenShare() {
    console.log('\n🛑 Stopping screen share...');
    
    // Stop audio context
    if (state.audioWorkletNode) {
        state.audioWorkletNode.disconnect();
        state.audioWorkletNode = null;
    }
    
    if (state.audioContext) {
        state.audioContext.close().catch(err => console.warn('Failed to close AudioContext:', err));
        state.audioContext = null;
    }
    
    // Stop media tracks
    if (state.shareStream) {
        state.shareStream.getTracks().forEach(track => track.stop());
        state.shareStream = null;
    }
    
    // Reset state (keep utterances and speakers for review)
    state.isSpeaking = false;
    state.isLiveTranscribing = false;
    
    // Update UI
    els.startShareBtn.disabled = false;
    els.stopShareBtn.disabled = true;
    if (state.selectedFile && state.transcriber && !isAnyOperationInProgress()) {
        els.transcribeFileBtn.disabled = false;
    }
    els.progressText.textContent = '';
    
    console.log('✅ Cleanup complete');
    console.log(`📊 Final stats: ${state.utterances.length} utterances, ${state.speakers.length} speakers`);
}

function stopScreenShare() {
    console.log('\n🛑 Stopping recording...');
    
    cleanupScreenShare();
    setStatus('✓ Recording stopped', false);
    
    console.log('✅ Recording stopped, transcript ready');
    
    // Process intelligence after recording stops
    if (state.utterances.length > 0) {
        console.log('🧠 Processing intelligence after recording...');
        setTimeout(() => {
            processTranscriptIntelligence().catch(err => {
                console.error('Intelligence processing failed:', err);
            });
        }, 500);
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
    els.saveMeetingBtn.addEventListener('click', saveCurrentMeeting);
    els.historyBtn.addEventListener('click', toggleMeetingsHistory);
    els.closeSidebarBtn.addEventListener('click', toggleMeetingsHistory);
    
    // Phase 3: Tab navigation
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const tabName = btn.dataset.tab;
            switchTab(tabName);
        });
    });
    
    // Phase 3: Load AI models button
    if (els.loadAIModelsBtn) {
        els.loadAIModelsBtn.addEventListener('click', async () => {
            console.log('\n🔘 User clicked "Load AI Models" button');
            
            els.loadAIModelsBtn.disabled = true;
            els.loadAIModelsBtn.textContent = '⏳ Loading...';
            els.aiLoadingProgress.style.display = 'block';
            els.aiStatusText.textContent = 'Loading AI models...';
            
            const success = await loadIntelligenceModels();
            
            els.aiLoadingProgress.style.display = 'none';
            
            if (success) {
                console.log('✅ Model loading succeeded - updating UI');
                els.aiModelStatus.classList.add('loaded');
                els.aiStatusText.textContent = '✅ AI models loaded - AI-powered summarization available';
                els.loadAIModelsBtn.style.display = 'none';
                if (els.unloadAIModelsBtn) els.unloadAIModelsBtn.style.display = 'inline-block';
            } else {
                console.log('❌ Model loading failed - using rule-based fallback');
                els.aiStatusText.textContent = '⚠️ Using rule-based intelligence (AI model failed to load)';
                els.loadAIModelsBtn.disabled = false;
                els.loadAIModelsBtn.textContent = '🔄 Retry Loading AI Models';
            }
        });
    }
    
    // Phase 3: Unload AI models button
    if (els.unloadAIModelsBtn) {
        els.unloadAIModelsBtn.addEventListener('click', () => {
            if (confirm('Unload AI models to free memory? You can reload them anytime.')) {
                unloadIntelligenceModels();
            }
        });
    }
    
    // Phase 3: Generate Intelligence button
    if (els.generateIntelligenceBtn) {
        els.generateIntelligenceBtn.addEventListener('click', async () => {
            els.generateIntelligenceBtn.disabled = true;
            els.generateIntelligenceBtn.textContent = '⏳ Processing...';
            
            try {
                await processTranscriptIntelligence();
                showAlert('✓ Intelligence generated successfully', 'success');
            } catch (error) {
                showAlert('Failed to generate intelligence: ' + error.message, 'error');
            } finally {
                els.generateIntelligenceBtn.disabled = false;
                els.generateIntelligenceBtn.textContent = '🧠 Generate Intelligence';
            }
        });
    }
    
    // Phase 3: Export buttons
    if (els.exportMarkdownBtn) {
        els.exportMarkdownBtn.addEventListener('click', exportToMarkdown);
    }
    if (els.exportJsonBtn) {
        els.exportJsonBtn.addEventListener('click', exportToJSON);
    }
    if (els.exportTextBtn) {
        els.exportTextBtn.addEventListener('click', exportToText);
    }
    
    // Memory optimization: Low memory mode toggle
    if (els.lowMemoryMode) {
        els.lowMemoryMode.addEventListener('change', (e) => {
            state.lowMemoryMode = e.target.checked;
            
            if (state.lowMemoryMode) {
                console.log('💾 Low Memory Mode ENABLED');
                showAlert('💾 Low Memory Mode enabled - using Tiny model, limited history', 'success');
                
                // Force Tiny model
                if (els.modelSelect) {
                    els.modelSelect.value = 'Xenova/whisper-tiny';
                    handleModelChange();
                }
            } else {
                console.log('💾 Low Memory Mode DISABLED');
                showAlert('Low Memory Mode disabled - full features available', 'success');
            }
        });
    }
    
    // Live transcription mode toggle
    if (els.toggleLiveMode) {
        els.toggleLiveMode.addEventListener('change', (e) => {
            enableLiveTranscription(e.target.checked);
        });
    }
    
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


// ==================== INDEXEDDB MEETING PERSISTENCE ====================

// Initialize IndexedDB
async function initMeetingDB() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open('TranscriptMeetings', 2); // Increment version for new store
        
        request.onerror = () => {
            console.error('Failed to open IndexedDB:', request.error);
            reject(request.error);
        };
        
        request.onsuccess = () => {
            state.meetingDB = request.result;
            console.log('✅ IndexedDB initialized');
            resolve(state.meetingDB);
        };
        
        request.onupgradeneeded = (event) => {
            const db = event.target.result;
            
            // Meetings store
            if (!db.objectStoreNames.contains('meetings')) {
                const store = db.createObjectStore('meetings', { keyPath: 'id' });
                store.createIndex('startTime', 'startTime', { unique: false });
                store.createIndex('title', 'title', { unique: false });
                console.log('📦 Created meetings object store');
            }
            
            // AI models cache store (Phase 3)
            if (!db.objectStoreNames.contains('aiModels')) {
                const modelStore = db.createObjectStore('aiModels', { keyPath: 'modelId' });
                modelStore.createIndex('cachedAt', 'cachedAt', { unique: false });
                console.log('📦 Created aiModels cache store');
            }
        };
    });
}

// Save meeting to IndexedDB
async function saveMeetingToDB(meeting) {
    if (!state.meetingDB) await initMeetingDB();
    
    return new Promise((resolve, reject) => {
        const transaction = state.meetingDB.transaction(['meetings'], 'readwrite');
        const store = transaction.objectStore('meetings');
        const request = store.put(meeting);
        
        request.onsuccess = () => {
            console.log('💾 Meeting saved:', meeting.title);
            resolve();
        };
        request.onerror = () => {
            console.error('Failed to save meeting:', request.error);
            reject(request.error);
        };
    });
}

// Load all meetings from IndexedDB
async function loadMeetingsFromDB() {
    if (!state.meetingDB) await initMeetingDB();
    
    return new Promise((resolve, reject) => {
        const transaction = state.meetingDB.transaction(['meetings'], 'readonly');
        const store = transaction.objectStore('meetings');
        const index = store.index('startTime');
        const request = index.openCursor(null, 'prev'); // Newest first
        
        const meetings = [];
        request.onsuccess = (event) => {
            const cursor = event.target.result;
            if (cursor) {
                meetings.push(cursor.value);
                cursor.continue();
            } else {
                console.log(`📂 Loaded ${meetings.length} meetings`);
                resolve(meetings);
            }
        };
        request.onerror = () => {
            console.error('Failed to load meetings:', request.error);
            reject(request.error);
        };
    });
}

// Delete meeting from IndexedDB
async function deleteMeetingFromDB(id) {
    if (!state.meetingDB) await initMeetingDB();
    
    return new Promise((resolve, reject) => {
        const transaction = state.meetingDB.transaction(['meetings'], 'readwrite');
        const store = transaction.objectStore('meetings');
        const request = store.delete(id);
        
        request.onsuccess = () => {
            console.log('🗑️ Meeting deleted:', id);
            resolve();
        };
        request.onerror = () => {
            console.error('Failed to delete meeting:', request.error);
            reject(request.error);
        };
    });
}

// Generate unique meeting ID
function generateMeetingId() {
    return `meeting_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

// Initialize new meeting
function initNewMeeting() {
    state.currentMeeting = {
        id: generateMeetingId(),
        title: `Meeting ${new Date().toLocaleDateString()} ${new Date().toLocaleTimeString()}`,
        startTime: Date.now(),
        endTime: null,
        speakers: [],
        utterances: []
    };
    console.log('🆕 New meeting initialized:', state.currentMeeting.title);
}

// Save current meeting
async function saveCurrentMeeting() {
    if (!state.currentMeeting) {
        initNewMeeting();
    }
    
    if (state.utterances.length === 0) {
        showAlert('Nothing to save yet');
        return;
    }
    
    // Update meeting data
    state.currentMeeting.endTime = Date.now();
    state.currentMeeting.speakers = state.speakers;
    state.currentMeeting.utterances = state.utterances;
    
    try {
        await saveMeetingToDB(state.currentMeeting);
        showAlert(`💾 Meeting saved: "${state.currentMeeting.title}"`);
    } catch (error) {
        showAlert(`Failed to save meeting: ${error.message}`);
    }
}

// Toggle meeting history sidebar
function toggleMeetingsHistory() {
    const sidebar = document.getElementById('meetingsSidebar');
    const isOpen = sidebar.classList.contains('open');
    
    if (isOpen) {
        sidebar.classList.remove('open');
    } else {
        sidebar.classList.add('open');
        refreshMeetingsHistory();
    }
}

// Refresh meeting history list
async function refreshMeetingsHistory() {
    const list = document.getElementById('meetingsList');
    
    try {
        const meetings = await loadMeetingsFromDB();
        
        if (meetings.length === 0) {
            list.innerHTML = '<div style="color: #666; font-size: 0.85rem; padding: 1rem;">No saved meetings</div>';
            return;
        }
        
        list.innerHTML = meetings.map(meeting => {
            const date = new Date(meeting.startTime).toLocaleString();
            const duration = meeting.endTime ? 
                formatDuration(meeting.endTime - meeting.startTime) : 
                'In progress';
            const speakers = meeting.speakers?.length || 0;
            const utterances = meeting.utterances?.length || 0;
            
            return `
                <div class="meeting-card" onclick="loadMeeting('${meeting.id}')">
                    <div class="meeting-card-title">${meeting.title}</div>
                    <div class="meeting-card-meta">
                        <div>${date}</div>
                        <div style="margin-top: 0.25rem;">
                            <span>⏱️ ${duration}</span>
                            <span>👥 ${speakers}</span>
                            <span>💬 ${utterances}</span>
                        </div>
                    </div>
                    <div class="meeting-card-actions">
                        <button class="btn-card" onclick="event.stopPropagation(); loadMeeting('${meeting.id}')">
                            📂 Load
                        </button>
                        <button class="btn-card danger" onclick="event.stopPropagation(); deleteMeeting('${meeting.id}')">
                            🗑️ Delete
                        </button>
                    </div>
                </div>
            `;
        }).join('');
    } catch (error) {
        console.error('Failed to load meetings:', error);
        list.innerHTML = '<div style="color: #ef4444; font-size: 0.85rem; padding: 1rem;">Failed to load meetings</div>';
    }
}

// Format duration in MM:SS
function formatDuration(ms) {
    const seconds = Math.floor(ms / 1000);
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
}

// Load a saved meeting
async function loadMeeting(id) {
    try {
        const meetings = await loadMeetingsFromDB();
        const meeting = meetings.find(m => m.id === id);
        
        if (!meeting) {
            showAlert('Meeting not found');
            return;
        }
        
        // Confirm if current meeting has unsaved changes
        if (state.utterances.length > 0 && state.currentMeeting.id !== id) {
            if (!confirm('Load this meeting? Current unsaved changes will be lost.')) {
                return;
            }
        }
        
        // Load meeting data
        state.currentMeeting = meeting;
        state.utterances = meeting.utterances || [];
        state.speakers = meeting.speakers || [];
        
        // Update display
        updateDiarizedTranscript();
        
        // Close sidebar
        toggleMeetingsHistory();
        
        showAlert(`📂 Loaded: "${meeting.title}"`);
    } catch (error) {
        console.error('Failed to load meeting:', error);
        showAlert(`Failed to load meeting: ${error.message}`);
    }
}

// Delete a meeting
async function deleteMeeting(id) {
    if (!confirm('Delete this meeting permanently?')) {
        return;
    }
    
    try {
        await deleteMeetingFromDB(id);
        showAlert('🗑️ Meeting deleted');
        refreshMeetingsHistory();
    } catch (error) {
        console.error('Failed to delete meeting:', error);
        showAlert(`Failed to delete meeting: ${error.message}`);
    }
}

// ============================================================================
// PHASE 3: AI MEETING INTELLIGENCE
// ============================================================================

/**
 * Load AI models for meeting intelligence (lazy loading)
 * Models are loaded on-demand when user requests intelligence features
 * Progress is tracked and displayed to user
 */
async function loadIntelligenceModels() {
    // Already loaded
    if (state.aiModels.modelsLoaded) {
        console.log('✓ AI models already loaded');
        showAlert('✓ AI models already loaded', 'success');
        return true;
    }
    
    // Already loading
    if (state.aiModels.isLoading) {
        console.log('⏳ AI models already loading...');
        showAlert('⏳ AI models already loading...', 'warning');
        return false;
    }
    
    state.aiModels.isLoading = true;
    state.aiModels.loadProgress = 0;
    
    console.log('\n' + '='.repeat(60));
    console.log('🚀 ATTEMPTING TO LOAD DISTILBART AI MODEL');
    console.log('='.repeat(60));
    
    try {
        // Check if transformers.js is available
        console.log('Step 1: Checking Transformers.js availability...');
        if (!pipeline || !env) {
            console.error('❌ Transformers.js not initialized');
            throw new Error('Transformers.js not initialized. Please refresh the page.');
        }
        console.log('✅ Transformers.js is available');
        
        // Update UI - show loading state
        showAlert('🔄 Loading DistilBART AI model (268MB)... This may take 2-5 minutes on first load.', 'warning');
        
        // Check if model is already cached
        const modelId = 'Xenova/distilbart-cnn-6-6';
        console.log('\nStep 2: Checking model cache...');
        const isCached = await isAIModelCached(modelId);
        
        if (isCached) {
            console.log('✅ Model found in cache - loading will be faster');
            showAlert('📦 Model found in cache - loading...', 'warning');
        } else {
            console.log('⚠️ First-time download (268MB) - this will take a few minutes');
            showAlert('📥 First-time download (268MB) - please wait 2-5 minutes...', 'warning');
        }
        
        // Load DistilBART for summarization
        console.log('\nStep 3: Loading DistilBART model...');
        console.log('Model ID:', modelId);
        console.log('Task: summarization');
        
        state.aiModels.loadProgress = 10;
        
        const startTime = Date.now();
        
        state.aiModels.summarizer = await pipeline(
            'summarization',
            modelId,
            {
                progress_callback: (progress) => {
                    console.log('Progress update:', progress);
                    
                    if (progress.status === 'progress' && progress.progress !== undefined) {
                        state.aiModels.loadProgress = 10 + Math.round(progress.progress * 0.8);
                        const elapsed = Math.round((Date.now() - startTime) / 1000);
                        
                        console.log(`📊 Loading: ${state.aiModels.loadProgress}% (${elapsed}s elapsed)`);
                        
                        // Update UI progress
                        if (els.aiProgressFill) {
                            els.aiProgressFill.style.width = state.aiModels.loadProgress + '%';
                        }
                        if (els.aiProgressText) {
                            els.aiProgressText.textContent = `Loading: ${state.aiModels.loadProgress}% (${elapsed}s)`;
                        }
                    }
                }
            }
        );
        
        const totalTime = Math.round((Date.now() - startTime) / 1000);
        
        console.log('\n✅ SUCCESS! DistilBART model loaded');
        console.log(`⏱️ Total time: ${totalTime} seconds`);
        console.log('Model type:', typeof state.aiModels.summarizer);
        
        state.aiModels.loadProgress = 100;
        
        // Cache metadata for future reference
        await cacheAIModelMetadata(modelId, 'summarization');
        
        // Mark as loaded
        state.aiModels.modelsLoaded = true;
        state.aiModels.isLoading = false;
        
        console.log('='.repeat(60));
        console.log('🎉 AI MODEL READY FOR USE');
        console.log('='.repeat(60) + '\n');
        
        showAlert(`✅ SUCCESS! AI model loaded in ${totalTime}s. AI-powered summarization now available!`, 'success');
        
        return true;
        
    } catch (error) {
        const errorTime = Math.round((Date.now() - (startTime || Date.now())) / 1000);
        
        console.log('\n' + '='.repeat(60));
        console.error('❌ FAILED TO LOAD AI MODEL');
        console.log('='.repeat(60));
        console.error('Error type:', error.name);
        console.error('Error message:', error.message);
        console.error('Time elapsed:', errorTime + 's');
        console.error('Full error:', error);
        console.log('='.repeat(60) + '\n');
        
        state.aiModels.isLoading = false;
        state.aiModels.loadProgress = 0;
        
        // Detailed error feedback
        let errorMsg = '';
        if (error.message.includes('eval') || error.message.includes('CSP') || error.message.includes('Content Security Policy')) {
            errorMsg = `❌ CSP ERROR: Browser security policy blocks AI model.\n\nThe model requires 'eval()' which is blocked by Content Security Policy.\n\nFalling back to rule-based intelligence (still very effective!)`;
            console.error('💡 This is a CSP (Content Security Policy) issue');
            console.error('💡 Rule-based processing will be used instead');
        } else if (error.message.includes('network') || error.message.includes('fetch')) {
            errorMsg = `❌ NETWORK ERROR: Could not download model.\n\nCheck your internet connection and try again.\n\nFalling back to rule-based intelligence.`;
        } else {
            errorMsg = `❌ ERROR: ${error.message}\n\nFalling back to rule-based intelligence (still very effective!)`;
        }
        
        showAlert(errorMsg, 'error');
        
        // Return false but don't throw - we'll use rule-based fallback
        return false;
    }
}

/**
 * Check if AI models are available
 * Returns true if models loaded, false if using rule-based fallback
 */
function areAIModelsAvailable() {
    return state.aiModels.modelsLoaded && state.aiModels.summarizer !== null;
}

/**
 * Unload AI models to free memory
 * Call this after exporting intelligence to reduce memory footprint
 */
function unloadIntelligenceModels() {
    console.log('🗑️ Unloading AI models to free memory...');
    
    state.aiModels.summarizer = null;
    state.aiModels.classifier = null;
    state.aiModels.modelsLoaded = false;
    state.aiModels.isLoading = false;
    state.aiModels.loadProgress = 0;
    
    // Update UI
    if (els.aiModelStatus) {
        els.aiModelStatus.classList.remove('loaded');
    }
    if (els.aiStatusText) {
        els.aiStatusText.textContent = 'AI models unloaded (memory freed)';
    }
    if (els.loadAIModelsBtn) {
        els.loadAIModelsBtn.style.display = 'inline-block';
        els.loadAIModelsBtn.disabled = false;
        els.loadAIModelsBtn.textContent = 'Load AI Models';
    }
    
    console.log('✅ AI models unloaded - memory freed');
    showAlert('🗑️ AI models unloaded - memory freed', 'success');
}

/**
 * Switch between tabs (Transcript, Intelligence, History)
 */
function switchTab(tabName) {
    // Update tab buttons
    document.querySelectorAll('.tab-btn').forEach(btn => {
        if (btn.dataset.tab === tabName) {
            btn.classList.add('active');
        } else {
            btn.classList.remove('active');
        }
    });
    
    // Update tab content
    document.querySelectorAll('.tab-content').forEach(content => {
        if (content.dataset.tab === tabName) {
            content.classList.add('active');
        } else {
            content.classList.remove('active');
        }
    });
    
    // If switching to intelligence tab, check if we should show content
    if (tabName === 'intelligence') {
        updateIntelligenceDisplay();
    }
    
    // If switching to history tab, refresh the list
    if (tabName === 'history') {
        refreshMeetingsHistory();
    }
}

/**
 * Update intelligence display based on current state
 */
function updateIntelligenceDisplay() {
    const hasUtterances = state.utterances.length > 0;
    const hasIntelligence = state.meetingIntelligence.summary.executive.length > 0;
    
    // Show/hide generate button
    if (hasUtterances && !hasIntelligence) {
        els.generateIntelligenceSection.style.display = 'block';
        els.intelligenceContent.style.display = 'none';
        els.intelligenceEmptyState.style.display = 'none';
    } else if (hasIntelligence) {
        els.generateIntelligenceSection.style.display = 'none';
        els.intelligenceContent.style.display = 'block';
        els.intelligenceEmptyState.style.display = 'none';
        
        // Populate intelligence data
        renderIntelligenceData();
    } else {
        els.generateIntelligenceSection.style.display = 'none';
        els.intelligenceContent.style.display = 'none';
        els.intelligenceEmptyState.style.display = 'block';
    }
}

/**
 * Render intelligence data to UI
 */
function renderIntelligenceData() {
    const intel = state.meetingIntelligence;
    
    // Render summary
    if (els.summaryExecutive) {
        els.summaryExecutive.textContent = intel.summary.executive || 'No summary available.';
    }
    
    // Render action items
    if (els.actionItemsList) {
        if (intel.actionItems.length === 0) {
            els.actionItemsList.innerHTML = '<p class="empty-state">No action items detected.</p>';
        } else {
            els.actionItemsList.innerHTML = intel.actionItems.map(action => `
                <div class="action-item">
                    <input type="checkbox" class="action-item-checkbox" ${action.status === 'done' ? 'checked' : ''}>
                    <div class="action-item-content">
                        <div class="action-item-text">${escapeHtml(action.text)}</div>
                        <div class="action-item-meta">
                            <span>👤 ${escapeHtml(action.assignee)}</span>
                            ${action.deadline ? `<span>📅 ${escapeHtml(action.deadline)}</span>` : ''}
                            <span class="priority-badge priority-${action.priority}">${action.priority}</span>
                        </div>
                    </div>
                </div>
            `).join('');
        }
    }
    
    // Render decisions
    if (els.decisionsList) {
        if (intel.decisions.length === 0) {
            els.decisionsList.innerHTML = '<p class="empty-state">No decisions detected.</p>';
        } else {
            els.decisionsList.innerHTML = intel.decisions.map(decision => `
                <div class="decision-item">
                    <div class="decision-text">${escapeHtml(decision.text)}</div>
                    <div class="decision-meta">
                        👤 ${decision.speaker ? escapeHtml(decision.speaker.name) : 'Unknown'} • 
                        ${new Date(decision.timestamp).toLocaleTimeString()}
                    </div>
                </div>
            `).join('');
        }
    }
    
    // Render topics
    if (els.topicsList) {
        if (intel.topics.length === 0) {
            els.topicsList.innerHTML = '<p class="empty-state">No topics detected.</p>';
        } else {
            els.topicsList.innerHTML = intel.topics.map(topic => `
                <span class="topic-tag">${escapeHtml(topic.text)} (${topic.count})</span>
            `).join('');
        }
    }
    
    // Render questions
    if (els.questionsList) {
        if (intel.questions.length === 0) {
            els.questionsList.innerHTML = '<p class="empty-state">No questions detected.</p>';
        } else {
            els.questionsList.innerHTML = intel.questions.map(question => `
                <div class="question-item ${question.answered ? '' : 'unanswered'}">
                    <div class="question-text">${escapeHtml(question.text)}</div>
                    <div class="question-meta">
                        <span>👤 ${question.speaker ? escapeHtml(question.speaker.name) : 'Unknown'}</span>
                        <span class="question-status ${question.answered ? 'answered' : 'unanswered'}">
                            ${question.answered ? '✓ Answered' : '⚠️ Unanswered'}
                        </span>
                    </div>
                </div>
            `).join('');
        }
    }
    
    // Render sentiment
    const totalSentiment = intel.sentiment.positive + intel.sentiment.neutral + intel.sentiment.negative;
    if (totalSentiment > 0) {
        const positivePercent = (intel.sentiment.positive / totalSentiment) * 100;
        const neutralPercent = (intel.sentiment.neutral / totalSentiment) * 100;
        const negativePercent = (intel.sentiment.negative / totalSentiment) * 100;
        
        if (els.sentimentPositive) els.sentimentPositive.style.width = positivePercent + '%';
        if (els.sentimentNeutral) els.sentimentNeutral.style.width = neutralPercent + '%';
        if (els.sentimentNegative) els.sentimentNegative.style.width = negativePercent + '%';
        
        if (els.sentimentPositiveCount) els.sentimentPositiveCount.textContent = intel.sentiment.positive;
        if (els.sentimentNeutralCount) els.sentimentNeutralCount.textContent = intel.sentiment.neutral;
        if (els.sentimentNegativeCount) els.sentimentNegativeCount.textContent = intel.sentiment.negative;
    }
}

/**
 * Escape HTML to prevent XSS
 */
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

/**
 * Export intelligence data to Markdown format
 */
function exportToMarkdown() {
    const intel = state.meetingIntelligence;
    const meeting = state.currentMeeting;
    
    if (!intel.summary.executive) {
        showAlert('No intelligence data to export. Generate intelligence first.', 'warning');
        return;
    }
    
    let markdown = '';
    
    // Header
    markdown += `# Meeting Intelligence Report\n\n`;
    
    if (meeting) {
        markdown += `**Meeting:** ${meeting.title}\n`;
        markdown += `**Date:** ${new Date(meeting.startTime).toLocaleString()}\n`;
        markdown += `**Duration:** ${formatDuration(meeting.duration)}\n`;
        markdown += `**Speakers:** ${state.speakers.length}\n\n`;
    }
    
    markdown += `---\n\n`;
    
    // Executive Summary
    markdown += `## 📄 Executive Summary\n\n`;
    markdown += `${intel.summary.executive}\n\n`;
    
    // Action Items
    if (intel.actionItems.length > 0) {
        markdown += `## ✅ Action Items (${intel.actionItems.length})\n\n`;
        intel.actionItems.forEach(action => {
            const checkbox = action.status === 'done' ? '[x]' : '[ ]';
            const priority = action.priority === 'urgent' ? '🔴' : action.priority === 'high' ? '🟡' : '🟢';
            markdown += `- ${checkbox} **${action.assignee}:** ${action.text}`;
            if (action.deadline) markdown += ` *(by ${action.deadline})*`;
            markdown += ` ${priority}\n`;
        });
        markdown += `\n`;
    }
    
    // Decisions
    if (intel.decisions.length > 0) {
        markdown += `## 🎯 Key Decisions (${intel.decisions.length})\n\n`;
        intel.decisions.forEach(decision => {
            markdown += `- ✓ ${decision.text}\n`;
            markdown += `  - *${decision.speaker ? decision.speaker.name : 'Unknown'}*\n`;
        });
        markdown += `\n`;
    }
    
    // Topics
    if (intel.topics.length > 0) {
        markdown += `## 💡 Main Topics\n\n`;
        intel.topics.forEach(topic => {
            markdown += `- **${topic.text}** (${topic.count} mentions)\n`;
        });
        markdown += `\n`;
    }
    
    // Questions
    if (intel.questions.length > 0) {
        const unanswered = intel.questions.filter(q => !q.answered);
        if (unanswered.length > 0) {
            markdown += `## ❓ Unanswered Questions\n\n`;
            unanswered.forEach(question => {
                markdown += `- ${question.text}\n`;
                markdown += `  - *Asked by ${question.speaker ? question.speaker.name : 'Unknown'}*\n`;
            });
            markdown += `\n`;
        }
    }
    
    // Sentiment
    const totalSentiment = intel.sentiment.positive + intel.sentiment.neutral + intel.sentiment.negative;
    if (totalSentiment > 0) {
        markdown += `## 😊 Sentiment Analysis\n\n`;
        markdown += `- Positive: ${intel.sentiment.positive} (${Math.round((intel.sentiment.positive / totalSentiment) * 100)}%)\n`;
        markdown += `- Neutral: ${intel.sentiment.neutral} (${Math.round((intel.sentiment.neutral / totalSentiment) * 100)}%)\n`;
        markdown += `- Negative: ${intel.sentiment.negative} (${Math.round((intel.sentiment.negative / totalSentiment) * 100)}%)\n\n`;
    }
    
    // Footer
    markdown += `---\n\n`;
    markdown += `*Generated by Local Whisper Transcriber on ${new Date().toLocaleString()}*\n`;
    
    // Download
    downloadFile(markdown, `meeting-intelligence-${Date.now()}.md`, 'text/markdown');
    showAlert('✓ Exported to Markdown', 'success');
}

/**
 * Export intelligence data to JSON format
 */
function exportToJSON() {
    const intel = state.meetingIntelligence;
    const meeting = state.currentMeeting;
    
    if (!intel.summary.executive) {
        showAlert('No intelligence data to export. Generate intelligence first.', 'warning');
        return;
    }
    
    const exportData = {
        meeting: meeting ? {
            title: meeting.title,
            startTime: meeting.startTime,
            duration: meeting.duration,
            speakers: state.speakers.length
        } : null,
        intelligence: intel,
        exportedAt: new Date().toISOString()
    };
    
    const json = JSON.stringify(exportData, null, 2);
    downloadFile(json, `meeting-intelligence-${Date.now()}.json`, 'application/json');
    showAlert('✓ Exported to JSON', 'success');
}

/**
 * Export intelligence data to plain text format
 */
function exportToText() {
    const intel = state.meetingIntelligence;
    const meeting = state.currentMeeting;
    
    if (!intel.summary.executive) {
        showAlert('No intelligence data to export. Generate intelligence first.', 'warning');
        return;
    }
    
    let text = '';
    
    // Header
    text += `MEETING INTELLIGENCE REPORT\n`;
    text += `${'='.repeat(50)}\n\n`;
    
    if (meeting) {
        text += `Meeting: ${meeting.title}\n`;
        text += `Date: ${new Date(meeting.startTime).toLocaleString()}\n`;
        text += `Duration: ${formatDuration(meeting.duration)}\n`;
        text += `Speakers: ${state.speakers.length}\n\n`;
    }
    
    // Executive Summary
    text += `EXECUTIVE SUMMARY\n`;
    text += `${'-'.repeat(50)}\n`;
    text += `${intel.summary.executive}\n\n`;
    
    // Action Items
    if (intel.actionItems.length > 0) {
        text += `ACTION ITEMS (${intel.actionItems.length})\n`;
        text += `${'-'.repeat(50)}\n`;
        intel.actionItems.forEach((action, i) => {
            text += `${i + 1}. ${action.assignee}: ${action.text}`;
            if (action.deadline) text += ` (by ${action.deadline})`;
            text += ` [${action.priority.toUpperCase()}]\n`;
        });
        text += `\n`;
    }
    
    // Decisions
    if (intel.decisions.length > 0) {
        text += `KEY DECISIONS (${intel.decisions.length})\n`;
        text += `${'-'.repeat(50)}\n`;
        intel.decisions.forEach((decision, i) => {
            text += `${i + 1}. ${decision.text}\n`;
            text += `   - ${decision.speaker ? decision.speaker.name : 'Unknown'}\n`;
        });
        text += `\n`;
    }
    
    // Topics
    if (intel.topics.length > 0) {
        text += `MAIN TOPICS\n`;
        text += `${'-'.repeat(50)}\n`;
        intel.topics.forEach(topic => {
            text += `- ${topic.text} (${topic.count} mentions)\n`;
        });
        text += `\n`;
    }
    
    // Footer
    text += `${'-'.repeat(50)}\n`;
    text += `Generated: ${new Date().toLocaleString()}\n`;
    
    downloadFile(text, `meeting-intelligence-${Date.now()}.txt`, 'text/plain');
    showAlert('✓ Exported to Text', 'success');
}

/**
 * Helper function to download a file
 */
function downloadFile(content, filename, mimeType) {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

/**
 * Format duration in seconds to readable string
 */
function formatDuration(seconds) {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);
    
    if (hours > 0) {
        return `${hours}h ${minutes}m ${secs}s`;
    } else if (minutes > 0) {
        return `${minutes}m ${secs}s`;
    } else {
        return `${secs}s`;
    }
}

// ============================================================================
// LIVE TRANSCRIPTION MODE
// ============================================================================

/**
 * Enable or disable live transcription mode
 */
async function enableLiveTranscription(enable) {
    state.liveTranscription.enabled = enable;
    
    if (enable) {
        console.log('🔴 Starting live transcription mode...');
        
        // Tell VAD to start buffering
        if (state.audioWorkletNode) {
            state.audioWorkletNode.port.postMessage({
                type: 'enable_live_mode',
                enabled: true
            });
        }
        
        // Start snapshot loop
        state.liveTranscription.intervalId = setInterval(
            requestSnapshot,
            LIVE_CONFIG.updateInterval * 1000
        );
        
        // Initialize live display
        createLiveTranscriptDisplay();
        
        showAlert('🔴 Live transcription active', 'success');
        
    } else {
        console.log('⏸️ Stopping live transcription mode...');
        
        // Stop loop
        if (state.liveTranscription.intervalId) {
            clearInterval(state.liveTranscription.intervalId);
            state.liveTranscription.intervalId = null;
        }
        
        // Tell VAD to stop buffering
        if (state.audioWorkletNode) {
            state.audioWorkletNode.port.postMessage({
                type: 'enable_live_mode',
                enabled: false
            });
        }
        
        // Clean up
        state.liveTranscription.lastDisplayedText = '';
        state.liveTranscription.pendingSnapshots = [];
        
        removeLiveTranscriptDisplay();
        
        showAlert('Live transcription stopped', 'success');
    }
}

/**
 * Request snapshot from VAD processor
 */
function requestSnapshot() {
    // Skip if already processing
    if (state.liveTranscription.isProcessing) {
        console.log('⏭️ Skipping snapshot, still processing');
        return;
    }
    
    // Request snapshot from VAD
    if (state.audioWorkletNode) {
        state.audioWorkletNode.port.postMessage({
            type: 'get_snapshot',
            duration: LIVE_CONFIG.snapshotDuration
        });
    }
}

/**
 * Handle snapshot ready from VAD
 */
async function handleSnapshotReady(audio, timestamp) {
    // Quality check
    const rms = calculateRMS(audio);
    if (rms < LIVE_CONFIG.minRMS) {
        console.log('⏭️ Snapshot too quiet, skipping');
        updateLiveDisplay(''); // Clear if silence
        return;
    }
    
    // Process snapshot
    state.liveTranscription.isProcessing = true;
    
    try {
        await processLiveSnapshot(audio, timestamp);
    } finally {
        state.liveTranscription.isProcessing = false;
    }
}

/**
 * Process live snapshot with optimized settings
 */
async function processLiveSnapshot(audioFloat32, timestamp) {
    try {
        // Use Tiny model for speed
        const tinyModel = state.loadedModels['Xenova/whisper-tiny'];
        if (!tinyModel) {
            console.warn('Tiny model not loaded for live mode');
            return;
        }
        
        // FAST transcription settings
        const language = els.languageSelect ? els.languageSelect.value : null;
        const options = {
            task: 'transcribe',
            
            // Speed optimizations
            condition_on_previous_text: false,
            return_timestamps: false,
            num_beams: 1,              // Greedy = fastest
            temperature: 0,
            
            // Quality safeguards
            compression_ratio_threshold: 2.8,
            no_speech_threshold: 0.7
        };
        
        if (language) {
            options.language = language;
        }
        
        const output = await tinyModel(audioFloat32, options);
        
        const text = output.text?.trim() || '';
        
        // Quick validation
        if (!text || text.length === 0) return;
        if (isExtremeRepetition(text)) {
            console.log('🚫 Blocked repetitive live snapshot');
            return;
        }
        
        // Smart merge with previous
        const merged = mergeLiveSnapshots(state.liveTranscription.lastDisplayedText, text);
        
        // Update display
        updateLiveDisplay(merged);
        
        // Store for next merge
        state.liveTranscription.lastDisplayedText = merged;
        
        // Cleanup old snapshots (memory management)
        pruneSnapshotCache();
        
    } catch (error) {
        console.error('Live snapshot error:', error);
    }
}

/**
 * Calculate RMS of audio samples
 */
function calculateRMS(samples) {
    let sum = 0;
    for (let i = 0; i < samples.length; i++) {
        sum += samples[i] * samples[i];
    }
    return Math.sqrt(sum / samples.length);
}

/**
 * Smart merging of live snapshots with overlap detection
 */
function mergeLiveSnapshots(previousText, newText) {
    if (!previousText) return newText;
    
    // Split into words
    const prevWords = previousText.split(/\s+/);
    const newWords = newText.split(/\s+/);
    
    // Find overlap (last N words of previous = first N words of new)
    let maxOverlap = 0;
    let overlapWords = Math.min(prevWords.length, newWords.length, 15); // Check up to 15 words
    
    for (let i = 1; i <= overlapWords; i++) {
        const prevTail = prevWords.slice(-i).join(' ').toLowerCase();
        const newHead = newWords.slice(0, i).join(' ').toLowerCase();
        
        if (prevTail === newHead) {
            maxOverlap = i;
        }
    }
    
    if (maxOverlap > 0) {
        // Found overlap - merge
        const uniqueNewWords = newWords.slice(maxOverlap);
        return previousText + ' ' + uniqueNewWords.join(' ');
    } else {
        // No overlap - append with space
        return previousText + ' ' + newText;
    }
}

/**
 * Prune snapshot cache to save memory
 */
function pruneSnapshotCache() {
    // Keep only last N snapshots worth of data
    if (state.liveTranscription.pendingSnapshots.length > LIVE_CONFIG.cacheSize) {
        state.liveTranscription.pendingSnapshots = 
            state.liveTranscription.pendingSnapshots.slice(-LIVE_CONFIG.cacheSize);
    }
    
    // Limit text buffer size (keep last ~300 words)
    if (state.liveTranscription.lastDisplayedText.length > 2000) {
        const words = state.liveTranscription.lastDisplayedText.split(/\s+/);
        state.liveTranscription.lastDisplayedText = words.slice(-300).join(' ');
    }
}

/**
 * Create live transcript display overlay
 */
function createLiveTranscriptDisplay() {
    const container = document.createElement('div');
    container.id = 'live-transcript-display';
    container.style.cssText = `
        position: fixed;
        bottom: 20px;
        left: 20px;
        right: 20px;
        max-width: 800px;
        margin: 0 auto;
        padding: 1rem 1.5rem;
        background: linear-gradient(135deg, rgba(59, 130, 246, 0.15), rgba(147, 51, 234, 0.15));
        backdrop-filter: blur(10px);
        border: 1px solid rgba(59, 130, 246, 0.3);
        border-radius: 12px;
        box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
        z-index: 9999;
        font-size: 1.1rem;
        line-height: 1.6;
        color: #fff;
        animation: slideUp 0.3s ease-out;
    `;
    
    container.innerHTML = `
        <div style="display: flex; align-items: center; gap: 0.75rem; margin-bottom: 0.5rem;">
            <div class="live-indicator"></div>
            <span style="font-size: 0.85rem; color: #888; text-transform: uppercase; letter-spacing: 0.05em;">Live Transcription</span>
            <button onclick="enableLiveTranscription(false)" style="
                margin-left: auto;
                padding: 0.25rem 0.75rem;
                background: rgba(255,255,255,0.1);
                border: 1px solid rgba(255,255,255,0.2);
                border-radius: 4px;
                color: #fff;
                cursor: pointer;
                font-size: 0.85rem;
            ">Stop</button>
        </div>
        <div id="live-text-content" style="min-height: 2rem; color: #e0e0e0;"></div>
    `;
    
    document.body.appendChild(container);
    
    // Add animation styles
    if (!document.getElementById('live-mode-styles')) {
        const style = document.createElement('style');
        style.id = 'live-mode-styles';
        style.textContent = `
            @keyframes slideUp {
                from { transform: translateY(20px); opacity: 0; }
                to { transform: translateY(0); opacity: 1; }
            }
            .live-indicator {
                width: 10px;
                height: 10px;
                background: #ef4444;
                border-radius: 50%;
                animation: livePulse 1.5s ease-in-out infinite;
            }
            @keyframes livePulse {
                0%, 100% { opacity: 1; transform: scale(1); }
                50% { opacity: 0.5; transform: scale(0.9); }
            }
        `;
        document.head.appendChild(style);
    }
}

/**
 * Update live display with new text
 */
function updateLiveDisplay(text) {
    const display = document.getElementById('live-text-content');
    if (display) {
        // Smooth text update with fade
        display.style.opacity = '0.7';
        display.textContent = text || 'Listening...';
        setTimeout(() => {
            display.style.opacity = '1';
        }, 100);
    }
}

/**
 * Remove live transcript display
 */
function removeLiveTranscriptDisplay() {
    const display = document.getElementById('live-transcript-display');
    if (display) {
        display.style.animation = 'slideUp 0.3s ease-out reverse';
        setTimeout(() => display.remove(), 300);
    }
}

/**
 * LIGHT anti-hallucination: Only detect EXTREME repetition
 * This is not aggressive - only blocks obvious hallucination loops
 */
function isExtremeRepetition(text) {
    // Only check if text is long enough to be suspicious
    if (text.length < 100) return false;
    
    const words = text.toLowerCase().split(/\s+/);
    if (words.length < 20) return false;
    
    // Only block if same 5+ word sequence repeats 5+ times
    // This catches "thank you thank you thank you..." x50 but not normal speech
    for (let seqLen = 5; seqLen <= 10; seqLen++) {
        const sequences = new Map();
        
        for (let i = 0; i <= words.length - seqLen; i++) {
            const sequence = words.slice(i, i + seqLen).join(' ');
            sequences.set(sequence, (sequences.get(sequence) || 0) + 1);
            
            // Only block if repeated 5+ times (very extreme)
            if (sequences.get(sequence) >= 5) {
                console.log(`🚫 Extreme repetition (${sequences.get(sequence)}x):`, sequence);
                return true;
            }
        }
    }
    
    return false;
}

/**
 * Process transcript to generate intelligence insights
 * Main orchestration function for Phase 3
 */
async function processTranscriptIntelligence() {
    console.log('=== Processing Transcript Intelligence ===');
    
    // Check if we have utterances to process
    if (!state.utterances || state.utterances.length === 0) {
        console.log('No utterances to process');
        return;
    }
    
    // Get full transcript text
    const fullText = state.utterances
        .map(u => u.text)
        .join(' ')
        .trim();
    
    if (!fullText || fullText.length < 50) {
        console.log('Transcript too short for intelligence processing');
        return;
    }
    
    console.log(`Processing ${state.utterances.length} utterances, ${fullText.length} characters`);
    
    try {
        // 1. Generate Summary (AI or rule-based)
        console.log('Generating summary...');
        state.meetingIntelligence.summary = await generateSummary(fullText);
        
        // 2. Extract Action Items
        console.log('Extracting action items...');
        state.meetingIntelligence.actionItems = extractActionItems(state.utterances);
        
        // 3. Extract Decisions
        console.log('Extracting decisions...');
        state.meetingIntelligence.decisions = extractDecisions(state.utterances);
        
        // 4. Extract Topics
        console.log('Extracting topics...');
        state.meetingIntelligence.topics = extractTopics(state.utterances);
        
        // 5. Extract Questions
        console.log('Extracting questions...');
        state.meetingIntelligence.questions = extractQuestions(state.utterances);
        
        // 6. Analyze Sentiment
        console.log('Analyzing sentiment...');
        state.meetingIntelligence.sentiment = analyzeSentiment(fullText);
        
        // 7. Extract Key Points
        console.log('Extracting key points...');
        state.meetingIntelligence.keyPoints = extractKeyPoints(fullText);
        
        // Update last processed marker
        state.meetingIntelligence.lastProcessedUtterance = state.utterances.length;
        
        console.log('✓ Intelligence processing complete');
        console.log('Summary:', state.meetingIntelligence.summary.executive);
        console.log('Action Items:', state.meetingIntelligence.actionItems.length);
        console.log('Decisions:', state.meetingIntelligence.decisions.length);
        console.log('Topics:', state.meetingIntelligence.topics.length);
        
        // Update UI if on intelligence tab
        updateIntelligenceDisplay();
        
    } catch (error) {
        console.error('Error processing intelligence:', error);
        showAlert('Failed to process intelligence: ' + error.message, 'error');
    }
}

/**
 * Generate summary (executive, standard, detailed)
 * Uses AI model if available, falls back to rule-based
 */
async function generateSummary(text) {
    const summary = {
        executive: '',
        standard: '',
        detailed: []
    };
    
    // Generate executive summary (1-2 sentences)
    if (areAIModelsAvailable()) {
        try {
            // Use AI model for abstractive summary
            const chunks = smartChunkText(text, 1000);
            const summaries = [];
            
            for (const chunk of chunks) {
                const result = await state.aiModels.summarizer(chunk, {
                    max_length: 100,
                    min_length: 30
                });
                
                if (result && result[0] && result[0].summary_text) {
                    summaries.push(result[0].summary_text);
                }
            }
            
            // Combine chunk summaries
            if (summaries.length > 0) {
                summary.executive = summaries.join(' ').slice(0, 200);
                summary.standard = summaries.join(' ');
            }
            
        } catch (error) {
            console.warn('AI summarization failed, using fallback:', error);
            summary.executive = generateRuleBasedSummary(text, 2);
            summary.standard = generateRuleBasedSummary(text, 5);
        }
    } else {
        // Use rule-based fallback
        summary.executive = generateRuleBasedSummary(text, 2);
        summary.standard = generateRuleBasedSummary(text, 5);
    }
    
    // Generate detailed bullet points (extractive)
    summary.detailed = generateExtractiveSummary(text, 8);
    
    return summary;
}

/**
 * Smart text chunking for AI processing
 * Splits text into chunks of maxWords, respecting sentence boundaries
 */
function smartChunkText(text, maxWords = 1000) {
    const sentences = text.match(/[^.!?]+[.!?]+/g) || [text];
    const chunks = [];
    let currentChunk = [];
    let currentWordCount = 0;
    
    for (const sentence of sentences) {
        const words = sentence.trim().split(/\s+/).length;
        
        if (currentWordCount + words > maxWords && currentChunk.length > 0) {
            // Start new chunk
            chunks.push(currentChunk.join(' '));
            currentChunk = [sentence];
            currentWordCount = words;
        } else {
            currentChunk.push(sentence);
            currentWordCount += words;
        }
    }
    
    // Add remaining chunk
    if (currentChunk.length > 0) {
        chunks.push(currentChunk.join(' '));
    }
    
    return chunks;
}

/**
 * Generate extractive summary (key sentences)
 */
function generateExtractiveSummary(text, maxSentences = 8) {
    const sentences = text.match(/[^.!?]+[.!?]+/g) || [text];
    
    if (sentences.length <= maxSentences) {
        return sentences.map(s => s.trim());
    }
    
    // Score sentences
    const keywords = [
        'decided', 'agreed', 'action', 'next', 'important', 'critical',
        'must', 'should', 'will', 'need', 'discussed', 'concluded',
        'summary', 'key', 'main', 'focus'
    ];
    
    const scoredSentences = sentences.map((sentence, index) => {
        let score = 0;
        const lowerSentence = sentence.toLowerCase();
        const words = sentence.trim().split(/\s+/).length;
        
        // Position bonus
        if (index === 0) score += 3;
        if (index === sentences.length - 1) score += 2;
        
        // Length scoring
        if (words < 5) score -= 2;
        if (words > 10 && words < 30) score += 2;
        if (words > 30) score -= 1;
        
        // Keyword bonus
        keywords.forEach(keyword => {
            if (lowerSentence.includes(keyword)) score += 2;
        });
        
        return { sentence: sentence.trim(), score, index };
    });
    
    // Get top sentences, maintain order
    return scoredSentences
        .sort((a, b) => b.score - a.score)
        .slice(0, maxSentences)
        .sort((a, b) => a.index - b.index)
        .map(s => s.sentence);
}

/**
 * Extract key points from text
 */
function extractKeyPoints(text) {
    // Use extractive summary as key points
    return generateExtractiveSummary(text, 5);
}

/**
 * Extract action items from utterances
 * Uses pattern matching to identify tasks, assignments, and follow-ups
 */
function extractActionItems(utterances) {
    const actionItems = [];
    let actionId = 1;
    
    // Action patterns
    const actionPatterns = [
        /(?:I|we|you|they|'ll|will|need to|should|must)\s+([^.!?]{10,})/gi,
        /(?:let's|lets)\s+([^.!?]{10,})/gi,
        /(?:can you|could you|would you|please)\s+([^.!?]{10,})/gi,
        /(?:TODO|FIXME|ACTION):\s*([^.!?]+)/gi,
        /(?:next step|action item|follow[- ]up):\s*([^.!?]+)/gi,
        /(?:going to|gonna)\s+([^.!?]{10,})/gi
    ];
    
    utterances.forEach((utterance, index) => {
        const text = utterance.text;
        const lowerText = text.toLowerCase();
        
        // Check each pattern
        actionPatterns.forEach(pattern => {
            const matches = [...text.matchAll(pattern)];
            
            matches.forEach(match => {
                const actionText = match[1] ? match[1].trim() : match[0].trim();
                
                // Filter out very short or generic matches
                if (actionText.length < 10 || actionText.length > 200) return;
                
                // Skip if it's a question without action intent
                if (actionText.includes('?') && !lowerText.includes('can you')) return;
                
                // Determine priority
                const priority = determinePriority(text);
                
                // Determine assignee
                const assignee = determineAssignee(text, utterance.speaker);
                
                // Extract deadline if present
                const deadline = extractDeadline(text);
                
                // Categorize action
                const category = categorizeAction(actionText);
                
                actionItems.push({
                    id: `action_${actionId++}`,
                    text: actionText,
                    speaker: utterance.speaker,
                    assignee: assignee,
                    deadline: deadline,
                    priority: priority,
                    status: 'pending',
                    category: category,
                    timestamp: utterance.timestamp || Date.now(),
                    context: text
                });
            });
        });
    });
    
    // Deduplicate similar actions
    return deduplicateActions(actionItems);
}

/**
 * Determine priority based on keywords
 */
function determinePriority(text) {
    const lowerText = text.toLowerCase();
    
    const urgentKeywords = ['urgent', 'asap', 'immediately', 'critical', 'must', 'now', 'today'];
    const highKeywords = ['important', 'should', 'need to', 'priority', 'soon'];
    
    if (urgentKeywords.some(kw => lowerText.includes(kw))) {
        return 'urgent';
    }
    if (highKeywords.some(kw => lowerText.includes(kw))) {
        return 'high';
    }
    return 'normal';
}

/**
 * Determine assignee from text
 */
function determineAssignee(text, speaker) {
    const lowerText = text.toLowerCase();
    
    // Check for explicit assignment
    if (lowerText.includes('you ') || lowerText.includes('can you') || lowerText.includes('could you')) {
        return 'Assigned to listener';
    }
    if (lowerText.includes('i will') || lowerText.includes("i'll") || lowerText.includes('i need to')) {
        return speaker ? speaker.name : 'Self-assigned';
    }
    if (lowerText.includes('we ') || lowerText.includes("we'll") || lowerText.includes('let\'s')) {
        return 'Team';
    }
    
    return speaker ? speaker.name : 'Unassigned';
}

/**
 * Extract deadline from text
 */
function extractDeadline(text) {
    const deadlinePatterns = [
        /by\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday)/i,
        /by\s+(tomorrow|today|tonight)/i,
        /by\s+(next\s+week|this\s+week|end of week)/i,
        /by\s+(\w+\s+\d+)/i,  // "by Jan 15"
        /by\s+(the\s+)?(\d+)(st|nd|rd|th)?/i  // "by the 15th"
    ];
    
    for (const pattern of deadlinePatterns) {
        const match = text.match(pattern);
        if (match) {
            return match[1] || match[0];
        }
    }
    
    return null;
}

/**
 * Categorize action type
 */
function categorizeAction(text) {
    const lowerText = text.toLowerCase();
    
    if (lowerText.includes('send') || lowerText.includes('email') || lowerText.includes('message')) {
        return 'communication';
    }
    if (lowerText.includes('review') || lowerText.includes('check') || lowerText.includes('look at')) {
        return 'review';
    }
    if (lowerText.includes('create') || lowerText.includes('build') || lowerText.includes('develop')) {
        return 'deliverable';
    }
    if (lowerText.includes('schedule') || lowerText.includes('meeting') || lowerText.includes('call')) {
        return 'meeting';
    }
    if (lowerText.includes('update') || lowerText.includes('inform') || lowerText.includes('notify')) {
        return 'update';
    }
    
    return 'task';
}

/**
 * Deduplicate similar action items
 */
function deduplicateActions(actions) {
    if (actions.length === 0) return actions;
    
    const unique = [];
    const seen = new Set();
    
    actions.forEach(action => {
        // Create a normalized key for comparison
        const key = action.text.toLowerCase()
            .replace(/[^a-z0-9\s]/g, '')
            .replace(/\s+/g, ' ')
            .trim()
            .slice(0, 50);
        
        if (!seen.has(key)) {
            seen.add(key);
            unique.push(action);
        }
    });
    
    return unique;
}

/**
 * Extract decisions from utterances
 * Identifies key decisions made during the meeting
 */
function extractDecisions(utterances) {
    const decisions = [];
    let decisionId = 1;
    
    // Decision patterns
    const decisionPatterns = [
        /(?:we|we've|we have)\s+decided\s+(?:to\s+)?([^.!?]{10,})/gi,
        /(?:decision|agreed|agreement):\s+([^.!?]{10,})/gi,
        /(?:let's go with|going with|go with)\s+([^.!?]{10,})/gi,
        /(?:approved|confirmed|finalized)\s+([^.!?]{10,})/gi,
        /(?:consensus|unanimous)\s+(?:on|that|to)\s+([^.!?]{10,})/gi,
        /(?:settled on|settling on)\s+([^.!?]{10,})/gi,
        /(?:final decision|final call)\s+(?:is|was)?\s*:?\s*([^.!?]{10,})/gi
    ];
    
    utterances.forEach((utterance, index) => {
        const text = utterance.text;
        
        // Check each pattern
        decisionPatterns.forEach(pattern => {
            const matches = [...text.matchAll(pattern)];
            
            matches.forEach(match => {
                const decisionText = match[1] ? match[1].trim() : match[0].trim();
                
                // Filter out very short or very long matches
                if (decisionText.length < 10 || decisionText.length > 200) return;
                
                // Skip if it's a question
                if (decisionText.includes('?')) return;
                
                decisions.push({
                    id: `decision_${decisionId++}`,
                    text: decisionText,
                    speaker: utterance.speaker,
                    timestamp: utterance.timestamp || Date.now(),
                    context: text,
                    confirmed: true
                });
            });
        });
    });
    
    // Deduplicate similar decisions
    return deduplicateDecisions(decisions);
}

/**
 * Deduplicate similar decisions
 */
function deduplicateDecisions(decisions) {
    if (decisions.length === 0) return decisions;
    
    const unique = [];
    const seen = new Set();
    
    decisions.forEach(decision => {
        const key = decision.text.toLowerCase()
            .replace(/[^a-z0-9\s]/g, '')
            .replace(/\s+/g, ' ')
            .trim()
            .slice(0, 50);
        
        if (!seen.has(key)) {
            seen.add(key);
            unique.push(decision);
        }
    });
    
    return unique;
}

/**
 * Extract main topics from utterances
 * Uses frequency analysis and keyword extraction
 */
function extractTopics(utterances) {
    // Combine all text
    const fullText = utterances.map(u => u.text).join(' ').toLowerCase();
    
    // Common stop words to exclude
    const stopWords = new Set([
        'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for',
        'of', 'with', 'by', 'from', 'as', 'is', 'was', 'are', 'were', 'been',
        'be', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would',
        'could', 'should', 'may', 'might', 'can', 'this', 'that', 'these',
        'those', 'i', 'you', 'he', 'she', 'it', 'we', 'they', 'what', 'which',
        'who', 'when', 'where', 'why', 'how', 'all', 'each', 'every', 'both',
        'few', 'more', 'most', 'other', 'some', 'such', 'no', 'nor', 'not',
        'only', 'own', 'same', 'so', 'than', 'too', 'very', 'just', 'now',
        'then', 'there', 'here', 'also', 'well', 'like', 'yeah', 'yes', 'okay',
        'ok', 'um', 'uh', 'gonna', 'wanna', 'gotta'
    ]);
    
    // Extract words (2+ characters, alphanumeric)
    const words = fullText.match(/\b[a-z]{2,}\b/g) || [];
    
    // Count word frequency
    const frequency = {};
    words.forEach(word => {
        if (!stopWords.has(word)) {
            frequency[word] = (frequency[word] || 0) + 1;
        }
    });
    
    // Extract bigrams (two-word phrases)
    const bigrams = {};
    for (let i = 0; i < words.length - 1; i++) {
        const word1 = words[i];
        const word2 = words[i + 1];
        
        if (!stopWords.has(word1) && !stopWords.has(word2)) {
            const bigram = `${word1} ${word2}`;
            bigrams[bigram] = (bigrams[bigram] || 0) + 1;
        }
    }
    
    // Get top single words (mentioned 3+ times)
    const topWords = Object.entries(frequency)
        .filter(([word, count]) => count >= 3)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10)
        .map(([word, count]) => ({ text: word, count, type: 'word' }));
    
    // Get top bigrams (mentioned 2+ times)
    const topBigrams = Object.entries(bigrams)
        .filter(([phrase, count]) => count >= 2)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([phrase, count]) => ({ text: phrase, count, type: 'phrase' }));
    
    // Combine and sort by count
    return [...topBigrams, ...topWords]
        .sort((a, b) => b.count - a.count)
        .slice(0, 12);
}

/**
 * Extract questions from utterances
 * Classifies as answered or unanswered based on context
 */
function extractQuestions(utterances) {
    const questions = [];
    let questionId = 1;
    
    utterances.forEach((utterance, index) => {
        const text = utterance.text;
        
        // Find questions (sentences ending with ?)
        const questionSentences = text.match(/[^.!?]*\?/g) || [];
        
        questionSentences.forEach(questionText => {
            questionText = questionText.trim();
            
            // Skip very short questions
            if (questionText.length < 10) return;
            
            // Check if question was answered (look at next few utterances)
            let answered = false;
            const lookAhead = 3;
            
            for (let i = index + 1; i < Math.min(index + lookAhead + 1, utterances.length); i++) {
                const nextText = utterances[i].text.toLowerCase();
                
                // Check for answer indicators
                if (
                    nextText.includes('yes') ||
                    nextText.includes('no') ||
                    nextText.includes('i think') ||
                    nextText.includes('probably') ||
                    nextText.includes('definitely') ||
                    nextText.includes('the answer') ||
                    nextText.includes('that would be') ||
                    nextText.length > 50  // Substantial response
                ) {
                    answered = true;
                    break;
                }
            }
            
            questions.push({
                id: `question_${questionId++}`,
                text: questionText,
                speaker: utterance.speaker,
                timestamp: utterance.timestamp || Date.now(),
                answered: answered,
                context: text
            });
        });
    });
    
    return questions;
}

/**
 * Analyze sentiment of the meeting
 * Returns counts of positive, neutral, and negative sentiment
 */
function analyzeSentiment(text) {
    const lowerText = text.toLowerCase();
    
    // Positive keywords
    const positiveKeywords = [
        'great', 'good', 'excellent', 'awesome', 'fantastic', 'wonderful',
        'perfect', 'love', 'like', 'happy', 'excited', 'amazing', 'brilliant',
        'success', 'successful', 'agree', 'agreed', 'yes', 'definitely',
        'absolutely', 'positive', 'progress', 'improvement', 'better',
        'thanks', 'thank you', 'appreciate', 'well done', 'congratulations'
    ];
    
    // Negative keywords
    const negativeKeywords = [
        'bad', 'terrible', 'awful', 'horrible', 'poor', 'worst', 'hate',
        'dislike', 'unhappy', 'sad', 'disappointed', 'disappointing',
        'concern', 'concerned', 'worry', 'worried', 'problem', 'issue',
        'difficult', 'hard', 'struggle', 'struggling', 'fail', 'failed',
        'failure', 'wrong', 'mistake', 'error', 'unfortunately', 'sadly',
        'disagree', 'no', 'not good', 'not great'
    ];
    
    // Count occurrences
    let positiveCount = 0;
    let negativeCount = 0;
    
    positiveKeywords.forEach(keyword => {
        const regex = new RegExp(`\\b${keyword}\\b`, 'gi');
        const matches = lowerText.match(regex);
        if (matches) positiveCount += matches.length;
    });
    
    negativeKeywords.forEach(keyword => {
        const regex = new RegExp(`\\b${keyword}\\b`, 'gi');
        const matches = lowerText.match(regex);
        if (matches) negativeCount += matches.length;
    });
    
    // Calculate neutral (total sentences minus sentiment sentences)
    const totalSentences = (text.match(/[.!?]+/g) || []).length;
    const sentimentSentences = positiveCount + negativeCount;
    const neutralCount = Math.max(0, totalSentences - sentimentSentences);
    
    return {
        positive: positiveCount,
        neutral: neutralCount,
        negative: negativeCount
    };
}

/**
 * Generate summary using rule-based fallback (when AI model unavailable)
 * Extracts key sentences based on importance scoring
 */
function generateRuleBasedSummary(text, maxSentences = 3) {
    if (!text || text.trim().length === 0) {
        return '';
    }
    
    // Split into sentences
    const sentences = text.match(/[^.!?]+[.!?]+/g) || [text];
    
    if (sentences.length <= maxSentences) {
        return text;
    }
    
    // Score sentences based on:
    // - Position (first/last sentences often important)
    // - Length (very short sentences less important)
    // - Keywords (action words, decision words)
    const keywords = [
        'decided', 'agreed', 'action', 'next', 'important', 'critical',
        'must', 'should', 'will', 'need', 'discussed', 'concluded'
    ];
    
    const scoredSentences = sentences.map((sentence, index) => {
        let score = 0;
        
        // Position bonus
        if (index === 0) score += 2; // First sentence
        if (index === sentences.length - 1) score += 1; // Last sentence
        
        // Length penalty for very short sentences
        const words = sentence.trim().split(/\s+/).length;
        if (words < 5) score -= 1;
        if (words > 10) score += 1;
        
        // Keyword bonus
        const lowerSentence = sentence.toLowerCase();
        keywords.forEach(keyword => {
            if (lowerSentence.includes(keyword)) score += 1;
        });
        
        return { sentence: sentence.trim(), score, index };
    });
    
    // Sort by score and take top sentences
    const topSentences = scoredSentences
        .sort((a, b) => b.score - a.score)
        .slice(0, maxSentences)
        .sort((a, b) => a.index - b.index); // Restore original order
    
    return topSentences.map(s => s.sentence).join(' ');
}

/**
 * Cache AI model to IndexedDB for faster subsequent loads
 * Note: Transformers.js handles its own caching, but we track metadata
 */
async function cacheAIModelMetadata(modelId, modelType) {
    if (!state.meetingDB) await initMeetingDB();
    
    return new Promise((resolve, reject) => {
        const transaction = state.meetingDB.transaction(['aiModels'], 'readwrite');
        const store = transaction.objectStore('aiModels');
        
        const metadata = {
            modelId: modelId,
            modelType: modelType,
            cachedAt: Date.now(),
            version: '1.0'
        };
        
        const request = store.put(metadata);
        
        request.onsuccess = () => {
            console.log(`✓ Cached metadata for ${modelId}`);
            resolve();
        };
        request.onerror = () => {
            console.warn('Failed to cache model metadata:', request.error);
            resolve(); // Don't fail if caching fails
        };
    });
}

/**
 * Check if AI model is cached
 */
async function isAIModelCached(modelId) {
    if (!state.meetingDB) await initMeetingDB();
    
    return new Promise((resolve) => {
        const transaction = state.meetingDB.transaction(['aiModels'], 'readonly');
        const store = transaction.objectStore('aiModels');
        const request = store.get(modelId);
        
        request.onsuccess = () => {
            resolve(!!request.result);
        };
        request.onerror = () => {
            resolve(false);
        };
    });
}

// Start the app when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', async () => {
        await initMeetingDB();
        initNewMeeting();
        initializeApp();
    });
} else {
    (async () => {
        await initMeetingDB();
        initNewMeeting();
        initializeApp();
    })();
}

class VADProcessor extends AudioWorkletProcessor {
    constructor(options) {
        super();
        const cfg = options.processorOptions || {};
        
        // More lenient thresholds to catch all speech
        this.energyThreshold = cfg.energyThreshold ?? 0.008;  // Lower = more sensitive
        this.silenceFramesNeeded = cfg.silenceFramesNeeded ?? 35; // ~1.1s silence
        this.speechFramesNeeded = cfg.speechFramesNeeded ?? 3;   // Quicker trigger
        
        // PRE-ROLL BUFFER: Capture audio BEFORE speech detected
        this.preRollFrames = 15; // ~0.5s before speech
        this.preRollBuffer = [];
        this.maxPreRollSize = 20;
        
        // POST-ROLL: Keep capturing after silence starts
        this.postRollFrames = 10; // ~0.3s after silence
        
        this.isSpeaking = false;
        this.silenceFrames = 0;
        this.speechFrames = 0;
        this.speechBuffer = [];
        this.speechStartTime = 0;
        // MEMORY OPTIMIZATION: Reduced from 20s to 12s
        // Shorter utterances = smaller tensors = lower memory usage
        // Whisper handles multiple short utterances better than one long one
        this.maxBufferSize = sampleRate * 12; // 12s max utterance
        
        this.frameCount = 0;
        
        // LIVE MODE: Continuous buffering for snapshots
        this.liveMode = false;
        this.continuousBuffer = [];
        this.maxContinuousBuffer = sampleRate * 30; // 30s rolling buffer
    }
    
    calculateRMS(samples) {
        let sum = 0;
        for (let i = 0; i < samples.length; i++) {
            sum += samples[i] * samples[i];
        }
        return Math.sqrt(sum / samples.length);
    }
    
    // Improved pitch detection using autocorrelation
    calculatePitch(samples) {
        const minLag = Math.floor(sampleRate / 500); // 500 Hz max
        const maxLag = Math.floor(sampleRate / 80);  // 80 Hz min
        
        let bestCorrelation = -1;
        let bestLag = minLag;
        
        for (let lag = minLag; lag < maxLag && lag < samples.length / 2; lag++) {
            let correlation = 0;
            for (let i = 0; i < samples.length - lag; i++) {
                correlation += samples[i] * samples[i + lag];
            }
            if (correlation > bestCorrelation) {
                bestCorrelation = correlation;
                bestLag = lag;
            }
        }
        
        return sampleRate / bestLag; // Frequency in Hz
    }
    
    // Spectral features (multiple bands)
    calculateSpectralFeatures(samples) {
        const features = {
            lowBand: 0,   // 0-300 Hz (bass, fundamental)
            midBand: 0,   // 300-2000 Hz (formants, vowels)
            highBand: 0,  // 2000+ Hz (consonants, sibilants)
        };
        
        // Simple band energy (approximation without FFT)
        const third = Math.floor(samples.length / 3);
        
        for (let i = 0; i < third; i++) {
            features.lowBand += Math.abs(samples[i]);
        }
        for (let i = third; i < 2 * third; i++) {
            features.midBand += Math.abs(samples[i]);
        }
        for (let i = 2 * third; i < samples.length; i++) {
            features.highBand += Math.abs(samples[i]);
        }
        
        // Normalize to proportions
        const total = features.lowBand + features.midBand + features.highBand;
        if (total > 0) {
            features.lowBand /= total;
            features.midBand /= total;
            features.highBand /= total;
        }
        
        return features;
    }
    
    // Formant approximation (vowel characteristics)
    calculateFormants(samples) {
        // Simplified formant estimation using peak detection
        const peaks = [];
        for (let i = 1; i < samples.length - 1; i++) {
            if (Math.abs(samples[i]) > Math.abs(samples[i-1]) && 
                Math.abs(samples[i]) > Math.abs(samples[i+1]) &&
                Math.abs(samples[i]) > 0.1) {
                peaks.push(i);
            }
        }
        
        // Return average peak spacing (formant proxy)
        if (peaks.length > 1) {
            let avgSpacing = 0;
            for (let i = 1; i < peaks.length; i++) {
                avgSpacing += peaks[i] - peaks[i-1];
            }
            return avgSpacing / (peaks.length - 1);
        }
        return 0;
    }
    
    process(inputs, outputs, parameters) {
        const input = inputs[0];
        if (!input || !input[0]) return true;
        
        const samples = input[0];
        
        // LIVE MODE: Always buffer for snapshots
        if (this.liveMode) {
            this.continuousBuffer.push(new Float32Array(samples));
            
            // Maintain rolling buffer (keep last 30s)
            const totalSamples = this.continuousBuffer.length * 128;
            if (totalSamples > this.maxContinuousBuffer) {
                this.continuousBuffer.shift();
            }
        }
        
        const rms = this.calculateRMS(samples);
        const hasSpeech = rms > this.energyThreshold;
        
        // Always maintain pre-roll buffer
        this.preRollBuffer.push(new Float32Array(samples));
        if (this.preRollBuffer.length > this.maxPreRollSize) {
            this.preRollBuffer.shift();
        }
        
        if (hasSpeech) {
            this.speechFrames++;
            this.silenceFrames = 0;
            
            // SPEECH START: Add pre-roll buffer!
            if (!this.isSpeaking && this.speechFrames >= this.speechFramesNeeded) {
                this.isSpeaking = true;
                this.speechStartTime = currentTime - (this.preRollBuffer.length * 128 / sampleRate);
                
                // Add pre-roll frames first
                this.speechBuffer = [...this.preRollBuffer.slice(-this.preRollFrames)];
                
                this.port.postMessage({ 
                    type: 'speech_start',
                    timestamp: this.speechStartTime
                });
            }
            
            if (this.isSpeaking) {
                this.speechBuffer.push(new Float32Array(samples));
                
                // Force end if too long
                if (this.speechBuffer.length * 128 > this.maxBufferSize) {
                    this.endUtterance();
                }
            }
            
        } else {
            this.silenceFrames++;
            this.speechFrames = 0;
            
            // POST-ROLL: Continue buffering during early silence
            if (this.isSpeaking && this.silenceFrames < this.postRollFrames) {
                this.speechBuffer.push(new Float32Array(samples));
            }
            
            // SPEECH END: Only after extended silence
            if (this.isSpeaking && this.silenceFrames >= this.silenceFramesNeeded) {
                this.endUtterance();
            }
        }
        
        this.frameCount++;
        return true;
    }
    
    endUtterance() {
        const totalLength = this.speechBuffer.reduce((sum, chunk) => sum + chunk.length, 0);
        const combined = new Float32Array(totalLength);
        
        let offset = 0;
        for (const chunk of this.speechBuffer) {
            combined.set(chunk, offset);
            offset += chunk.length;
        }
        
        // Calculate speaker features
        const features = this.extractSpeakerFeatures(combined);
        
        this.port.postMessage({
            type: 'speech_end',
            audio: combined,
            timestamp: this.speechStartTime,
            duration: (currentTime - this.speechStartTime).toFixed(2),
            features: features // For speaker clustering
        });
        
        this.isSpeaking = false;
        
        // MEMORY OPTIMIZATION: Explicitly clear buffers and trim pre-roll
        this.speechBuffer = [];
        this.silenceFrames = 0;
        this.speechFrames = 0;
        
        // Keep only the last pre-roll frames to avoid memory buildup
        if (this.preRollBuffer.length > this.preRollFrames) {
            this.preRollBuffer = this.preRollBuffer.slice(-this.preRollFrames);
        }
    }
    
    extractSpeakerFeatures(samples) {
        const windowSize = 4096;
        const numWindows = Math.floor(samples.length / windowSize);
        
        let features = {
            pitch: [],
            energy: [],
            formant: [],
            lowBand: [],
            midBand: [],
            highBand: []
        };
        
        // Extract features from multiple windows
        for (let i = 0; i < numWindows; i++) {
            const start = i * windowSize;
            const window = samples.slice(start, start + windowSize);
            
            const rms = this.calculateRMS(window);
            if (rms > 0.01) { // Only analyze frames with speech
                features.pitch.push(this.calculatePitch(window));
                features.energy.push(rms);
                features.formant.push(this.calculateFormants(window));
                
                const spectral = this.calculateSpectralFeatures(window);
                features.lowBand.push(spectral.lowBand);
                features.midBand.push(spectral.midBand);
                features.highBand.push(spectral.highBand);
            }
        }
        
        // Return median values (more robust than mean)
        return {
            pitch: this.median(features.pitch),
            energy: this.median(features.energy),
            formant: this.median(features.formant),
            lowBand: this.median(features.lowBand),
            midBand: this.median(features.midBand),
            highBand: this.median(features.highBand),
            pitchVariance: this.variance(features.pitch),
            energyVariance: this.variance(features.energy),
            duration: samples.length / sampleRate
        };
    }
    
    median(arr) {
        if (arr.length === 0) return 0;
        const sorted = [...arr].sort((a, b) => a - b);
        const mid = Math.floor(sorted.length / 2);
        return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
    }
    
    variance(arr) {
        if (arr.length === 0) return 0;
        const mean = arr.reduce((a, b) => a + b, 0) / arr.length;
        return arr.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / arr.length;
    }
    
    // LIVE MODE: Get snapshot from continuous buffer
    getSnapshot(durationSeconds) {
        const sampleCount = Math.floor(sampleRate * durationSeconds);
        const frameCount = Math.ceil(sampleCount / 128);
        
        // Get last N frames
        const snapshot = this.continuousBuffer.slice(-frameCount);
        
        if (snapshot.length === 0) return null;
        
        // Combine into single Float32Array
        const totalLength = snapshot.reduce((sum, chunk) => sum + chunk.length, 0);
        const combined = new Float32Array(totalLength);
        
        let offset = 0;
        for (const chunk of snapshot) {
            combined.set(chunk, offset);
            offset += chunk.length;
        }
        
        return combined;
    }
}

registerProcessor('vad-processor', VADProcessor);

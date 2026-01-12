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
        this.maxBufferSize = sampleRate * 20; // 20s max utterance
        
        this.frameCount = 0;
    }
    
    calculateRMS(samples) {
        let sum = 0;
        for (let i = 0; i < samples.length; i++) {
            sum += samples[i] * samples[i];
        }
        return Math.sqrt(sum / samples.length);
    }
    
    // Extract pitch estimate (zero-crossing rate proxy)
    calculateZCR(samples) {
        let crossings = 0;
        for (let i = 1; i < samples.length; i++) {
            if ((samples[i] >= 0 && samples[i-1] < 0) || 
                (samples[i] < 0 && samples[i-1] >= 0)) {
                crossings++;
            }
        }
        return crossings / samples.length;
    }
    
    // Spectral centroid approximation
    calculateSpectralCentroid(samples) {
        let weightedSum = 0;
        let sum = 0;
        for (let i = 0; i < samples.length; i++) {
            const mag = Math.abs(samples[i]);
            weightedSum += mag * i;
            sum += mag;
        }
        return sum > 0 ? weightedSum / sum : 0;
    }
    
    process(inputs, outputs, parameters) {
        const input = inputs[0];
        if (!input || !input[0]) return true;
        
        const samples = input[0];
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
        this.speechBuffer = [];
        this.silenceFrames = 0;
        this.speechFrames = 0;
    }
    
    extractSpeakerFeatures(samples) {
        // Extract features for speaker identification
        const chunkSize = 4096;
        const chunks = Math.floor(samples.length / chunkSize);
        
        let avgPitch = 0;
        let avgEnergy = 0;
        let avgSpectral = 0;
        
        for (let i = 0; i < chunks; i++) {
            const start = i * chunkSize;
            const chunk = samples.slice(start, start + chunkSize);
            avgPitch += this.calculateZCR(chunk);
            avgEnergy += this.calculateRMS(chunk);
            avgSpectral += this.calculateSpectralCentroid(chunk);
        }
        
        return {
            pitch: avgPitch / chunks,           // Higher for female voices
            energy: avgEnergy / chunks,         // Speaking volume
            spectral: avgSpectral / chunks,     // Timbre characteristic
            duration: samples.length / sampleRate
        };
    }
}

registerProcessor('vad-processor', VADProcessor);

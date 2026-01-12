class VADProcessor extends AudioWorkletProcessor {
    constructor(options) {
        super();
        const cfg = options.processorOptions || {};
        this.energyThreshold = cfg.energyThreshold ?? 0.01;
        this.silenceFramesNeeded = cfg.silenceFramesNeeded ?? 25;
        this.speechFramesNeeded = cfg.speechFramesNeeded ?? 5;
        
        this.isSpeaking = false;
        this.silenceFrames = 0;
        this.speechFrames = 0;
        this.speechBuffer = [];
        this.speechStartTime = 0;
        this.maxBufferSize = sampleRate * 15; // 15 seconds max
    }
    
    calculateRMS(samples) {
        let sum = 0;
        for (let i = 0; i < samples.length; i++) {
            sum += samples[i] * samples[i];
        }
        return Math.sqrt(sum / samples.length);
    }
    
    process(inputs, outputs, parameters) {
        const input = inputs[0];
        if (!input || !input[0]) return true;
        
        const samples = input[0]; // mono
        const rms = this.calculateRMS(samples);
        const hasSpeech = rms > this.energyThreshold;
        
        if (hasSpeech) {
            this.speechFrames++;
            this.silenceFrames = 0;
            
            if (!this.isSpeaking && this.speechFrames >= this.speechFramesNeeded) {
                this.isSpeaking = true;
                this.speechBuffer = [];
                this.speechStartTime = currentTime;
                this.port.postMessage({ type: 'speech_start' });
            }
            
            if (this.isSpeaking) {
                this.speechBuffer.push(new Float32Array(samples));
                if (this.speechBuffer.length * 128 > this.maxBufferSize) {
                    this.endUtterance();
                }
            }
        } else {
            this.silenceFrames++;
            this.speechFrames = 0;
            
            if (this.isSpeaking && this.silenceFrames < this.silenceFramesNeeded) {
                this.speechBuffer.push(new Float32Array(samples));
            }
            
            if (this.isSpeaking && this.silenceFrames >= this.silenceFramesNeeded) {
                this.endUtterance();
            }
        }
        
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
        
        this.port.postMessage({
            type: 'speech_end',
            audio: combined,
            duration: (currentTime - this.speechStartTime).toFixed(2)
        });
        
        this.isSpeaking = false;
        this.speechBuffer = [];
        this.silenceFrames = 0;
        this.speechFrames = 0;
    }
}

registerProcessor('vad-processor', VADProcessor);

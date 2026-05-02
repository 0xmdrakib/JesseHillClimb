"use client";

export class AudioManager {
  ctx: AudioContext | null = null;
  engineOsc: OscillatorNode | null = null;
  engineFilter: BiquadFilterNode | null = null;
  engineGain: GainNode | null = null;
  masterGain: GainNode | null = null;

  vehicleId: string = "jeep";
  initialized = false;

  init() {
    if (typeof window === "undefined") return;
    if (!this.ctx) {
      try {
        const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
        this.ctx = new AudioCtx();
        this.masterGain = this.ctx.createGain();
        this.masterGain.gain.value = 0.4;
        this.masterGain.connect(this.ctx.destination);

        // Engine sound setup
        this.engineOsc = this.ctx.createOscillator();
        this.engineOsc.type = "sawtooth";

        this.engineFilter = this.ctx.createBiquadFilter();
        this.engineFilter.type = "lowpass";

        this.engineGain = this.ctx.createGain();
        this.engineGain.gain.value = 0;

        this.engineOsc.connect(this.engineFilter);
        this.engineFilter.connect(this.engineGain);
        this.engineGain.connect(this.masterGain);

        this.engineOsc.start();
        this.initialized = true;
      } catch (e) {
        console.warn("AudioContext failed to initialize");
      }
    }
    if (this.ctx && this.ctx.state === "suspended") {
      this.ctx.resume();
    }
  }

  silenceEngine() {
    if (!this.ctx || !this.engineGain) return;
    const now = this.ctx.currentTime;
    this.engineGain.gain.cancelScheduledValues(now);
    this.engineGain.gain.setValueAtTime(0, now);
  }

  suspend() {
    this.silenceEngine();
    if (this.ctx && this.ctx.state === "running") {
      this.ctx.suspend();
    }
  }

  setVehicle(id: string) {
    this.vehicleId = id;
  }

  updateEngine(rpm01: number, isRunning: boolean) {
    if (!this.ctx || !this.engineOsc || !this.engineFilter || !this.engineGain) return;

    const now = this.ctx.currentTime;
    const rpm = Math.max(0, Math.min(1, Number.isFinite(rpm01) ? rpm01 : 0));

    // Hard-mute the oscillator whenever the vehicle is not actively moving.
    // A constantly running oscillator at tiny gain can still create an audible whine on phone speakers.
    if (!isRunning || rpm <= 0.015) {
      this.engineGain.gain.cancelScheduledValues(now);
      this.engineGain.gain.setValueAtTime(0, now);
      return;
    }

    // Volume curve based on RPM. Keep the minimum lower than before so slow coasting stays subtle.
    this.engineGain.gain.cancelScheduledValues(now);
    this.engineGain.gain.setTargetAtTime(0.035 + rpm * 0.18, now, 0.08);

    let baseFreq = 40;
    let freqMul = 100;
    let filterBase = 200;

    if (this.vehicleId === "bicycle") {
      this.engineOsc.type = "triangle";
      baseFreq = 25;
      freqMul = 50;
      filterBase = 300;
    } else if (this.vehicleId === "sportsCar") {
      this.engineOsc.type = "sawtooth";
      baseFreq = 65;
      freqMul = 220;
      filterBase = 900;
    } else {
      // Jeep
      this.engineOsc.type = "sawtooth";
      baseFreq = 45;
      freqMul = 130;
      filterBase = 350;
    }

    const targetFreq = baseFreq + rpm * freqMul;
    this.engineOsc.frequency.setTargetAtTime(targetFreq, now, 0.1);
    this.engineFilter.frequency.setTargetAtTime(filterBase + rpm * 1200, now, 0.1);
  }

  playCoin() {
    if (!this.ctx || !this.masterGain) return;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = "sine";
    osc.connect(gain);
    gain.connect(this.masterGain);

    osc.frequency.setValueAtTime(1200, this.ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(2200, this.ctx.currentTime + 0.1);

    gain.gain.setValueAtTime(0.3, this.ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, this.ctx.currentTime + 0.3);

    osc.start();
    osc.stop(this.ctx.currentTime + 0.3);
  }

  playCrash() {
    if (!this.ctx || !this.masterGain) return;
    const bufferSize = this.ctx.sampleRate * 0.4;
    const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) data[i] = Math.random() * 2 - 1;

    const noise = this.ctx.createBufferSource();
    noise.buffer = buffer;

    const filter = this.ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.setValueAtTime(800, this.ctx.currentTime);
    filter.frequency.exponentialRampToValueAtTime(50, this.ctx.currentTime + 0.3);

    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.5, this.ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, this.ctx.currentTime + 0.3);

    noise.connect(filter);
    filter.connect(gain);
    gain.connect(this.masterGain);

    noise.start();
  }
}

export const audioManager = new AudioManager();

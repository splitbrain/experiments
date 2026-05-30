// Thin wrapper around MediaRecorder. Captures one clip and resolves with a Blob.

export function isSupported() {
  return (
    typeof MediaRecorder !== 'undefined' &&
    !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia)
  );
}

export class Recorder {
  constructor() {
    this._stream = null;
    this._mr = null;
    this._chunks = [];
    this._stopResolve = null;
  }

  get recording() {
    return !!this._mr && this._mr.state === 'recording';
  }

  async start() {
    if (this.recording) return;
    this._stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    this._chunks = [];
    this._mr = new MediaRecorder(this._stream);
    this._mr.addEventListener('dataavailable', (e) => {
      if (e.data && e.data.size > 0) this._chunks.push(e.data);
    });
    this._mr.addEventListener('stop', () => {
      const type = this._mr.mimeType || 'audio/webm';
      const blob = new Blob(this._chunks, { type });
      this._cleanup();
      if (this._stopResolve) {
        this._stopResolve(blob);
        this._stopResolve = null;
      }
    });
    this._mr.start();
  }

  /** Stop recording. @returns {Promise<Blob>} the recorded audio */
  stop() {
    if (!this._mr || this._mr.state === 'inactive') {
      return Promise.resolve(new Blob([], { type: 'audio/webm' }));
    }
    return new Promise((resolve) => {
      this._stopResolve = resolve;
      this._mr.stop();
    });
  }

  _cleanup() {
    if (this._stream) {
      this._stream.getTracks().forEach((t) => t.stop());
      this._stream = null;
    }
    this._mr = null;
  }
}

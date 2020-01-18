import 'core-js';
import EventEmitter from 'events';
import uuid from 'uuid/v4';
import querystring from 'querystring';
import Microphone from '@gkt/microphone';

class Transcriber extends EventEmitter {
  constructor({
    gkUrl = '/',
    getUserMedia = null,
    webSocket = window.WebSocket,
    audioContext = window.AudioContext || window.webkitAudioContext,
    microphone = Microphone,
    maxFinalWait = 5000,
    audioParams = null,
    relayParams = null,
  } = {}) {
    super();
    this.gkUrl = gkUrl;
    this.getUserMedia = getUserMedia || (navigator.mediaDevices && navigator.mediaDevices.getUserMedia.bind(
      navigator.mediaDevices
    ));
    this.WebSocket = webSocket;
    this.AudioContext = audioContext;
    this.Microphone = microphone;
    this.maxFinalWait = maxFinalWait;
    this.state = UNINITIALIZED;
    this.audioParams = audioParams;
    this.relayParams = relayParams;
  }

  init() {
    if (this.state === INITIALIZING) {
      return this._initPromise;
    }

    this.state = INITIALIZING;
    this._final = false;

    this._initPromise = this._requestAudioPermission()
      .then(stream => {
        this.stream = stream;
        this.device = stream
          .getAudioTracks()[0]
          .label.replace(/^default - /i, '');
        this.microphone = new this.Microphone(this.stream, {
          exportSampleRate: 16000, audioContext: this.AudioContext
        });
        this.state = READY;
        this.emit(TRANSCRIBER_READY, this);
        return this;
      })
      .catch(error => {
        this.error = error;
        this.state = ERROR;
        throw error;
      });

    return this._initPromise;
  }

  start() {
    if (this.state !== READY) {
      throw new Error('Transcriber#start: not ready');
    }

    this.state = INITIALIZING_RECORDING;

    const sessionId = uuid();

    return Promise.all([
      this._openAudioSocket(sessionId).then(socket => {
        this.audioSocket = socket;
        this.audioSocket.onclose = () =>
          this._handleSocketClose(this.audioSocket);
      }),
      this._openRelaySocket(sessionId).then(socket => {
        this.relaySocket = socket;
        this.relaySocket.onclose = () =>
          this._handleSocketClose(this.relaySocket);
        this.relaySocket.onmessage = m => this._handleSocketMessage(m);
      }),
    ]).then(
      () => {
        this._startRecording();
        this.state = RECORDING;
        this.emit(TRANSCRIBER_STARTED, this);
        return this;
      },
      error => {
        this.error = error;
        this.state = ERROR;
        throw error;
      }
    );
  }

  stop() {
    if (this.state !== RECORDING) {
      return Promise.resolve();
    }

    this.state = FINALIZING_RECORDING;

    this._stopRecording();
    this._pushData();
    this.audioSocket.close();

    return this._waitForFinal().then(() => {
      this.relaySocket.close();
      this.state = READY;
      this.emit(TRANSCRIBER_STOPPED, this);
      return this;
    });
  }

  cancel() {
    if (this.state !== RECORDING) {
      throw new Error('Transcriber#cancel: not recording');
    }

    this._stopRecording();

    this.state = READY;
    this.emit(TRANSCRIBER_CANCELED, this);
    return this;
  }

  destroy() {
    if (this.stream) {
      this.stream.getAudioTracks().forEach(t => t.stop());
    }
    this.stream = null;
    this.device = null;
    this.microphone = null;
    this.state = UNINITIALIZED;
    return this;
  }

  _requestAudioPermission() {
    if (!this.getUserMedia) {
      return Promise.reject("no access to navigator.mediaDevices.getUserMedia, the application may need to be served over HTTPS");
    }
    return this.getUserMedia({ audio: true, video: false }).then(
      stream => stream
    );
  }

  _openAudioSocket(sessionId) {
    return new Promise((resolve, reject) => {
      let path = `${this.gkUrl}/audio/${sessionId}`;
      if (this.audioParams) {
        path = `${path}?${querystring.encode(this.audioParams)}`
      }
      const socket = new this.WebSocket(this._webSocketUrl(path));
      socket.onopen = () => resolve(socket);
      socket.onerror = e => reject(e);
    });
  }

  _openRelaySocket(sessionId) {
    return new Promise((resolve, reject) => {
      let path = `${this.gkUrl}/relay/${sessionId}`;
      if (this.relayParams) {
        path = `${path}?${querystring.encode(this.relayParams)}`
      }
      const socket = new this.WebSocket(this._webSocketUrl(path));
      socket.onopen = () => resolve(socket);
      socket.onerror = e => reject(e);
    });
  }

  _waitForFinal() {
    return new Promise(resolve => {
      let t = new Date();

      const timer = setInterval(() => {
        if (this._final || new Date() - t >= this.maxFinalWait) {
          clearInterval(timer);
          resolve();
        }
      }, 250);
    });
  }

  _handleSocketClose() {
    if (this.state === RECORDING) {
      this.cancel();
    }
  }

  _handleSocketMessage({ data }) {
    const parsed = JSON.parse(data);
    this._final = parsed.final || false;
    this.emit(TRANSCRIBER_DATA_RECEIVED, this, parsed);
  }

  _startRecording() {
    this.microphone.start();
    this.timer = setInterval(() => {
      this._pushData();
    }, 250);
  }

  _pushData() {
    const blob = this.microphone.export();
    if (blob.size > 0) {
      this.audioSocket.send(blob);
    }
    return blob;
  }

  _stopRecording() {
    clearInterval(this.timer);
    delete this.timer;
    this.microphone.stop();
  }

  _webSocketUrl(path) {
    const url = new URL(path, window.location.href);
    url.protocol = url.protocol.replace('http', 'ws');
    return url.href;
  }
}

// Internal States
const UNINITIALIZED = Transcriber.UNINITIALIZED = Symbol('UNINITIALIZED');
const INITIALIZING = Transcriber.INITIALIZING = Symbol('INITIALIZING');
const ERROR = Transcriber.ERROR = Symbol('ERROR');
const READY = Transcriber.READY = Symbol('READY');
const INITIALIZING_RECORDING = Transcriber.INITIALIZING_RECORDING = Symbol('INITIALIZING_RECORDING');
const RECORDING = Transcriber.RECORDING = Symbol('RECORDING');
const FINALIZING_RECORDING = Transcriber.FINALIZING_RECORDING = Symbol('FINALIZING_RECORDING');

// External Events
const TRANSCRIBER_READY = Transcriber.TRANSCRIBER_READY = Symbol('TRANSCRIBER_READY');
const TRANSCRIBER_STARTED = Transcriber.TRANSCRIBER_STARTED = Symbol('TRANSCRIBER_STARTED');
const TRANSCRIBER_CANCELED = Transcriber.TRANSCRIBER_CANCELED = Symbol('TRANSCRIBER_CANCELED');
const TRANSCRIBER_STOPPED = Transcriber.TRANSCRIBER_STOPPED = Symbol('TRANSCRIBER_STOPPED');
const TRANSCRIBER_DATA_RECEIVED = Transcriber.TRANSCRIBER_DATA_RECEIVED = Symbol('TRANSCRIBER_DATA_RECEIVED');

export default Transcriber;

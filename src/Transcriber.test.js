import Transcriber from './Transcriber';

import {
  getUserMedia,
  MockAudioContext,
  MockWebSocket,
  ErrorMockWebSocket,
  MockMicrophone,
} from './transcriberMocks';

let defaultOpts;
let transcriber;

beforeEach(() => {
  MockWebSocket.clearConnections();

  defaultOpts = {
    getUserMedia,
    audioContext: MockAudioContext,
    webSocket: MockWebSocket,
    microphone: MockMicrophone,
    maxFinalWait: 0,
    middlewareConfig: {discovery: {foo: 1}},
    memo: 'hello world',
  };

  transcriber = new Transcriber(defaultOpts);
});

describe('#init', () => {
  it('calls getUserMedia to request audio permission and sets the state to INITIALIZING', async () => {
    const spy = spyOn(transcriber, 'getUserMedia').and.callThrough();
    const p = transcriber.init();
    expect(spy).toBeCalledWith({ audio: true, video: false });
    expect(transcriber.state).toEqual(Transcriber.INITIALIZING);
    await p;
  });

  it('can be safely called multiple times', async () => {
    await transcriber.init();
    await transcriber.init();
  });

  describe('when audio permission is granted', () => {
    it('transitions to the READY state and sets up the microphone', async () => {
      await transcriber.init();
      expect(transcriber.state).toEqual(Transcriber.READY);
      expect(transcriber.microphone).not.toBeUndefined();
    });

    it('records the device label', async () => {
      await transcriber.init();
      expect(transcriber.device).toBe('Some Mic Device');
    });

    it('emits the TRANSCRIBER_READY event', async () => {
      const spy = jest.fn();
      transcriber.on(Transcriber.TRANSCRIBER_READY, spy);
      await transcriber.init();
      expect(spy).toBeCalledWith(transcriber);
    });
  });

  describe('when audio permission is denied', () => {
    beforeEach(() => {
      transcriber = new Transcriber({
        ...defaultOpts,
        getUserMedia: () =>
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error('boom')))
          ),
      });
    });

    it('transitions to the ERROR state', async () => {
      let thrown = false;
      try {
        await transcriber.init();
      } catch (e) {
        thrown = true;
      }
      expect(thrown).toBe(true);
      expect(transcriber.state).toEqual(Transcriber.ERROR);
    });
  });
});

describe('#start', () => {
  describe('when not READY', () => {
    it('throws an exception', () => {
      expect(() => {
        transcriber.start();
      }).toThrow(new Error('Transcriber#start: not ready'));
    });
  });

  describe('when READY', () => {
    it('opens goes to the INITIALIZING_RECORDING state', async () => {
      await transcriber.init();
      const p = transcriber.start();
      expect(transcriber.state).toEqual(Transcriber.INITIALIZING_RECORDING);
      await p;
    });

    it('opens an audio websocket connection', async () => {
      await transcriber.init();

      const p = transcriber.start();
      expect(MockWebSocket.connections.length).toBe(2);
      const url = new URL(MockWebSocket.connections[0]);
      expect(url.origin).toEqual('ws://audio');
      expect(url.searchParams.get('middleware_config')).toEqual(encodeURIComponent(JSON.stringify({discovery: {foo: 1}})));
      expect(url.searchParams.get('memo')).toEqual('hello%20world');
      await p;
    });

    it('opens a relay websocket connection', async () => {
      await transcriber.init();

      const p = transcriber.start();
      expect(MockWebSocket.connections.length).toBe(2);
      const url = new URL(MockWebSocket.connections[1]);
      expect(url.origin).toEqual('ws://relay');
      await p;
    });

    describe('when websocket connection succeeds', () => {
      it('goes to the RECORDING state', async () => {
        await transcriber.init();
        await transcriber.start();
        expect(transcriber.state).toEqual(Transcriber.RECORDING);
      });

      it('emits a TRANSCRIBER_STARTED event', async () => {
        const cb = jest.fn();
        transcriber.on(Transcriber.TRANSCRIBER_STARTED, cb);
        await transcriber.init();
        await transcriber.start();
        expect(cb).toBeCalledWith(transcriber);
      });
    });

    describe('when websocket connection fails', () => {
      beforeEach(() => {
        transcriber = new Transcriber({
          ...defaultOpts,
          webSocket: ErrorMockWebSocket,
        });
      });

      it('goes to the ERROR state', async () => {
        let thrown = false;
        await transcriber.init();

        try {
          await transcriber.start();
        } catch (e) {
          thrown = true;
        }

        expect(thrown).toBe(true);
        expect(transcriber.state).toBe(Transcriber.ERROR);
      });
    });
  });
});

describe('RECORDING', () => {
  beforeEach(async () => {
    await transcriber.init();
    await transcriber.start();
  });

  it('sends recorded data to the server every 250ms', async () => {
    const sendSpy = spyOn(transcriber.audioSocket, 'send');
    await transcriber._pushData();
    expect(sendSpy).toBeCalled();
  });

  describe('when a websocket message is received', () => {
    it('emits a TRANSCRIBER_DATA_RECEIVED event with the message data', () => {
      const cb = jest.fn();
      const message = { a: 1, b: 'two', c: [1, 2, 3] };
      transcriber.on(Transcriber.TRANSCRIBER_DATA_RECEIVED, cb);
      transcriber.relaySocket.onmessage({ data: JSON.stringify(message) });
      expect(cb).toBeCalledWith(transcriber, message);
    });
  });

  describe('when the server closes the websocket connection', () => {
    it('stops the microphone and cancels the push timer', () => {
      const stopSpy = spyOn(transcriber.microphone, 'stop');
      expect(transcriber.timer).toBeDefined();
      transcriber.relaySocket.onclose();
      expect(transcriber.timer).not.toBeDefined();
      expect(stopSpy).toBeCalled();
    });
  });
});

describe('#stop', () => {
  describe('when RECORDING', () => {
    beforeEach(async () => {
      await transcriber.init();
      await transcriber.start();
    });

    it('goes to the FINALIZING_RECORDING state', async () => {
      const p = transcriber.stop();
      expect(transcriber.state).toBe(Transcriber.FINALIZING_RECORDING);
      await p;
    });

    it('stops the microphone and cancels the push timer', async () => {
      const stopSpy = spyOn(transcriber.microphone, 'stop');

      expect(transcriber.timer).toBeDefined();
      await transcriber.stop();
      expect(transcriber.timer).not.toBeDefined();
      expect(stopSpy).toBeCalled();
    });

    it('sends the remaining recorded data', async () => {
      const sendSpy = spyOn(transcriber.audioSocket, 'send');
      await transcriber.stop();
      expect(sendSpy).toBeCalled();
    });

    it('closes the sockets', async () => {
      const audioCloseSpy = spyOn(transcriber.audioSocket, 'close');
      const relayCloseSpy = spyOn(transcriber.relaySocket, 'close');
      await transcriber.stop();
      expect(audioCloseSpy).toBeCalled();
      expect(relayCloseSpy).toBeCalled();
    });

    it('goes to the READY state when finalized', async () => {
      await transcriber.stop();
      expect(transcriber.state).toBe(Transcriber.READY);
    });

    it('emits a TRANSCRIBER_STOPPED event', async () => {
      const cb = jest.fn();
      transcriber.on(Transcriber.TRANSCRIBER_STOPPED, cb);
      await transcriber.stop();
      expect(cb).toBeCalledWith(transcriber);
    });
  });
});

describe('#cancel', () => {
  describe('when not RECORDING', () => {
    it('throws an exception', () => {
      expect(() => {
        transcriber.cancel();
      }).toThrow(new Error('Transcriber#cancel: not recording'));
    });
  });

  describe('when RECORDING', () => {
    beforeEach(async () => {
      await transcriber.init();
      await transcriber.start();
    });

    it('stops the microphone and cancels the push timer', async () => {
      const stopSpy = spyOn(transcriber.microphone, 'stop');

      expect(transcriber.timer).toBeDefined();
      transcriber.cancel();
      expect(transcriber.timer).not.toBeDefined();
      expect(stopSpy).toBeCalled();
    });

    it('goes immediately to the READY state', async () => {
      transcriber.cancel();
      expect(transcriber.state).toBe(Transcriber.READY);
    });

    it('emits a TRANSCRIBER_CANCELED event', async () => {
      const cb = jest.fn();
      transcriber.on(Transcriber.TRANSCRIBER_CANCELED, cb);
      transcriber.cancel();
      expect(cb).toBeCalledWith(transcriber);
    });
  });
});

describe('#destroy', () => {
  beforeEach(async () => {
    await transcriber.init();
  });

  it('sets state to UNINITIALIZED', () => {
    expect(transcriber.state).toBe(Transcriber.READY);
    transcriber.destroy();
    expect(transcriber.state).toBe(Transcriber.UNINITIALIZED);
  });

  it('clears the stream, device, and microphone', () => {
    transcriber.destroy();
    expect(transcriber.stream).toBeNull();
    expect(transcriber.device).toBeNull();
    expect(transcriber.microphone).toBeNull();
  });
});

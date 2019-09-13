/* eslint class-methods-use-this: "off" */

export const getUserMedia = () =>
  new Promise(resolve =>
    setTimeout(() =>
      resolve({
        getAudioTracks() {
          return [{ label: 'Default - Some Mic Device', stop: () => {} }];
        },
      })
    )
  );

export class MockAudioContext {
  createAnalyser() {
    return {};
  }

  createMediaStreamSource() {
    return { connect: () => {} };
  }
}

export class MockWebSocket {
  constructor() {
    setTimeout(() => {
      this.onopen(this);
    });
  }

  send() {}

  close() {}
}

export class ErrorMockWebSocket {
  constructor() {
    setTimeout(() => {
      this.onerror({});
    });
  }
}

export class MockMicrophone {
  start() {}

  stop() {}

  export() {
    return new Blob([0,0,0,0,0]);
  }
}

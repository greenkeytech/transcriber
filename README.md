# @gkt/transcriber

`@gkt/transcriber` is a JavaScript library for performing voice transcriptions via GreenKey's
backend services.

## Installation

```
$ npm install @gkt/transcriber 
```

Or via unpkg.com:

```html
<script type="text/javascript" src="https://unpkg.com/@gkt/transcriber"></script>
```

## Usage

```javascript
// es6 module
import Transcriber from '@gkt/transcriber';

// common js module
// const Transcriber = require('@gkt/transcriber');

// script tag
// const Transcriber = window.Transcriber;

// Provide a base URL that is proxied to your GreenKey backend instance
const transcriber = new Transcriber({gkUrl: '/greenkey'});

// This will prompt the user for access to the microphone
transcriber.init().then(function() {
  // Register a callback for transcription data. Updates will be emitted periodically while a
  // transcription is active. A final data object will be emitted after the transcription is stopped
  // and is indicated by the `data.final` property.
  transcriber.on(Transcriber.TRANSCRIBER_DATA_RECEIVED, function(t, data) {
    console.log(data);
  });

  // Start recording audio data from the microphone and send it to the GreenKey backend for
  // processing.
  transcriber.start();

  // Stop recording audio data.
  transcriber.stop();
});
```

### Processing Results

Transcriptions are produced in real time and communicated to the client via the
`Transcriber.TRANSCRIBER_DATA_RECEIVED` event. The first argument to the event handler is the
transcriber instance and the second is an object containing the current result of the transcription.
The following top-level fields are included:

| Field | Type | Description |
| ----- | ---- | ----------- |
| session | string | A unique identifier for the transcription session |
| final | boolean | Indicates whether this is the final version of the transcript |
| clockStart | string (ISO8601 date) | The time the transcription recording started |
| segments | array of objects | A list of segment objects |

And the `segments` array contains objects with these fields:

| Field | Type | Description |
| ----- | ---- | ----------- |
| final | boolean | Indicates whether this segment is finished processing |
| startTimeSec | number | The offset in seconds from `clockStart` where the segment audio started |
| endTimeSec | number | The offset in seconds from `clockStart` where the segment audio ended |
| transcript | string | The text of the raw transcript |
| interpreted_quote | object | Present when a quote is detected in the transcript |
| interpreted_quote.imString | string | The generated IM String of the detected quote |
| interpreted_quote.productClass.label | string | The product class of the detected quote |
| words | array | A list of transcript works with confidence levels |

## Example Apps

Some example apps are provided in the `examples` directory. Edit the `.html` files to set the
`gkUrl` variable to your GreenKey instance before opening in a browser.

The examples are full apps that send audio data recorded from the microphone, receive transcription
results and display them.

## Notes

This library uses the [MediaDevices.getUserMedia()](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia)
API for gaining access to the user's microphone hardware. This API is only available in secure
contexts, so your application must be served over HTTPS in order for it to work.


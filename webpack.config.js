const path = require('path');

module.exports = {
  entry: './src/Transcriber.js',
  output: {
    path: path.resolve(__dirname, 'dist'),
    filename: 'Transcriber.js',
    library: 'Transcriber',
    libraryExport: ['default'],
    libraryTarget: 'umd'
  },
  module: {
    rules: [
      {
        test: /\.js$/,
        exclude: /node_modules/,
        use: {
          loader: 'babel-loader'
        }
      }
    ]
  }
};


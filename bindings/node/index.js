let nodeTypeInfo;
try {
  nodeTypeInfo = require('../../src/node-types.json');
} catch (_) {
  nodeTypeInfo = [];
}

module.exports = require('node-gyp-build')(__dirname + '/../..');

try {
  module.exports.nodeTypeInfo = nodeTypeInfo;
} catch (_) {
  // no-op in case the module exports are frozen
}

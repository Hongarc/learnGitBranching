const { join } = require('path');
const { readFileSync } = require('fs');

const util = require('../util');
const { strings } = require('./strings');

const easyRegex = /intl\.str\(\s*'([A-Za-z\-]+)'/g;

const allKetSet = new Set(Object.keys(strings));
allKetSet.delete('error-untranslated'); // used in ./index.js

const goodKeySet = new Set();
const validateKey = function (key) {
  if (!strings[key]) {
    console.log('NO KEY for: "', key, '"');
  } else {
    goodKeySet.add(key);
    allKetSet.delete(key);
  }
};

if (!util.isBrowser()) {
  for (const path of util.readDirDeep(join(__dirname, '../../'))) {
    const content = readFileSync(path);
    var match;
    while (match = easyRegex.exec(content)) {
      validateKey(match[1]);
    }
  }
  console.log(goodKeySet.size, 'good keys found!');
  console.log(allKetSet.size, 'keys did not use!');
  console.log(allKetSet);
}

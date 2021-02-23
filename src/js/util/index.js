const { readdirSync, lstatSync } = require('fs');
const { join } = require('path');

const escapeString = require('./escapeString');
const constants = require('./constants');

exports.parseQueryString = function (uri) {
  // from http://stevenbenner.com/2010/03/javascript-regex-trick-parse-a-query-string-into-an-object/
  const parameters = {};
  uri.replace(
    new RegExp('([^?=&]+)(=([^&]*))?', 'g'),
    ($0, $1, $2, $3) => { parameters[$1] = $3; },
  );
  return parameters;
};

exports.isBrowser = function () {
  const inBrowser = String(typeof window) !== 'undefined';
  return inBrowser;
};

exports.splitTextCommand = function (value, callback, context) {
  const functionBind = callback.bind(context);
  value.split(';').forEach((command, index) => {
    const newCommand = escapeString(command)
      .replace(/^(\s+)/, '')
      .replace(/(\s+)$/, '')
      .replace(/&quot;/g, '"')
      .replace(/&#x27;/g, "'")
      .replace(/&#x2F;/g, '/');

    if (index > 0 && command.length === 0) {
      return;
    }
    functionBind(newCommand);
  });
};

exports.genParseCommand = function (regexMap, eventName) {
  return function (string) {
    let method;
    let regexResults;

    for (const _method of Object.keys(regexMap)) {
      const results = regexMap[_method].exec(string);
      if (results) {
        method = _method;
        regexResults = results;
      }
    }

    return (!method) ? false : {
      toSet: {
        eventName,
        method,
        regexResults,
      },
    };
  };
};

exports.readDirDeep = function (dir) {
  const paths = [];
  for (const path of readdirSync(dir)) {
    const aPath = join(dir, path);
    if (lstatSync(aPath).isDirectory()) {
      paths.push(...exports.readDirDeep(aPath));
    } else {
      paths.push(aPath);
    }
  }
  return paths;
};

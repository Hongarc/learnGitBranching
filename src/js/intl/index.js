const _ = require('underscore');
const LocaleStore = require('../stores/LocaleStore');

const { strings } = require('./strings');

const { getDefaultLocale } = LocaleStore;

const fallbackMap = {
  zh_TW: 'zh_CN',
};

// lets change underscores template settings so it interpolates
// things like "{branchName} does not exist".
const templateSettings = { ..._.templateSettings };
templateSettings.interpolate = /{(.+?)}/g;
const template = exports.template = function (string, parameters) {
  return _.template(string, parameters, templateSettings);
};

var string = exports.str = function (key, parameters) {
  parameters = parameters || {};
  // this function takes a key like "error-branch-delete"
  // and parameters like {branchName: 'bugFix', num: 3}.
  //
  // it sticks those into a translation string like:
  //   'en': 'You can not delete the branch {branchName} because' +
  //         'you are currently on that branch! This is error number + {num}'
  //
  // to produce:
  //
  // 'You can not delete the branch bugFix because you are currently on that branch!
  //  This is error number 3'

  let locale = LocaleStore.getLocale();
  if (!strings[key]) {
    console.warn(`NO INTL support for key ${key}`);
    return `NO INTL support for key ${key}. this is probably a dev error`;
  }

  if (!strings[key][locale]) {
    // try falling back to another locale if in the map
    locale = fallbackMap[locale] || getDefaultLocale();
  }

  if (!strings[key][locale]) {
    if (key !== 'error-untranslated') {
      return string('error-untranslated');
    }
    return `No translation for the key "${key}"`;
  }

  return template(
    strings[key][locale],
    parameters,
  );
};

const getIntlKey = exports.getIntlKey = function (object, key, overrideLocale) {
  if (!object || !object[key]) {
    throw new Error(`that key ${key}doesn't exist in this blob${object}`);
  }
  if (!object[key][getDefaultLocale()]) {
    console.warn(
      'WARNING!! This blob does not have intl support:',
      object,
      'for this key',
      key,
    );
  }

  const locale = overrideLocale || LocaleStore.getLocale();
  return object[key][locale];
};

exports.todo = function (string_) {
  return string_;
};

exports.getDialog = function (object) {
  return getIntlKey(object, 'dialog') || object.dialog[getDefaultLocale()];
};

exports.getHint = function (level) {
  if (!getIntlKey(level, 'hint')) {
    return `${getIntlKey(level, 'hint', getDefaultLocale())} -- ${string('error-untranslated')}`;
  }
  return getIntlKey(level, 'hint');
};

exports.getName = function (level) {
  if (!getIntlKey(level, 'name')) {
    return `${getIntlKey(level, 'name', getDefaultLocale())} -- ${string('error-untranslated')}`;
  }
  return getIntlKey(level, 'name');
};

exports.getStartDialog = function (level) {
  const startDialog = getIntlKey(level, 'startDialog');
  if (startDialog) { return startDialog; }

  // this level translation isn't supported yet, so lets add
  // an alert to the front and give the english version.
  const errorAlert = {
    type: 'ModalAlert',
    options: {
      markdown: string('error-untranslated'),
    },
  };
  const startCopy = {

    ...level.startDialog[getDefaultLocale()] || level.startDialog,
  };
  startCopy.childViews.unshift(errorAlert);

  return startCopy;
};

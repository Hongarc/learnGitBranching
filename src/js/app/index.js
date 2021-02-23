const Backbone = require('backbone');
const jQuery = require('jquery');
const { EventEmitter } = require('events');
const React = require('react');
const ReactDOM = require('react-dom');

const util = require('../util');
const intl = require('../intl');
const LocaleStore = require('../stores/LocaleStore');
const LocaleActions = require('../actions/LocaleActions');

/**
 * Globals
 */

Backbone.$ = jQuery;

// Bypass jasmine
if (util.isBrowser()) {
  window.jQuery = jQuery;
  window.$ = jQuery;
  window.Raphael = require('raphael');
}

const events = {

  ...EventEmitter.prototype,
  trigger() {
    // alias this for backwards compatibility
    Reflect.apply(this.emit, this, arguments);
  },
};
// Allow unlimited listeners, so FF doesn't break
events.setMaxListeners(0);
let commandUI;
let sandbox;
let eventBaton;
let levelDropdown;

/// ////////////////////////////////////////////////////////////////////

const init = function () {
  /**
    * There is a decent amount of bootstrapping we need just to hook
    * everything up. The init() method takes on these responsibilities,
    * including but not limited to:
    *   - setting up Events and EventBaton
    *   - calling the constructor for the main visualization
    *   - initializing the command input bar
    *   - handling window.focus and zoom events
  * */
  const { Sandbox } = require('../sandbox');
  const { EventBaton } = require('../util/eventBaton');
  const { LevelDropdownView } = require('../views/levelDropdownView');

  eventBaton = new EventBaton();
  commandUI = new CommandUI();
  sandbox = new Sandbox();
  levelDropdown = new LevelDropdownView({
    wait: true,
  });

  LocaleStore.subscribe(() => {
    if (LocaleStore.getLocale() !== LocaleStore.getDefaultLocale()) {
      intlRefresh();
    }
  });
  events.on('vcsModeChange', vcsModeRefresh);

  initRootEvents(eventBaton);
  initDemo(sandbox);
  // unfortunate global export for casper tests
  window.LocaleStore = LocaleStore;
  window.LocaleActions = LocaleActions;
  window.intl = intl;
};

var vcsModeRefresh = function (eventData) {
  if (!window.$) { return; }

  const { mode } = eventData;
  const isGit = eventData.mode === 'git';

  const displayMode = mode.slice(0, 1).toUpperCase() + mode.slice(1);
  const otherMode = (displayMode === 'Git') ? 'Hg' : 'Git';
  const regex = new RegExp(otherMode, 'g');

  document.title = intl.str('learn-git-branching').replace(regex, displayMode);
  $('span.vcs-mode-aware').each((index, element) => {
    const text = $(element).text().replace(regex, displayMode);
    $(element).text(text);
  });

  $('body').toggleClass('gitMode', isGit);
  $('body').toggleClass('hgMode', !isGit);
};

const insertAlternateLinks = function (pageId) {
  // For now pageId is null, which would link to the main page.
  // In future if pageId is provided this method should link to a specific page

  // The value of the hreflang attribute identifies the language (in ISO 639-1 format)
  // and optionally a region (in ISO 3166-1 Alpha 2 format) of an alternate URL

  const altLinks = LocaleStore.getSupportedLocales().map((langCode) => {
    const url = `https://learngitbranching.js.org/?locale=${langCode}`;
    return `<link rel="alternate" hreflang="${langCode}" href="${url}" />`;
  });
  const defaultUrl = `https://learngitbranching.js.org/?locale=${LocaleStore.getDefaultLocale()}`;
  altLinks.push(`<link rel="alternate" hreflang="x-default" href="${defaultUrl}" />`);
  $('head').prepend(altLinks);
};

var intlRefresh = function () {
  if (!window.$) { return; }
  const countryCode = LocaleStore.getLocale().split('_')[0];
  $('html').attr('lang', countryCode);
  $("meta[http-equiv='content-language']").attr('content', countryCode);
  $('span.intl-aware').each((index, element) => {
    const intl = require('../intl');
    const key = $(element).attr('data-intl');
    $(element).text(intl.str(key));
  });
};

var initRootEvents = function (eventBaton) {
  // we always want to focus the text area to collect input
  const focusTextArea = function () {
    $('#commandTextField').focus();
  };
  focusTextArea();

  $(window).focus((e) => {
    eventBaton.trigger('windowFocus', e);
  });
  $(document).click((e) => {
    eventBaton.trigger('documentClick', e);
  });
  $(document).bind('keydown', (e) => {
    eventBaton.trigger('docKeydown', e);
  });
  $(document).bind('keyup', (e) => {
    eventBaton.trigger('docKeyup', e);
  });
  $(window).on('resize', (e) => {
    events.trigger('resize', e);
  });

  eventBaton.stealBaton('docKeydown', () => {});
  eventBaton.stealBaton('docKeyup', () => {});

  // the default action on window focus and document click is to just focus the text area
  eventBaton.stealBaton('windowFocus', focusTextArea);
  eventBaton.stealBaton('documentClick', focusTextArea);

  // but when the input is fired in the text area, we pipe that to whoever is
  // listenining
  const makeKeyListener = function (name) {
    return function () {
      const arguments_ = [name];
      for (const argument of Array.prototype.slice.apply(arguments)) {
        arguments_.push(argument);
      }
      eventBaton.trigger.apply(eventBaton, arguments_);
    };
  };

  $('#commandTextField').on('keydown', makeKeyListener('keydown'));
  $('#commandTextField').on('keyup', makeKeyListener('keyup'));
  $(window).trigger('resize');
};

var initDemo = function (sandbox) {
  const parameters = util.parseQueryString(window.location.href);

  // being the smart programmer I am (not), I don't include a true value on demo, so
  // I have to check if the key exists here
  let commands;
  if (/(iphone|ipod|ipad).*applewebkit/i.test(navigator.userAgent) || /android/i.test(navigator.userAgent)) {
    sandbox.mainVis.customEvents.on('gitEngineReady', () => {
      eventBaton.trigger('commandSubmitted', 'mobile alert');
    });
  }

  if (parameters.hasOwnProperty('demo')) {
    commands = [
      'git commit; git checkout -b bugFix C1; git commit; git merge master; git checkout master; git commit; git rebase bugFix;',
      'delay 1000; reset;',
      'level advanced1 --noFinishDialog --noStartCommand --noIntroDialog;',
      'delay 2000; show goal; delay 1000; hide goal;',
      'git checkout bugFix; git rebase master; git checkout side; git rebase bugFix;',
      'git checkout another; git rebase side; git rebase another master;',
      'help; levels',
    ];
  } else if (parameters.hasOwnProperty('hgdemo')) {
    commands = [
      'importTreeNow {"branches":{"master":{"target":"C3","id":"master"},"feature":{"target":"C2","id":"feature"},"debug":{"target":"C4","id":"debug"}},"commits":{"C0":{"parents":[],"id":"C0","rootCommit":true},"C1":{"parents":["C0"],"id":"C1"},"C2":{"parents":["C1"],"id":"C2"},"C3":{"parents":["C1"],"id":"C3"},"C4":{"parents":["C2"],"id":"C4"}},"HEAD":{"target":"feature","id":"HEAD"}}',
      'delay 1000',
      'git rebase master',
      'delay 1000',
      'undo',
      'hg book',
      'delay 1000',
      'hg rebase -d master',
    ];
    commands = commands.join(';#').split('#'); // hax
  } else if (parameters.hasOwnProperty('hgdemo2')) {
    commands = [
      'importTreeNow {"branches":{"master":{"target":"C3","id":"master"},"feature":{"target":"C2","id":"feature"},"debug":{"target":"C4","id":"debug"}},"commits":{"C0":{"parents":[],"id":"C0","rootCommit":true},"C1":{"parents":["C0"],"id":"C1"},"C2":{"parents":["C1"],"id":"C2"},"C3":{"parents":["C1"],"id":"C3"},"C4":{"parents":["C2"],"id":"C4"}},"HEAD":{"target":"debug","id":"HEAD"}}',
      'delay 1000',
      'git rebase master',
      'delay 1000',
      'undo',
      'hg sum',
      'delay 1000',
      'hg rebase -d master',
    ];
    commands = commands.join(';#').split('#'); // hax
  } else if (parameters.hasOwnProperty('remoteDemo')) {
    commands = [
      'git clone',
      'git commit',
      'git fakeTeamwork',
      'git pull',
      'git push',
      'git commit',
      'git fakeTeamwork',
      'git pull --rebase',
      'git push',
      'levels',
    ];
    commands = commands.join(';#').split('#'); // hax
  } else if (parameters.gist_level_id) {
    $.ajax({
      url: `https://api.github.com/gists/${parameters.gist_level_id}`,
      type: 'GET',
      dataType: 'jsonp',
      success(response) {
        const data = response.data || {};
        const files = data.files || {};
        if (Object.keys(files).length === 0) {
          console.warn('no files found');
          return;
        }
        const file = files[Object.keys(files)[0]];
        if (!file.content) {
          console.warn('file empty');
        }
        eventBaton.trigger(
          'commandSubmitted',
          `importLevelNow ${escape(file.content)}; clear`,
        );
      },
    });
  } else if (!parameters.hasOwnProperty('NODEMO')) {
    commands = [
      'help;',
      'levels',
    ];
  }
  if (parameters.hasOwnProperty('STARTREACT')) {
    /*
    ReactDOM.render(
      React.createElement(CommandView, {}),
      document.getElementById(params['STARTREACT'])
      ); */
  }
  if (commands) {
    sandbox.mainVis.customEvents.on('gitEngineReady', () => {
      eventBaton.trigger('commandSubmitted', commands.join(''));
    });
  }

  if (parameters.locale !== undefined && parameters.locale.length > 0) {
    LocaleActions.changeLocaleFromURI(parameters.locale);
  } else {
    tryLocaleDetect();
  }

  insertAlternateLinks();

  if (parameters.command) {
    const command = unescape(parameters.command);
    sandbox.mainVis.customEvents.on('gitEngineReady', () => {
      eventBaton.trigger('commandSubmitted', command);
    });
  }
};

function tryLocaleDetect() {
  // use navigator to get the locale setting
  changeLocaleFromHeaders(navigator.language || navigator.browserLanguage);
}

function changeLocaleFromHeaders(langString) {
  LocaleActions.changeLocaleFromHeader(langString);
}

if (require('../util').isBrowser()) {
  // this file gets included via node sometimes as well
  $(document).ready(init);
}

/**
  * the UI method simply bootstraps the command buffer and
  * command prompt views. It only interacts with user input
  * and simply pipes commands to the main events system
* */
function CommandUI() {
  Backbone.$ = $; // lol WTF BACKBONE MANAGE YOUR DEPENDENCIES
  const Views = require('../views');
  const Collections = require('../models/collections');
  const CommandViews = require('../views/commandViews');
  const CommandHistoryView = require('../react_views/CommandHistoryView.jsx');
  const MainHelperBarView = require('../react_views/MainHelperBarView.jsx');

  this.commandCollection = new Collections.CommandCollection();
  this.commandBuffer = new Collections.CommandBuffer({
    collection: this.commandCollection,
  });

  this.commandPromptView = new CommandViews.CommandPromptView({
    el: $('#commandLineBar'),
  });

  ReactDOM.render(
    React.createElement(MainHelperBarView),
    document.querySelector('#helperBarMount'),
  );
  ReactDOM.render(
    React.createElement(
      CommandHistoryView,
      { commandCollection: this.commandCollection },
    ),
    document.querySelector('#commandDisplay'),
  );
}

exports.getEvents = function () {
  return events;
};

exports.getSandbox = function () {
  return sandbox;
};

exports.getEventBaton = function () {
  return eventBaton;
};

exports.getCommandUI = function () {
  return commandUI;
};

exports.getLevelDropdown = function () {
  return levelDropdown;
};

exports.init = init;

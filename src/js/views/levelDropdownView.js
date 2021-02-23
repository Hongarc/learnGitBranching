const _ = require('underscore');
const Q = require('q');
const Backbone = require('backbone');
const LocaleStore = require('../stores/LocaleStore');

const util = require('../util');
const debounce = require('../util/debounce');
const intl = require('../intl');
const log = require('../log');
const { KeyboardListener } = require('../util/keyboard');
const Main = require('../app');
const LevelStore = require('../stores/LevelStore');

const { ModalTerminal } = require('.');
const { ContainedBase } = require('.');
const { BaseView } = require('.');

const LEVELS = require('../../levels');

var LevelDropdownView = ContainedBase.extend({
  tagName: 'div',
  className: 'levelDropdownView box vertical',
  template: _.template($('#level-dropdown-view').html()),
  events: {
    'click div.levelDropdownTab': 'onTabClick',
  },

  initialize(options) {
    options = options || {};
    const queryParameters = util.parseQueryString(
      window.location.href,
    );
    this.JSON = {
      selectedTab: queryParameters.defaultTab || 'main',
      tabs: [{
        id: 'main',
        name: intl.str('main-levels-tab'),
      }, {
        id: 'remote',
        name: intl.str('remote-levels-tab'),
      }],
    };

    this.navEvents = { ...Backbone.Events };
    this.navEvents.on('clickedID', debounce(
      this.loadLevelID.bind(this),
      300,
      true,
    ));
    this.navEvents.on('negative', this.negative, this);
    this.navEvents.on('positive', this.positive, this);
    this.navEvents.on('left', this.left, this);
    this.navEvents.on('right', this.right, this);
    this.navEvents.on('up', this.up, this);
    this.navEvents.on('down', this.down, this);

    this.keyboardListener = new KeyboardListener({
      events: this.navEvents,
      aliasMap: {
        esc: 'negative',
        enter: 'positive',
      },
      wait: true,
    });

    this.sequences = LevelStore.getSequences();
    this.sequenceToLevels = LevelStore.getSequenceToLevels();

    this.container = new ModalTerminal({
      title: intl.str('select-a-level'),
    });

    // Lol WTF. For some reason we cant use this.render.bind(this) so
    // instead setup a lame callback version. The CasperJS tests
    // fail otherwise.
    const that = this;
    LocaleStore.subscribe(() => {
      that.render.apply(that);
    });
    LevelStore.subscribe(() => {
      that.render();
    });
    this.render();
    if (!options.wait) {
      this.show();
    }
  },

  render() {
    this.container.updateTitle(
      intl.str('select-a-level'),
    );
    this.updateTabNames([
      intl.str('main-levels-tab'),
      intl.str('remote-levels-tab'),
    ]);
    Reflect.apply(LevelDropdownView.__super__.render, this, arguments);
    this.buildSequences();
  },

  onTabClick(event) {
    const sourceElement = event.target || event.srcElement;
    const id = $(sourceElement).attr('data-id');
    if (id === this.JSON.selectedTab) {
      return;
    }
    this.selectedTab = id;
    this.updateTabTo(id);
  },

  updateTabTo(id) {
    this.JSON.selectedTab = id;
    this.render();
    if (this.selectedID) {
      this.selectedSequence = this.getSequencesOnTab()[0];
      this.selectedIndex = 0;
      this.updateSelectedIcon();
    }
  },

  updateTabNames(names) {
    for (const [index, name] of names.entries()) {
      this.JSON.tabs[index].name = name;
    }
  },

  positive() {
    if (!this.selectedID) {
      return;
    }
    this.loadLevelID(this.selectedID);
  },

  left() {
    if (this.turnOnKeyboardSelection()) {
      return;
    }
    this.leftOrRight(-1);
  },

  updateSelectedIcon() {
    this.selectedID = this.getSelectedID();
    this.selectIconByID(this.selectedID);
  },

  leftOrRight(delta) {
    this.deselectIconByID(this.selectedID);
    const index = this.selectedIndex + delta;

    const sequence = this.getCurrentSequence();
    const { tabs } = this.JSON;
    // switch tabs now if needed / possible
    if (index >= sequence.length
        && this.getTabIndex() + 1 < tabs.length) {
      this.switchToTabIndex(this.getTabIndex() + 1);
      this.selectedIndex = 0;
    } else if (index < 0
               && this.getTabIndex() - 1 >= 0) {
      this.switchToTabIndex(this.getTabIndex() - 1);
      this.selectedIndex = 0;
    } else {
      this.selectedIndex = this.wrapIndex(
        this.selectedIndex + delta, this.getCurrentSequence(),
      );
    }
    this.updateSelectedIcon();
  },

  right() {
    if (this.turnOnKeyboardSelection()) {
      return;
    }
    this.leftOrRight(1);
  },

  up() {
    if (this.turnOnKeyboardSelection()) {
      return;
    }
    this.selectedSequence = this.getPreviousSequence();
    this.downOrUp();
  },

  down() {
    if (this.turnOnKeyboardSelection()) {
      return;
    }
    this.selectedSequence = this.getNextSequence();
    this.downOrUp();
  },

  downOrUp() {
    this.selectedIndex = this.boundIndex(this.selectedIndex, this.getCurrentSequence());
    this.deselectIconByID(this.selectedID);
    this.updateSelectedIcon();
  },

  turnOnKeyboardSelection() {
    if (!this.selectedID) {
      this.selectFirst();
      return true;
    }
    return false;
  },

  turnOffKeyboardSelection() {
    if (!this.selectedID) { return; }
    this.deselectIconByID(this.selectedID);
    this.selectedID = undefined;
    this.selectedIndex = undefined;
    this.selectedSequence = undefined;
  },

  getTabIndex() {
    const ids = this.JSON.tabs.map((tab) => tab.id);
    return ids.indexOf(this.JSON.selectedTab);
  },

  switchToTabIndex(index) {
    const tabID = this.JSON.tabs[index].id;
    this.updateTabTo(tabID);
  },

  wrapIndex(index, array) {
    index = (index >= array.length) ? 0 : index;
    index = (index < 0) ? array.length - 1 : index;
    return index;
  },

  boundIndex(index, array) {
    index = (index >= array.length) ? array.length - 1 : index;
    index = (index < 0) ? 0 : index;
    return index;
  },

  getSequencesOnTab() {
    return this.sequences.filter(function (sequenceName) {
      const tab = LEVELS.getTabForSequence(sequenceName);
      return tab === this.JSON.selectedTab;
    }, this);
  },

  getNextSequence() {
    const current = this.getSequenceIndex(this.selectedSequence);
    const desired = this.wrapIndex(current + 1, this.getSequencesOnTab());
    return this.getSequencesOnTab()[desired];
  },

  getPreviousSequence() {
    const current = this.getSequenceIndex(this.selectedSequence);
    const desired = this.wrapIndex(current - 1, this.getSequencesOnTab());
    return this.getSequencesOnTab()[desired];
  },

  getSequenceIndex(name) {
    const index = this.getSequencesOnTab().indexOf(name);
    if (index < 0) { throw new Error('didnt find'); }
    return index;
  },

  getIndexForID(id) {
    return LevelStore.getLevel(id).index;
  },

  selectFirst() {
    const firstID = this.sequenceToLevels[this.getSequencesOnTab()[0]][0].id;
    this.selectIconByID(firstID);
    this.selectedIndex = 0;
    this.selectedSequence = this.getSequencesOnTab()[0];
  },

  getCurrentSequence() {
    return this.sequenceToLevels[this.selectedSequence];
  },

  getSelectedID() {
    return this.sequenceToLevels[this.selectedSequence][this.selectedIndex].id;
  },

  selectIconByID(id) {
    this.toggleIconSelect(id, true);
  },

  deselectIconByID(id) {
    this.toggleIconSelect(id, false);
  },

  toggleIconSelect(id, value) {
    this.selectedID = id;
    const selector = `#levelIcon-${id}`;
    $(selector).toggleClass('selected', value);

    // also go find the series and update the about
    this.seriesViews.forEach((view) => {
      if (!view.levelIDs.includes(id)) {
        return;
      }
      view.updateAboutForLevelID(id);
    }, this);
  },

  negative() {
    this.hide();
  },

  testOption(string) {
    return this.currentCommand && new RegExp(`--${string}`).test(this.currentCommand.get('rawStr'));
  },

  show(deferred, command) {
    this.currentCommand = command;
    // doing the update on show will allow us to fade which will be nice
    this.updateSolvedStatus();

    this.showDeferred = deferred;
    this.keyboardListener.listen();
    LevelDropdownView.__super__.show.apply(this);
  },

  hide() {
    if (this.showDeferred) {
      this.showDeferred.resolve();
    }
    this.showDeferred = undefined;
    this.keyboardListener.mute();
    this.turnOffKeyboardSelection();

    LevelDropdownView.__super__.hide.apply(this);
  },

  loadLevelID(id) {
    if (!this.testOption('noOutput')) {
      Main.getEventBaton().trigger(
        'commandSubmitted',
        `level ${id}`,
      );
      const level = LevelStore.getLevel(id);
      const name = level.name.en_US;
      log.levelSelected(name);
    }
    this.hide();
  },

  updateSolvedStatus() {
    this.seriesViews.forEach((view) => {
      view.updateSolvedStatus();
    }, this);
  },

  buildSequences() {
    this.seriesViews = [];
    this.getSequencesOnTab().forEach(function (sequenceName) {
      this.seriesViews.push(new SeriesView({
        destination: this.$el,
        name: sequenceName,
        navEvents: this.navEvents,
      }));
    }, this);
  },
});

var SeriesView = BaseView.extend({
  tagName: 'div',
  className: 'seriesView box flex1 vertical',
  template: _.template($('#series-view').html()),
  events: {
    'click div.levelIcon': 'click',
    'mouseenter div.levelIcon': 'enterIcon',
  },

  initialize(options) {
    this.name = options.name || 'intro';
    this.navEvents = options.navEvents;
    this.info = LevelStore.getSequenceInfo(this.name);
    this.levels = LevelStore.getLevelsInSequence(this.name);

    this.levelIDs = [];
    let firstLevelInfo = null;
    this.levels.forEach(function (level) {
      if (firstLevelInfo === null) {
        firstLevelInfo = this.formatLevelAbout(level.id);
      }
      this.levelIDs.push(level.id);
    }, this);

    this.destination = options.destination;
    // use a non-breaking space to prevent the level from bouncing around
    // from missing strings
    this.JSON = {
      displayName: intl.getIntlKey(this.info, 'displayName'),
      about: intl.getIntlKey(this.info, 'about') || '&nbsp;',
      levelInfo: firstLevelInfo,
      ids: this.levelIDs,
    };

    this.render();
    this.updateSolvedStatus();
  },

  updateSolvedStatus() {
    // this is a bit hacky, it really should be some nice model
    // property changing but it's the 11th hour...
    const toLoop = this.$('div.levelIcon').each((index, element) => {
      const id = $(element).attr('data-id');
      $(element).toggleClass('solved', LevelStore.isLevelSolved(id));
    });
  },

  getEventID(event) {
    const element = event.target;
    return $(element).attr('data-id');
  },

  setAbout(content) {
    this.$('p.levelInfo').text(content);
  },

  enterIcon(event) {
    const id = this.getEventID(event);
    this.updateAboutForLevelID(id);
  },

  updateAboutForLevelID(id) {
    this.setAbout(this.formatLevelAbout(id));
  },

  formatLevelAbout(id) {
    const level = LevelStore.getLevel(id);
    return `${this.getLevelNumberFromID(id)
    }: ${
      intl.getName(level)}`;
  },

  getLevelNumberFromID(id) {
    // hack -- parse out the level number from the ID
    return id.replace(/\D/g, '');
  },

  click(event) {
    const id = this.getEventID(event);
    this.navEvents.trigger('clickedID', id);
  },
});

exports.LevelDropdownView = LevelDropdownView;

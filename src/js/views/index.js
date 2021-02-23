const _ = require('underscore');
const Q = require('q');
const Backbone = require('backbone');
const marked = require('marked');

const Main = require('../app');
const intl = require('../intl');
const log = require('../log');
const Constants = require('../util/constants');
const { KeyboardListener } = require('../util/keyboard');
const debounce = require('../util/debounce');
const throttle = require('../util/throttle');

const BaseView = Backbone.View.extend({
  getDestination() {
    return this.destination || this.container.getInsideElement();
  },

  tearDown() {
    this.$el.remove();
    if (this.container) {
      this.container.tearDown();
    }
  },

  renderAgain(HTML) {
    // flexibility
    HTML = HTML || this.template(this.JSON);
    this.$el.html(HTML);
  },

  render(HTML) {
    this.renderAgain(HTML);
    const destination = this.getDestination();
    $(destination).append(this.el);
  },
});

const ResolveRejectBase = BaseView.extend({
  resolve() {
    this.deferred.resolve();
  },

  reject() {
    this.deferred.reject();
  },
});

const PositiveNegativeBase = BaseView.extend({
  positive() {
    this.navEvents.trigger('positive');
  },

  exit() {
    this.navEvents.trigger('exit');
  },

  negative() {
    this.navEvents.trigger('negative');
  },
});

const ContainedBase = BaseView.extend({
  getAnimationTime() { return 700; },

  show() {
    this.container.show();
  },

  hide() {
    this.container.hide();
  },

  die() {
    this.hide();
    setTimeout(() => {
      this.tearDown();
    }, this.getAnimationTime() * 1.1);
  },
});

const GeneralButton = ContainedBase.extend({
  tagName: 'a',
  className: 'generalButton uiButton',
  template: _.template($('#general-button').html()),
  events: {
    click: 'click',
  },

  initialize(options) {
    options = options || {};
    this.navEvents = options.navEvents || ({ ...Backbone.Events });
    this.destination = options.destination;
    if (!this.destination) {
      this.container = new ModalTerminal();
    }

    this.JSON = {
      buttonText: options.buttonText || 'General Button',
      wantsWrapper: (options.wantsWrapper !== undefined) ? options.wantsWrapper : true,
    };

    this.render();

    if (this.container && !options.wait) {
      this.show();
    }
  },

  click() {
    if (!this.clickFunc) {
      this.clickFunc = throttle(
        this.sendClick.bind(this),
        500,
      );
    }
    this.clickFunc();
  },

  sendClick: function () {
    this.navEvents.trigger('click');
  }.bind(this),
});

const ConfirmCancelView = ResolveRejectBase.extend({
  tagName: 'div',
  className: 'confirmCancelView box horizontal justify',
  template: _.template($('#confirm-cancel-template').html()),
  events: {
    'click .confirmButton': 'resolve',
    'click .cancelButton': 'reject',
  },

  initialize(options) {
    if (!options.destination) {
      throw new Error('needmore');
    }

    this.destination = options.destination;
    this.deferred = options.deferred || Q.defer();
    this.JSON = {
      confirm: options.confirm || intl.str('confirm-button'),
      cancel: options.cancel || intl.str('cancel-button'),
    };

    this.render();
  },
});

var LeftRightView = PositiveNegativeBase.extend({
  tagName: 'div',
  className: 'leftRightView box horizontal center',
  template: _.template($('#left-right-template').html()),

  initialize(options) {
    if (!options.destination || !options.events) {
      throw new Error('needmore');
    }

    this.destination = options.destination;

    // we switch to a system where every leftrightview has its own
    // events system to add support for git demonstration view taking control of the
    // click events
    this.pipeEvents = options.events;
    this.navEvents = { ...Backbone.Events };

    this.JSON = {
      showLeft: (options.showLeft === undefined) ? true : options.showLeft,
      lastNav: (options.lastNav === undefined) ? false : options.lastNav,
    };

    this.render();
    // For some weird reason backbone events aren't working anymore so
    // im going to just wire this up manually
    this.$('div.right').click(this.positive.bind(this));
    this.$('div.left').click(this.negative.bind(this));
    this.$('div.exit').click(this.exit.bind(this));
  },

  exit() {
    this.pipeEvents.trigger('exit');
    LeftRightView.__super__.exit.apply(this);
  },

  positive() {
    this.pipeEvents.trigger('positive');
    LeftRightView.__super__.positive.apply(this);
  },

  negative() {
    this.pipeEvents.trigger('negative');
    LeftRightView.__super__.negative.apply(this);
  },

});

const ModalView = Backbone.View.extend({
  tagName: 'div',
  className: 'modalView box horizontal center transitionOpacityLinear',
  template: _.template($('#modal-view-template').html()),

  getAnimationTime() { return 700; },

  initialize(options) {
    this.shown = false;
    this.render();
  },

  render() {
    // add ourselves to the DOM
    this.$el.html(this.template({}));
    $('body').append(this.el);
    // this doesn't necessarily show us though...
  },

  stealKeyboard() {
    Main.getEventBaton().stealBaton('keydown', this.onKeyDown, this);
    Main.getEventBaton().stealBaton('keyup', this.onKeyUp, this);
    Main.getEventBaton().stealBaton('windowFocus', this.onWindowFocus, this);
    Main.getEventBaton().stealBaton('documentClick', this.onDocumentClick, this);

    // blur the text input field so keydown events will not be caught by our
    // preventDefaulters, allowing people to still refresh and launch inspector (etc)
    $('#commandTextField').blur();
  },

  releaseKeyboard() {
    Main.getEventBaton().releaseBaton('keydown', this.onKeyDown, this);
    Main.getEventBaton().releaseBaton('keyup', this.onKeyUp, this);
    Main.getEventBaton().releaseBaton('windowFocus', this.onWindowFocus, this);
    Main.getEventBaton().releaseBaton('documentClick', this.onDocumentClick, this);

    Main.getEventBaton().trigger('windowFocus');
  },

  onWindowFocus(e) {
    // console.log('window focus doing nothing', e);
  },

  onDocumentClick(e) {
    // console.log('doc click doing nothing', e);
  },

  onKeyDown(e) {
    e.preventDefault();
  },

  onKeyUp(e) {
    e.preventDefault();
  },

  show() {
    this.toggleZ(true);
    // on reflow, change our class to animate. for whatever
    // reason if this is done immediately, chrome might combine
    // the two changes and lose the ability to animate and it looks bad.
    process.nextTick(() => {
      this.toggleShow(true);
    });
  },

  hide() {
    this.toggleShow(false);
    setTimeout(() => {
      // if we are still hidden...
      if (!this.shown) {
        this.toggleZ(false);
      }
    }, this.getAnimationTime());
  },

  getInsideElement() {
    return this.$('.contentHolder');
  },

  toggleShow(value) {
    // this prevents releasing keyboard twice
    if (this.shown === value) { return; }

    if (value) {
      this.stealKeyboard();
    } else {
      this.releaseKeyboard();
    }

    this.shown = value;
    this.$el.toggleClass('show', value);
  },

  toggleZ(value) {
    this.$el.toggleClass('inFront', value);
  },

  tearDown() {
    this.$el.html('');
    $('body')[0].removeChild(this.el);
  },
});

var ModalTerminal = ContainedBase.extend({
  tagName: 'div',
  className: 'modalTerminal box flex1',
  template: _.template($('#terminal-window-template').html()),
  events: {
    'click div.inside': 'onClick',
  },

  initialize(options) {
    options = options || {};
    this.navEvents = options.events || ({ ...Backbone.Events });

    this.container = new ModalView();
    this.JSON = {
      title: options.title,
    };

    this.render();
  },

  updateTitle(/* string */ title) {
    this.$('.modal-title').text(title);
  },

  onClick() {
    this.navEvents.trigger('click');
  },

  getInsideElement() {
    return this.$('.inside');
  },
});

var ModalAlert = ContainedBase.extend({
  tagName: 'div',
  template: _.template($('#modal-alert-template').html()),

  initialize(options) {
    this.options = options || {};
    this.JSON = {
      title: options.title || 'Something to say',
      text: options.text || 'Here is a paragraph',
      markdown: options.markdown,
    };

    if (options.markdowns) {
      this.JSON.markdown = options.markdowns.join('\n');
    }

    this.container = new ModalTerminal({});
    this.render();

    if (!options.wait) {
      this.show();
    }
  },

  render() {
    let HTML = (this.JSON.markdown)
      ? marked(this.JSON.markdown)
      : this.template(this.JSON);
    // one more hack -- allow adding custom random HTML if specified
    if (this.options._dangerouslyInsertHTML) {
      HTML += this.options._dangerouslyInsertHTML;
    }

    // call to super, not super elegant but better than
    // copy paste code
    Reflect.apply(ModalAlert.__super__.render, this, [HTML]);
  },
});

const ConfirmCancelTerminal = Backbone.View.extend({
  initialize(options) {
    options = options || {};

    this.deferred = options.deferred || Q.defer();
    this.modalAlert = new ModalAlert({

      markdown: '#you sure?',
      ...options,
    });

    const buttonDefer = Q.defer();
    this.buttonDefer = buttonDefer;
    this.confirmCancel = new ConfirmCancelView({
      deferred: buttonDefer,
      destination: this.modalAlert.getDestination(),
    });

    // whenever they hit a button. make sure
    // we close and pass that to our deferred
    buttonDefer.promise
      .then(this.deferred.resolve)
      .fail(this.deferred.reject)
      .done(() => {
        this.close();
      });

    // also setup keyboard
    this.navEvents = { ...Backbone.Events };
    this.navEvents.on('positive', this.positive, this);
    this.navEvents.on('negative', this.negative, this);
    this.keyboardListener = new KeyboardListener({
      events: this.navEvents,
      aliasMap: {
        enter: 'positive',
        esc: 'negative',
      },
    });

    if (!options.wait) {
      this.modalAlert.show();
    }
  },

  positive() {
    this.buttonDefer.resolve();
  },

  negative() {
    this.buttonDefer.reject();
  },

  getAnimationTime() { return 700; },

  show() {
    this.modalAlert.show();
  },

  hide() {
    this.modalAlert.hide();
  },

  getPromise() {
    return this.deferred.promise;
  },

  close() {
    this.keyboardListener.mute();
    this.modalAlert.die();
  },
});

var NextLevelConfirm = ConfirmCancelTerminal.extend({
  initialize(options) {
    options = options || {};
    const nextLevelName = (options.nextLevel)
      ? intl.getName(options.nextLevel)
      : '';

    // lol hax
    const { markdowns } = intl.getDialog(require('../dialogs/nextLevel'))[0].options;
    let markdown = markdowns.join('\n');
    markdown = intl.template(markdown, {
      numCommands: options.numCommands,
      best: options.best,
    });

    markdown = options.numCommands <= options.best ? `${markdown}\n\n${intl.str('finish-dialog-win')}` : `${markdown}\n\n${intl.str('finish-dialog-lose', { best: options.best })}`;

    markdown += '\n\n';
    let extraHTML;
    if (options.nextLevel) {
      markdown += intl.str('finish-dialog-next', { nextLevel: nextLevelName });
    } else {
      extraHTML = `<p class="catchadream">${intl.str('finish-dialog-finished')
      } (ﾉ^_^)ﾉ (ﾉ^_^)ﾉ (ﾉ^_^)ﾉ`
        + '</p>';
    }

    options = {

      ...options,
      markdown,
      _dangerouslyInsertHTML: extraHTML,
    };

    Reflect.apply(NextLevelConfirm.__super__.initialize, this, [options]);
  },
});

const ViewportAlert = Backbone.View.extend({
  initialize(options) {
    this.grabBatons();
    this.modalAlert = new ModalAlert({
      markdowns: this.markdowns,
    });
    this.modalAlert.show();
  },

  grabBatons() {
    Main.getEventBaton().stealBaton(this.eventBatonName, this.batonFired, this);
  },

  releaseBatons() {
    Main.getEventBaton().releaseBaton(this.eventBatonName, this.batonFired, this);
  },

  finish() {
    this.releaseBatons();
    this.modalAlert.die();
  },
});

var WindowSizeAlertWindow = ViewportAlert.extend({
  initialize(options) {
    this.eventBatonName = 'windowSizeCheck';
    this.markdowns = [
      '## That window size is not supported :-/',
      'Please resize your window back to a supported size',
      '',
      '(and of course, pull requests to fix this are appreciated :D)',
    ];
    Reflect.apply(WindowSizeAlertWindow.__super__.initialize, this, [options]);
  },

  batonFired(size) {
    if (size.w > Constants.VIEWPORT.minWidth
        && size.h > Constants.VIEWPORT.minHeight) {
      this.finish();
    }
  },
});

var ZoomAlertWindow = ViewportAlert.extend({
  initialize(options) {
    if (!options || !options.level) { throw new Error('need level'); }

    this.eventBatonName = 'zoomChange';
    this.markdowns = [
      `## That zoom level of ${options.level} is not supported :-/`,
      'Please zoom back to a supported zoom level with Ctrl + and Ctrl -',
      '',
      '(and of course, pull requests to fix this are appreciated :D)',
    ];
    Reflect.apply(ZoomAlertWindow.__super__.initialize, this, [options]);
  },

  batonFired(level) {
    if (level <= Constants.VIEWPORT.maxZoom
        && level >= Constants.VIEWPORT.minZoom) {
      this.finish();
    }
  },
});

const CanvasTerminalHolder = BaseView.extend({
  tagName: 'div',
  className: 'canvasTerminalHolder box flex1',
  template: _.template($('#terminal-window-bare-template').html()),
  events: {
    'click div.wrapper': 'onClick',
  },

  initialize(options) {
    options = options || {};
    this.parent = options.parent;
    this.minHeight = options.minHeight || 200;
    this.destination = $('body');
    this.JSON = {
      title: options.title || intl.str('goal-to-reach'),
      text: options.text || intl.str('hide-goal'),
    };

    this.render();
    this.inDom = true;

    this.$terminal = this.$el.find('.terminal-window-holder').first();
    this.$terminal.height(0.8 * $(window).height());
    this.$terminal.draggable({
      cursor: 'move',
      handle: '.toolbar',
      containment: '#interfaceWrapper',
      scroll: false,
    });

    // If the entire window gets resized such that the terminal is outside the view, then
    // move it back into the view, and expand/shrink it vertically as necessary.
    $(window).on('resize', debounce(this.recalcLayout.bind(this), 300));

    if (options.additionalClass) {
      this.$el.addClass(options.additionalClass);
    }
  },

  getAnimationTime() { return 700; },

  onClick() {
    this.die();
  },

  die() {
    this.minimize();
    this.inDom = false;

    setTimeout(() => {
      this.tearDown();
    }, this.getAnimationTime());
  },

  minimize() {
    this.parent.trigger('minimizeCanvas', {
      left: this.$terminal.css('left'),
      top: this.$terminal.css('top'),
    }, {
      width: this.$terminal.css('width'),
      height: this.$terminal.css('height'),
    });

    this.$terminal.animate({
      height: '0px',
      opacity: 0,
    }, this.getAnimationTime());
  },

  restore(pos, size) {
    const self = this;
    pos = pos || { top: this.$terminal.css('top'), left: this.$terminal.css('left') };
    size = size || { width: this.$terminal.css('width'), height: this.$terminal.css('height') };

    this.$terminal.css({
      top: pos.top,
      left: pos.left,
      width: size.width,
      height: '0px',
      opacity: '0',
    });

    this.$terminal.animate({
      height: size.height,
      opacity: 1,
    }, this.getAnimationTime(), () => {
      self.recalcLayout();
    });
  },

  recalcLayout() {
    // Resize/reposition self based on the size of the browser window.

    const { parent } = this;
    let leftOffset = 0;
    let topOffset = 0;
    let heightOffset = 0;
    const width = this.$terminal.outerWidth();
    let height = this.$terminal.outerHeight();
    let { left } = this.$terminal.offset();
    let { top } = this.$terminal.offset();
    const right = ($(window).width() - (left + width));
    const bottom = ($(window).height() - (top + height));
    const minHeight = 0.75 * $(window).height();
    const maxHeight = 0.95 * $(window).height();

    // Calculate offsets
    if (top < 0) { topOffset = -top; }
    if (left < 0) { leftOffset = -left; }
    if (right < 0) { leftOffset = right; }
    if (bottom < 0) { topOffset = bottom; }
    if (height < minHeight) { heightOffset = minHeight - height; }
    if (height > maxHeight) { heightOffset = maxHeight - height; }

    // Establish limits
    left = Math.max(left + leftOffset, 0);
    top = Math.max(top + topOffset, 0);
    height = Math.max(height + heightOffset, minHeight);

    // Set the new position/size
    this.$terminal.animate({
      left: `${left}px`,
      top: `${top}px`,
      height: `${height}px`,
    }, this.getAnimationTime(), () => {
      parent.trigger('resizeCanvas');
    });
  },

  getCanvasLocation() {
    return this.$('div.inside')[0];
  },
});

exports.BaseView = BaseView;
exports.GeneralButton = GeneralButton;
exports.ModalView = ModalView;
exports.ModalTerminal = ModalTerminal;
exports.ModalAlert = ModalAlert;
exports.ContainedBase = ContainedBase;
exports.ConfirmCancelView = ConfirmCancelView;
exports.LeftRightView = LeftRightView;
exports.ZoomAlertWindow = ZoomAlertWindow;
exports.ConfirmCancelTerminal = ConfirmCancelTerminal;
exports.WindowSizeAlertWindow = WindowSizeAlertWindow;

exports.CanvasTerminalHolder = CanvasTerminalHolder;
exports.NextLevelConfirm = NextLevelConfirm;

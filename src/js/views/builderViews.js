const _ = require('underscore');
const Q = require('q');
const marked = require('marked');

const Views = require('.');
const throttle = require('../util/throttle');

const { ModalTerminal } = Views;
const { ContainedBase } = Views;

const TextGrabber = ContainedBase.extend({
  tagName: 'div',
  className: 'textGrabber box vertical',
  template: _.template($('#text-grabber').html()),

  initialize(options) {
    options = options || {};
    this.JSON = {
      helperText: options.helperText || 'Enter some text',
    };

    this.container = options.container || new ModalTerminal({
      title: 'Enter some text',
    });
    this.render();
    if (options.initialText) {
      this.setText(options.initialText);
    }

    if (!options.wait) {
      this.show();
    }
  },

  getText() {
    return this.$('textarea').val();
  },

  setText(string) {
    this.$('textarea').val(string);
  },
});

const MarkdownGrabber = ContainedBase.extend({
  tagName: 'div',
  className: 'markdownGrabber box horizontal',
  template: _.template($('#markdown-grabber-view').html()),
  events: {
    'keyup textarea': 'keyup',
  },

  initialize(options) {
    options = options || {};
    this.deferred = options.deferred || Q.defer();

    if (options.fromObj) {
      options.fillerText = options.fromObj.options.markdowns.join('\n');
    }

    this.JSON = {
      previewText: options.previewText || 'Preview',
      fillerText: options.fillerText || '## Enter some markdown!\n\n\n',
    };

    this.container = options.container || new ModalTerminal({
      title: options.title || 'Enter some markdown',
    });
    this.render();

    if (!options.withoutButton) {
      // do button stuff
      const buttonDefer = Q.defer();
      buttonDefer.promise
        .then(this.confirmed.bind(this))
        .fail(this.cancelled.bind(this))
        .done();

      const confirmCancel = new Views.ConfirmCancelView({
        deferred: buttonDefer,
        destination: this.getDestination(),
      });
    }

    this.updatePreview();

    if (!options.wait) {
      this.show();
    }
  },

  confirmed() {
    this.die();
    this.deferred.resolve(this.getRawText());
  },

  cancelled() {
    this.die();
    this.deferred.resolve();
  },

  keyup() {
    if (!this.throttledPreview) {
      this.throttledPreview = throttle(
        this.updatePreview.bind(this),
        500,
      );
    }
    this.throttledPreview();
  },

  getRawText() {
    return this.$('textarea').val();
  },

  exportToArray() {
    return this.getRawText().split('\n');
  },

  getExportObj() {
    return {
      markdowns: this.exportToArray(),
    };
  },

  updatePreview() {
    const raw = this.getRawText();
    const HTML = marked(raw);
    this.$('div.insidePreview').html(HTML);
  },
});

const MarkdownPresenter = ContainedBase.extend({
  tagName: 'div',
  className: 'markdownPresenter box vertical',
  template: _.template($('#markdown-presenter').html()),

  initialize(options) {
    options = options || {};
    this.deferred = options.deferred || Q.defer();
    this.JSON = {
      previewText: options.previewText || 'Here is something for you',
      fillerText: options.fillerText || '# Yay',
    };

    this.container = new ModalTerminal({
      title: 'Check this out...',
    });
    this.render();

    if (!options.noConfirmCancel) {
      const confirmCancel = new Views.ConfirmCancelView({
        destination: this.getDestination(),
      });
      confirmCancel.deferred.promise
        .then(() => {
          this.deferred.resolve(this.grabText());
        })
        .fail(() => {
          this.deferred.reject();
        })
        .done(this.die.bind(this));
    }

    this.show();
  },

  grabText() {
    return this.$('textarea').val();
  },
});

const DemonstrationBuilder = ContainedBase.extend({
  tagName: 'div',
  className: 'demonstrationBuilder box vertical',
  template: _.template($('#demonstration-builder').html()),
  events: {
    'click div.testButton': 'testView',
  },

  initialize(options) {
    options = options || {};
    this.deferred = options.deferred || Q.defer();
    if (options.fromObj) {
      const toEdit = options.fromObj.options;
      options = {

        ...options,
        ...toEdit,
        beforeMarkdown: toEdit.beforeMarkdowns.join('\n'),
        afterMarkdown: toEdit.afterMarkdowns.join('\n'),
      };
    }

    this.JSON = {};
    this.container = new ModalTerminal({
      title: 'Demonstration Builder',
    });
    this.render();

    // build the two markdown grabbers
    this.beforeMarkdownView = new MarkdownGrabber({
      container: this,
      withoutButton: true,
      fillerText: options.beforeMarkdown,
      previewText: 'Before demonstration Markdown',
    });
    this.beforeCommandView = new TextGrabber({
      container: this,
      helperText: 'The git command(s) to set up the demonstration view (before it is displayed)',
      initialText: options.beforeCommand || 'git checkout -b bugFix',
    });

    this.commandView = new TextGrabber({
      container: this,
      helperText: 'The git command(s) to demonstrate to the reader',
      initialText: options.command || 'git commit',
    });

    this.afterMarkdownView = new MarkdownGrabber({
      container: this,
      withoutButton: true,
      fillerText: options.afterMarkdown,
      previewText: 'After demonstration Markdown',
    });

    // build confirm button
    const buttonDeferred = Q.defer();
    const confirmCancel = new Views.ConfirmCancelView({
      deferred: buttonDeferred,
      destination: this.getDestination(),
    });

    buttonDeferred.promise
      .then(this.confirmed.bind(this))
      .fail(this.cancelled.bind(this))
      .done();
  },

  testView() {
    const { MultiView } = require('./multiView');
    new MultiView({
      childViews: [{
        type: 'GitDemonstrationView',
        options: this.getExportObj(),
      }],
    });
  },

  getExportObj() {
    return {
      beforeMarkdowns: this.beforeMarkdownView.exportToArray(),
      afterMarkdowns: this.afterMarkdownView.exportToArray(),
      command: this.commandView.getText(),
      beforeCommand: this.beforeCommandView.getText(),
    };
  },

  confirmed() {
    this.die();
    this.deferred.resolve(this.getExportObj());
  },

  cancelled() {
    this.die();
    this.deferred.resolve();
  },

  getInsideElement() {
    return this.$('.insideBuilder')[0];
  },
});

const MultiViewBuilder = ContainedBase.extend({
  tagName: 'div',
  className: 'multiViewBuilder box vertical',
  template: _.template($('#multi-view-builder').html()),
  typeToConstructor: {
    ModalAlert: MarkdownGrabber,
    GitDemonstrationView: DemonstrationBuilder,
  },

  events: {
    'click div.deleteButton': 'deleteOneView',
    'click div.testButton': 'testOneView',
    'click div.editButton': 'editOneView',
    'click div.testEntireView': 'testEntireView',
    'click div.addView': 'addView',
    'click div.saveView': 'saveView',
    'click div.cancelView': 'cancel',
  },

  initialize(options) {
    options = options || {};
    this.deferred = options.deferred || Q.defer();
    this.multiViewJSON = options.multiViewJSON || {};

    this.JSON = {
      views: this.getChildViews(),
      supportedViews: Object.keys(this.typeToConstructor),
    };

    this.container = new ModalTerminal({
      title: 'Build a MultiView!',
    });
    this.render();

    this.show();
  },

  saveView() {
    this.hide();
    this.deferred.resolve(this.multiViewJSON);
  },

  cancel() {
    this.hide();
    this.deferred.resolve();
  },

  addView(event) {
    const element = event.target;
    const type = $(element).attr('data-type');

    const whenDone = Q.defer();
    const Constructor = this.typeToConstructor[type];
    const builder = new Constructor({
      deferred: whenDone,
    });
    whenDone.promise
      .then(() => {
        const newView = {
          type,
          options: builder.getExportObj(),
        };
        this.addChildViewObj(newView);
      })
      .fail(() => {
      // they don't want to add the view apparently, so just return
      })
      .done();
  },

  testOneView(event) {
    const element = event.target;
    const index = $(element).attr('data-index');
    const toTest = this.getChildViews()[index];
    const { MultiView } = require('./multiView');
    new MultiView({
      childViews: [toTest],
    });
  },

  testEntireView() {
    const { MultiView } = require('./multiView');
    new MultiView({
      childViews: this.getChildViews(),
    });
  },

  editOneView(event) {
    const element = event.target;
    const index = $(element).attr('data-index');
    const type = $(element).attr('data-type');

    const whenDone = Q.defer();
    const builder = new this.typeToConstructor[type]({
      deferred: whenDone,
      fromObj: this.getChildViews()[index],
    });
    whenDone.promise
      .then(() => {
        const newView = {
          type,
          options: builder.getExportObj(),
        };
        const views = this.getChildViews();
        views[index] = newView;
        this.setChildViews(views);
      })
      .fail(() => {})
      .done();
  },

  deleteOneView(event) {
    const element = event.target;
    const index = $(element).attr('data-index');
    const toSlice = this.getChildViews();

    const updated = toSlice.slice(0, index).concat(toSlice.slice(index + 1));
    this.setChildViews(updated);
    this.update();
  },

  addChildViewObj(newObject, index) {
    const childViews = this.getChildViews();
    childViews.push(newObject);
    this.setChildViews(childViews);
    this.update();
  },

  setChildViews(newArray) {
    this.multiViewJSON.childViews = newArray;
  },

  getChildViews() {
    return this.multiViewJSON.childViews || [];
  },

  update() {
    this.JSON.views = this.getChildViews();
    this.renderAgain();
  },
});

exports.MarkdownGrabber = MarkdownGrabber;
exports.DemonstrationBuilder = DemonstrationBuilder;
exports.TextGrabber = TextGrabber;
exports.MultiViewBuilder = MultiViewBuilder;
exports.MarkdownPresenter = MarkdownPresenter;

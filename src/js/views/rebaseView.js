const _ = require('underscore');
const Q = require('q');
const Backbone = require('backbone');
const { GitError } = require('../util/errors');

const { ModalTerminal } = require('.');
const { ContainedBase } = require('.');
const { ConfirmCancelView } = require('.');

const intl = require('../intl');

require('jquery-ui/ui/widget');
require('jquery-ui/ui/scroll-parent');
require('jquery-ui/ui/data');
require('jquery-ui/ui/widgets/mouse');
require('jquery-ui/ui/ie');
require('jquery-ui/ui/widgets/sortable');
require('jquery-ui/ui/plugin');
require('jquery-ui/ui/safe-active-element');
require('jquery-ui/ui/safe-blur');
require('jquery-ui/ui/widgets/draggable');

const InteractiveRebaseView = ContainedBase.extend({
  tagName: 'div',
  template: _.template($('#interactive-rebase-template').html()),

  initialize(options) {
    this.deferred = options.deferred;
    this.rebaseMap = {};
    this.entryObjMap = {};
    this.options = options;

    this.rebaseEntries = new RebaseEntryCollection();
    options.toRebase.reverse();
    options.toRebase.forEach(function (commit) {
      const id = commit.get('id');
      this.rebaseMap[id] = commit;

      // make basic models for each commit
      this.entryObjMap[id] = new RebaseEntry({
        id,
      });
      this.rebaseEntries.add(this.entryObjMap[id]);
    }, this);

    this.container = new ModalTerminal({
      title: intl.str('interactive-rebase-title'),
    });
    this.render();

    // show the dialog holder
    this.show();

    if (options.aboveAll) {
      // TODO fix this :(
      $('#canvasHolder').css('display', 'none');
    }
  },

  restoreVis() {
    // restore the absolute position canvases
    $('#canvasHolder').css('display', 'inherit');
  },

  confirm() {
    this.die();
    if (this.options.aboveAll) {
      this.restoreVis();
    }

    // get our ordering
    const uiOrder = [];
    this.$('ul.rebaseEntries li').each((index, object) => {
      uiOrder.push(object.id);
    });

    // now get the real array
    const toRebase = [];
    uiOrder.forEach(function (id) {
      // the model pick check
      if (this.entryObjMap[id].get('pick')) {
        toRebase.unshift(this.rebaseMap[id]);
      }
    }, this);
    toRebase.reverse();

    this.deferred.resolve(toRebase);
    // garbage collection will get us
    this.$el.html('');
  },

  render() {
    const json = {
      num: Object.keys(this.rebaseMap).length,
      solutionOrder: this.options.initialCommitOrdering,
    };

    const destination = this.container.getInsideElement();
    this.$el.html(this.template(json));
    $(destination).append(this.el);

    // also render each entry
    const listHolder = this.$('ul.rebaseEntries');
    this.rebaseEntries.each((entry) => {
      new RebaseEntryView({
        el: listHolder,
        model: entry,
      });
    }, this);

    // then make it reorderable..
    listHolder.sortable({
      axis: 'y',
      placeholder: 'rebaseEntry transitionOpacity ui-state-highlight',
      appendTo: 'parent',
    });

    this.makeButtons();
  },

  cancel() {
    // empty array does nothing, just like in git
    this.hide();
    if (this.options.aboveAll) {
      this.restoreVis();
    }
    this.deferred.resolve([]);
  },

  makeButtons() {
    // control for button
    const deferred = Q.defer();
    deferred.promise
      .then(() => {
        this.confirm();
      })
      .fail(() => {
        this.cancel();
      })
      .done();

    // finally get our buttons
    new ConfirmCancelView({
      destination: this.$('.confirmCancel'),
      deferred,
    });
  },
});

var RebaseEntry = Backbone.Model.extend({
  defaults: {
    pick: true,
  },

  toggle() {
    this.set('pick', !this.get('pick'));
  },
});

var RebaseEntryCollection = Backbone.Collection.extend({
  model: RebaseEntry,
});

var RebaseEntryView = Backbone.View.extend({
  tagName: 'li',
  template: _.template($('#interactive-rebase-entry-template').html()),

  toggle() {
    this.model.toggle();

    // toggle a class also
    this.listEntry.toggleClass('notPicked', !this.model.get('pick'));
  },

  initialize(options) {
    this.render();
  },

  render() {
    this.$el.append(this.template(this.model.toJSON()));

    // hacky :( who would have known jquery barfs on ids with %'s and quotes
    this.listEntry = this.$el.children(':last');

    this.listEntry.delegate('#toggleButton', 'click', () => {
      this.toggle();
    });
  },
});

exports.InteractiveRebaseView = InteractiveRebaseView;

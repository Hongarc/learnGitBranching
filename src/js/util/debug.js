const toGlobalize = {
  App: require('../app/index.js'),
  Tree: require('../visuals/tree'),
  Visuals: require('../visuals'),
  Git: require('../git'),
  CommandModel: require('../models/commandModel'),
  CommandLineStore: require('../stores/CommandLineStore'),
  CommandLineActions: require('../actions/CommandLineActions'),
  LevelActions: require('../actions/LevelActions'),
  LevelStore: require('../stores/LevelStore'),
  LocaleActions: require('../actions/LocaleActions'),
  GlobalStateActions: require('../actions/GlobalStateActions'),
  GlobalStateStore: require('../stores/GlobalStateStore'),
  LocaleStore: require('../stores/LocaleStore'),
  Levels: require('../graph/treeCompare'),
  Constants: require('./constants'),
  Commands: require('../commands'),
  Collections: require('../models/collections'),
  Async: require('../visuals/animation'),
  AnimationFactory: require('../visuals/animation/animationFactory'),
  Main: require('../app'),
  HeadLess: require('../git/headless'),
  Q: { Q: require('q') },
  RebaseView: require('../views/rebaseView'),
  Views: require('../views'),
  MultiView: require('../views/multiView'),
  ZoomLevel: require('./zoomLevel'),
  VisBranch: require('../visuals/visBranch'),
  TreeCompare: require('../graph/treeCompare'),
  Level: require('../level'),
  Sandbox: require('../sandbox'),
  GitDemonstrationView: require('../views/gitDemonstrationView'),
  Markdown: require('marked'),
  LevelDropdownView: require('../views/levelDropdownView'),
  BuilderViews: require('../views/builderViews'),
  Util: require('./index'),
  Intl: require('../intl'),
};

for (const moduleName of Object.keys(toGlobalize)) {
  const module = toGlobalize[moduleName];

  for (const key in module) {
    let value = module[key];
    if (value instanceof Function) {
      value = value.bind(module);
    }
    window[`debug_${moduleName}_${key}`] = value;
  }
}

$(document).ready(() => {
  window.debug_events = toGlobalize.Main.getEvents();
  window.debug_eventBaton = toGlobalize.Main.getEventBaton();
  window.debug_sandbox = toGlobalize.Main.getSandbox();
  window.debug_modules = toGlobalize;
  window.debug_levelDropdown = toGlobalize.Main.getLevelDropdown();
  window.debug_copyTree = function () {
    return toGlobalize.Main.getSandbox().mainVis.gitEngine.printAndCopyTree();
  };
});

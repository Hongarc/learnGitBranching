const React = require('react');
const HelperBarView = require('./HelperBarView.jsx');
const IntlHelperBarView = require('./IntlHelperBarView.jsx');
const CommandsHelperBarView = require('./CommandsHelperBarView.jsx');

const keyMirror = require('../util/keyMirror');
const log = require('../log');

const BARS = keyMirror({
  SELF: null,
  INTL: null,
  COMMANDS: null,
});

class MainHelperBarView extends React.Component {
  constructor(properties, context) {
    super(properties, context);
    this.state = {
      shownBar: BARS.SELF,
    };
  }

  render() {
    return (
      <div>
        <HelperBarView
          className="BaseHelperBar"
          items={this.getItems()}
          shown={this.state.shownBar === BARS.SELF}
        />
        <CommandsHelperBarView
          shown={this.state.shownBar === BARS.COMMANDS}
          onExit={this.showSelf.bind(this)}
        />
        <IntlHelperBarView
          shown={this.state.shownBar === BARS.INTL}
          onExit={this.showSelf.bind(this)}
        />
      </div>
    );
  }

  showSelf() {
    this.setState({
      shownBar: BARS.SELF,
    });
  }

  getItems() {
    return [{
      icon: 'question-sign',
      onClick: function () {
        this.setState({
          shownBar: BARS.COMMANDS,
        });
      }.bind(this),
    }, {
      icon: 'globe',
      onClick: function () {
        this.setState({
          shownBar: BARS.INTL,
        });
      }.bind(this),
    }, {
      newPageLink: true,
      icon: 'twitter',
      href: 'https://twitter.com/petermcottle',
    }, {
      newPageLink: true,
      icon: 'facebook',
      href: 'https://www.facebook.com/LearnGitBranching',
    }];
  }
}

module.exports = MainHelperBarView;

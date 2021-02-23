const React = require('react');
const PropTypes = require('prop-types');

const CommandView = require('./CommandView.jsx');
const Main = require('../app');

const _subscribeEvents = [
  'add',
  'reset',
  'change',
  'all',
];

class CommandHistoryView extends React.Component {
  componentDidMount() {
    for (const _subscribeEvent of _subscribeEvents) {
      this.props.commandCollection.on(
        _subscribeEvent,
        this.updateFromCollection,
        this,
      );
    }

    this.props.commandCollection.on('change', this.scrollDown, this);
    Main.getEvents().on('commandScrollDown', this.scrollDown, this);
    Main.getEvents().on('clearOldCommands', () => this.clearOldCommands(), this);
  }

  componentWillUnmount() {
    for (const _subscribeEvent of _subscribeEvents) {
      this.props.commandCollection.off(
        _subscribeEvent,
        this.updateFromCollection,
        this,
      );
    }
  }

  updateFromCollection() {
    this.forceUpdate();
  }

  clearOldCommands() {
    // go through and get rid of every command that is "processed" or done
    const toDestroy = [];

    this.props.commandCollection.each((command) => {
      if (command.get('status') !== 'inqueue'
          && command.get('status') !== 'processing') {
        toDestroy.push(command);
      }
    }, this);
    toDestroy.forEach((element) => {
      element.destroy();
    });

    this.updateFromCollection();
    this.scrollDown();
  }

  // eslint-disable-next-line class-methods-use-this
  scrollDown() {
    const cD = document.querySelector('#commandDisplay');
    const t = document.querySelector('#terminal');

    // firefox hack
    const shouldScroll = (cD.clientHeight > t.clientHeight)
      || (window.innerHeight < cD.clientHeight);

    // ugh sometimes i wish i had toggle class
    const hasScroll = t.className.match(/scrolling/g);
    if (shouldScroll && !hasScroll) {
      t.className += ' scrolling';
    } else if (!shouldScroll && hasScroll) {
      t.className = t.className.replace(/shouldScroll/g, '');
    }

    if (shouldScroll) {
      t.scrollTop = t.scrollHeight;
    }
  }

  render() {
    const allCommands = [];
    this.props.commandCollection.each((command, index) => {
      allCommands.push(
        <CommandView
          id={`command_${index}`}
          command={command}
          key={command.cid}
        />,
      );
    }, this);
    return (
      <div>
        {allCommands}
      </div>
    );
  }
}

CommandHistoryView.propTypes = {
  // the backbone command model collection
  commandCollection: PropTypes.object.isRequired,
};

module.exports = CommandHistoryView;

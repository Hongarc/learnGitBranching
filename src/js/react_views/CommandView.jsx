const React = require('react');
const ReactDOM = require('react-dom');
const PropTypes = require('prop-types');

const reactUtil = require('../util/reactUtil');
const keyMirror = require('../util/keyMirror');

const STATUSES = keyMirror({
  inqueue: null,
  processing: null,
  finished: null,
});

class CommandView extends React.Component {
  componentDidMount() {
    this.props.command.on('change', this.updateStateFromModel, this);
    this.updateStateFromModel();
  }

  componentWillUnmount() {
    this.props.command.off('change', this.updateStateFromModel, this);
  }

  updateStateFromModel() {
    const commandJSON = this.props.command.toJSON();
    this.setState({
      status: commandJSON.status,
      rawStr: commandJSON.rawStr,
      warnings: commandJSON.warnings,
      result: commandJSON.result,
    });
  }

  constructor(properties, context) {
    super(properties, context);
    this.state = {
      status: STATUSES.inqueue,
      rawStr: 'git commit',
      warnings: [],
      result: '',
    };
  }

  render() {
    const commandClass = reactUtil.joinClasses([
      this.state.status,
      'commandLine',
      'transitionBackground',
    ]);

    return (
      <div id={this.props.id} className="reactCommandView">
        <p className={commandClass}>
          <span className="prompt">$</span>
          {' '}
          <span dangerouslySetInnerHTML={{
            __html: this.state.rawStr,
          }}
          />
          <span className="icons transitionAllSlow">
            <i className="icon-exclamation-sign" />
            <i className="icon-check-empty" />
            <i className="icon-retweet" />
            <i className="icon-check" />
          </span>
        </p>
        {this.renderResult()}
        <div className="commandLineWarnings">
          {this.renderFormattedWarnings()}
        </div>
      </div>
    );
  }

  renderResult() {
    if (!this.state.result) {
      return null;
    }
    // We are going to get a ton of raw markup here
    // so lets split into paragraphs ourselves
    const paragraphs = this.state.result.split('\n');
    const result = [];
    for (const [index, paragraph] of paragraphs.entries()) {
      if (paragraph.startsWith('https://')) {
        result.push(
          <a
            href={paragraph}
            key={`paragraph_${index}`}
            dangerouslySetInnerHTML={{
              __html: paragraph,
            }}
          />,
        );
      } else {
        result.push(
          <p
            key={`paragraph_${index}`}
            dangerouslySetInnerHTML={{
              __html: paragraph,
            }}
          />,
        );
      }
    }
    return (
      <div className="commandLineResult">
        {result}
      </div>
    );
  }

  renderFormattedWarnings() {
    const { warnings } = this.state;
    const result = [];
    for (const [index, warning] of warnings.entries()) {
      result.push(
        <p key={`warning_${index}`}>
          <i className="icon-exclamation-sign" />
          {warning}
        </p>,
      );
    }
    return result;
  }
}

CommandView.propTypes = {
  // the backbone command model
  command: PropTypes.object.isRequired,
  id: PropTypes.string,
};

module.exports = CommandView;

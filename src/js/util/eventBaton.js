function EventBaton(options) {
  this.eventMap = {};
  this.options = options || {};
}

// this method steals the "baton" -- aka, only this method will now
// get called. analogous to events.on
// EventBaton.prototype.on = function(name, func, context) {
EventBaton.prototype.stealBaton = function (name, function_, context) {
  if (!name) { throw new Error('need name'); }
  if (!function_) { throw new Error('need func!'); }

  const listeners = this.eventMap[name] || [];
  listeners.push({
    func: function_,
    context,
  });
  this.eventMap[name] = listeners;
};

EventBaton.prototype.sliceOffArgs = function (number, arguments_) {
  const newArguments = [];
  for (let index = number; index < arguments_.length; index++) {
    newArguments.push(arguments_[index]);
  }
  return newArguments;
};

EventBaton.prototype.trigger = function (name) {
  // arguments is weird and doesn't do slice right
  const argumentsToApply = this.sliceOffArgs(1, arguments);

  const listeners = this.eventMap[name];
  if (!listeners || listeners.length === 0) {
    console.warn('no listeners for', name);
    return;
  }

  // call the top most listener with context and such
  const toCall = listeners.slice(-1)[0];
  toCall.func.apply(toCall.context, argumentsToApply);
};

EventBaton.prototype.getNumListeners = function (name) {
  const listeners = this.eventMap[name] || [];
  return listeners.length;
};

EventBaton.prototype.getListenersThrow = function (name) {
  const listeners = this.eventMap[name];
  if (!listeners || listeners.length === 0) {
    throw new Error(`no one has that baton!${name}`);
  }
  return listeners;
};

EventBaton.prototype.passBatonBackSoft = function (name, function_, context, arguments_) {
  try {
    return this.passBatonBack(name, function_, context, arguments_);
  } catch (error) {}
};

EventBaton.prototype.passBatonBack = function (name, function_, context, arguments_) {
  // this method will call the listener BEFORE the name/func pair. this
  // basically allows you to put in shims, where you steal batons but pass
  // them back if they don't meet certain conditions
  const listeners = this.getListenersThrow(name);

  let indexBefore;
  for (const [index, listenerObject] of listeners.entries()) {
    // skip the first
    if (index === 0) { continue; }
    if (listenerObject.func === function_ && listenerObject.context === context) {
      indexBefore = index - 1;
    }
  }
  if (indexBefore === undefined) {
    throw new Error("you are the last baton holder! or i didn't find you");
  }
  const toCallObject = listeners[indexBefore];

  toCallObject.func.apply(toCallObject.context, arguments_);
};

EventBaton.prototype.releaseBaton = function (name, function_, context) {
  // might be in the middle of the stack, so we have to loop instead of
  // just popping blindly
  const listeners = this.getListenersThrow(name);

  const newListeners = [];
  let found = false;
  for (const listenerObject of listeners) {
    if (listenerObject.func === function_ && listenerObject.context === context) {
      if (found) {
        console.warn('woah duplicates!!!');
        console.log(listeners);
      }
      found = true;
    } else {
      newListeners.push(listenerObject);
    }
  }

  if (!found) {
    console.log('did not find that function', function_, context, name, arguments);
    console.log(this.eventMap);
    throw new Error("can't releasebaton if you don't have it");
  }
  this.eventMap[name] = newListeners;
};

exports.EventBaton = EventBaton;

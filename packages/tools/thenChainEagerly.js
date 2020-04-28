Object.defineProperty(exports, "__esModule", { value: true });

const { dumpObject, wrapError, outputError } = require("./wrapError");

/**
 * Resolves the chain of then-operations eagerly ie. synchronously if
 * possible. If any of the intermediate steps is a thenable, the whole
 * operation behaves like so:
 *
 * return functionChain.reduce(async (intermediate, f) => f(await intermediate), initialValue)
 *
 * Otherwise thenChainEagerly returns the result synchronously, like so:
 *
 * return functionChain.reduce((intermediate, f) => f(intermediate), initialValue)
 *
 * Additionally, if any of the steps throws (synchronously or
 * asynchronously) the thrown error is wrapped with context
 * information. If onRejected is given it will be called with the
 * wrapped error and current chain progress information: the return
 * value will be returned from the whole call or a thrown value
 * wrapped in context like above.
 *
 * Rationale: in ValOS codebase there are pathways which sometimes need
 * to work synchronously and sometimes asynchronously, depending on
 * what data can be known to be cached or not.
 * While 'await' keyword can accept non-thenable values just fine the
 * issue is that declaring a function to be 'async' means that it will
 * always return a thenable: this means that synchronous callers will be
 * broken. Changing synchronous callers to use await or deal with
 * thenables has cascading changes to the surrounding contexts which
 * would lead to larger rewrites.
 *
 * thenChainEagerly solves this problem by retaining the synchronous
 * callsites unchanged with the expense of necessitating the internal
 * sync/async hybrid callpaths to use the somewhat clunkier
 * thenChainEagerly API, instead of the nicer async/await.
 *
 * @export
 * @param {any} head
 * @param {any} callbacks
 * @param {any} onError(error, stepIndex, head, callbacks)
 */

module.exports = {
  mapEagerly,
  thenChainEagerly,
  thisChainEagerly,
  thisChainReturn,
  wrapOutputError,
};

// Sequential map on maybeThenable which awaits for each entry and each
// return value of the mapped function eagerly: if no thenables are
// encountered resolves synchronously.

function mapEagerly (
    entriesOrThenables, // : any[] | Promise<any[]>,
    callbacks, // : Function,
    onRejected, // ?: Function,
    startIndex = 0,
    results = []) {
  let index = null;
  let errorName, entries, entryHead, valueCandidate;
  const callback = (typeof callbacks === "function")
      ? callbacks
      : (e => thenChainEagerly(e, callbacks));
  try {
    if (!Array.isArray(entriesOrThenables)) {
      if ((entriesOrThenables == null) || (typeof entriesOrThenables.then !== "function")) {
        throw new Error("mapEagerly: array expected as first argument");
      }
      errorName = new Error(`During mapEagerly.entriesOrThenables.catch`);
      return entriesOrThenables.then(
          entries_ => mapEagerly(entries_, callback, onRejected, startIndex, results),
          errorOnMapEagerly);
    }
    entries = entriesOrThenables;
    for (index = startIndex;
        index < entries.length;
        results[index++] = valueCandidate) {
      entryHead = entries[index];
      if ((entryHead == null) || (typeof entryHead.then !== "function")) {
        try {
          valueCandidate = callback(entryHead, index, entries);
        } catch (error) {
          errorName = new Error(getName("callback"));
          return errorOnMapEagerly(error);
        }
        if ((valueCandidate == null) || (typeof valueCandidate.then !== "function")) continue;
        errorName = new Error(getName("callback thenable resolution"));
      } else {
        // eslint-disable-next-line no-loop-func
        valueCandidate = entryHead.then(resolvedHead => callback(resolvedHead, index, entries));
        errorName = new Error(getName("head or callback promise resolution"));
      }
      return valueCandidate.then(
          value => { // eslint-disable-line no-loop-func
            results[index] = value;
            return mapEagerly(entries, callback, onRejected, index + 1, results);
          },
          errorOnMapEagerly);
    }
    return results;
  } catch (error) {
    errorName = new Error(getName("handling"));
    return errorOnMapEagerly(error);
  }
  function getName (info) {
    return `During mapEagerly step #${index} ${info} ${
        !(onRejected && onRejected.name) ? " " : `(with ${onRejected.name})`}`;
  }
  function errorOnMapEagerly (error) {
    let innerError = error;
    try {
      if (onRejected) {
        return onRejected(error,
            (index === null) ? entries : entries[index],
            index, results, entries, callback, onRejected);
      }
    } catch (onRejectedError) { innerError = onRejectedError; }
    throw wrapError(innerError, errorName,
        "\n\tentry head:", ...dumpObject(entryHead),
        "\n\tmaybePromises:", ...dumpObject(entries || entriesOrThenables),
        "\n\tcurrent entry:", ...dumpObject((entries || entriesOrThenables || [])[index]));
  }
}

function thenChainEagerly (
    initialValue, // : any,
    functions, // : any | Function[],
    onRejected, // : ?Function,
    startIndex // : number
) {
  const functionChain = (startIndex !== undefined) || Array.isArray(functions) ? functions
      : [functions];
  let next = initialValue;
  let index = startIndex || 0;
  let head;
  for (; (next == null) || (typeof next.then !== "function"); ++index) {
    head = next;
    try {
      if (index >= functionChain.length) return head;
      const func = functionChain[index];
      next = !func ? head : func(head);
    } catch (error) {
      const wrapped = wrapError(error, new Error(getName("callback")),
          "\n\thead:", ...dumpObject(head),
          "\n\tcurrent function:", ...dumpObject(functionChain[index]),
          "\n\tfunctionChain:", ...dumpObject(functionChain));
      if (!onRejected) throw wrapped;
      next = onRejected(wrapped, index, head, functionChain, onRejected);
    }
  }
  --index;
  return next.then(
      newHead => (index + 1 >= functionChain.length
          ? newHead
          : thenChainEagerly(newHead, functionChain, onRejected, index + 1)),
      error => {
        const wrapped = wrapError(error, new Error(getName("thenable")),
            "\n\thead:", ...dumpObject(head),
            "\n\tinitialValue:", ...dumpObject(initialValue),
            "\n\tfunctionChain:", ...dumpObject(functionChain));
        if (!onRejected) throw wrapped;
        return onRejected(wrapped, index, head, functionChain, onRejected);
      });
  function getName (info) {
    const functionName = (functionChain[index] || "").name;
    return `During ${`${functionName ? `${functionName}, as ` : ""
      }thenChainEagerly ${index === -1 ? "initial value" : `step #${index}`}`} ${info}`;
  }
}

function thisChainEagerly (
    this_, // : any,
    initialParams, // : any,
    functions, // : any | Function[],
    onRejected, // : ?Function,
    startIndex // : number
) {
  let index = startIndex || 0, params = initialParams;
  let paramsArrayWithPromise;
  for (;;) {
    if ((params == null) || (typeof params !== "object")) {
      params = (params === undefined) ? [] : [params];
    } else if (Array.isArray(params)) {
      let i = 0;
      for (; i !== params.length; ++i) {
        if ((params[i] != null) && (typeof params[i].then === "function")) {
          params = Promise.all(paramsArrayWithPromise = params);
          break;
        }
      }
      if (params.length === undefined) break;
    } else if (typeof params.then === "function") {
      break;
    } else {
      const keys = Object.keys(params);
      if (keys.length !== 1) {
        throw new Error("thisChainEagerly redirection object must have exactly one field");
      }
      const forwardFunctionKey = keys[0];
      params = params[forwardFunctionKey];
      index = functions[forwardFunctionKey];
      if (typeof index === "function") index = Number(forwardFunctionKey);
      else if (typeof index !== "number") {
        if (forwardFunctionKey === "") return params; // thisChainReturn directive
        index = functions.findIndex(f => (f.name === forwardFunctionKey));
        if (index === -1) {
          throw new Error(
              `thisChainEagerly can't find redirection function with name '${forwardFunctionKey}'`);
        }
        functions[forwardFunctionKey] = index;
      }
      continue;
    }
    if (index >= functions.length) return params;
    const func = functions[index];
    if (!func) continue;
    try {
      params = func.apply(this_, params);
      ++index;
    } catch (error) {
      const wrapped = wrapError(error, new Error(getName("callback")),
          "\n\tthis:", ...dumpObject(this_),
          "\n\tparams:", ...dumpObject(params),
          "\n\tcurrent function:", ...dumpObject(func),
          "\n\tfunctions:", ...dumpObject(functions),
          "\n\tonRejected:", ...dumpObject(onRejected),
        );
      if (!onRejected) throw wrapped;
      params = onRejected.call(this_, wrapped, index, params, functions, onRejected);
      index = functions.length;
    }
  }
  --index;
  return params.then(
      newParams => thisChainEagerly(this_, newParams, functions, onRejected, index + 1),
      error => {
        const wrapped = wrapError(error, new Error(getName("thenable resolution")),
            "\n\tthis:", ...dumpObject(this_),
            "\n\tparams:", ...dumpObject(params),
            "\n\tcurrent function:", ...dumpObject(functions[index]),
            "\n\tfunctions:", ...dumpObject(functions),
            "\n\tonRejected:", ...dumpObject(onRejected),
        );
        if (!onRejected) throw wrapped;
        return thisChainEagerly(this_,
            onRejected.call(
                this_, wrapped, index, paramsArrayWithPromise || params, functions, onRejected),
            functions, onRejected, functions.length);
      });
  function getName (info) {
    const functionName = (functions[index] || "").name;
    return `During ${`${functionName ? `${functionName}, as ` : ""
        }thisChainEagerly ${index === -1 ? "initial params" : `step #${index}`}`} ${info}`;
  }
}

function thisChainReturn (result) {
  return { "": result };
}

function wrapOutputError (callback, header, onError) {
  let actualOnError = onError, actualHeader = header;
  if (typeof header === "function") {
    actualOnError = header;
    actualHeader = header.name;
  }
  return (...forwardedArgs) => thenChainEagerly(
      null,
      () => callback(...forwardedArgs),
      error => {
        let rethrow, ret;
        try {
          if (!actualOnError) rethrow = error;
          else ret = actualOnError(error);
        } catch (innerError) {
          rethrow = innerError;
        }
        outputError(rethrow || error,
            actualHeader || `Exception ${rethrow ? "rethrown" : "caught"} by wrapOutputError`);
        if (rethrow) throw rethrow;
        return ret;
      });
}

// @flow

import isPromise from "~/tools/isPromise";
import { arrayFromAny } from "~/tools/sequenceFromAny";
import wrapError, { dumpObject } from "~/tools/wrapError";

/**
 * Resolves the chain of then-operations eagerly ie. synchronously if possible.
 * If any of the intermediate steps is a promise, the whole operation behaves like so:
 *
 * return functionChain.reduce(async (intermediate, f) => f(await intermediate), initialValue)
 *
 * Otherwise thenChainEagerly returns the result synchronously, like so:
 *
 * return functionChain.reduce((intermediate, f) => f(intermediate), initialValue)
 *
 * Additionally, if any of the steps throws (synchronously or asynchronously) the thrown error is
 * wrapped with context information. Additionally if onRejected is given it will be called with
 * the wrapped error and its result value thrown.
 *
 * Rationale: in Valaa codebase there are pathways which sometimes need to work synchronously and
 * sometimes asynchronously, depending on what data can be known to be cached or not.
 * While 'await' keyword can accept non-promise values just fine the issue is that declaring a
 * function to be 'async' means that it will always return a Promise: this means that synchronous
 * callers will be broken. Changing synchronous callers to use await or deal with promises has
 * cascading changes to the surrounding contexts which would lead to larger rewrites.
 *
 * thenChainEagerly solves this problem by retaining the synchronous callsites unchanged with the
 * expense of necessitating the internal sync/async hybrid callpaths to use the somewhat clunkier
 * thenChainEagerly API, instead of the nicer async/await.
 *
 * @export
 * @param {any} head
 * @param {any} callbacks
 */
export default function thenChainEagerly (initialValue: any,
    functionChain: void | Function | Function[], onRejected?: Function) {
  return thenChainEagerlyList(initialValue, arrayFromAny(functionChain), onRejected, 0);
}

export function thenChainEagerlyList (initialValue: any, functionChain: Function[],
    onRejected: ?Function, startIndex: number = 0) {
  let head = initialValue;
  let currentIndex = startIndex;
  try {
    for (; !isPromise(head); ++currentIndex) {
      if (currentIndex >= functionChain.length) return head;
      head = functionChain[currentIndex](head);
    }
  } catch (error) {
    const wrappedError = wrapError(error, `During thenChainEagerly step #${currentIndex}`,
        "\n\thead:", ...dumpObject(head),
        "\n\tcurrent function:", functionChain[currentIndex],
        "\n\tfunctionChain:", ...dumpObject(functionChain));
    throw (onRejected && onRejected(wrappedError)) || wrappedError;
  }
  return head.then(
      value => (currentIndex >= functionChain.length
          ? value
          : thenChainEagerlyList(
              functionChain[currentIndex](value), functionChain, onRejected, currentIndex + 1)),
      error => (onRejected && onRejected(error)));
}